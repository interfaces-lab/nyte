import Foundation
import NyteCore

enum DiffMode: Int, Sendable {
    case unified, split
}

struct DiffFolds: Equatable, Sendable {
    static let context: Int32 = 3
    static let step: Int32 = 20
    static let smallestFold: Int32 = 4

    var top: [Int32]
    var bottom: [Int32]

    init(hunks: Int) {
        top = (0...hunks).map { $0 == 0 ? 0 : Self.context }
        bottom = (0...hunks).map { $0 == hunks ? 0 : Self.context }
    }

    func expanded(_ gap: Int, fully: Bool) -> DiffFolds {
        var folds = self
        let last = top.count - 1
        let reveal = fully ? Int32.max / 4 : Self.step
        switch gap {
        case 0: folds.bottom[gap] += reveal
        case last: folds.top[gap] += reveal
        default:
            folds.top[gap] += reveal / 2
            folds.bottom[gap] += reveal / 2
        }
        return folds
    }

    func expandedAll() -> DiffFolds {
        (0..<top.count).reduce(self) { $0.expanded($1, fully: true) }
    }
}

struct DiffRows: Sendable {
    enum Kind: UInt8, Sendable {
        case context, removed, added, changed, header, fold, note, composer, gap
    }

    struct Anchor: Sendable {
        var side: ReviewComment.Side
        var line: Int
        var height: CGFloat
        var note: Int
    }

    var kinds: [Kind] = []
    var old: [Int32] = []
    var new: [Int32] = []
    var owner: [Int32] = []
    var tops: [CGFloat] = [0]
    var headers: [Int32] = []

    var count: Int { kinds.count }
    var height: CGFloat { tops[tops.count - 1] }

    func rect(of row: Int, width: CGFloat) -> CGRect {
        CGRect(x: 0, y: tops[row], width: width, height: tops[row + 1] - tops[row])
    }

    func row(at y: CGFloat) -> Int {
        guard count > 0 else { return -1 }
        var low = 0, high = count - 1
        while low < high {
            let middle = (low + high + 1) / 2
            if tops[middle] <= y { low = middle } else { high = middle - 1 }
        }
        return low
    }

    func hiddenLines(ofFold row: Int) -> Int { Int(new[row]) }

    func isChange(_ row: Int) -> Bool {
        switch kinds[row] {
        case .removed, .added, .changed: true
        case .context, .header, .fold, .note, .composer, .gap: false
        }
    }

    func gapped(_ gaps: [PatchShape.Gap], height: CGFloat) -> DiffRows {
        guard !gaps.isEmpty else { return self }
        var before = [Int](repeating: -1, count: count + 1)
        var next = 0
        for row in 0..<count where next < gaps.count && kinds[row] != .header {
            let gap = gaps[next]
            let reached = (new[row] >= 0 && kinds[row] != .removed && new[row] >= gap.new) || (old[row] >= 0 && old[row] >= gap.old)
            guard reached else { continue }
            let at = row > 0 && kinds[row - 1] == .header ? row - 1 : row
            before[at] = next
            next += 1
        }
        var rows = DiffRows()
        for row in 0...count {
            if before[row] >= 0 {
                rows.append(.gap, Int32(before[row]), -1, row < count ? owner[row] : 0, height)
            }
            guard row < count else { break }
            if kinds[row] == .header { rows.headers.append(Int32(rows.count)) }
            rows.append(kinds[row], old[row], new[row], owner[row], tops[row + 1] - tops[row])
        }
        return rows
    }

    func noteIndex(_ row: Int) -> Int? { kinds[row] == .note ? Int(old[row]) : nil }

    func anchored(_ anchors: [Anchor]) -> DiffRows {
        guard !anchors.isEmpty else { return self }
        var pending = anchors.indices.map { $0 }
        var rows = DiffRows()
        rows.headers.reserveCapacity(headers.count)
        for row in 0..<count {
            if kinds[row] == .header { rows.headers.append(Int32(rows.count)) }
            rows.append(kinds[row], old[row], new[row], owner[row], tops[row + 1] - tops[row])
            guard !pending.isEmpty, kinds[row] != .header, kinds[row] != .fold else { continue }
            let here = pending.filter { index in
                let anchor = anchors[index]
                return anchor.side == .new ? new[row] == Int32(anchor.line) && kinds[row] != .removed
                    : old[row] == Int32(anchor.line) && kinds[row] != .added
            }
            for index in here {
                let anchor = anchors[index]
                rows.append(anchor.note < 0 ? .composer : .note, Int32(anchor.note), -1, owner[row], anchor.height)
            }
            pending.removeAll { here.contains($0) }
        }
        return rows
    }

