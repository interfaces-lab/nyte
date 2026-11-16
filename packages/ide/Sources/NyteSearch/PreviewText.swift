import Darwin
import Foundation
import NyteUI

struct PreviewText: Sendable {
    static let span = 48 << 10
    static let radius = 200
    static let longLine = 2_000
    static let lead = 600

    var path = ""
    var firstLine = 0
    var lines: [String] = []
    var columnOffsets: [Int] = []
    var entryState = LexState.normal
    var lexedFromTop = true

    var lineCount: Int { lines.count }
    var lastLine: Int { firstLine + lines.count - 1 }

    static func read(root: URL, path: String, unsaved: String?, line: Int, byte: Int, column: Int,
                     checkpoints: LexCheckpoints) -> PreviewText {
        let language = Language.detect(fileName: (path as NSString).lastPathComponent)
        if var text = unsaved {
            let key = "\(path)\u{0}\(text.utf8.count)\u{0}\(text.hashValue)"
            return text.withUTF8 { all in
                cut(all, windowStart: 0, total: all.count, path: path, line: line, byte: byte, column: column) { first in
                    checkpoints.state(at: first, key: key, language: language) { Array(all[$0]) }
                }
            }
        }
        let descriptor = open(root.appendingPathComponent(path).path, O_RDONLY | O_CLOEXEC)
        guard descriptor >= 0 else { return PreviewText(path: path) }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0 else { return PreviewText(path: path) }
        let total = Int(info.st_size)
        let key = "\(path)\u{0}\(total)\u{0}\(info.st_mtimespec.tv_sec).\(info.st_mtimespec.tv_nsec)"
        let start = max(0, byte - span)
        let end = min(total, byte + span)
        guard end > start else { return PreviewText(path: path) }
        var buffer = [UInt8](repeating: 0, count: end - start)
        let got = buffer.withUnsafeMutableBytes { pread(descriptor, $0.baseAddress, end - start, off_t(start)) }
        guard got > 0 else { return PreviewText(path: path) }
        return buffer.withUnsafeBufferPointer { window in
            cut(UnsafeBufferPointer(rebasing: window[0..<got]), windowStart: start, total: total, path: path, line: line, byte: byte,
                column: column) { first in
                checkpoints.state(at: first, key: key, language: language) { range in
                    var chunk = [UInt8](repeating: 0, count: range.count)
                    let read = chunk.withUnsafeMutableBytes { pread(descriptor, $0.baseAddress, range.count, off_t(range.lowerBound)) }
                    return read == range.count ? chunk : []
                }
            }
        }
    }

    private static func cut(_ window: UnsafeBufferPointer<UInt8>, windowStart: Int, total: Int, path: String, line: Int, byte: Int,
                            column: Int, carried: (Int) -> UInt8?) -> PreviewText {
        guard let base = window.baseAddress else { return PreviewText(path: path) }
        let count = window.count
        let target = min(max(0, byte - windowStart), count)
        let found = ByteScan.lastNewline(base, before: target, notBefore: 0)
        let matchLineStart = found.map { $0 + 1 } ?? 0
        let knowsLineStart = found != nil || windowStart == 0
        var starts = [matchLineStart]
        var cursor = matchLineStart
        while starts.count <= radius, cursor > 0, let previous = ByteScan.lastNewline(base, before: cursor - 1, notBefore: 0) {
            starts.insert(previous + 1, at: 0)
            cursor = previous + 1
        }
        if starts.count <= radius, cursor > 0, windowStart == 0 { starts.insert(0, at: 0) }
        let before = starts.count - 1
        cursor = matchLineStart
        var after = 0
        while after < radius {
            let end = ByteScan.nextNewline(base, from: cursor, count: count)
            guard end < count || windowStart + count == total else { break }
            guard end < count else { break }
            starts.append(end + 1)
            cursor = end + 1
            after += 1
        }
        if starts.count - 1 > before, let last = starts.last, windowStart + count < total,
           ByteScan.nextNewline(base, from: last, count: count) == count {
            starts.removeLast()
        }
        var preview = PreviewText(path: path, firstLine: line - before)
        let initial = carried(windowStart + (starts.first ?? 0))
        preview.lexedFromTop = initial != nil
        preview.entryState = initial ?? LexState.normal
        for (index, start) in starts.enumerated() {
            var end = ByteScan.nextNewline(base, from: start, count: count)
            if end == count, index < starts.count - 1 { end = starts[index + 1] - 1 }
            if end > start, base[end - 1] == UInt8(ascii: "\r") { end -= 1 }
            var from = start
            var offset = 0
            if index == before, !knowsLineStart || end - start > longLine {
                from = max(start, target - lead)
                while from < target, base[from] & 0xC0 == 0x80 { from += 1 }
                offset = column - ByteScan.utf16Count(base, from: from, to: target)
            }
            var to = min(end, from + longLine)
            while to > from, to < end, base[to] & 0xC0 == 0x80 { to -= 1 }
            let text = String(decoding: UnsafeBufferPointer(start: base + from, count: to - from), as: UTF8.self)
            preview.lines.append(text)
            preview.columnOffsets.append(offset)
        }
        return preview
    }
}
