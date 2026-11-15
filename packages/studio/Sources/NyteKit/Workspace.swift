import Foundation

public struct WorkspaceInfo: Identifiable, Hashable, Sendable {
  public let id: String
  /// The folder on the host's machine, or nil for a workspace that isn't a local folder.
  public let path: String?
  public let available: Bool
  public let sessions: Int
  public let isWorktree: Bool

  public var name: String {
    path.map { URL(filePath: $0).lastPathComponent } ?? "Workspace"
  }

  init(_ json: JSON) {
    id = json["id"].string ?? ""
    path = json["target"]["kind"].string == "local" ? json["target"]["path"].string : nil
    available = json["availability"]["kind"].string == "available"
    sessions = json["sessions"].int ?? 0
    isWorktree = !json["isolation"].isNull
  }
}

public struct FileEntry: Hashable, Sendable {
  public let path: String
  public let isDirectory: Bool
}

public struct FileChange: Hashable, Sendable {
  public enum Kind: String, Sendable {
    case created, modified, removed
  }

  public let path: String
  public let kind: Kind
  public let version: String?
}

public enum WriteOutcome: Equatable, Sendable {
  case saved(version: String)
  /// Someone else changed the file since the version the write expected.
  case stale(current: String?)
}

public struct ModelChoice: Identifiable, Hashable, Sendable {
  public let provider: String
  public let model: String
  public let name: String

  public var id: String { "\(provider)/\(model)" }
}

public struct SentMessage: Sendable {
  public let session: String
  public let receipt: String
}

/// A piece of a message: plain text, a file the agent should read, or lines taken from one.
public enum MessagePart: Sendable {
  case text(String)
  case reference(path: String)
  /// Lines `start` through `end` of a workspace file as it is now, with their text.
  case excerpt(path: String, start: Int, end: Int, text: String)

  var json: JSON {
    switch self {
    case .text(let text):
      return ["kind": "text", "text": .string(text)]
    case .reference(let path):
      return ["kind": "reference", "path": .string(path)]
    case .excerpt(let path, let start, let end, let text):
      return [
        "kind": "excerpt", "text": .string(text),
        "source": [
          "kind": "diff", "path": .string(path), "side": "new", "start": .number(Double(start)),
          "end": .number(Double(end)),
        ],
      ]
    }
  }
}

extension HostClient {
  public func workspaces() async throws -> [WorkspaceInfo] {
    try await call("workspaces.list").array.map(WorkspaceInfo.init)
  }

  /// Lists every file and folder under a directory of a workspace.
  public func scan(workspace: String, directory: String? = nil) async throws -> [FileEntry] {
    var input: [String: JSON] = ["workspace": .string(workspace)]
    if let directory { input["directory"] = .string(directory) }
    var entries: [FileEntry] = []
    for try await frame in frames("files.scan", .object(input)) {
      for entry in frame["entries"].array {
        guard let path = entry["path"].string else { continue }
        entries.append(FileEntry(path: path, isDirectory: entry["kind"].string == "directory"))
      }
    }
    return entries
  }

  /// Reads a text file and its version, or nil when nothing readable is there.
  public func read(workspace: String, path: String) async throws -> (contents: String, version: String)? {
    let output = try await call("files.read", ["workspace": .string(workspace), "path": .string(path)])
    guard output["kind"].string == "text", let contents = output["contents"].string,
      let version = output["version"].string
    else { return nil }
    return (contents, version)
  }

  /// Writes a file only if it still has the version `expect` names, so a write never lands on
  /// top of a change this client hasn't seen.
  public func write(
    workspace: String, path: String, contents: String, expect: String?
  ) async throws -> WriteOutcome {
    var options: [String: JSON] = ["parents": true]
    options["expect"] = .string(expect ?? "absent")
    let output = try await upload(
      "files.write",
      ["workspace": .string(workspace), "path": .string(path), "options": .object(options)],
      body: Data(contents.utf8))
    if output["kind"].string == "saved", let version = output["version"].string {
      return .saved(version: version)
    }
    return .stale(current: output["current"].string)
  }

  public func fileBytes(workspace: String, path: String) async throws -> Data {
    try await bytes("files.bytes", ["workspace": .string(workspace), "path": .string(path)])
  }

  /// Follows changes to a workspace's files until the task is cancelled.
  public func watch(workspace: String) -> AsyncThrowingStream<[FileChange], Error> {
    let source = frames("files.watch", ["workspace": .string(workspace)])
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          for try await frame in source {
            continuation.yield(
              frame.array.compactMap { change in
                guard let path = change["path"].string,
                  let kind = change["kind"].string.flatMap(FileChange.Kind.init(rawValue:))
                else { return nil }
                return FileChange(path: path, kind: kind, version: change["version"].string)
              })
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// The models a chat can run on, the host's default first.
  public func models() async throws -> (choices: [ModelChoice], preferred: ModelChoice?) {
    let output = try await call("models.list")
    var choices: [ModelChoice] = []
    for provider in output["providers"].array {
      guard provider["credential"].string != "missing" else { continue }
      for model in provider["models"].array {
        guard let providerID = model["ref"]["provider"].string, let id = model["ref"]["id"].string
        else { continue }
        choices.append(ModelChoice(provider: providerID, model: id, name: model["name"].string ?? id))
      }
    }
    let fallback = output["default"]
    let preferred = choices.first {
      $0.provider == fallback["provider"].string && $0.model == fallback["id"].string
    }
    return (choices, preferred)
  }

  /// Starts a chat with its first message. `prompt` adds a layer to the system prompt.
  public func startSession(
    workspace: String, content: [MessagePart], model: ModelChoice?, prompt: String?
  ) async throws -> SentMessage {
    let id = UUID().uuidString.lowercased()
    var input: [String: JSON] = [
      "id": .string(id), "workspace": .string(workspace), "content": .array(content.map(\.json)),
    ]
    if let model {
      input["configuration"] = ["model": ["provider": .string(model.provider), "id": .string(model.model)]]
    }
    if let prompt { input["prompt"] = ["kind": "layer", "text": .string(prompt)] }
    let output = try await call("sessions.start", .object(input))
    return SentMessage(
      session: output["session"].string ?? id, receipt: output["receipt"].string ?? id)
  }

  public func send(session: String, content: [MessagePart]) async throws -> SentMessage {
    let output = try await call(
      "head.send",
      [
        "session": .string(session), "head": "main", "content": .array(content.map(\.json)),
        "options": ["id": .string(UUID().uuidString.lowercased())],
      ])
    return SentMessage(session: session, receipt: output["receipt"].string ?? "")
  }

  public func stop(session: String) async {
    _ = try? await call("session.stop", ["session": .string(session)])
  }
}
