import AppKit

extension TextEngineView {
    override func accessibilityValue() -> Any? { store.string }

    override func setAccessibilityValue(_ value: Any?) {
        guard isEditable, let text = value as? String else { return }
        perform(TextCommands.inserting([text], SelectionSet([Selection(anchor: 0, head: store.length)]), in: store, kind: .named("Replace")))
    }

    override func accessibilityNumberOfCharacters() -> Int { store.length }

    override func accessibilitySelectedText() -> String? { store.string(selections.primarySelection.range) }

    override func setAccessibilitySelectedText(_ text: String?) {
        guard isEditable, let text else { return }
        perform(TextCommands.inserting([text], selections.primaryOnly, in: store, kind: .typing))
    }

    override func accessibilitySelectedTextRange() -> NSRange { selections.primarySelection.range }

    override func setAccessibilitySelectedTextRange(_ range: NSRange) {
        select(SelectionSet([Selection(TypingDecision.clamp(range, within: store.length))]))
    }

    override func accessibilitySelectedTextRanges() -> [NSValue]? { selections.ranges.map { NSValue(range: $0) } }

    override func setAccessibilitySelectedTextRanges(_ ranges: [NSValue]?) {
        let given = (ranges ?? []).map { Selection(TypingDecision.clamp($0.rangeValue, within: store.length)) }
        guard !given.isEmpty else { return }
        select(SelectionSet(given))
    }

    override func accessibilityInsertionPointLineNumber() -> Int { store.line(at: selections.primarySelection.head) }

    override func accessibilityVisibleCharacterRange() -> NSRange {
        let visible = visibleRect
        guard store.lineCount > 0 else { return NSRange(location: 0, length: 0) }
        let start = store.lineRange(rowMap.line(atRow: row(atY: visible.minY))).location
        let end = NSMaxRange(store.lineRange(rowMap.line(atRow: row(atY: max(visible.minY, visible.maxY - 1)))))
        return NSRange(location: start, length: end - start)
    }

    override func accessibilityLine(for index: Int) -> Int {
        guard index >= 0, index <= store.length else { return -1 }
        return store.line(at: index)
    }

    override func accessibilityRange(forLine line: Int) -> NSRange {
        guard line >= 0, line < store.lineCount else { return NSRange(location: NSNotFound, length: 0) }
        let span = store.lineRange(line)
        return line + 1 < store.lineCount ? NSRange(location: span.location, length: span.length + 1) : span
    }

    override func accessibilityString(for range: NSRange) -> String? {
        guard range.location != NSNotFound, NSMaxRange(range) <= store.length else { return nil }
        return store.string(range)
    }

    override func accessibilityAttributedString(for range: NSRange) -> NSAttributedString? {
        guard let text = accessibilityString(for: range) else { return nil }
        return NSAttributedString(string: text, attributes: [.font: metrics.font])
    }

    override func accessibilityRange(for point: NSPoint) -> NSRange {
        guard let window else { return NSRange(location: NSNotFound, length: 0) }
        let local = convert(window.convertPoint(fromScreen: point), from: nil)
        return NSRange(location: offset(at: local), length: 0)
    }

    override func accessibilityRange(for index: Int) -> NSRange {
        guard index >= 0, index < store.length else { return NSRange(location: NSNotFound, length: 0) }
        let start = TextUnits.clusterStart(before: index + 1, in: store)
        return NSRange(location: start, length: TextUnits.clusterEnd(after: start, in: store) - start)
    }

    override func accessibilityStyleRange(for index: Int) -> NSRange {
        guard index >= 0, index <= store.length else { return NSRange(location: NSNotFound, length: 0) }
        return store.lineRange(store.line(at: index))
    }

    override func accessibilityFrame(for range: NSRange) -> NSRect {
        let clamped = TypingDecision.clamp(range, within: store.length)
        let local = rects(for: clamped).reduce(NSRect.null) { $0.union($1) }
        guard let window, !local.isNull else { return .zero }
        return window.convertToScreen(convert(local, to: nil))
    }

    override func isAccessibilityFocused() -> Bool { window?.firstResponder === self }

    override func setAccessibilityFocused(_ focused: Bool) {
        if focused { window?.makeFirstResponder(self) }
    }
}
