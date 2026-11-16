import AppKit
import NyteUI
import os

extension TextEngineView {
    func perform(_ transaction: TextTransaction?, scrolls: Bool = true, recording: Bool = true) {
        guard isEditable, let transaction else { return }
        if composition != nil { commitComposition() }
        let before = session.selections
        let applied = session.apply(transaction, recording: recording && recordsHistory)
        didChange(applied.changes)
        if case .opened(let step) = applied.recorded { registerUndo(step) }
        didSelect(from: before, scrolls: scrolls)
    }

    func select(_ set: SelectionSet, scrolls: Bool = true) {
        if composition != nil { commitComposition() }
        let before = session.selections
        session.select(set)
        didSelect(from: before, scrolls: scrolls)
    }

    func didChange(_ changes: [TextChange]) {
        guard !changes.isEmpty else { return }
        for change in changes {
            updateWindows(for: change)
            let lines = cache.invalidate(change)
            if change.lines.inserted != change.lines.removed {
                if rowMap.folds.hiddenCount > 0 { rowMap = rowMap.shifted(by: change) }
                invalidateBelow(line: change.lines.line)
            } else {
                invalidate(lines: lines)
            }
        }
        if changes.contains(where: { $0.lines.inserted != $0.lines.removed }) { fitFrame() }
        if rowMap.folds.hiddenCount > 0 {
            let touched = changes.map { $0.lines.line...($0.lines.line + $0.lines.inserted) }
            let kept = foldedRanges.filter { fold in !touched.contains { $0.overlaps(fold) } }
            if kept.count != foldedRanges.count { setFolds(kept) }
        }
        restartBlink()
        onTextChange?(changes)
        NSAccessibility.post(element: self, notification: .valueChanged)
    }

    private func updateWindows(for change: TextChange) {
        guard !lineWindows.isEmpty else { return }
        let line = change.lines.line
        guard change.lines.inserted == 0, change.lines.removed == 0, var table = lineWindows[line], isWindowed(line) else {
            lineWindows.removeAll()
            return
        }
        let span = store.lineRange(line)
        let removed = NSRange(location: change.range.location - span.location, length: change.range.length)
        store.buffer.withUnits(span) { units in
            table.edit(removed, inserted: change.insertedLength, in: units, size: Self.windowLength, advance: metrics.advance) { measure(units, $0) }
        }
        lineWindows[line] = table
    }

    func didSelect(from before: SelectionSet, scrolls: Bool) {
        guard before != session.selections else { return }
        revealSelections()
        invalidateSelections(before)
        invalidateSelections(session.selections)
        restartBlink()
        if scrolls { scrollToPrimary() }
        onSelectionChange?()
        NSAccessibility.post(element: self, notification: .selectedTextChanged)
    }

    private func invalidateSelections(_ set: SelectionSet) {
        let visible = visibleRect
        let firstLine = rowMap.line(atRow: row(atY: visible.minY))
        let lastLine = rowMap.line(atRow: row(atY: visible.maxY))
        guard store.lineCount > 0 else { return }
        let bounds = store.lineRange(firstLine).location...NSMaxRange(store.lineRange(lastLine))
        for selection in set.selections where selection.upper >= bounds.lowerBound && selection.lower <= bounds.upperBound {
            let first = max(firstLine, store.line(at: selection.lower))
            let last = min(lastLine, store.line(at: selection.upper))
            invalidate(lines: first...max(first, last))
        }
    }

    func scrollToPrimary() {
        let head = selections.primarySelection.head
        let rect = caretRect(at: head).insetBy(dx: -metrics.advance * 2, dy: 0)
        scrollToVisible(rect)
    }

    func run(_ motion: TextCommands.Motion, extending: Bool) {
        select(TextCommands.moved(selections, motion, extending: extending, in: store, context: context, measure: columnMeasure))
    }

    func edit(_ build: (TextStore, SelectionSet, EditContext) -> TextTransaction?) {
        perform(build(store, selections, context))
    }

    func breakUndoCoalescing() { session.breakCoalescing() }

    func registerUndo(_ step: EditHistory.Step) {
        if let undoRegistrar { return undoRegistrar(step) }
        guard let undo = undoManager else { return }
        let explicit = !undo.groupsByEvent && undo.groupingLevel == 0
        if explicit { undo.beginUndoGrouping() }
        undo.registerUndo(withTarget: self) { $0.undoStep(step.id) }
        undo.setActionName(step.title)
        if explicit { undo.endUndoGrouping() }
    }

    private func undoStep(_ id: Int) {
        let title = session.history.undoSteps.last?.title ?? ""
        guard undo(step: id) else { return }
        undoManager?.registerUndo(withTarget: self) { $0.redoStep(id) }
        undoManager?.setActionName(title)
    }

    private func redoStep(_ id: Int) {
        let title = session.history.redoSteps.last?.title ?? ""
        guard redo(step: id) else { return }
        undoManager?.registerUndo(withTarget: self) { $0.undoStep(id) }
        undoManager?.setActionName(title)
    }

    func undo(step id: Int) -> Bool {
        guard session.history.undoSteps.last?.id == id else {
            assertionFailure("undo step \(id) is not on top of the history")
            return false
        }
        abandonComposition()
        let before = session.selections
        guard let changes = session.undo() else { return false }
        didChange(changes)
        didSelect(from: before, scrolls: true)
        return true
    }

    func redo(step id: Int) -> Bool {
        guard session.history.redoSteps.last?.id == id else {
            assertionFailure("redo step \(id) is not on top of the history")
            return false
        }
        let before = session.selections
        guard let changes = session.redo() else { return false }
        didChange(changes)
        didSelect(from: before, scrolls: true)
        return true
    }
}
