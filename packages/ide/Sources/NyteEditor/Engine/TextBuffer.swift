import Foundation

struct TextBuffer: Sendable {
    static let chunkCapacity = 16_368
    static let loadFill = 8_176
    static let mergeBelow = 1_024

    private(set) var chunks: [ContiguousArray<UInt16>]
    private var ends: [Int]

    init() {
        chunks = [[]]
        ends = [0]
    }

    init(chunks: [ContiguousArray<UInt16>]) {
        var running = 0
        self.init(chunks: chunks, ends: chunks.map { running += $0.count; return running })
    }

    private init(chunks: [ContiguousArray<UInt16>], ends: [Int]) {
        self.chunks = chunks.isEmpty ? [[]] : chunks
        self.ends = ends.isEmpty ? [0] : ends
    }

    init(_ units: UnsafeBufferPointer<UInt16>) {
        var chunks: [ContiguousArray<UInt16>] = []
        var ends: [Int] = []
        chunks.reserveCapacity(units.count / Self.loadFill + 1)
        ends.reserveCapacity(units.count / Self.loadFill + 1)
        var start = 0
        while start < units.count {
            let end = Self.splitPoint(units, near: min(units.count, start + Self.loadFill))
            var chunk = ContiguousArray<UInt16>()
            chunk.reserveCapacity(end - start)
            chunk.append(contentsOf: UnsafeBufferPointer(rebasing: units[start..<end]))
            chunks.append(chunk)
            ends.append(end)
            start = end
        }
        self.init(chunks: chunks, ends: ends)
    }

    init(_ string: String) {
        let units = Array(string.utf16)
        self = units.withUnsafeBufferPointer { TextBuffer($0) }
    }

    var count: Int { ends[ends.count - 1] }
    var isEmpty: Bool { count == 0 }

    subscript(offset: Int) -> UInt16 {
        let slot = chunk(containing: offset)
        return chunks[slot][offset - start(ofChunk: slot)]
    }

    func start(ofChunk slot: Int) -> Int { slot == 0 ? 0 : ends[slot - 1] }

    func withUnits<Result>(_ range: NSRange, _ body: (UnsafeBufferPointer<UInt16>) throws -> Result) rethrows -> Result {
        guard range.length > 0 else { return try body(UnsafeBufferPointer(start: nil, count: 0)) }
        let slot = chunk(containing: range.location)
        let local = range.location - start(ofChunk: slot)
        if local + range.length <= chunks[slot].count {
            return try chunks[slot].withUnsafeBufferPointer { try body(UnsafeBufferPointer(rebasing: $0[local..<local + range.length])) }
        }
        return try withUnsafeTemporaryAllocation(of: UInt16.self, capacity: range.length) { scratch in
            copy(range, into: scratch)
            return try body(UnsafeBufferPointer(scratch))
        }
    }

    func copy(_ range: NSRange, into target: UnsafeMutableBufferPointer<UInt16>) {
        var written = 0
        var slot = chunk(containing: range.location)
        var local = range.location - start(ofChunk: slot)
        while written < range.length {
            let take = min(chunks[slot].count - local, range.length - written)
            chunks[slot].withUnsafeBufferPointer { source in
                guard let from = source.baseAddress, let to = target.baseAddress else { return }
                (to + written).update(from: from + local, count: take)
            }
            written += take
            slot += 1
            local = 0
        }
    }

    func units(_ range: NSRange) -> [UInt16] {
        [UInt16](unsafeUninitializedCapacity: range.length) { target, initialized in
            copy(range, into: target)
            initialized = range.length
        }
    }

    func string(_ range: NSRange) -> String {
        withUnits(range) { String(decoding: $0, as: UTF16.self) }
    }

    var string: String { string(NSRange(location: 0, length: count)) }

    mutating func replace(_ range: NSRange, with inserted: UnsafeBufferPointer<UInt16>) {
        let first = chunk(atOrBefore: range.location)
        let last = range.length == 0 ? first : chunk(containing: NSMaxRange(range) - 1)
        let firstStart = start(ofChunk: first)
        let localStart = range.location - firstStart
        let localEnd = NSMaxRange(range) - start(ofChunk: last)
        if first == last, chunks[first].count - range.length + inserted.count <= Self.chunkCapacity {
            chunks[first].replaceSubrange(localStart..<localEnd, with: inserted)
            let delta = inserted.count - range.length
            if delta != 0 { shiftEnds(from: first, by: delta) }
            if chunks[first].count < Self.mergeBelow { mergeSmall(first) }
            return
        }
        var joined = ContiguousArray<UInt16>()
        joined.reserveCapacity(localStart + inserted.count + chunks[last].count - localEnd)
        joined.append(contentsOf: chunks[first][0..<localStart])
        joined.append(contentsOf: inserted)
        joined.append(contentsOf: chunks[last][localEnd...])
        let pieces = joined.withUnsafeBufferPointer(Self.split)
        chunks.replaceSubrange(first...last, with: pieces)
        if chunks.isEmpty { chunks = [[]] }
        rebuildEnds(from: first)
        if first < chunks.count, chunks[first].count < Self.mergeBelow { mergeSmall(first) }
    }

    mutating func replace(_ range: NSRange, with inserted: [UInt16]) {
        inserted.withUnsafeBufferPointer { replace(range, with: $0) }
    }

    func chunk(containing offset: Int) -> Int {
        var low = 0
        var high = ends.count - 1
        while low < high {
            let middle = (low + high) / 2
            if ends[middle] > offset { high = middle } else { low = middle + 1 }
        }
        return low
    }

    private func chunk(atOrBefore offset: Int) -> Int {
        var low = 0
        var high = ends.count - 1
        while low < high {
            let middle = (low + high) / 2
            if ends[middle] >= offset { high = middle } else { low = middle + 1 }
        }
        return low
    }

    private mutating func shiftEnds(from slot: Int, by delta: Int) {
        ends.withUnsafeMutableBufferPointer { ends in
            for index in slot..<ends.count { ends[index] += delta }
        }
    }

    private mutating func rebuildEnds(from slot: Int) {
        ends.removeSubrange(min(slot, ends.count)...)
        var running = slot == 0 ? 0 : ends[slot - 1]
        for index in slot..<chunks.count {
            running += chunks[index].count
            ends.append(running)
        }
    }

    private mutating func mergeSmall(_ slot: Int) {
        guard chunks.count > 1 else { return }
        let neighbour = slot + 1 < chunks.count ? slot + 1 : slot - 1
        let low = min(slot, neighbour)
        guard chunks[low].count + chunks[low + 1].count <= Self.chunkCapacity else { return }
        chunks[low].append(contentsOf: chunks[low + 1])
        chunks.remove(at: low + 1)
        ends.remove(at: low)
    }

    private static func split(_ units: UnsafeBufferPointer<UInt16>) -> [ContiguousArray<UInt16>] {
        guard !units.isEmpty else { return [] }
        var pieces: [ContiguousArray<UInt16>] = []
        var start = 0
        while start < units.count {
            let remaining = units.count - start
            let end = remaining <= chunkCapacity ? units.count : splitPoint(units, near: start + loadFill)
            pieces.append(ContiguousArray(UnsafeBufferPointer(rebasing: units[start..<end])))
            start = end
        }
        return pieces
    }

    private static func splitPoint(_ units: UnsafeBufferPointer<UInt16>, near end: Int) -> Int {
        guard end < units.count, end > 0, UTF16.isTrailSurrogate(units[end]) else { return end }
        return end + 1
    }
}
