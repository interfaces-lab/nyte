import AppKit

extension ListView {
    public var numberColumn: CGFloat {
        guard let widestNumber else { return measuredNumberColumn }
        let widest = widestNumber()
        return widest.isEmpty ? 0 : Draw.width(of: widest, style: .base, tabular: true)
    }

    func noteNumber(_ row: RowContent) -> Bool {
        guard row.number.count > widestDigits else { return false }
        widestDigits = row.number.count
        let font = RowRenderer.titleStyle(row).tabularFont()
        measuredNumberColumn = ceil((row.number as NSString).size(withAttributes: [.font: font]).width)
        return true
    }

    func forgetNumbers() {
        widestDigits = 0
        measuredNumberColumn = 0
    }

    func pushNumberColumn() {
        let column = numberColumn
        table.enumerateAvailableRowViews { view, _ in (view as? RowCell)?.numberColumn = column }
    }

    func updateHoveredAction(at point: NSPoint) {
        table.enumerateAvailableRowViews { view, row in
            guard let cell = view as? RowCell else { return }
            cell.hoveredAction = row == hoveredRow ? cell.action(at: cell.convert(point, from: table)) : nil
        }
    }

    func trackAction(_ index: Int, in cell: RowCell, row: Int) {
        cell.pressedAction = index
        cell.hoveredAction = index
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = cell.action(at: cell.convert(next.locationInWindow, from: nil)) == index
            cell.pressedAction = inside ? index : nil
            cell.hoveredAction = inside ? index : nil
            guard next.type == .leftMouseUp else { continue }
            cell.pressedAction = nil
            if inside { performAction(index, ofRow: row, on: IndexSet(integer: row)) }
            return
        }
        cell.pressedAction = nil
    }

    func performAction(_ index: Int, ofRow row: Int, on rows: IndexSet) {
        guard row >= 0, row < table.numberOfRows else { return }
        let actions = content(row).actions
        guard index < actions.count else { return }
        onAction?(actions[index].id, rows)
    }

    func performActionKey(_ event: NSEvent) -> Bool {
        guard let onAction, let row = selectedRow else { return false }
        guard let action = content(row).actions.first(where: { KeyLabel.matches(event, key: $0.key, modifiers: $0.modifiers) }) else {
            return false
        }
        onAction(action.id, table.selectedRowIndexes)
        return true
    }

    func withActions(_ menu: NSMenu?, row: Int, targets: IndexSet) -> NSMenu? {
        guard onAction != nil else { return menu }
        let shared = content(row).actions.filter { action in
            targets.allSatisfy { $0 == row || content($0).actions.contains { $0.id == action.id } }
        }
        guard !shared.isEmpty else { return menu }
        let merged = menu ?? NSMenu()
        if !merged.items.isEmpty { merged.insertItem(.separator(), at: 0) }
        for action in shared.reversed() {
            let item = RowActionItem(title: action.label, action: #selector(RowActionItem.fireAction(_:)), keyEquivalent: action.key.lowercased())
            item.keyEquivalentModifierMask = action.modifiers
            item.image = Symbol.image(action.symbol, glyph: .md)
            item.target = item
            item.fire = { [weak self] in self?.onAction?(action.id, targets) }
            merged.insertItem(item, at: 0)
        }
        return merged
    }
}

@MainActor
final class RowActionItem: NSMenuItem {
    var fire: (() -> Void)?

    @objc func fireAction(_ sender: Any?) { fire?() }
}
