import AppKit
import NyteUI
import os

extension TextEngineView: @MainActor NSTextInputClient {
    static let longestProposedRange = 4_096

    override func keyDown(with event: NSEvent) {
        let signpost = OSSignposter.editor.beginInterval("engine key")
        defer { OSSignposter.editor.endInterval("engine key", signpost) }
        NSCursor.setHiddenUntilMouseMoves(true)
        if !hasMarkedText(), onKey?(event) == true { return }
        let hadMarkedText = hasMarkedText()
        let source = hadMarkedText ? nil : inputContext?.selectedKeyboardInputSource
        keyStroke = []
        interpretKeyEvents([event])
        let pending = keyStroke ?? []
        keyStroke = nil
        let stroke = TypingDecision.Stroke(
            hadMarkedText: hadMarkedText, hasMarkedText: hasMarkedText(),
            layoutChanged: !hadMarkedText && source != inputContext?.selectedKeyboardInputSource, pending: pending
        )
        guard case .perform(let actions) = TypingDecision.resolve(stroke) else { return }
        for action in actions { run(action, isKeyPress: true) }
    }

    private func run(_ action: TypingDecision.Action, isKeyPress: Bool) {
        switch action {
        case .insert(let text, let range):
            insertNow(text, replacementRange: range ?? NSRange(location: NSNotFound, length: 0), isKeyPress: isKeyPress)
        case .command(let name):
            performCommand(NSSelectorFromString(name))
        }
    }

    private func flushPendingKeys() {
        guard let pending = keyStroke, !pending.isEmpty else { return }
        keyStroke = []
        for action in pending { run(action, isKeyPress: true) }
    }

    func insertText(_ string: Any, replacementRange: NSRange) {
        let text = (string as? String) ?? (string as? NSAttributedString)?.string ?? ""
        guard isEditable else { return }
        switch TypingDecision.arrival(isHandlingKey: keyStroke != nil, isComposing: composition != nil) {
        case .later:
            keyStroke?.append(.insert(text, replacing: replacementRange.location == NSNotFound ? nil : replacementRange))
        case .now:
            flushPendingKeys()
            insertNow(text, replacementRange: replacementRange, isKeyPress: keyStroke != nil)
        }
    }

    override func insertText(_ insertString: Any) {
        insertText(insertString, replacementRange: NSRange(location: NSNotFound, length: 0))
    }

    private func insertNow(_ text: String, replacementRange: NSRange, isKeyPress: Bool) {
        let commits = composition != nil
        switch TypingDecision.target(replacementRange: replacementRange, markedRange: composition?.range, length: store.length) {
        case .marked:
            commitComposition(with: text, fromInputMethod: true)
        case .range(let range):
            perform(TextCommands.inserting([text], SelectionSet([Selection(range)]), in: store, kind: .typing))
        case .selections:
            perform(TextCommands.typing(text, selections, in: store, context: context))
        }
        if TypingDecision.reachesFeatures(isKeyPress: isKeyPress, commitsComposition: commits) { onType?(text) }
    }

    override func doCommand(by selector: Selector) {
        switch TypingDecision.arrival(isHandlingKey: keyStroke != nil, isComposing: composition != nil) {
        case .later: keyStroke?.append(.command(NSStringFromSelector(selector)))
        case .now: performCommand(selector)
        }
    }

