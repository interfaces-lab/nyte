import Foundation
import Synchronization
@testable import NyteAgent

extension HostCheck {
    struct ProbeError: Error, CustomStringConvertible {
        let description: String
    }

    private struct Peek: Decodable {
        let type: String?
        let id: String?
        let text: String?
        let last: Bool?
    }

    private struct ResultOf<Output: Decodable>: Decodable {
        let output: Output
    }

    @MainActor final class Tape {
        private let socket: URLSessionWebSocketTask
        private(set) var lines: [String] = []
        private(set) var bytes = 0
        private var calls = 0
        private var pieces: [String] = []

        init(socket: URLSessionWebSocketTask) {
            self.socket = socket
        }

        func hello() async throws {
            try await socket.send(.string(Wire.encode(Wire.Hello(client: .init(name: "NyteProbe recorder", version: "0")))))
            _ = try await until("hello", id: "") { $0.type == "welcome" }
        }

        @discardableResult
        func call<Request: Wire.Request>(_ request: Request) async throws -> Request.Output {
            calls += 1
            let id = "r\(calls)"
            try await socket.send(.string(Wire.encode(Wire.Call(id: id, input: request))))
            let frame = try await until(Request.name, id: id) { $0.id == id && ($0.type == "result" || $0.type == "error") }
            guard try JSONDecoder().decode(Peek.self, from: frame).type == "result" else {
                throw ProbeError(description: "\(Request.name) answered an error")
            }
            return try JSONDecoder().decode(ResultOf<Request.Output>.self, from: frame).output
        }

        func listen() async {
            _ = try? await until("-", id: "") { _ in false }
        }

        private func until(_ operation: String, id: String, _ done: (Peek) -> Bool) async throws -> Data {
            while true {
                let text = switch try await socket.receive() {
                case let .string(text): text
                case let .data(data): String(decoding: data, as: UTF8.self)
                @unknown default: ""
                }
                lines.append(operation + "\t" + id + "\t" + text)
                bytes += text.utf8.count
                let peek = try JSONDecoder().decode(Peek.self, from: Data(text.utf8))
                guard peek.type == "fragment" else {
                    if done(peek) { return Data(text.utf8) }
                    continue
                }
                pieces.append(peek.text ?? "")
                guard peek.last == true else { continue }
                let joined = Data(pieces.joined().utf8)
                pieces = []
                if done(try JSONDecoder().decode(Peek.self, from: joined)) { return joined }
            }
        }
    }

    @MainActor struct Recorder {
        let home: URL
        let folder: URL
        let file: URL

        static let historyLimit = 200
        static let maxMessageBytes = 64 * 1_048_576

        func run(check: HostCheck) async {
            guard let data = try? Data(contentsOf: home.appending(path: "host.json")),
                  let host = try? JSONDecoder().decode(Wire.HostFile.self, from: data),
                  let base = URL(string: host.url), let url = Wire.socketURL(base)
            else { return check.expect(false, "record: no live host file in \(home.path)") }
            let session = URLSession(configuration: .ephemeral)
            var request = URLRequest(url: url)
            request.setValue("Bearer \(host.token)", forHTTPHeaderField: "Authorization")
            let socket = session.webSocketTask(with: request)
            socket.maximumMessageSize = Self.maxMessageBytes
            socket.resume()
            let tape = Tape(socket: socket)
            var reads: [String: Int] = [:]
            do {
                try await tape.hello()
                try await tape.call(Wire.Subscribe(scopes: ["host"]))
                let inspection = try await tape.call(Wire.Inspect(target: Wire.Target(path: folder.path)))
                try await tape.call(Wire.ListModels())
                var mine: [Wire.SessionRow] = []
                var cursor: String?
                repeat {
                    let page = try await tape.call(Wire.ListSessions(cursor: cursor, limit: AgentEngine.sessionPage))
                    mine += page.items.filter { $0.belongs(to: inspection.registered ?? "") }
                    cursor = page.next
                } while cursor != nil
                for row in mine.sorted(by: { $0.lastActivityAt > $1.lastActivityAt }).prefix(HostCheck.recordedSessions) {
                    try await tape.call(Wire.ReadSession(session: row.id))
                    try await tape.call(Wire.Subscribe(scopes: ["session/" + row.id]))
                    let window = try await tape.call(Wire.ReadHead(session: row.id, head: AgentEngine.head,
                                                                   window: .init(tail: AgentEngine.tail), resume: nil))
                    if let oldest = window.order.first {
                        try await tape.call(Wire.ReadHistory(session: row.id, head: AgentEngine.head, before: oldest,
                                                             limit: Self.historyLimit))
                    }
                    if let part = window.tables.parts?.upsert.first?.id ?? window.order.first {
                        try await tape.call(Wire.ReadPart(session: row.id, part: part))
                    }
                    reads[row.id] = window.order.count
                }
                try await tape.call(Wire.OpenText())
                let listening = Task { await tape.listen() }
                await Patience.pause(HostCheck.record)
                socket.cancel(with: .goingAway, reason: nil)
                await listening.value
            } catch {
                check.expect(false, "record: \(error)")
            }
            socket.cancel(with: .goingAway, reason: nil)
            session.invalidateAndCancel()
            do {
                try Data((tape.lines.joined(separator: "\n") + "\n").utf8).write(to: file)
            } catch {
                return check.expect(false, "record: cannot write \(file.path)")
            }
            check.expect(tape.lines.count > reads.count,
                         "record: \(tape.lines.count) frames, \(tape.bytes) bytes, \(reads.count) sessions read, to \(file.path)")
        }
    }

