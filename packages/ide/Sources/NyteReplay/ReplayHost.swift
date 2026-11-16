import CryptoKit
import Darwin
import Foundation
import NyteCore
import OSLog

public enum ReplayError: Error, Sendable {
    case socket(Int32)
    case hostFile(String)
}

public final class ReplayHost: Sendable {
    public let home: URL
    public let port: Int
    private let descriptor: Int32

    public static let token = "replay-token"
    static let version = "0.0.0-replay"
    static let logger = Logger(subsystem: "sh.nyte.ide", category: "NyteReplay")
    static let backlog: Int32 = 16

    private init(home: URL, port: Int, descriptor: Int32) {
        self.home = home
        self.port = port
        self.descriptor = descriptor
    }

    public static func start(home: URL) throws(ReplayError) -> ReplayHost {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw .socket(errno) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                bind(descriptor, socketAddress, length) == 0 && listen(descriptor, backlog) == 0
                    && getsockname(descriptor, socketAddress, &length) == 0
            }
        }
        guard bound else {
            let failure = errno
            close(descriptor)
            throw .socket(failure)
        }
        let port = Int(UInt16(bigEndian: address.sin_port))
        let file = "{\"url\":\"http://127.0.0.1:\(port)\",\"token\":\"\(token)\",\"pid\":\(getpid())}"
        do {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
            try Data(file.utf8).write(to: home.appending(path: "host.json"))
        } catch {
            close(descriptor)
            throw .hostFile(error.localizedDescription)
        }
        let now = Date.now.timeIntervalSince1970 * 1000
        Thread.detachNewThread { ReplayHost.accept(descriptor, now: now) }
        logger.info("replay host serving on port \(port, privacy: .public)")
        return ReplayHost(home: home, port: port, descriptor: descriptor)
    }

    public func stop() {
        Darwin.shutdown(descriptor, SHUT_RDWR)
        close(descriptor)
        try? FileManager.default.removeItem(at: home.appending(path: "host.json"))
    }

    private static func accept(_ listener: Int32, now: Double) {
        while true {
            let client = Darwin.accept(listener, nil, nil)
            guard client >= 0 else { return }
            var quiet: Int32 = 1
            setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &quiet, socklen_t(MemoryLayout<Int32>.size))
            Thread.detachNewThread {
                var connection = ReplayConnection(client: client, now: now)
                connection.serve()
                close(client)
            }
        }
    }
}

struct ReplayConnection {
    let client: Int32
    let now: Double
    private var subscribed: Set<String> = []
    private var texting = false

    static let socketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    init(client: Int32, now: Double) {
        self.client = client
        self.now = now
    }

    mutating func serve() {
        guard let head = readHead() else { return }
        let lines = head.components(separatedBy: "\r\n")
        let path = lines.first?.split(separator: " ").dropFirst().first.map(String.init) ?? ""
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        switch path {
        case "/.nyte/describe":
            let body = "{\"name\":\"replay\",\"platform\":\"darwin\",\"version\":\"\(ReplayHost.version)\"}"
            write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Nyte-Host: replay\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n" + body)
        case "/.nyte/ws":
            guard headers["authorization"] == "Bearer \(ReplayHost.token)" else {
                return write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            }
            let accept = Data(Insecure.SHA1.hash(data: Data(((headers["sec-websocket-key"] ?? "") + Self.socketGUID).utf8))).base64EncodedString()
            write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n")
            talk()
        default:
            write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        }
    }

    private mutating func talk() {
        while let (opcode, payload) = readMessage() {
            switch opcode {
            case 0x8: return send(opcode: 0x8, payload: [])
            case 0x9: send(opcode: 0xA, payload: payload)
            case 0x1, 0x2: handle(JSON.parse(Data(payload)) ?? .null)
            default: continue
            }
        }
    }

    private mutating func handle(_ frame: JSON) {
        switch frame["type"]?.string {
        case "hello":
            send(["c": "e", "type": "welcome", "api_revision": 24, "api_min_revision": 17, "api_server_revision": 24,
                  "host_id": "replay-host", "client_id": "replay-client",
                  "limits": ["backlogBytes": 8_388_608, "maxFrameBytes": 1_048_576]])
        case "call":
            let id = frame["id"] ?? .null
            let op = frame["op"]?.string ?? ""
            switch answer(op, frame["input"] ?? .null) {
            case let .success(output): send(["c": "e", "type": "result", "id": id, "output": output])
            case let .failure(refusal):
                send(["c": "e", "type": "error", "id": id,
                      "error": ["code": .string(refusal.code), "message": .string(refusal.message), "hostId": "replay-host",
                                "issues": [], "correlation": .null]])
            }
            follow(op, frame["input"] ?? .null)
        default:
            return
        }
    }

    struct Refusal: Error {
        let code: String
        let message: String
    }

