import AppKit
import NyteUI
import NyteCore

extension EditorViewController {
    var currentUndoManager: UndoManager {
        guard let index = selectedIndex, textView.model === documents[index].model else { return blankUndo }
        return documents[index].undo
    }

    func connectTextView() {
        textView.decorators = [self]
        textView.trailingInset = ErrorStripe.width
        textView.undoManagerProvider = { [weak self] in self?.currentUndoManager }
        textView.undoRegistrar = { [weak self] step in self?.registerShownUndo(step) }
        textView.onTextChange = { [weak self] changes in self?.textViewDidChange(changes) }
        textView.onSelectionChange = { [weak self] in self?.selectionDidChange() }
        textView.onType = { [weak self] text in self?.tellFeatures { $0.didType(text) } }
        textView.onKey = { [weak self] event in self?.features.contains { $0.handleKey(event) } ?? false }
        textView.onPointerMoved = { [weak self] point, offset, modifiers in
            self?.tellFeatures { $0.pointerMoved(to: point, offset: offset, modifiers: modifiers) }
        }
        textView.onPointerExited = { [weak self] in self?.tellFeatures { $0.pointerExited() } }
        textView.onClick = { [weak self] point, _, event in self?.handleClick(at: point, event: event) ?? false }
        textView.onFocusLeave = { [weak self] in self?.tellFeatures { $0.focusDidLeave() } }
        textView.contextMenuProvider = { [weak self] _, _ in self?.contextMenu() }
        textView.onEditorCommand = { [weak self] selector in self?.runEditorCommand(selector) ?? false }
        textView.canRunEditorCommand = { [weak self] selector in self?.canRunEditorCommand(selector) ?? false }
        textView.onFinderAction = { [weak self] action in self?.finding?.perform(action) ?? false }
        textView.canPerformFinderAction = { [weak self] action in self?.finding?.canPerform(action) ?? false }
        textView.onFinderToggle = { [weak self] option in
            guard let finding = self?.finding, finding.isOpen else { return false }
            finding.toggle(option)
            return true
        }
    }

    private func handleClick(at point: NSPoint, event: NSEvent) -> Bool {
        if features.contains(where: { $0.handleClick(at: point, event: event) }) { return true }
        guard let offset = textView.hitOffset(at: point) else { return false }
        return features.contains { $0.handleClick(at: offset, event: event) }
    }

    func textViewDidChange(_ changes: [TextChange]) {
        guard let index = selectedIndex, textView.model === documents[index].model else { return }
        didEdit(index, changes)
    }

    func didEdit(_ index: Int, _ changes: [TextChange]) {
        guard !changes.isEmpty else { return }
        let url = documents[index].url
        let isShown = textView.model === documents[index].model
        for change in changes {
            documents[index].revision += 1
            lastLineChange = change.lines
            if documents[index].isOpenInIntelligence {
                intelligence?.change(url, range: TextSpan(start: change.start, end: change.oldEnd),
                                     text: String(decoding: change.inserted, as: UTF16.self))
            }
            let shift = change.lines.inserted - change.lines.removed
            if shift != 0 { onLinesShift?(url, change.lines.line + 1, shift) }
            if isShown { tellFeatures { $0.textDidChange(in: change.newRange, delta: change.delta) } }
        }
        let undo = documents[index].undo
        let wasDirty = documents[index].isDirty
        let wasPreview = documents[index].isPreview
        documents[index].isDirty = undo.isUndoing || undo.isRedoing ? !isAtSavedText(documents[index]) : true
        documents[index].isPreview = false
        if isShown {
            ruler.updateThickness(lines: documents[index].lines.count)
            ruler.needsDisplay = true
            paint()
        }
        if wasDirty != documents[index].isDirty || wasPreview { onTabsChange?() }
        onTextChange?(url)
    }

    func isAtSavedText(_ document: Document) -> Bool {
        document.length == document.savedLength && FileIO.digest(document.store.buffer) == document.savedDigest
    }

    func selectionDidChange() {
        if !isNarrowing { narrowerSelections.removeAll() }
        reportPosition()
        ruler.needsDisplay = true
        for feature in features { feature.selectionDidChange() }
    }

    private func registerShownUndo(_ step: EditHistory.Step) {
        guard let index = selectedIndex, textView.model === documents[index].model else { return }
        register(.undo, step: step.id, title: step.title, document: documents[index].id)
    }

    enum UndoDirection {
        case undo, redo
    }

    func register(_ direction: UndoDirection, step: Int, title: String, document id: Int) {
        guard let index = row(id) else { return }
        let undo = documents[index].undo
        let explicit = !undo.groupsByEvent && undo.groupingLevel == 0 && !undo.isUndoing && !undo.isRedoing
        if explicit { undo.beginUndoGrouping() }
        undo.registerUndo(withTarget: self) { editor in
            switch direction {
            case .undo: editor.step(.undo, step: step, document: id)
            case .redo: editor.step(.redo, step: step, document: id)
            }
        }
        undo.setActionName(title)
        if explicit { undo.endUndoGrouping() }
    }

    private func step(_ direction: UndoDirection, step: Int, document id: Int) {
        guard let index = row(id) else { return }
        let model = documents[index].model
        let history = model.session.history
        let title = (direction == .undo ? history.undoSteps.last : history.redoSteps.last)?.title ?? ""
        if textView.model === model {
            guard direction == .undo ? textView.undo(step: step) : textView.redo(step: step) else { return }
        } else {
            let top = direction == .undo ? history.undoSteps.last?.id : history.redoSteps.last?.id
            guard top == step, let changes = direction == .undo ? model.session.undo() : model.session.redo() else { return }
            didEdit(index, changes)
        }
        register(direction == .undo ? .redo : .undo, step: step, title: title, document: id)
    }

    func apply(_ transaction: TextTransaction, to id: Int) {
        guard let index = row(id) else { return }
        let model = documents[index].model
        if textView.model === model { return textView.perform(transaction) }
        let applied = model.session.apply(transaction)
        didEdit(index, applied.changes)
        if case .opened(let step) = applied.recorded { register(.undo, step: step.id, title: step.title, document: id) }
    }
}
