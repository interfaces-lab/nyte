import AppKit
import NyteCore
import NyteUI

extension EditorViewController {
    func contextMenu() -> NSMenu? {
        let hasSelection = textView.selections.selections.contains { !$0.isEmpty }
        let menu = textMenu?() ?? Menu.make([
            MenuItem("Cut", enabled: hasSelection && textView.isEditable) { [weak self] in self?.textView.cut(nil) },
            MenuItem("Copy", enabled: hasSelection) { [weak self] in self?.textView.copy(nil) },
            MenuItem("Paste", enabled: textView.isEditable) { [weak self] in self?.textView.paste(nil) },
        ])
        if let word = lookUpWord() {
            let lookUp = Menu.make([MenuItem("Look Up “" + word.text + "”") { [weak self] in self?.textView.lookUp(at: word.offset) }, .separator])
            for item in lookUp.items.reversed() {
                lookUp.removeItem(item)
                menu.insertItem(item, at: 0)
            }
        }
        return addingAskItem(to: menu)
    }

    private func lookUpWord() -> (text: String, offset: Int)? {
        guard shown != nil else { return nil }
        let primary = textView.selections.primarySelection
        if !primary.isEmpty, primary.range.length <= Self.longestLookUp { return (textView.store.string(primary.range), primary.lower) }
        guard let word = TextUnits.word(at: primary.head, in: textView.store, rule: .natural) else { return nil }
        return (textView.store.string(word), word.location)
    }

    func canRunEditorCommand(_ selector: Selector) -> Bool {
        if let fold = Self.foldCommands[selector] { return folding?.canRun(fold) ?? false }
        return switch selector {
        case #selector(TextEngineView.goToLine(_:)), #selector(TextEngineView.expandSelection(_:)): shown != nil
        case #selector(TextEngineView.shrinkSelection(_:)): !narrowerSelections.isEmpty
        case #selector(TextEngineView.openLineNote(_:)): hasLineNoteAtCaret
        case #selector(TextEngineView.nextChange(_:)), #selector(TextEngineView.previousChange(_:)): hasChanges
        default: false
        }
    }

    func runEditorCommand(_ selector: Selector) -> Bool {
        guard canRunEditorCommand(selector) else { return false }
        if let fold = Self.foldCommands[selector] {
            folding?.run(fold)
            return true
        }
        switch selector {
        case #selector(TextEngineView.goToLine(_:)): promptForLine()
        case #selector(TextEngineView.expandSelection(_:)): expandSelection()
        case #selector(TextEngineView.shrinkSelection(_:)): shrinkSelection()
        case #selector(TextEngineView.openLineNote(_:)): openLineNoteAtCaret()
        case #selector(TextEngineView.nextChange(_:)): jumpToChange(forward: true)
        case #selector(TextEngineView.previousChange(_:)): jumpToChange(forward: false)
        default: return false
        }
        return true
    }

    private func expandSelection() {
        let current = textView.selectedRange()
        guard let wider = SelectionScope.expand(current, in: shownText, isQuoted: { [weak self] in self?.isQuoted($0) ?? false }) else { return }
        narrow { textView.setSelectedRange(wider) }
        narrowerSelections.append(current)
    }

    private func shrinkSelection() {
        guard let narrower = narrowerSelections.popLast() else { return }
        narrow { textView.setSelectedRange(narrower) }
    }

    private func narrow(_ body: () -> Void) {
        isNarrowing = true
        body()
        isNarrowing = false
    }
}