    private func answer(_ op: String, _ input: JSON) -> Result<JSON, Refusal> {
        let session = ReplayScript.sessions.first { $0.id == input["session"]?.string }
        switch op {
        case "events.subscribe", "events.unsubscribe", "text.open": return .success(.null)
        case "workspaces.inspect": return .success(ReplayScript.inspection(path: input["target"]?["path"]?.string ?? "/"))
        case "models.list": return .success(ReplayScript.models)
        case "workspaces.list": return .success(ReplayScript.workspaces)
        case "catalogs.read": return .success(ReplayScript.catalogView)
        case "workspace.changes":
            let source = input["source"]
            let found = source?["kind"]?.string == "session"
                ? ReplayScript.sessionChanges(source?["session"]?.string ?? "", now: now)
                : ReplayScript.runChanges(source?["run"]?.string ?? "", now: now)
            guard let files = found else { return .failure(Refusal(code: "unavailable", message: "No run of this script snapshotted its workspace.")) }
            return .success(["revision": "replay", "files": .array(files)])
        case "sessions.list":
            return .success(["items": .array(ReplayScript.sessions.map { ReplayScript.row($0, now: now) }), "next": .null])
        case "session.info", "head.read", "head.history", "part.read":
            guard let session else { return .failure(Refusal(code: "unknown", message: "No session has that id.")) }
            let output: JSON = switch op {
            case "session.info": ReplayScript.row(session, now: now)
            case "head.read": ReplayScript.window(session, now: now)
            case "head.history": ["messages": [], "leadingPrompt": .null, "turns": []]
            default: ["seq": 1, "part": ReplayScript.part(input["part"]?.string ?? "", session: session) ?? .null]
            }
            return .success(output)
        default:
            ReplayHost.logger.info("refused \(op, privacy: .public)")
            return .failure(Refusal(code: "denied", message: "The replay host serves a scripted workspace and changes nothing."))
        }
    }

    private mutating func follow(_ op: String, _ input: JSON) {
        switch op {
        case "events.subscribe":
            for scope in input["scopes"]?.array?.compactMap(\.string) ?? [] where subscribed.insert(scope).inserted {
                let fact: JSON = scope == "host"
                    ? ["c": "e", "type": "event", "scope": "host", "seq": .null, "kind": "live", "clients": []]
                    : ["c": "e", "type": "event", "scope": .string(scope), "seq": .null, "kind": "live", "activation": ["kind": "active"]]
                send(fact)
            }
            streamLive()
        case "text.open":
            texting = true
            streamLive()
        default:
            return
        }
    }

    private func streamLive() {
        guard texting, subscribed.contains("session/" + ReplayScript.running) else { return }
        send(["c": "t", "part": .string(ReplayScript.livePart), "run": "run-running", "version": 4,
              "text": "Every scroll re-measures rows that are already exact, so the table spends most of each frame in layout."])
    }

    private func send(_ frame: JSON) {
        send(opcode: 0x1, payload: Array(frame.encoded()))
    }

    private func send(opcode: UInt8, payload: [UInt8]) {
        var frame: [UInt8] = [0x80 | opcode]
        let count = payload.count
        if count < 126 {
            frame.append(UInt8(count))
        } else if count <= Int(UInt16.max) {
            frame += [126, UInt8(count >> 8), UInt8(count & 0xFF)]
        } else {
            frame.append(127)
            frame += (0 ..< 8).reversed().map { UInt8((count >> ($0 * 8)) & 0xFF) }
        }
        write(frame + payload)
    }

    private func readHead() -> String? {
        var bytes: [UInt8] = []
        let end: [UInt8] = [0x0D, 0x0A, 0x0D, 0x0A]
        while !bytes.suffix(end.count).elementsEqual(end) {
            guard let next = receive(1) else { return nil }
            bytes += next
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    private func readMessage() -> (UInt8, [UInt8])? {
        var opcode: UInt8 = 0
        var payload: [UInt8] = []
        while true {
            guard let header = receive(2) else { return nil }
            var length = Int(header[1] & 0x7F)
            if length == 126 {
                guard let more = receive(2) else { return nil }
                length = Int(more[0]) << 8 | Int(more[1])
            } else if length == 127 {
                guard let more = receive(8) else { return nil }
                length = more.reduce(0) { $0 << 8 | Int($1) }
            }
            let masked = header[1] & 0x80 != 0
            guard let mask = masked ? receive(4) : [], let body = receive(length) else { return nil }
            let code = header[0] & 0x0F
            if code != 0 { opcode = code }
            payload += masked ? body.enumerated().map { $0.element ^ mask[$0.offset % 4] } : body
            if header[0] & 0x80 != 0 { return (opcode, payload) }
        }
    }

    private func receive(_ count: Int) -> [UInt8]? {
        var bytes = [UInt8](repeating: 0, count: count)
        var filled = 0
        while filled < count {
            let read = bytes.withUnsafeMutableBytes { buffer in buffer.baseAddress.map { recv(client, $0 + filled, count - filled, 0) } ?? -1 }
            guard read > 0 else { return nil }
            filled += read
        }
        return bytes
    }

    private func write(_ text: String) {
        write(Array(text.utf8))
    }

    private func write(_ bytes: [UInt8]) {
        var sent = 0
        while sent < bytes.count {
            let wrote = bytes.withUnsafeBytes { buffer in buffer.baseAddress.map { Darwin.send(client, $0 + sent, bytes.count - sent, 0) } ?? -1 }
            guard wrote > 0 else { return }
            sent += wrote
        }
    }
}
