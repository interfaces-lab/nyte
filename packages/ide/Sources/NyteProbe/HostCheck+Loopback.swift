import CryptoKit
import Darwin
import Foundation
@testable import NyteAgent

extension HostCheck {
    enum Loopback {
        enum Mode: Sendable, Equatable {
            case refuseToken
            case oldWelcome
            case closeWithReason
        }

        struct Server: Sendable {
            let port: Int
            let descriptor: Int32

            func stop() {
                Darwin.shutdown(descriptor, SHUT_RDWR)
                close(descriptor)
            }
        }

        static let token = "probe-token"
        static let oldRevision = 3
        static let oldReason = "Update the host: this IDE needs API revision \(Wire.minRevision) or later."
        static let newRevision = 30
        static let closeReason = "Update the client: the host serves \(newRevision) and the client speaks up to \(Wire.revision)."
        static let policyViolation: [UInt8] = [0x03, 0xF0]
        static let socketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        static let readSeconds = 5
        static let backlog: Int32 = 8
        static let chunk = 4096

        static func unusedPort() -> Int {
            guard let (descriptor, port) = listener() else { return 1 }
            close(descriptor)
            return port
        }

        static func start(_ mode: Mode) -> Server? {
            guard let (descriptor, port) = listener() else { return nil }
            Thread.detachNewThread { serve(descriptor, mode) }
            return Server(port: port, descriptor: descriptor)
        }

        private static func listener() -> (Int32, Int)? {
            let descriptor = socket(AF_INET, SOCK_STREAM, 0)
            guard descriptor >= 0 else { return nil }
            var address = sockaddr_in()
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET)
            address.sin_addr.s_addr = inet_addr("127.0.0.1")
            var length = socklen_t(MemoryLayout<sockaddr_in>.size)
            let bound = withUnsafeMutablePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                    bind(descriptor, socketAddress, length) == 0 && Darwin.listen(descriptor, backlog) == 0
                        && getsockname(descriptor, socketAddress, &length) == 0
                }
            }
            guard bound else {
                close(descriptor)
                return nil
            }
            return (descriptor, Int(UInt16(bigEndian: address.sin_port)))
        }

        private static func serve(_ listener: Int32, _ mode: Mode) {
            while true {
                let client = accept(listener, nil, nil)
                guard client >= 0 else { return }
                var timeout = timeval(tv_sec: readSeconds, tv_usec: 0)
                setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                answer(client, mode)
                close(client)
            }
        }

        private static func answer(_ client: Int32, _ mode: Mode) {
            guard let head = readHead(client) else { return }
            let lines = head.components(separatedBy: "\r\n")
            let path = lines.first?.split(separator: " ").dropFirst().first.map(String.init) ?? ""
            var headers: [String: String] = [:]
            for line in lines.dropFirst() {
                guard let colon = line.firstIndex(of: ":") else { continue }
                headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            }
            switch path {
            case "/.nyte/describe":
                write(client, "HTTP/1.1 200 OK\r\nX-Nyte-Host: probe\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
            case "/.nyte/ws":
                guard mode != .refuseToken, headers["authorization"] == "Bearer \(token)" else {
                    return write(client, "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                }
                let key = headers["sec-websocket-key"] ?? ""
                let accept = Data(Insecure.SHA1.hash(data: Data((key + socketGUID).utf8))).base64EncodedString()
                write(client, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n")
                _ = readFrame(client)
                switch mode {
                case .oldWelcome:
                    let welcome = "{\"c\":\"e\",\"type\":\"welcome\",\"api_revision\":\(oldRevision),\"api_min_revision\":1,"
                        + "\"api_server_revision\":\(oldRevision),\"host_id\":\"probe\",\"client_id\":\"probe\","
                        + "\"limits\":{\"backlogBytes\":\(Wire.backlogBytes),\"maxFrameBytes\":1048576}}"
                    send(client, opcode: 0x1, payload: Array(welcome.utf8))
                case .closeWithReason:
                    send(client, opcode: 0x8, payload: policyViolation + Array(closeReason.utf8))
                case .refuseToken:
                    break
                }
                drain(client)
            default:
                write(client, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            }
        }

        private static func readHead(_ client: Int32) -> String? {
            var bytes: [UInt8] = []
            let end: [UInt8] = [0x0D, 0x0A, 0x0D, 0x0A]
            while !bytes.suffix(end.count).elementsEqual(end) {
                guard let next = receive(client, count: 1) else { return nil }
                bytes += next
            }
            return String(decoding: bytes, as: UTF8.self)
        }

        private static func readFrame(_ client: Int32) -> [UInt8]? {
            guard let header = receive(client, count: 2) else { return nil }
            var length = Int(header[1] & 0x7F)
            if length == 126 {
                guard let more = receive(client, count: 2) else { return nil }
                length = Int(more[0]) << 8 | Int(more[1])
            } else if length == 127 {
                guard let more = receive(client, count: 8) else { return nil }
                length = more.reduce(0) { $0 << 8 | Int($1) }
            }
            let masked = header[1] & 0x80 != 0
            guard let mask = masked ? receive(client, count: 4) : [], let payload = receive(client, count: length) else { return nil }
            return masked ? payload.enumerated().map { $0.element ^ mask[$0.offset % 4] } : payload
        }

        private static func send(_ client: Int32, opcode: UInt8, payload: [UInt8]) {
            var frame: [UInt8] = [0x80 | opcode]
            if payload.count < 126 {
                frame.append(UInt8(payload.count))
            } else {
                frame += [126, UInt8(payload.count >> 8), UInt8(payload.count & 0xFF)]
            }
            write(client, frame + payload)
        }

        private static func drain(_ client: Int32) {
            while receive(client, count: 1) != nil {}
        }

        private static func receive(_ client: Int32, count: Int) -> [UInt8]? {
            var bytes = [UInt8](repeating: 0, count: count)
            var filled = 0
            while filled < count {
                let read = bytes.withUnsafeMutableBytes { buffer in buffer.baseAddress.map { recv(client, $0 + filled, count - filled, 0) } ?? -1 }
                guard read > 0 else { return nil }
                filled += read
            }
            return bytes
        }

        private static func write(_ client: Int32, _ text: String) {
            write(client, Array(text.utf8))
        }

        private static func write(_ client: Int32, _ bytes: [UInt8]) {
            var sent = 0
            while sent < bytes.count {
                let wrote = bytes.withUnsafeBytes { buffer in buffer.baseAddress.map { Darwin.send(client, $0 + sent, bytes.count - sent, 0) } ?? -1 }
                guard wrote > 0 else { return }
                sent += wrote
            }
        }
    }
}
