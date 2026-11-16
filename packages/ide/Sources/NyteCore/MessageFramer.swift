import Foundation

public struct MessageFramer: Sendable {
    private var buffer = [UInt8]()
    private var start = 0
    private var pending: Int?

    private static let separator: [UInt8] = [0x0D, 0x0A, 0x0D, 0x0A]
    private static let field = Array("content-length:".utf8)

    public init() {}

    public mutating func append(_ bytes: some Sequence<UInt8>) -> [Data] {
        buffer.append(contentsOf: bytes)
        var bodies: [Data] = []
        while true {
            if pending == nil {
                guard let end = headerEnd() else { break }
                pending = contentLength(in: start..<end)
                start = end + Self.separator.count
                if pending == nil { continue }
            }
            guard let length = pending, buffer.count - start >= length else { break }
            bodies.append(Data(buffer[start..<start + length]))
            start += length
            pending = nil
        }
        if start > 0, start >= buffer.count / 2 {
            buffer.removeFirst(start)
            start = 0
        }
        return bodies
    }

    public static func frame(_ body: Data) -> Data {
        var framed = Data("Content-Length: \(body.count)\r\n\r\n".utf8)
        framed.append(body)
        return framed
    }

    private func headerEnd() -> Int? {
        guard buffer.count - start >= Self.separator.count else { return nil }
        for index in start...(buffer.count - Self.separator.count)
        where buffer[index] == 0x0D && buffer[index + 1] == 0x0A && buffer[index + 2] == 0x0D && buffer[index + 3] == 0x0A {
            return index
        }
        return nil
    }

    private func contentLength(in header: Range<Int>) -> Int? {
        for line in buffer[header].split(separator: 0x0A) {
            let lowered = line.prefix(Self.field.count).map { $0 | 0x20 }
            guard lowered.elementsEqual(Self.field) else { continue }
            let digits = line.dropFirst(Self.field.count).filter { $0 >= 0x30 && $0 <= 0x39 }
            return Int(String(decoding: digits, as: UTF8.self))
        }
        return nil
    }
}
