import Foundation

/// An action this client offers other clients of the same host, declared in its hello.
public struct ClientAction: Sendable {
  public let name: String
  public let summary: String
  public let input: JSON

  public init(name: String, summary: String, input: JSON = ["type": "object"]) {
    self.name = name
    self.summary = summary
    self.input = input
  }
}

/// A client connected to the host, as the host lists it.
public struct ConnectedClient: Sendable, Identifiable, Hashable {
  public let id: String
  public let kind: String
  public let name: String
  public let version: String
  public let actions: [String]

  init(_ json: JSON) {
    id = json["id"].string ?? ""
    kind = json["kind"].string ?? "other"
    name = json["name"].string ?? ""
    version = json["version"].string ?? ""
    actions = json["actions"].array.compactMap { $0["name"].string }
  }
}

/// The host's WebSocket: calls, the events of the scopes subscribed to, streamed text, and
/// requests from other clients to perform an action this one declared.
@MainActor
public final class HostSocket {
  public enum State: Equatable, Sendable {
    case connecting
    case connected(host: String, client: String)
    case waiting(String)
  }

  public static let apiRevision = 27
  public static let apiMinRevision = 17

  public private(set) var state: State = .connecting
  public private(set) var clients: [ConnectedClient] = []
  public var clientID: String? {
    if case .connected(_, let client) = state { return client }
    return nil
  }

  /// Called on every change of `state`. A `.connected` after the first means the socket was
  /// lost and found again: subscriptions are restored first, and readers should read again.
  public var onState: ((State) -> Void)?
  public var onClients: (([ConnectedClient]) -> Void)?
  /// Every event frame of a subscribed scope, with its `scope`, `seq` and `kind`.
  public var onEvent: ((JSON) -> Void)?
  /// Every frame of the text channel: `part` with `text`, `append` or `progress`.
  public var onText: ((JSON) -> Void)?
  /// Answers another client's request to perform an action declared in `actions`.
  public var onPerform: ((_ action: String, _ input: JSON) async throws -> JSON)?

  private let endpoint: HostEndpoint
  private let name: String
  private let version: String
  private let actions: [ClientAction]
  private let session = URLSession(configuration: .ephemeral)
  private var task: URLSessionWebSocketTask?
  private var pending: [String: CheckedContinuation<JSON, Error>] = [:]
  private var scopes: Set<String> = []
  private var fragments = ""
  private var counter = 0
  private var attempt = 0
  private var closed = false

  public init(endpoint: HostEndpoint, name: String, version: String, actions: [ClientAction] = []) {
    self.endpoint = endpoint
    self.name = name
    self.version = version
    self.actions = actions
  }

  public func connect() {
    guard !closed else { return }
    set(.connecting)
    var components = URLComponents(url: endpoint.url.appending(path: ".nyte/ws"), resolvingAgainstBaseURL: false)
    components?.scheme = endpoint.url.scheme == "https" ? "wss" : "ws"
    guard let url = components?.url else { return }
    var request = URLRequest(url: url)
    request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
    let task = session.webSocketTask(with: request)
    task.maximumMessageSize = 16 * 1024 * 1024
    self.task = task
    task.resume()

    let hello: JSON = [
      "c": "e", "type": "hello",
      "api_min_revision": .number(Double(Self.apiMinRevision)),
      "api_revision": .number(Double(Self.apiRevision)),
      "client": [
        "kind": "app", "name": .string(name), "version": .string(version),
        "actions": .array(
          actions.map { ["name": .string($0.name), "summary": .string($0.summary), "input": $0.input] }),
      ],
    ]
    send(hello, on: task)
    receive(on: task)
  }

  public func close() {
    closed = true
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
    failPending(HostError(code: "unavailable", message: "The connection closed."))
  }

  /// Calls an operation on the socket and returns its output.
  public func call(_ operation: String, _ input: JSON = [:]) async throws -> JSON {
    guard let task, case .connected = state else {
      throw HostError(code: "unavailable", message: "The host isn't connected.")
    }
    counter += 1
    let id = "c\(counter)"
    return try await withCheckedThrowingContinuation { continuation in
      pending[id] = continuation
      send(["c": "e", "type": "call", "id": .string(id), "op": .string(operation), "input": input], on: task)
    }
  }

