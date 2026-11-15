import Foundation
import Observation

/// What a session's head is doing right now.
public enum Execution: Equatable, Sendable {
  case idle(failed: String?)
  case responding
  case executing
  case waiting
  case retrying(String)

  public var isBusy: Bool {
    if case .idle = self { return false }
    return true
  }

  init(_ json: JSON) {
    switch json["kind"].string {
    case "live": self = json["phase"].string == "executing" ? .executing : .responding
    case "waiting": self = .waiting
    case "retrying": self = .retrying(json["reason"].string ?? "")
    default:
      let end = json["lastRun"]["end"]
      self = .idle(failed: end["kind"].string == "failed" ? end["failure"]["message"].string : nil)
    }
  }
}

public struct SessionInfo: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String?
  public let workspace: String
  public let parent: String?
  public let archived: Bool
  public let side: Bool
  public let lastActivityAt: Double
  public let execution: Execution

  init(_ json: JSON) {
    id = json["id"].string ?? ""
    name = json["name"].string
    workspace = json["workspace"].string ?? ""
    parent = json["parent"].string
    archived = json["archived"].bool ?? false
    side = json["side"].bool ?? false
    lastActivityAt = json["lastActivityAt"].double ?? 0
    execution = Execution(json["heads"].array.first { $0["name"].string == "main" }?["execution"] ?? .null)
  }
}

/// The host's sessions table, kept current by the `host` scope's change events.
@MainActor
@Observable
public final class SessionDirectory {
  public private(set) var sessions: [SessionInfo] = []
  private var rows: [String: SessionInfo] = [:]
  private var seq = -1.0

  public init() {}

  /// Reads the table. Call it after the socket subscribes to `host`, and again on reconnect.
  public func read(from socket: HostSocket) async {
    guard let output = try? await socket.call("sessions.read", ["parents": ["kind": "roots"], "limit": 200])
    else { return }
    rows = [:]
    for row in output["rows"].array {
      let info = SessionInfo(row)
      rows[info.id] = info
    }
    seq = output["seq"].double ?? 0
    publish()
  }

  public func apply(_ event: JSON) {
    guard event["scope"].string == "host", event["kind"].string == "change",
      let next = event["seq"].double, next > seq
    else { return }
    seq = next
    let table = event["tables"]["sessions"]
    for row in table["upsert"].array {
      let info = SessionInfo(row)
      rows[info.id] = info
    }
    for id in table["drop"].array.compactMap(\.string) { rows[id] = nil }
    publish()
  }

  private func publish() {
    sessions = rows.values.filter { $0.parent == nil && !$0.archived && !$0.side }
      .sorted { ($0.lastActivityAt, $0.id) > ($1.lastActivityAt, $1.id) }
  }
}

/// One line of a transcript: something a person sent, or a part the agent produced.
public struct TranscriptItem: Identifiable, Equatable, Sendable {
  public enum Body: Equatable, Sendable {
    /// What a person sent: their words, and a label for each file or excerpt that rode along.
    case user(String, attachments: [String])
    case answer(markdown: String, live: Bool)
    case thinking(live: Bool)
    case tool(ToolStep)
    case other(kind: String)
  }

  public let id: String
  public let turn: String
  public let body: Body

  public init(id: String, turn: String, body: Body) {
    self.id = id
    self.turn = turn
    self.body = body
  }
}

/// A tool call, reduced to what a designer needs to see of it.
public struct ToolStep: Equatable, Sendable {
  public let name: String
  /// `read`, `list`, `edit`, `shell`, `delegate` or `custom`.
  public let kind: String
  public let path: String?
  public let label: String?
  public let running: Bool
  public let failed: Bool
  public let added: Int?
  public let removed: Int?
}

/// One session head's transcript, kept current by its scope's change events and the text channel.
@MainActor
@Observable
public final class Transcript {
  public let session: String
  public let head: String
  public private(set) var items: [TranscriptItem] = []
  public private(set) var execution: Execution = .idle(failed: nil)
  /// What the running turn says it is doing, such as `Editing`.
  public private(set) var activity: String?
  public private(set) var loaded = false

  private var order: [String] = []
  private var messages: [String: JSON] = [:]
  private var turns: [String: JSON] = [:]
  private var streamed: [String: (version: Double, text: String)] = [:]
  private var seq = -1.0

  public init(session: String, head: String = "main") {
    self.session = session
    self.head = head
  }

