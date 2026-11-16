import Foundation
import NyteUI
import Synchronization

final class LexCheckpoints: Sendable {
    static let interval = 256
    static let bound = 8 << 20
    static let capacity = 16

    struct Entry: Sendable {
        var key: String
        var bytes: [Int] = [0]
        var states: [UInt8] = [LexState.normal]
        var reach = 0
        var linesSinceCheckpoint = 0
        var state = LexState.normal
    }

    let bound: Int
    private let entries = Mutex<[Entry]>([])

    init(bound: Int = LexCheckpoints.bound) {
        self.bound = bound
    }

    func state(at target: Int, key: String, language: Language, read: (Range<Int>) -> [UInt8]) -> UInt8? {
        guard target <= bound else { return nil }
        guard target > 0 else { return LexState.normal }
        var entry = entries.withLock { list -> Entry in
            guard let index = list.firstIndex(where: { $0.key == key }) else { return Entry(key: key) }
            return list.remove(at: index)
        }
        if entry.reach < target {
            let chunk = read(entry.reach..<target)
            Self.extend(&entry, with: chunk, language: language)
        }
        let checkpoint = entry.bytes.lastIndex { $0 <= target } ?? 0
        let from = entry.bytes[checkpoint]
        var state = entry.states[checkpoint]
        if from < target {
            var scratch = Entry(key: key, bytes: [from], states: [state], reach: from)
            scratch.state = state
            Self.extend(&scratch, with: read(from..<target), language: language)
            state = scratch.state
        }
        entries.withLock { list in
            list.insert(entry, at: 0)
            if list.count > Self.capacity { list.removeLast() }
        }
        return state
    }

    private static func extend(_ entry: inout Entry, with chunk: [UInt8], language: Language) {
        var tokens: [UInt64] = []
        var start = 0
        chunk.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            while start < buffer.count {
                let newline = ByteScan.nextNewline(base, from: start, count: buffer.count)
                guard newline < buffer.count else { break }
                var end = newline
                if end > start, base[end - 1] == UInt8(ascii: "\r") { end -= 1 }
                let units = Array(String(decoding: UnsafeBufferPointer(start: base + start, count: end - start), as: UTF8.self).utf16)
                units.withUnsafeBufferPointer { line in
                    entry.state = Lexer.line(line, state: entry.state, language: language, offset: 0, tokens: &tokens, emit: false)
                }
                tokens.removeAll(keepingCapacity: true)
                start = newline + 1
                entry.linesSinceCheckpoint += 1
                if entry.linesSinceCheckpoint == interval {
                    entry.linesSinceCheckpoint = 0
                    entry.bytes.append(entry.reach + start)
                    entry.states.append(entry.state)
                }
            }
        }
        entry.reach += start
    }
}