  /// Subscribes to a scope and keeps it across reconnects.
  public func subscribe(_ scope: String) async throws {
    scopes.insert(scope)
    _ = try await call("events.subscribe", ["scopes": [.string(scope)]])
  }

  public func unsubscribe(_ scope: String) async {
    scopes.remove(scope)
    _ = try? await call("events.unsubscribe", ["scopes": [.string(scope)]])
  }

  /// Asks another connected client to perform an action it declared.
  public func perform(_ action: String, on client: String, input: JSON = [:]) async throws -> JSON {
    try await call("client.perform", ["client": .string(client), "action": .string(action), "input": input])
  }

  private func send(_ frame: JSON, on task: URLSessionWebSocketTask) {
    let text = String(decoding: frame.data(), as: UTF8.self)
    task.send(.string(text)) { _ in }
  }

  private func receive(on task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      Task { @MainActor in
        guard let self, self.task === task else { return }
        switch result {
        case .failure(let error):
          self.lost(error.localizedDescription)
        case .success(let message):
          if case .string(let text) = message { self.handle(text, on: task) }
          self.receive(on: task)
        }
      }
    }
  }

  private func handle(_ text: String, on task: URLSessionWebSocketTask) {
    guard let frame = try? JSON.parse(Data(text.utf8)) else { return }
    if frame["c"].string == "t" {
      onText?(frame)
      return
    }

    switch frame["type"].string {
    case "fragment":
      fragments += frame["text"].string ?? ""
      if frame["last"].bool == true {
        let whole = fragments
        fragments = ""
        handle(whole, on: task)
      }

    case "welcome":
      attempt = 0
      let client = frame["client_id"].string ?? ""
      let connected = State.connected(host: frame["host_id"].string ?? "", client: client)
      state = connected
      let restore = scopes.union(["host", "client/\(client)"])
      scopes = restore.filter { !$0.hasPrefix("client/") || $0 == "client/\(client)" }
      // Readers hear about the connection only once its scopes are subscribed, so a read they
      // start in answer can't miss a change.
      Task {
        _ = try? await call("events.subscribe", ["scopes": .array(scopes.sorted().map { .string($0) })])
        _ = try? await call("text.open")
        if state == connected { onState?(connected) }
      }

    case "result":
      if let id = frame["id"].string, let continuation = pending.removeValue(forKey: id) {
        continuation.resume(returning: frame["output"])
      }

    case "error":
      if let id = frame["id"].string, let continuation = pending.removeValue(forKey: id) {
        continuation.resume(throwing: HostError(frame["error"]))
      }

    case "event":
      switch (frame["scope"].string, frame["kind"].string) {
      case ("host", "live"):
        clients = frame["clients"].array.map(ConnectedClient.init)
        onClients?(clients)
      case (_, "perform"):
        answer(frame)
      default:
        break
      }
      onEvent?(frame)

    default:
      break
    }
  }

  private func answer(_ frame: JSON) {
    guard let call = frame["call"].string, let action = frame["action"].string else { return }
    let input = frame["input"]
    Task {
      do {
        guard let onPerform else {
          throw HostError(code: "not_supported", message: "\(name) doesn't perform \(action).")
        }
        let result = try await onPerform(action, input)
        _ = try? await self.call("client.reply", ["call": .string(call), "result": result])
      } catch {
        let host = error as? HostError
        _ = try? await self.call(
          "client.reply",
          [
            "call": .string(call),
            "error": [
              "code": .string(host?.code ?? "internal"),
              "message": .string(host?.message ?? error.localizedDescription),
            ],
          ])
      }
    }
  }

  private func lost(_ reason: String) {
    task = nil
    fragments = ""
    failPending(HostError(code: "unavailable", message: "The host went away."))
    guard !closed else { return }
    attempt += 1
    let delay = min(5, 0.4 * pow(1.6, Double(attempt - 1)))
    set(.waiting(reason))
    Task {
      try? await Task.sleep(for: .seconds(delay))
      if self.task == nil { self.connect() }
    }
  }

  private func failPending(_ error: HostError) {
    let waiting = pending
    pending = [:]
    for continuation in waiting.values { continuation.resume(throwing: error) }
  }

  private func set(_ next: State) {
    state = next
    onState?(next)
  }
}