    final class Collected: Sendable {
        let problems = Mutex<[String]>([])
        let messages = Mutex<[Wire.Message]>([])

        func add(_ problem: String) {
            problems.withLock { $0.append(problem) }
        }
    }

    @MainActor struct StreamDecode {
        let file: URL

        func run(check: HostCheck) {
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { return check.expect(false, "decode: no recording") }
            let collected = Collected()
            var counts: [String: Int] = [:]
            var pieces: [String] = []
            let decoder = JSONDecoder()
            func decode(_ data: Data, operation: String, id: String) {
                let calls = id.isEmpty ? [:] : [id: Wire.Pending(operation: operation, resolve: { answer in
                    do {
                        if operation == Wire.ReadHead.name {
                            let window = try Wire.HeadWindow(from: answer)
                            collected.messages.withLock { $0 += window.tables.messages?.upsert ?? [] }
                        } else if operation == Wire.ReadHistory.name {
                            let page = try Wire.HistoryPage(from: answer)
                            collected.messages.withLock { $0 += page.messages }
                        } else {
                            try Self.answer(operation, answer)
                        }
                    } catch {
                        collected.add("\(operation) answer: \(Wire.describe(error))")
                    }
                }, reject: { _ in })]
                let frame: Wire.Inbound
                do {
                    frame = try decoder.decode(Wire.Inbound.self, from: data, configuration: calls)
                } catch {
                    return collected.add("frame: \(Wire.describe(error))")
                }
                counts[Self.label(frame, operation: operation), default: 0] += 1
                guard case let .fragment(piece, last) = frame else { return }
                pieces.append(piece)
                guard last else { return }
                let joined = Data(pieces.joined().utf8)
                pieces = []
                decode(joined, operation: operation, id: id)
            }
            for line in text.split(separator: "\n") {
                let fields = line.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false)
                guard fields.count == 3 else { continue }
                decode(Data(fields[2].utf8), operation: String(fields[0]), id: String(fields[1]))
            }
            for (label, count) in counts.sorted(by: { $0.key < $1.key }) { print("       \(label): \(count)") }
            let problems = collected.problems.withLock { $0 }
            check.expect(problems.isEmpty, "decode: \(counts.values.reduce(0, +)) frames decoded" + (problems.isEmpty ? "" : "; \(problems)"))
            let reported = HostCheck.entries(since: nil).filter { $0.hasPrefix("unknown ") || $0.hasPrefix("skipped ") }
            let expected = reported.filter { $0.hasPrefix("unknown part kind ") }
            let wrong = reported.filter { !$0.hasPrefix("unknown part kind ") }
            check.expect(wrong.isEmpty, "unknowns: \(expected.isEmpty ? "none" : expected.joined(separator: ", ")) (plugin part kinds, drawn as plain rows)"
                + (wrong.isEmpty ? "; nothing the client reads fell to unknown" : "; NOT expected: \(wrong)"))
            ChangeCheck.run(messages: collected.messages.withLock { $0 }, root: check.folder, check: check)
        }

        nonisolated private static func answer(_ operation: String, _ decoder: any Decoder) throws {
            switch operation {
            case Wire.Inspect.name: _ = try Wire.Inspection(from: decoder)
            case Wire.ListModels.name: _ = try Wire.Catalog(from: decoder)
            case Wire.ListSessions.name: _ = try Wire.SessionPage(from: decoder)
            case Wire.ReadSession.name: _ = try Wire.SessionRow(from: decoder)
            case Wire.ReadHead.name: _ = try Wire.HeadWindow(from: decoder)
            case Wire.ReadHistory.name: _ = try Wire.HistoryPage(from: decoder)
            case Wire.ReadPart.name: _ = try Wire.PartRead(from: decoder)
            default: _ = Wire.Nothing(from: decoder)
            }
        }

        private static func label(_ frame: Wire.Inbound, operation: String) -> String {
            switch frame {
            case .welcome: "welcome"
            case .answered: "answer to \(operation)"
            case .refused: "error from \(operation)"
            case .event(.sessions): "event: host sessions change"
            case .event(.session): "event: session change"
            case .event(.presence): "event: live facts"
            case let .event(.unknown(kind)): "event: unknown \(kind)"
            case .text(.whole): "text: whole"
            case .text(.append): "text: append"
            case .text(.progress): "text: progress"
            case .text(.closed): "text: closed"
            case let .text(.unknown(kind)): "text: unknown \(kind)"
            case .fragment: "fragment"
            case let .ignored(what): "ignored \(what)"
            }
        }
    }
}
