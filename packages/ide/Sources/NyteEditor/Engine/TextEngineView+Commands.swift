import AppKit
import NyteUI

extension TextEngineView: @MainActor NSUserInterfaceValidations {
    typealias KeyCommand = @MainActor (TextEngineView) -> Void

    static let keyCommands: [Selector: KeyCommand] = {
        var table: [Selector: KeyCommand] = [:]
        let motions: [(Selector, Selector?, TextCommands.Motion)] = [
            (#selector(moveLeft(_:)), #selector(moveLeftAndModifySelection(_:)), .left),
            (#selector(moveRight(_:)), #selector(moveRightAndModifySelection(_:)), .right),
            (#selector(moveBackward(_:)), #selector(moveBackwardAndModifySelection(_:)), .left),
            (#selector(moveForward(_:)), #selector(moveForwardAndModifySelection(_:)), .right),
            (#selector(moveUp(_:)), #selector(moveUpAndModifySelection(_:)), .up),
            (#selector(moveDown(_:)), #selector(moveDownAndModifySelection(_:)), .down),
            (#selector(moveWordLeft(_:)), #selector(moveWordLeftAndModifySelection(_:)), .wordLeft),
            (#selector(moveWordRight(_:)), #selector(moveWordRightAndModifySelection(_:)), .wordRight),
            (#selector(moveWordBackward(_:)), #selector(moveWordBackwardAndModifySelection(_:)), .wordLeft),
            (#selector(moveWordForward(_:)), #selector(moveWordForwardAndModifySelection(_:)), .wordRight),
            (#selector(moveToBeginningOfLine(_:)), #selector(moveToBeginningOfLineAndModifySelection(_:)), .lineStart),
            (#selector(moveToEndOfLine(_:)), #selector(moveToEndOfLineAndModifySelection(_:)), .lineEnd),
            (#selector(moveToLeftEndOfLine(_:)), #selector(moveToLeftEndOfLineAndModifySelection(_:)), .lineStart),
            (#selector(moveToRightEndOfLine(_:)), #selector(moveToRightEndOfLineAndModifySelection(_:)), .lineEnd),
            (#selector(moveToBeginningOfParagraph(_:)), #selector(moveToBeginningOfParagraphAndModifySelection(_:)), .lineStart),
            (#selector(moveToEndOfParagraph(_:)), #selector(moveToEndOfParagraphAndModifySelection(_:)), .lineEnd),
            (#selector(moveToBeginningOfDocument(_:)), #selector(moveToBeginningOfDocumentAndModifySelection(_:)), .documentStart),
            (#selector(moveToEndOfDocument(_:)), #selector(moveToEndOfDocumentAndModifySelection(_:)), .documentEnd),
            (#selector(pageUp(_:)), #selector(pageUpAndModifySelection(_:)), .pageUp),
            (#selector(pageDown(_:)), #selector(pageDownAndModifySelection(_:)), .pageDown),
        ]
        for (plain, extending, motion) in motions {
            table[plain] = { $0.run(motion, extending: false) }
            if let extending { table[extending] = { $0.run(motion, extending: true) } }
        }
        table[#selector(moveParagraphBackwardAndModifySelection(_:))] = { $0.run(.paragraphBackward, extending: true) }
        table[#selector(moveParagraphForwardAndModifySelection(_:))] = { $0.run(.paragraphForward, extending: true) }
        let deletions: [(Selector, TextCommands.Deletion)] = [
            (#selector(deleteBackward(_:)), .backward), (#selector(deleteForward(_:)), .forward),
            (#selector(deleteBackwardByDecomposingPreviousCharacter(_:)), .backward),
            (#selector(deleteWordBackward(_:)), .wordBackward), (#selector(deleteWordForward(_:)), .wordForward),
        ]
        for (selector, deletion) in deletions {
            table[selector] = { view in view.edit { TextCommands.deleting($1, deletion, in: $0, context: $2) } }
        }
        let kills: [(Selector, TextCommands.Deletion)] = [
            (#selector(deleteToBeginningOfLine(_:)), .toLineStart), (#selector(deleteToEndOfLine(_:)), .toLineEnd),
            (#selector(deleteToBeginningOfParagraph(_:)), .toParagraphStart), (#selector(deleteToEndOfParagraph(_:)), .toParagraphEnd),
        ]
        for (selector, deletion) in kills { table[selector] = { $0.kill(deletion) } }
        for selector in [#selector(insertNewline(_:)), #selector(insertLineBreak(_:)), #selector(insertParagraphSeparator(_:)),
                         #selector(insertNewlineIgnoringFieldEditor(_:)), #selector(insertContainerBreak(_:))] {
            table[selector] = { view in view.edit { TextCommands.newline($1, in: $0, context: $2) } }
        }
        for selector in [#selector(insertTab(_:)), #selector(insertTabIgnoringFieldEditor(_:))] {
            table[selector] = { view in view.edit { TextCommands.tab($1, in: $0, context: $2) } }
        }
        table[#selector(insertBacktab(_:))] = { view in view.edit { TextCommands.shiftingLines($1, right: false, in: $0, context: $2) } }
        table[#selector(indent(_:))] = { view in view.edit { TextCommands.shiftingLines($1, right: true, in: $0, context: $2) } }
        table[#selector(insertSingleQuoteIgnoringSubstitution(_:))] = { $0.insertText("'", replacementRange: NSRange(location: NSNotFound, length: 0)) }
        table[#selector(insertDoubleQuoteIgnoringSubstitution(_:))] = { $0.insertText("\"", replacementRange: NSRange(location: NSNotFound, length: 0)) }
        table[#selector(transpose(_:))] = { view in view.edit { store, set, _ in TextCommands.transposing(set, in: store) } }
        table[#selector(transposeWords(_:))] = { view in view.edit { TextCommands.transposingWords($1, in: $0, context: $2) } }
        table[#selector(yank(_:))] = { view in view.perform(view.session.kills.yanking(view.selections, in: view.store)) }
        table[#selector(uppercaseWord(_:))] = { view in view.edit { TextCommands.changingCase($1, in: $0, context: $2) { $0.uppercased() } } }
        table[#selector(lowercaseWord(_:))] = { view in view.edit { TextCommands.changingCase($1, in: $0, context: $2) { $0.lowercased() } } }
        table[#selector(capitalizeWord(_:))] = { view in view.edit { TextCommands.changingCase($1, in: $0, context: $2) { $0.capitalized } } }
        table[#selector(changeCaseOfLetter(_:))] = { view in view.edit { TextCommands.changingCase($1, in: $0, context: $2) { $0.uppercased() } } }
        table[#selector(cancelOperation(_:))] = { view in if view.selections.hasSeveral { view.select(view.selections.primaryOnly) } }
        table[#selector(selectAll(_:))] = { $0.selectAll(nil) }
        table[#selector(selectLine(_:))] = { view in view.select(TextCommands.selectingLines(view.selections, in: view.store)) }
        table[#selector(selectParagraph(_:))] = { view in view.select(TextCommands.selectingLines(view.selections, in: view.store)) }
        table[#selector(selectWord(_:))] = { view in view.select(TextCommands.selectingWords(view.selections, in: view.store, context: view.context)) }
        table[#selector(setMark(_:))] = { $0.mark = $0.selections.primarySelection.head }
        table[#selector(selectToMark(_:))] = { view in
            guard let mark = view.mark else { return }
            view.select(SelectionSet([Selection(anchor: mark, head: view.selections.primarySelection.head)]))
        }
        table[#selector(deleteToMark(_:))] = { view in
            guard let mark = view.mark else { return }
            view.perform(TextCommands.deleting(SelectionSet([Selection(anchor: mark, head: view.selections.primarySelection.head)]),
                                               .backward, in: view.store, context: view.context))
        }
        table[#selector(swapWithMark(_:))] = { view in
            guard let mark = view.mark else { return }
            view.mark = view.selections.primarySelection.head
            view.select(SelectionSet(caret: mark))
        }
        table[#selector(scrollPageUp(_:))] = { $0.scrollPage(by: -1) }
        table[#selector(scrollPageDown(_:))] = { $0.scrollPage(by: 1) }
        table[#selector(scrollLineUp(_:))] = { $0.scrollLines(by: -1) }
        table[#selector(scrollLineDown(_:))] = { $0.scrollLines(by: 1) }
        table[#selector(scrollToBeginningOfDocument(_:))] = { $0.scroll(NSPoint(x: $0.visibleRect.minX, y: 0)) }
        table[#selector(scrollToEndOfDocument(_:))] = { $0.scroll(NSPoint(x: $0.visibleRect.minX, y: $0.bounds.maxY - $0.visibleRect.height)) }
        table[#selector(centerSelectionInVisibleArea(_:))] = { view in
            let caret = view.caretRect(at: view.selections.primarySelection.head)
            view.scroll(NSPoint(x: view.visibleRect.minX, y: max(0, caret.midY - view.visibleRect.height / 2)))
        }
        return table
    }()

    func performCommand(_ selector: Selector) {
        if let command = Self.keyCommands[selector] { return command(self) }
        if responds(to: selector) {
            _ = perform(selector, with: nil)
            return
        }
        super.doCommand(by: selector)
    }

    func kill(_ deletion: TextCommands.Deletion) {
        guard isEditable else { return }
        if composition != nil { commitComposition() }
        let before = selections
        let applied = session.kill(deletion)
        didChange(applied.changes)
        if case .opened(let step) = applied.recorded { registerUndo(step) }
        didSelect(from: before, scrolls: true)
    }

    func scrollPage(by pages: Int) {
        let visible = visibleRect
        scroll(NSPoint(x: visible.minX, y: max(0, visible.minY + CGFloat(pages) * (visible.height - metrics.lineHeight))))
    }

    func scrollLines(by lines: Int) {
        let visible = visibleRect
        scroll(NSPoint(x: visible.minX, y: max(0, visible.minY + CGFloat(lines) * metrics.lineHeight)))
    }

    override func selectAll(_ sender: Any?) {
        select(SelectionSet([Selection(anchor: 0, head: store.length)]), scrolls: false)
    }

    @objc func undo(_ sender: Any?) { undoManager?.undo() }
    @objc func redo(_ sender: Any?) { undoManager?.redo() }

    @objc func toggleLineComment(_ sender: Any?) { edit { TextCommands.togglingComment($1, in: $0, context: $2) } }
    @objc func indentLines(_ sender: Any?) { edit { TextCommands.shiftingLines($1, right: true, in: $0, context: $2) } }
    @objc func outdentLines(_ sender: Any?) { edit { TextCommands.shiftingLines($1, right: false, in: $0, context: $2) } }
    @objc func moveLinesUp(_ sender: Any?) { edit { store, set, _ in TextCommands.movingLines(set, up: true, in: store) } }
    @objc func moveLinesDown(_ sender: Any?) { edit { store, set, _ in TextCommands.movingLines(set, up: false, in: store) } }
    @objc func duplicateLines(_ sender: Any?) { edit { store, set, _ in TextCommands.duplicatingLines(set, in: store) } }
    @objc func deleteLines(_ sender: Any?) { edit { store, set, _ in TextCommands.deletingLines(set, in: store) } }
    @objc func moveSubwordLeft(_ sender: Any?) { run(.subwordLeft, extending: false) }
    @objc func moveSubwordRight(_ sender: Any?) { run(.subwordRight, extending: false) }
    @objc func moveSubwordLeftAndModifySelection(_ sender: Any?) { run(.subwordLeft, extending: true) }
    @objc func moveSubwordRightAndModifySelection(_ sender: Any?) { run(.subwordRight, extending: true) }

    @objc func selectNextOccurrence(_ sender: Any?) {
        guard let next = TextCommands.addingNextOccurrence(to: selections, in: store, context: context) else { return }
        breakUndoCoalescing()
        select(next)
    }

    @objc func selectAllOccurrences(_ sender: Any?) {
        guard let all = TextCommands.selectingAllOccurrences(of: selections, in: store) else { return }
        breakUndoCoalescing()
        select(all, scrolls: false)
    }

    @objc func addCaretAbove(_ sender: Any?) { addCaret(below: false) }
    @objc func addCaretBelow(_ sender: Any?) { addCaret(below: true) }

    private func addCaret(below: Bool) {
        guard let next = TextCommands.addingCaret(to: selections, below: below, in: store, measure: columnMeasure) else { return }
        breakUndoCoalescing()
        select(next)
    }

    func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        let hasSelection = selections.selections.contains { !$0.isEmpty }
        let menuItem = item as? NSMenuItem
        switch item.action {
        case #selector(copy(_:)): return hasSelection
        case #selector(cut(_:)), #selector(delete(_:)): return hasSelection && isEditable
        case #selector(paste(_:)), #selector(pasteAsPlainText(_:)):
            return isEditable && NSPasteboard.general.availableType(from: [.string]) != nil
        case #selector(undo(_:)):
            menuItem?.title = undoManager?.undoMenuItemTitle ?? "Undo"
            return isEditable && undoManager?.canUndo == true
        case #selector(redo(_:)):
            menuItem?.title = undoManager?.redoMenuItemTitle ?? "Redo"
            return isEditable && undoManager?.canRedo == true
        case #selector(selectAll(_:)): return store.length > 0
        case #selector(moveLinesUp(_:)): return isEditable && store.line(at: selections.selections[0].lower) > 0
        case #selector(moveLinesDown(_:)): return isEditable && store.line(at: selections.selections[selections.count - 1].upper) + 1 < store.lineCount
        case #selector(toggleLineComment(_:)): return isEditable && (context.lineComment != nil || context.blockComment != nil)
        case #selector(indentLines(_:)), #selector(outdentLines(_:)), #selector(duplicateLines(_:)), #selector(deleteLines(_:)): return isEditable
        case #selector(selectNextOccurrence(_:)), #selector(selectAllOccurrences(_:)), #selector(addCaretAbove(_:)),
             #selector(addCaretBelow(_:)):
            return store.length > 0
        case #selector(performTextFinderAction(_:)):
            return Self.finderAction(item).map { canPerformFinderAction?($0) ?? false } ?? false
        case #selector(toggleMatchCase(_:)), #selector(toggleWholeWord(_:)), #selector(toggleRegularExpression(_:)):
            return canPerformFinderAction?(.hideFindInterface) ?? false
        case #selector(expandSelection(_:)), #selector(shrinkSelection(_:)), #selector(openLineNote(_:)), #selector(goToLine(_:)),
             #selector(nextChange(_:)), #selector(previousChange(_:)), #selector(foldCode(_:)), #selector(unfoldCode(_:)),
             #selector(toggleFolding(_:)), #selector(foldAll(_:)), #selector(unfoldAll(_:)), #selector(foldBlockComments(_:)),
             #selector(foldImports(_:)):
            return item.action.map { canRunEditorCommand?($0) ?? false } ?? false
        default: return item.action.map(responds(to:)) ?? false
        }
    }
}

extension TextCommands {
    static func changingCase(_ set: SelectionSet, in store: TextStore, context: EditContext,
                             _ transform: @escaping (String) -> String) -> TextTransaction {
        perSelection(store, set, kind: .named("Change Case")) { selection in
            let range = selection.isEmpty ? TextUnits.word(at: selection.head, in: store, rule: context.words) : selection.range
            guard let range else { return nil }
            let changed = Array(transform(store.string(range)).utf16)
            return Piece(range: range, text: changed, anchor: selection.isEmpty ? changed.count : 0, head: changed.count)
        }
    }

    static func transposingWords(_ set: SelectionSet, in store: TextStore, context: EditContext) -> TextTransaction {
        perSelection(store, set, kind: .named("Transpose Words")) { selection in
            guard selection.isEmpty else { return nil }
            let leftStart = TextUnits.wordStart(before: selection.head, in: store, rule: context.words)
            let leftEnd = TextUnits.wordEnd(after: leftStart, in: store, rule: context.words)
            let rightEnd = TextUnits.wordEnd(after: max(selection.head, leftEnd), in: store, rule: context.words)
            let rightStart = TextUnits.wordStart(before: rightEnd, in: store, rule: context.words)
            guard leftEnd <= rightStart, rightStart < rightEnd, leftStart < leftEnd else { return nil }
            let left = store.units(NSRange(location: leftStart, length: leftEnd - leftStart))
            let middle = store.units(NSRange(location: leftEnd, length: rightStart - leftEnd))
            let right = store.units(NSRange(location: rightStart, length: rightEnd - rightStart))
            return .caret(after: NSRange(location: leftStart, length: rightEnd - leftStart), inserting: right + middle + left)
        }
    }
}
