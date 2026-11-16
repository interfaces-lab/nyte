import Foundation
import NyteUI

enum TextLoader {
    struct Loaded: Sendable {
        let store: TextStore
        let format: TextFormat
        let widestColumns: Int
    }

    private static let utf8BOM: [UInt8] = [0xEF, 0xBB, 0xBF]
    private static let carriageReturn = UInt16(UInt8(ascii: "\r"))

    static func load(_ data: Data, language: Language) -> Loaded? {
        let hasBOM = data.starts(with: utf8BOM)
        let body = hasBOM ? data.dropFirst(utf8BOM.count) : data[...]
        guard var decoded = body.withUnsafeBytes({ Decoder.decode($0.bindMemory(to: UInt8.self)) }) else { return nil }
        guard decoded.crlf > decoded.lf else {
            let store = TextStore(buffer: TextBuffer(chunks: decoded.chunks), lines: LineIndex(starts: decoded.starts), language: language)
            return Loaded(store: store, format: TextFormat(encoding: .utf8, hasBOM: hasBOM, lineEnding: .lf), widestColumns: decoded.widest)
        }
        var units = decoded.chunks.flatMap { $0 }
        decoded.chunks = []
        units.removeAll { $0 == carriageReturn }
        let store = units.withUnsafeBufferPointer { TextStore($0, language: language) }
        return Loaded(store: store, format: TextFormat(encoding: .utf8, hasBOM: hasBOM, lineEnding: .crlf), widestColumns: decoded.widest)
    }

    static func widestColumns(_ units: UnsafeBufferPointer<UInt16>) -> Int {
        var widest = 0
        var start = 0
        for index in units.indices where units[index] == LineIndex.newline {
            widest = max(widest, index - start)
            start = index + 1
        }
        return max(widest, units.count - start)
    }

    struct Decoder {
        var chunks: [ContiguousArray<UInt16>] = []
        var current = ContiguousArray<UInt16>()
        var starts = [0]
        var count = 0
        var lineStart = 0
        var widest = 0
        var crlf = 0
        var lf = 0
        var previous: UInt16 = 0

        static func decode(_ bytes: UnsafeBufferPointer<UInt8>) -> Decoder? {
            var decoder = Decoder()
            decoder.current.reserveCapacity(TextBuffer.loadFill)
            decoder.starts.reserveCapacity(bytes.count / 32 + 1)
            var index = 0
            while index < bytes.count {
                let lead = bytes[index]
                if lead < 0x80 {
                    guard lead != 0 else { return nil }
                    decoder.append(UInt16(lead))
                    index += 1
                    continue
                }
                guard let (scalar, width) = scalar(in: bytes, at: index) else { return nil }
                if scalar < 0x10000 {
                    decoder.append(UInt16(scalar))
                } else {
                    decoder.split()
                    let value = scalar - 0x10000
                    decoder.current.append(UInt16(0xD800 + (value >> 10)))
                    decoder.current.append(UInt16(0xDC00 + (value & 0x3FF)))
                    decoder.count += 2
                }
                index += width
            }
            decoder.widest = max(decoder.widest, decoder.count - decoder.lineStart)
            if !decoder.current.isEmpty { decoder.chunks.append(decoder.current) }
            return decoder
        }

        private mutating func split() {
            guard current.count >= TextBuffer.loadFill else { return }
            chunks.append(current)
            current = ContiguousArray()
            current.reserveCapacity(TextBuffer.loadFill)
        }

        private mutating func append(_ unit: UInt16) {
            split()
            current.append(unit)
            count += 1
            if unit == LineIndex.newline {
                if previous == TextLoader.carriageReturn { crlf += 1 } else { lf += 1 }
                starts.append(count)
                widest = max(widest, count - 1 - lineStart)
                lineStart = count
            }
            previous = unit
        }

        private static func scalar(in bytes: UnsafeBufferPointer<UInt8>, at index: Int) -> (UInt32, Int)? {
            let lead = UInt32(bytes[index])
            let width: Int
            let minimum: UInt32
            var value: UInt32
            switch lead {
            case 0xC2...0xDF: (width, minimum, value) = (2, 0x80, lead & 0x1F)
            case 0xE0...0xEF: (width, minimum, value) = (3, 0x800, lead & 0x0F)
            case 0xF0...0xF4: (width, minimum, value) = (4, 0x10000, lead & 0x07)
            default: return nil
            }
            guard index + width <= bytes.count else { return nil }
            for offset in 1..<width {
                let next = UInt32(bytes[index + offset])
                guard next & 0xC0 == 0x80 else { return nil }
                value = value << 6 | (next & 0x3F)
            }
            guard value >= minimum, value <= 0x10FFFF, !(0xD800...0xDFFF).contains(value) else { return nil }
            return (value, width)
        }
    }
}
