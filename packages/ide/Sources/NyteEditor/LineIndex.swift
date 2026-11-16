import Foundation
import NyteUI
import NyteCore

struct LineIndex: Sendable {
    struct Change: Equatable {
        let line: Int
        let removed: Int
        let inserted: Int
    }

    static let newline = UInt16(UInt8(ascii: "\n"))
    private static let smallestGap = 64
    private static let gapShare = 16

    private var starts: [Int]
    private var entryStates: [UInt8]
    private var gapStart: Int
    private var gapEnd: Int
    private var shiftAfterGap = 0

    init() {
        self.init(starts: [0])
    }

    init(starts: [Int]) {
        self.starts = starts
        entryStates = [UInt8](repeating: LexState.normal, count: starts.count)
        gapStart = starts.count
        gapEnd = starts.count
    }

    init(_ units: UnsafeBufferPointer<UInt16>) {
        var starts = [0]
        starts.reserveCapacity(units.count / 32 + 1)
        for index in units.indices where units[index] == Self.newline { starts.append(index + 1) }
        self.init(starts: starts)
    }

    var count: Int { starts.count - (gapEnd - gapStart) }

    func start(of line: Int) -> Int {
        line < gapStart ? starts[line] : starts[line + gapEnd - gapStart] + shiftAfterGap
    }

    func entryState(of line: Int) -> UInt8 {
        entryStates[line < gapStart ? line : line + gapEnd - gapStart]
    }

    mutating func setEntryState(_ state: UInt8, of line: Int) {
        entryStates[line < gapStart ? line : line + gapEnd - gapStart] = state
    }

    func line(at offset: Int) -> Int {
        var low = 0
        var high = count - 1
        while low < high {
            let middle = (low + high + 1) / 2
            if start(of: middle) <= offset { low = middle } else { high = middle - 1 }
        }
        return low
    }

    func position(at offset: Int) -> TextPosition {
        let line = line(at: offset)
        return TextPosition(line: line, column: offset - start(of: line))
    }

    func offset(of position: TextPosition, length: Int) -> Int? {
        guard position.line >= 0, position.line < count else { return nil }
        let range = range(of: position.line, length: length)
        return range.location + min(max(0, position.column), range.length)
    }

    func end(length: Int) -> TextPosition { position(at: length) }

    func range(of line: Int, length: Int) -> NSRange {
        let lineStart = start(of: line)
        let end = line + 1 < count ? start(of: line + 1) - 1 : length
        return NSRange(location: lineStart, length: end - lineStart)
    }

    mutating func replace(location: Int, oldLength: Int, inserted: UnsafeBufferPointer<UInt16>) -> Change {
        let line = line(at: location)
        let lower = line + 1
        var upper = lower
        while upper < count, start(of: upper) <= location + oldLength { upper += 1 }
        moveGap(to: lower)
        gapEnd += upper - lower
        shiftAfterGap += inserted.count - oldLength
        var added = 0
        for index in inserted.indices where inserted[index] == Self.newline {
            insertAtGap(location + index + 1)
            added += 1
        }
        return Change(line: line, removed: upper - lower, inserted: added)
    }

    private mutating func moveGap(to line: Int) {
        while gapStart > line {
            gapStart -= 1
            gapEnd -= 1
            starts[gapEnd] = starts[gapStart] - shiftAfterGap
            entryStates[gapEnd] = entryStates[gapStart]
        }
        while gapStart < line {
            starts[gapStart] = starts[gapEnd] + shiftAfterGap
            entryStates[gapStart] = entryStates[gapEnd]
            gapStart += 1
            gapEnd += 1
        }
    }

    private mutating func insertAtGap(_ lineStart: Int) {
        if gapStart == gapEnd { widenGap() }
        starts[gapStart] = lineStart
        entryStates[gapStart] = LexState.normal
        gapStart += 1
    }

    private mutating func widenGap() {
        let width = max(Self.smallestGap, starts.count / Self.gapShare)
        starts.insert(contentsOf: repeatElement(0, count: width), at: gapStart)
        entryStates.insert(contentsOf: repeatElement(LexState.normal, count: width), at: gapStart)
        gapEnd += width
    }
}
