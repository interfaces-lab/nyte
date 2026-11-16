import Foundation
import NyteUI

struct RowMap: Equatable, Sendable {
    var folds = FoldMap()

    func rowCount(lines: Int) -> Int { folds.rowCount(lines: lines) }
    func row(of line: Int) -> Int { folds.row(of: line) }
    func line(atRow row: Int) -> Int { folds.line(atRow: row) }

    func shifted(by change: TextChange) -> RowMap {
        folds.hiddenCount == 0 ? self : RowMap(folds: folds.shifted(by: change.lines))
    }
}

@MainActor
struct RowLayoutCache {
    static let limit = 512

    struct Key: Hashable {
        let line: Int
        let window: Int
    }

    private var entries: [Key: CodeRowLayout] = [:]

    subscript(_ key: Key) -> CodeRowLayout? { entries[key] }

    mutating func store(_ layout: CodeRowLayout, for key: Key) {
        if entries.count >= Self.limit { entries.removeAll(keepingCapacity: true) }
        entries[key] = layout
    }

    mutating func removeAll() { entries.removeAll(keepingCapacity: true) }

    mutating func remove(line: Int) {
        for key in entries.keys where key.line == line { entries[key] = nil }
    }

    @discardableResult
    mutating func invalidate(_ change: TextChange) -> ClosedRange<Int> {
        let first = change.lines.line
        let reach = max(first + change.lines.inserted, change.relexedThrough)
        let shift = change.lines.inserted - change.lines.removed
        guard shift != 0 || change.lines.removed != 0 else {
            for key in entries.keys where key.line >= first && key.line <= reach { entries[key] = nil }
            return first...reach
        }
        let lastRemoved = first + change.lines.removed
        var kept: [Key: CodeRowLayout] = [:]
        kept.reserveCapacity(entries.count)
        for (key, layout) in entries {
            if key.line < first {
                kept[key] = layout
            } else if key.line > lastRemoved, key.line + shift > reach {
                kept[Key(line: key.line + shift, window: key.window)] = layout
            }
        }
        entries = kept
        return first...reach
    }
}
