import Foundation

struct FoldMap: Equatable, Sendable {
    private(set) var firsts: [Int] = []
    private(set) var lasts: [Int] = []
    private var hiddenBefore: [Int] = [0]

    init() {}

    init(hiding ranges: [ClosedRange<Int>]) {
        for range in ranges.filter({ $0.lowerBound >= 1 }).sorted(by: { $0.lowerBound < $1.lowerBound }) {
            if let last = lasts.last, range.lowerBound <= last + 1 {
                lasts[lasts.count - 1] = max(last, range.upperBound)
                continue
            }
            firsts.append(range.lowerBound)
            lasts.append(range.upperBound)
        }
        hiddenBefore = firsts.indices.reduce(into: [0]) { $0.append($0[$0.count - 1] + lasts[$1] - firsts[$1] + 1) }
    }

    var ranges: [ClosedRange<Int>] { firsts.indices.map { firsts[$0]...lasts[$0] } }
    var hiddenCount: Int { hiddenBefore[hiddenBefore.count - 1] }

    func rowCount(lines: Int) -> Int { lines - hiddenCount }

    func isHidden(_ line: Int) -> Bool {
        let slot = rangesStarting(atOrBefore: line) - 1
        return slot >= 0 && line <= lasts[slot]
    }

    func row(of line: Int) -> Int {
        let slot = rangesStarting(atOrBefore: line) - 1
        guard slot >= 0 else { return line }
        if line <= lasts[slot] { return firsts[slot] - 1 - hiddenBefore[slot] }
        return line - hiddenBefore[slot + 1]
    }

    func line(atRow row: Int) -> Int {
        var low = 0
        var high = firsts.count
        while low < high {
            let middle = (low + high) / 2
            if firsts[middle] - hiddenBefore[middle] <= row { low = middle + 1 } else { high = middle }
        }
        return row + hiddenBefore[low]
    }

    func folding(_ range: ClosedRange<Int>) -> FoldMap {
        FoldMap(hiding: ranges + [range])
    }

    func unfolding(around line: Int) -> FoldMap {
        let slot = rangesStarting(atOrBefore: line + 1) - 1
        guard slot >= 0, line + 1 >= firsts[slot], line <= lasts[slot] else { return self }
        return FoldMap(hiding: ranges.enumerated().filter { $0.offset != slot }.map(\.element))
    }

    func shifted(by change: LineIndex.Change) -> FoldMap {
        let shift = change.inserted - change.removed
        let lastEdited = change.line + change.removed
        let touchesHeader = { (first: Int) in change.line == first - 1 && (change.removed > 0 || change.inserted > 0) }
        return FoldMap(hiding: ranges.compactMap { range in
            if range.upperBound < change.line { return range }
            if range.lowerBound > lastEdited, !touchesHeader(range.lowerBound) { return (range.lowerBound + shift)...(range.upperBound + shift) }
            return nil
        })
    }

    private func rangesStarting(atOrBefore line: Int) -> Int {
        var low = 0
        var high = firsts.count
        while low < high {
            let middle = (low + high) / 2
            if firsts[middle] <= line { low = middle + 1 } else { high = middle }
        }
        return low
    }
}
