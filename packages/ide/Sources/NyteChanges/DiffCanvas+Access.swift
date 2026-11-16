import AppKit
import NyteCore
import NyteUI

final class DiffRowElement: NSAccessibilityElement {
    var press: (@MainActor () -> Void)?
    var selected: (@MainActor () -> Bool)?

    override func accessibilityPerformPress() -> Bool {
        guard let press else { return false }
        MainActor.assumeIsolated { press() }
        return true
    }

    override func isAccessibilitySelected() -> Bool {
        guard let selected else { return false }
        return MainActor.assumeIsolated { selected() }
    }
}

extension DiffCanvas {
    override func accessibilityChildren() -> [Any]? {
        guard rows.count > 0 else { return [] }
        let first = max(0, rows.row(at: visibleRect.minY)), last = min(rows.count - 1, rows.row(at: visibleRect.maxY))
        guard first <= last else { return [] }
        accessRows = accessRows.filter { (first...last).contains($0.key) }
        return (first...last).map(element)
    }

    override func accessibilitySelectedRows() -> [Any]? {
        selectedRows.filter { accessRows[$0] != nil || visibleRows.contains($0) }.map(element)
    }

    override func accessibilityRowCount() -> Int { rows.count }

    private var visibleRows: ClosedRange<Int> {
        guard rows.count > 0 else { return 0...0 }
        return max(0, rows.row(at: visibleRect.minY))...min(rows.count - 1, max(0, rows.row(at: visibleRect.maxY)))
    }

    func element(_ row: Int) -> NSAccessibilityElement {
        if let known = accessRows[row] { return known }
        let element = DiffRowElement()
        element.press = { [weak self] in
            guard let self, row < rows.count else { return }
            if rows.kinds[row] == .fold { expand(fold: row, fully: false) } else { move(to: row, extending: false) }
        }
        element.selected = { [weak self] in self?.selectedRows.contains(row) ?? false }
        element.setAccessibilityParent(self)
        element.setAccessibilityRole(.row)
        element.setAccessibilityIndex(row)
        element.setAccessibilityLabel(describe(row))
        let rect = rows.rect(of: row, width: bounds.width)
        element.setAccessibilityFrameInParentSpace(NSRect(x: rect.minX, y: bounds.height - rect.maxY, width: rect.width,
                                                          height: rect.height))
        if rows.kinds[row] == .header {
            element.setAccessibilityCustomActions([actions.primary, actions.destructive].compactMap { action in
                guard let action else { return nil }
                return NSAccessibilityCustomAction(name: action.title(lines: false)) { [weak self] in
                    guard let self, row < rows.count else { return false }
                    let hunk = Int(rows.owner[row])
                    onAction?(action, DiffSelection(hunks: [document.diff.hunks[hunk]]))
                    return true
                }
            })
        }
        accessRows[row] = element
        return element
    }

    func describe(_ row: Int) -> String {
        switch rows.kinds[row] {
        case .header:
            let index = Int(rows.owner[row])
            let hunk = document.diff.hunks[index]
            let place = heading(of: index).map { ", in " + $0 } ?? ""
            return "Change \(index + 1) of \(document.diff.hunks.count), \(hunk.new.count) added, \(hunk.old.count) removed, "
                + "at line \(headerStart(.new, hunk.new))\(place)"
        case .note, .composer:
            return describeNote(row)
        case .gap:
            return gapLabel(row)
        case .fold:
            let hidden = rows.hiddenLines(ofFold: row)
            return "\(hidden) unchanged \(hidden == 1 ? "line" : "lines") hidden"
        case .context:
            return "Line \(document.number(.new, Int(rows.new[row]))): " + document.new.string(of: Int(rows.new[row]))
        case .removed:
            return "Removed line \(document.number(.old, Int(rows.old[row]))): " + document.old.string(of: Int(rows.old[row]))
        case .added:
            return "Added line \(document.number(.new, Int(rows.new[row]))): " + document.new.string(of: Int(rows.new[row]))
        case .changed:
            let old = rows.old[row] >= 0 ? "Removed line \(document.number(.old, Int(rows.old[row]))): " + document.old.string(of: Int(rows.old[row])) : ""
            let new = rows.new[row] >= 0 ? "Added line \(document.number(.new, Int(rows.new[row]))): " + document.new.string(of: Int(rows.new[row])) : ""
            return [old, new].filter { !$0.isEmpty }.joined(separator: "; ")
        }
    }
}