    static func build(_ document: DiffDocument, mode: DiffMode, folds: DiffFolds, line: CGFloat, header: CGFloat) -> DiffRows {
        var rows = DiffRows()
        let hunks = document.diff.hunks
        let estimate = hunks.reduce(0) { $0 + $1.old.count + $1.new.count } + hunks.count * 8 + 8
        rows.kinds.reserveCapacity(estimate)
        rows.old.reserveCapacity(estimate)
        rows.new.reserveCapacity(estimate)
        rows.owner.reserveCapacity(estimate)
        rows.tops.reserveCapacity(estimate + 1)
        rows.headers.reserveCapacity(hunks.count)
        for gap in 0...hunks.count {
            let oldStart = gap == 0 ? 0 : hunks[gap - 1].old.upperBound
            let newStart = gap == 0 ? 0 : hunks[gap - 1].new.upperBound
            let newEnd = gap == hunks.count ? document.new.count : hunks[gap].new.lowerBound
            let length = Int32(newEnd - newStart)
            var top = min(folds.top[gap], length), bottom = min(folds.bottom[gap], length - top)
            if length - top - bottom < DiffFolds.smallestFold {
                top = length
                bottom = 0
            }
            let owner = Int32(max(0, gap - 1))
            for offset in 0..<Int(top) {
                rows.append(.context, Int32(oldStart + offset), Int32(newStart + offset), owner, line)
            }
            let hidden = length - top - bottom
            if hidden > 0 { rows.append(.fold, Int32(gap), hidden, Int32(gap), header) }
            guard gap < hunks.count else {
                for offset in Int(length - bottom)..<Int(length) {
                    rows.append(.context, Int32(oldStart + offset), Int32(newStart + offset), owner, line)
                }
                break
            }
            rows.headers.append(Int32(rows.count))
            rows.append(.header, -1, -1, Int32(gap), header)
            for offset in Int(length - bottom)..<Int(length) {
                rows.append(.context, Int32(oldStart + offset), Int32(newStart + offset), Int32(gap), line)
            }
            let hunk = hunks[gap]
            switch mode {
            case .unified:
                for line32 in hunk.old { rows.append(.removed, Int32(line32), -1, Int32(gap), line) }
                for line32 in hunk.new { rows.append(.added, -1, Int32(line32), Int32(gap), line) }
            case .split:
                for index in 0..<max(hunk.old.count, hunk.new.count) {
                    let left = index < hunk.old.count ? Int32(hunk.old.lowerBound + index) : -1
                    let right = index < hunk.new.count ? Int32(hunk.new.lowerBound + index) : -1
                    rows.append(.changed, left, right, Int32(gap), line)
                }
            }
        }
        return rows
    }

    private mutating func append(_ kind: Kind, _ oldLine: Int32, _ newLine: Int32, _ owner: Int32, _ height: CGFloat) {
        kinds.append(kind)
        old.append(oldLine)
        new.append(newLine)
        self.owner.append(owner)
        tops.append(tops[tops.count - 1] + height)
    }

    func selection(_ rows: IndexSet) -> DiffSelection {
        var selection = DiffSelection()
        for row in rows where row < count {
            switch kinds[row] {
            case .removed: selection.old.insert(Int(old[row]))
            case .added: selection.new.insert(Int(new[row]))
            case .changed:
                if old[row] >= 0 { selection.old.insert(Int(old[row])) }
                if new[row] >= 0 { selection.new.insert(Int(new[row])) }
            case .context, .header, .fold, .note, .composer, .gap: continue
            }
        }
        return selection
    }

    func rows(ofHunk hunk: Int) -> Range<Int> {
        let start = Int(headers[hunk])
        var end = start + 1
        while end < count, owner[end] == Int32(hunk), kinds[end] != .header, kinds[end] != .fold, kinds[end] != .gap { end += 1 }
        return start..<end
    }
}