    func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
        guard isEditable else { return }
        flushPendingKeys()
        let marked: NSAttributedString = switch string {
        case let attributed as NSAttributedString: attributed
        case let plain as String: NSAttributedString(string: plain)
        default: NSAttributedString()
        }
        let units = Array(marked.string.utf16)
        let target: NSRange
        var current: Composition
        if let composition {
            target = replacementRange.location == NSNotFound ? composition.range : TypingDecision.clamp(replacementRange, within: store.length)
            current = composition
        } else {
            guard !units.isEmpty else { return }
            target = replacementRange.location == NSNotFound ? selections.primarySelection.range
                : TypingDecision.clamp(replacementRange, within: store.length)
            current = Composition(range: target, original: store.units(target), before: selections,
                                  selected: NSRange(location: 0, length: 0), underlines: [])
        }
        guard !units.isEmpty else { return abandonComposition() }
        current.range = NSRange(location: target.location, length: units.count)
        current.selected = TypingDecision.clamp(selectedRange, within: units.count)
        current.underlines = TypingDecision.underlines(marked)
        let caret = Selection(anchor: target.location + current.selected.location, head: target.location + NSMaxRange(current.selected))
        composition = current
        applyUnrecorded([TextReplacement(range: target, text: units)], primary: caret)
    }

    func unmarkText() {
        guard composition != nil else { return }
        commitComposition(with: nil, fromInputMethod: true)
    }

    func commitComposition(with text: String? = nil, fromInputMethod: Bool = false) {
        guard let current = composition else { return }
        composition = nil
        let committed = text.map { Array($0.utf16) } ?? store.units(current.range)
        if text != nil {
            let caret = Selection(caret: current.range.location + committed.count)
            applyUnrecorded([TextReplacement(range: current.range, text: committed)], primary: caret)
        }
        if !fromInputMethod { inputContext?.discardMarkedText() }
        let start = current.range.location
        let forward = TextTransaction([TextReplacement(range: NSRange(location: start, length: current.original.count), text: committed)],
                                      before: current.before, after: selections, kind: .typing)
        let inverse = TextTransaction([TextReplacement(range: NSRange(location: start, length: committed.count), text: current.original)],
                                      before: selections, after: current.before, kind: .typing)
        if case .opened(let step) = session.record(forward, inverse: inverse) { registerUndo(step) }
        invalidate(lines: store.line(at: start)...store.line(at: start + committed.count))
        guard selections.hasSeveral, !committed.isEmpty else { return }
        let primary = selections.primarySelection
        perform(TextCommands.perSelection(store, selections, kind: .typing) { selection in
            selection == primary ? nil : .caret(after: selection.range, inserting: committed)
        })
    }

    func abandonComposition() {
        guard let current = composition else { return }
        composition = nil
        applyUnrecorded([TextReplacement(range: current.range, text: current.original)], primary: nil)
        let before = selections
        session.select(current.before.clamped(to: store.length))
        didSelect(from: before, scrolls: false)
        inputContext?.discardMarkedText()
    }

    private func applyUnrecorded(_ replacements: [TextReplacement], primary: Selection?) {
        let before = selections
        var transaction = TextCommands.through(replacements, store, selections, kind: .typing)
        if let primary {
            var after = transaction.after.selections
            after[transaction.after.primary] = primary
            transaction.after = SelectionSet(after, primary: transaction.after.primary)
        }
        let applied = session.apply(transaction, recording: false)
        didChange(applied.changes)
        didSelect(from: before, scrolls: true)
    }

    func selectedRange() -> NSRange {
        guard let composition else { return selections.primarySelection.range }
        return NSRange(location: composition.range.location + composition.selected.location, length: composition.selected.length)
    }

    func markedRange() -> NSRange { composition?.range ?? NSRange(location: NSNotFound, length: 0) }

    func hasMarkedText() -> Bool { composition != nil }

    func attributedSubstring(forProposedRange range: NSRange, actualRange: NSRangePointer?) -> NSAttributedString? {
        guard range.location != NSNotFound, range.location <= store.length else { return nil }
        var clamped = TypingDecision.clamp(range, within: store.length)
        clamped.length = min(clamped.length, Self.longestProposedRange)
        actualRange?.pointee = clamped
        return NSAttributedString(string: store.string(clamped), attributes: [.font: metrics.font])
    }

    func validAttributesForMarkedText() -> [NSAttributedString.Key] {
        [.underlineStyle, .underlineColor, .markedClauseSegment, .foregroundColor, .backgroundColor]
    }

    func firstRect(forCharacterRange range: NSRange, actualRange: NSRangePointer?) -> NSRect {
        let clamped = TypingDecision.clamp(range, within: store.length)
        let line = store.line(at: clamped.location)
        let first = TypingDecision.firstLine(of: clamped, lineRange: store.lineRange(line))
        actualRange?.pointee = first
        let left = x(of: first.location)
        let right = first.length > 0 ? x(of: NSMaxRange(first)) : left
        let rect = NSRect(x: left, y: top(ofLine: line), width: right - left, height: metrics.lineHeight)
        guard let window else { return rect }
        return window.convertToScreen(convert(rect, to: nil))
    }

    func characterIndex(for point: NSPoint) -> Int {
        guard let window else { return NSNotFound }
        let local = convert(window.convertPoint(fromScreen: point), from: nil)
        return bounds.contains(local) ? offset(at: local) : NSNotFound
    }

    func baselineDeltaForCharacter(at anIndex: Int) -> CGFloat { metrics.lineHeight - metrics.baseline }

    func fractionOfDistanceThroughGlyph(for point: NSPoint) -> CGFloat {
        let offset = offset(at: point)
        let left = x(of: offset)
        let right = x(of: TextUnits.clusterEnd(after: offset, in: store))
        return right > left ? min(1, max(0, (point.x - left) / (right - left))) : 0
    }

    func windowLevel() -> Int { window?.level.rawValue ?? 0 }
}
