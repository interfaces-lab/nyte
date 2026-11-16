import Dispatch
import Foundation
import Network
import NyteCore
import Synchronization
actor AdapterConnection {
    enum Incoming: Sendable {
        case event(String, JSON)
        case request(seq: Int, command: String, arguments: JSON)
    }

    nonisolated let incoming: AsyncStream<Incoming>
    nonisolated let queue: DispatchSerialQueue
    nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

    private let emit: AsyncStream<Incoming>.Continuation
    private let connection: NWConnection
    private var framer = MessageFramer()
    private var sequence = 0
    private var pending: [Int: CheckedContinuation<JSON, any Error>] = [:]
    private var closed = false

    private static let readSize = 65_536
    static func open(port: UInt16, patience: Duration = .seconds(10)) async throws -> AdapterConnection {
        let deadline = ContinuousClock.now + patience
        while true {
            if let connection = await AdapterConnection(port: port) { return connection }
            guard ContinuousClock.now < deadline else { throw DebugFailure("Could not connect to the debug adapter on port \(port).") }
            try await Task.sleep(for: .milliseconds(50))
        }
    }

    private init?(port: UInt16) async {
        queue = DispatchSerialQueue(label: "sh.nyte.ide.dap.\(port)")
        connection = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port) ?? .any, using: .tcp)
        (incoming, emit) = AsyncStream.makeStream(of: Incoming.self)
        let connection = connection
        let ready: Bool = await withCheckedContinuation { continuation in
            let once = Once(continuation)
            connection.stateUpdateHandler = { state in
                let answer: Bool? = switch state {
                case .ready: true
                case .failed, .waiting, .cancelled: false
                default: nil
                }
                guard let answer else { return }
                once.resume(answer)
            }
            connection.start(queue: queue)
        }
        guard ready else {
            connection.cancel()
            return nil
        }
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .failed, .cancelled: self.assumeIsolated { $0.close() }
            default: break
            }
        }
        receive()
    }
    func request(_ command: String, _ arguments: JSON = [:], timeout: Duration = .seconds(30)) async throws -> JSON {
        guard !closed else { throw DebugFailure("The debug adapter connection is closed.") }
        sequence += 1
        let seq = sequence
        let message: JSON = ["seq": .number(Double(seq)), "type": "request", "command": .string(command), "arguments": arguments]
        let expiry = Task {
            try await Task.sleep(for: timeout)
            self.settle(seq, .failure(DebugFailure("The debug adapter did not answer \(command) in time.")))
        }
        defer { expiry.cancel() }
        return try await withCheckedThrowingContinuation { continuation in
            pending[seq] = continuation
            write(message)
        }
    }
    func respond(to seq: Int, command: String, body: JSON = [:], error: String? = nil) {
        sequence += 1
        var message: JSON = [
            "seq": .number(Double(sequence)), "type": "response", "request_seq": .number(Double(seq)),
            "command": .string(command), "success": .bool(error == nil), "body": body,
        ]
        if let error, case var .object(fields) = message {
            fields["message"] = .string(error)
            message = .object(fields)
        }
        write(message)
    }

    func close() {
        guard !closed else { return }
        closed = true
        connection.cancel()
        for continuation in pending.values { continuation.resume(throwing: DebugFailure("The debug adapter closed the connection.")) }
        pending.removeAll()
        emit.finish()
    }

    private func write(_ message: JSON) {
        connection.send(content: MessageFramer.frame(message.encoded()), completion: .contentProcessed { _ in })
    }

    private func settle(_ seq: Int, _ result: Result<JSON, any Error>) {
        pending.removeValue(forKey: seq)?.resume(with: result)
    }
    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: Self.readSize) { [weak self] data, _, complete, error in
            guard let self else { return }
            self.assumeIsolated { connection in
                if let data { connection.handle(data) }
                if complete || error != nil { return connection.close() }
                connection.receive()
            }
        }
    }

    private func handle(_ data: Data) {
        for body in framer.append(data) {
            guard let message = JSON.parse(body), let type = message["type"]?.string else { continue }
            switch type {
            case "response":
                guard let seq = message["request_seq"]?.int else { continue }
                if message["success"]?.bool == true {
                    settle(seq, .success(message["body"] ?? .null))
                    continue
                }
                let text = message["body"]?["error"]?["format"]?.string ?? message["message"]?.string ?? "request failed"
                settle(seq, .failure(DebugFailure(text)))
            case "event":
                guard let name = message["event"]?.string else { continue }
                emit.yield(.event(name, message["body"] ?? .null))
            case "request":
                guard let seq = message["seq"]?.int, let command = message["command"]?.string else { continue }
                emit.yield(.request(seq: seq, command: command, arguments: message["arguments"] ?? [:]))
            default: continue
            }
        }
    }
}
final class Once<Value: Sendable>: Sendable {
    private let continuation: Mutex<CheckedContinuation<Value, Never>?>

    init(_ continuation: CheckedContinuation<Value, Never>) {
        self.continuation = Mutex(continuation)
    }

    func resume(_ value: Value) {
        continuation.withLock { $0.take() }?.resume(returning: value)
    }
}
