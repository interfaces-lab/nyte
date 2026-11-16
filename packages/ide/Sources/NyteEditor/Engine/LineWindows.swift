import AppKit
import NyteUI

struct LineWindows: Equatable {
    static let reach = 64
    private static let firstCombining: UInt16 = 0x300
    private static let joiner: UInt16 = 0x200D

    private(set) var starts: [Int]
    private(set) var widths: [CGFloat]
    private(set) var origins: [CGFloat]
    private(set) var length: Int

    var count: Int { widths.count }
    var width: CGFloat { (origins.last ?? 0) + (widths.last ?? 0) }

    func end(of window: Int) -> Int { window + 1 < starts.count ? starts[window + 1] : length }

    func window(containing column: Int) -> Int {
        var low = 0
        var high = starts.count - 1
        while low < high {
            let middle = (low + high + 1) / 2
            if starts[middle] <= column { low = middle } else { high = middle - 1 }
        }
        return low
    }

    func window(atX x: CGFloat) -> Int {
        var low = 0
        var high = origins.count - 1
        while low < high {
            let middle = (low + high + 1) / 2
            if origins[middle] <= x { low = middle } else { high = middle - 1 }
        }
        return low
    }

    static func build(_ units: UnsafeBufferPointer<UInt16>, size: Int, advance: CGFloat,
                      measure: (Range<Int>) -> CGFloat) -> LineWindows {
        var starts: [Int] = []
        var widths: [CGFloat] = []
        var start = 0
        repeat {
            let end = boundary(in: units, near: min(units.count, start + size))
            starts.append(start)
            widths.append(width(of: start..<end, in: units, advance: advance, measure: measure))
            start = end
        } while start < units.count
        return LineWindows(starts: starts, widths: widths, length: units.count)
    }

    private init(starts: [Int], widths: [CGFloat], length: Int) {
        self.starts = starts
        self.widths = widths
        self.length = length
        origins = Self.prefix(widths)
    }

    mutating func edit(_ removed: NSRange, inserted: Int, in units: UnsafeBufferPointer<UInt16>, size: Int, advance: CGFloat,
                       measure: (Range<Int>) -> CGFloat) {
        let slot = window(containing: removed.location)
        guard NSMaxRange(removed) <= end(of: slot) else {
            self = Self.build(units, size: size, advance: advance, measure: measure)
            return
        }
        let delta = inserted - removed.length
        length += delta
        for index in (slot + 1)..<starts.count { starts[index] += delta }
        let end = end(of: slot)
        guard end - starts[slot] > 0, end - starts[slot] <= size * 2, slot + 1 >= starts.count || starts[slot + 1] > starts[slot] else {
            self = Self.build(units, size: size, advance: advance, measure: measure)
            return
        }
        widths[slot] = Self.width(of: starts[slot]..<end, in: units, advance: advance, measure: measure)
        origins = Self.prefix(widths)
    }

    static func boundary(in units: UnsafeBufferPointer<UInt16>, near end: Int) -> Int {
        var index = end
        let limit = min(units.count, end + reach)
        while index < limit, index > 0,
              units[index] >= firstCombining || UTF16.isTrailSurrogate(units[index]) || units[index - 1] == joiner {
            index += 1
        }
        return index
    }

    private static func width(of range: Range<Int>, in units: UnsafeBufferPointer<UInt16>, advance: CGFloat,
                              measure: (Range<Int>) -> CGFloat) -> CGFloat {
        let plain = units[range].allSatisfy { $0 < 0x80 && $0 != TextCommands.tab }
        return plain ? CGFloat(range.count) * advance : measure(range)
    }

    private static func prefix(_ widths: [CGFloat]) -> [CGFloat] {
        var running: CGFloat = 0
        return widths.map { width in
            defer { running += width }
            return running
        }
    }
}
