import AppKit
@testable import NyteEditor

struct WholeGapBuffer {
    var storage: ContiguousArray<UInt16>
    var gapStart: Int
    var gapEnd: Int

    init(_ units: [UInt16]) {
        storage = ContiguousArray(units)
        storage.append(contentsOf: repeatElement(0, count: 4_096))
        gapStart = units.count
        gapEnd = storage.count
    }

    var count: Int { storage.count - (gapEnd - gapStart) }

    mutating func insert(_ units: [UInt16], at offset: Int) {
        moveGap(to: offset)
        if gapEnd - gapStart < units.count {
            let grow = max(units.count, storage.count / 8)
            storage.insert(contentsOf: repeatElement(0, count: grow), at: gapEnd)
            gapEnd += grow
        }
        for unit in units {
            storage[gapStart] = unit
            gapStart += 1
        }
    }

    mutating func moveGap(to offset: Int) {
        guard offset != gapStart else { return }
        let width = gapEnd - gapStart
        storage.withUnsafeMutableBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            if offset < gapStart {
                (base + offset + width).update(from: base + offset, count: gapStart - offset)
            } else {
                (base + gapStart).update(from: base + gapEnd, count: offset - gapStart)
            }
        }
        gapStart = offset
        gapEnd = offset + width
    }

    func read(_ location: Int, _ length: Int) -> Int {
        var sum = 0
        for index in location..<location + length { sum &+= Int(storage[index < gapStart ? index : index + gapEnd - gapStart]) }
        return sum
    }
}

extension EditorBench {
    static let bufferOperations = 2_000

    static func bufferChoice(lines: Int) {
        let units = Array(goSource(lines: lines).utf16)
        let clock = ContinuousClock()
        print("\(lines) lines, \(units.count) UTF-16 units; per operation in µs, p50 / p95")
        var started = clock.now
        var chunked = units.withUnsafeBufferPointer { TextBuffer($0) }
        let chunkedLoad = clock.now - started
        started = clock.now
        var whole = WholeGapBuffer(units)
        let wholeLoad = clock.now - started
        print(String(format: "  load: chunks %.1f ms, one gap %.1f ms", micros(chunkedLoad) / 1000, micros(wholeLoad) / 1000))
        let middle = units.count / 2
        let typed: [UInt16] = [0x78]
        var random = Xorshift(state: 0x51ED_2701_7A3C_44B1)
        let spots = (0..<bufferOperations).map { _ in random.next(units.count) }
        let rows: [(String, () -> Void, () -> Void)] = [
            ("type at one place", { chunked.replace(NSRange(location: middle, length: 0), with: typed) },
             { whole.insert(typed, at: middle) }),
            ("edit at a random place", { chunked.replace(NSRange(location: spots[random.next(spots.count)], length: 0), with: typed) },
             { whole.insert(typed, at: spots[random.next(spots.count)]) }),
            ("edit while a snapshot is alive", {
                let snapshot = chunked
                chunked.replace(NSRange(location: middle, length: 0), with: typed)
                withExtendedLifetime(snapshot) {}
            }, {
                let snapshot = whole
                whole.insert(typed, at: middle)
                withExtendedLifetime(snapshot) {}
            }),
            ("read an 80-unit line", { _ = chunked.withUnits(NSRange(location: spots[random.next(spots.count)], length: 80)) { $0.reduce(0) { $0 &+ Int($1) } } },
             { _ = whole.read(spots[random.next(spots.count)], 80) }),
        ]
        for (name, onChunks, onGap) in rows {
            let a = timed(onChunks, clock: clock)
            let b = timed(onGap, clock: clock)
            print(String(format: "  %-32@ chunks %7.2f / %7.2f   one gap %8.2f / %8.2f", name, percentile(a, 0.5), percentile(a, 0.95),
                         percentile(b, 0.5), percentile(b, 0.95)))
        }
        let chunkBytes = chunked.chunks.reduce(0) { $0 + $1.capacity * 2 } + chunked.chunks.count * 8 * 2
        print(String(format: "  bytes per unit after the edits: chunks %.3f (%d chunks), one gap %.3f", Double(chunkBytes) / Double(chunked.count),
                     chunked.chunks.count, Double(whole.storage.capacity * 2) / Double(whole.count)))
    }

    static func timed(_ operation: () -> Void, clock: ContinuousClock) -> [Double] {
        (0..<bufferOperations).map { _ in
            let started = clock.now
            operation()
            return micros(clock.now - started)
        }
    }
}
