import Foundation

/// Where a host listens and the token that gets in.
public struct HostEndpoint: Sendable, Equatable {
  public let url: URL
  public let token: String

  public init(url: URL, token: String) {
    self.url = url
    self.token = token
  }

  /// Finds this machine's host the way `nyte` does: `NYTE_HOST_URL` and `NYTE_HOST_TOKEN` when
  /// both are set, otherwise the `host.json` a running host keeps in its home folder.
  public static func discover(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> HostEndpoint {
    if let address = environment["NYTE_HOST_URL"], let url = URL(string: address),
      let token = environment["NYTE_HOST_TOKEN"]
    {
      return HostEndpoint(url: url, token: token)
    }
    let home = environment["NYTE_HOME"].map { URL(filePath: $0) }
      ?? FileManager.default.homeDirectoryForCurrentUser.appending(path: ".nyte")
    let file = home.appending(path: "host.json")
    guard let data = try? Data(contentsOf: file) else {
      throw HostError(code: "unavailable", message: "No Nyte host is running. Open Nyte, or run nyte host.")
    }
    let json = try JSON.parse(data)
    guard let address = json["url"].string, let url = URL(string: address),
      let token = json["token"].string
    else {
      throw HostError(code: "invalid", message: "\(file.path) doesn't name a host.")
    }
    return HostEndpoint(url: url, token: token)
  }
}

/// An error a host answered with, or a failure to reach it.
public struct HostError: Error, Sendable, LocalizedError {
  public let code: String
  public let message: String

  public init(code: String, message: String) {
    self.code = code
    self.message = message
  }

  public var errorDescription: String? { message }

  init(_ json: JSON, status: Int? = nil) {
    code = json["code"].string ?? (status.map { "http_\($0)" } ?? "internal")
    message = json["message"].string ?? "The host answered with an error it did not describe."
  }
}

/// Calls a host's operations over HTTP: one JSON value for a query or command, server-sent
/// events for a watch or stream, raw bytes for file contents.
public final class HostClient: Sendable {
  public let endpoint: HostEndpoint
  private let session: URLSession

  public init(endpoint: HostEndpoint) {
    self.endpoint = endpoint
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 3600
    configuration.httpMaximumConnectionsPerHost = 16
    session = URLSession(configuration: configuration)
  }

  private func request(_ operation: String) -> URLRequest {
    var request = URLRequest(url: endpoint.url.appending(path: operation))
    request.httpMethod = "POST"
    request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
    return request
  }

  /// Calls a query, command or receipt operation.
  public func call(_ operation: String, _ input: JSON = [:]) async throws -> JSON {
    var request = request(operation)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = input.data()
    request.timeoutInterval = 60
    let (data, response) = try await session.data(for: request)
    return try answer(data, response)
  }

  /// Calls an operation that takes bytes: the body is the contents and the input rides in a header.
  public func upload(_ operation: String, _ input: JSON, body: Data) async throws -> JSON {
    var request = request(operation)
    request.setValue(base64url(input.data()), forHTTPHeaderField: "X-Nyte-Input")
    request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
    request.timeoutInterval = 60
    let (data, response) = try await session.upload(for: request, from: body)
    return try answer(data, response)
  }

  /// Calls an operation that answers raw bytes, such as `files.bytes`.
  public func bytes(_ operation: String, _ input: JSON) async throws -> Data {
    var request = request(operation)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = input.data()
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode < 400 else {
      throw HostError((try? JSON.parse(data)) ?? .null, status: (response as? HTTPURLResponse)?.statusCode)
    }
    return data
  }

  /// Follows a watch or stream operation, one JSON value per frame, until the task is cancelled
  /// or the host ends it.
  public func frames(_ operation: String, _ input: JSON) -> AsyncThrowingStream<JSON, Error> {
    var request = request(operation)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    request.httpBody = input.data()
    let prepared = request
    let session = session

    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          let (bytes, response) = try await session.bytes(for: prepared)
          if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            var body = Data()
            for try await byte in bytes { body.append(byte) }
            throw HostError((try? JSON.parse(body)) ?? .null, status: http.statusCode)
          }
          var failed = false
          for try await line in bytes.lines {
            if line.hasPrefix("event:") {
              failed = line.dropFirst(6).trimmingCharacters(in: .whitespaces) == "error"
              continue
            }
            guard line.hasPrefix("data:") else { continue }
            let value = try JSON.parse(Data(line.dropFirst(5).utf8))
            if failed { throw HostError(value) }
            continuation.yield(value)
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  private func answer(_ data: Data, _ response: URLResponse) throws -> JSON {
    let json = data.isEmpty ? JSON.null : ((try? JSON.parse(data)) ?? .null)
    guard let http = response as? HTTPURLResponse, http.statusCode < 400 else {
      throw HostError(json, status: (response as? HTTPURLResponse)?.statusCode)
    }
    return json
  }
}

func base64url(_ data: Data) -> String {
  data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}