  /// Subscribes to the session and reads its window. Call again on reconnect.
  public func read(from socket: HostSocket, tail: Int = 200) async {
    try? await socket.subscribe("session/\(session)")
    guard
      let output = try? await socket.call(
        "head.read",
        ["session": .string(session), "head": .string(head), "window": ["tail": .number(Double(tail))]])
    else { return }
    messages = [:]
    turns = [:]
    order = output["order"].array.compactMap(\.string)
    seq = output["seq"].double ?? 0
    write(output["tables"])
    loaded = true
    publish()
  }

  public func apply(_ event: JSON) {
    guard event["scope"].string == "session/\(session)", event["kind"].string == "change",
      let next = event["seq"].double, next >= seq
    else { return }
    seq = next
    write(event["tables"])
    for path in event["paths"].array where path["head"].string == head {
      let ids = path["ids"].array.compactMap(\.string)
      guard let after = path["after"].string else {
        let kept = order.first.flatMap { ids.firstIndex(of: $0) }
        order = kept.map { Array(ids[$0...]) } ?? ids
        continue
      }
      guard let at = order.firstIndex(of: after) else { continue }
      order = Array(order[...at]) + ids
    }
    publish()
  }

  public func applyText(_ frame: JSON) {
    guard let part = frame["part"].string, messages[part] != nil || order.contains(part) else { return }
    let version = frame["version"].double ?? 0
    if let text = frame["text"].string {
      streamed[part] = (version, text)
    } else if let append = frame["append"].string, let known = streamed[part] {
      streamed[part] = (version, known.text + append)
    } else {
      return
    }
    publish()
  }

  private func write(_ tables: JSON) {
    for row in tables["messages"]["upsert"].array {
      if let id = row["id"].string { messages[id] = row }
    }
    for id in tables["messages"]["drop"].array.compactMap(\.string) { messages[id] = nil }
    for row in tables["turns"]["upsert"].array {
      if let id = row["id"].string { turns[id] = row }
    }
    for row in tables["heads"]["upsert"].array where row["name"].string == head {
      execution = Execution(row["execution"])
    }
  }

  private func publish() {
    var next: [TranscriptItem] = []
    for id in order {
      guard let row = messages[id], let item = item(id, row) else { continue }
      next.append(item)
    }
    if next != items { items = next }
    let running = turns.values.first { $0["state"]["kind"].string == "working" }
    let label = running?["state"]["activity"].string
    if label != activity { activity = label }
  }

  private func item(_ id: String, _ row: JSON) -> TranscriptItem? {
    let turn = row["turn"].string ?? ""
    if row["kind"].string == "user" {
      let content = row["content"]
      let text = content.string
        ?? content.array.compactMap { $0["kind"].string == "text" ? $0["text"].string : nil }
          .joined(separator: "\n")
      let attachments = content.array.compactMap { part -> String? in
        switch part["kind"].string {
        case "reference":
          return part["path"].string.map { URL(filePath: $0).lastPathComponent }
        case "excerpt":
          let source = part["source"]
          guard let path = source["path"].string else { return source["kind"].string }
          let name = URL(filePath: path).lastPathComponent
          return source["start"].int.map { "\(name):\($0)" } ?? name
        case "file":
          return part["name"].string
        case "skill":
          return part["name"].string
        default:
          return nil
        }
      }
      return TranscriptItem(id: id, turn: turn, body: .user(text, attachments: attachments))
    }

    let state = row["state"]
    let live = row["status"]["kind"].string == "live"
    switch row["partKind"].string {
    case "text":
      var markdown = state["markdown"].string ?? ""
      if live, let stream = streamed[id], stream.version >= (row["version"].double ?? 0) {
        markdown = stream.text
      } else if !live {
        streamed[id] = nil
      }
      guard !markdown.isEmpty else { return nil }
      return TranscriptItem(id: id, turn: turn, body: .answer(markdown: markdown, live: live))

    case "thinking":
      return TranscriptItem(id: id, turn: turn, body: .thinking(live: live))

    case "tool":
      let outcome = state["outcome"]
      let kind = state["class"]["kind"].string ?? "custom"
      return TranscriptItem(
        id: id, turn: turn,
        body: .tool(
          ToolStep(
            name: state["name"].string ?? "tool", kind: kind,
            path: state["class"]["path"].string ?? state["args"]["path"].string,
            label: state["class"]["description"].string ?? state["class"]["label"].string
              ?? state["class"]["command"].string,
            running: state["phase"].string != "settled",
            failed: state["phase"].string == "settled" && outcome["kind"].string != "ok",
            added: outcome["output"]["added"].int, removed: outcome["output"]["removed"].int)))

    default:
      return TranscriptItem(id: id, turn: turn, body: .other(kind: row["partKind"].string ?? "part"))
    }
  }
}
