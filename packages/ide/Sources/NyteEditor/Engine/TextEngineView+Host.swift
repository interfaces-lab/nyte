import AppKit
import NyteUI

extension TextEngineView {
    static let textOrigin = NSPoint(x: 0, y: TextEngineView.verticalInset)

    var textOrigin: NSPoint { Self.textOrigin }
    var text: ShownText { ShownText(store.buffer) }

    var indent: Indent {
        get { context.indent }
        set { context.indent = newValue }
    }

    var selectedRanges: [NSValue] {
        get { selections.ranges.map { NSValue(range: $0) } }
        set {
            let ranges = newValue.map { TypingDecision.clamp($0.rangeValue, within: store.length) }
            guard !ranges.isEmpty else { return }
            select(SelectionSet(ranges: ranges), scrolls: false)
        }
    }

    func setSelectedRange(_ range: NSRange) {
        select(SelectionSet([Selection(TypingDecision.clamp(range, within: store.length))]), scrolls: false)
    }

    func scrollRangeToVisible(_ range: NSRange) {
        let clamped = TypingDecision.clamp(range, within: store.length)
        let box = rects(for: NSRange(location: clamped.location, length: 0)).first ?? caretRect(at: clamped.location)
        scrollToVisible(box.insetBy(dx: -metrics.advance * 2, dy: 0))
    }

    var visibleCharacterRange: NSRange { accessibilityVisibleCharacterRange() }

    var visibleLines: ClosedRange<Int> {
        let visible = visibleRect
        guard store.lineCount > 0 else { return 0...0 }
        return rowMap.line(atRow: row(atY: visible.minY))...rowMap.line(atRow: row(atY: max(visible.minY, visible.maxY - 1)))
    }

    func line(atY y: CGFloat) -> Int { rowMap.line(atRow: row(atY: y)) }

    func replaceUntracked(_ range: NSRange, with text: String) {
        let clamped = TypingDecision.clamp(range, within: store.length)
        perform(TextCommands.through([TextReplacement(range: clamped, text)], store, selections, kind: .typing))
    }

    func relayoutLines(_ lines: ClosedRange<Int>) {
        guard store.lineCount > 0 else { return }
        let clamped = max(0, lines.lowerBound)...min(store.lineCount - 1, max(lines.lowerBound, lines.upperBound))
        invalidateLayout(lines: clamped)
    }

    func relayoutVisible() { relayoutLines(visibleLines) }

    func trailingNoteFrames(forLine line: Int, notes: [TrailingNote]) -> [NSRect?] {
        guard !isWindowed(line) else { return notes.map { _ in nil } }
        let top = top(ofLine: line)
        return CodeRowBuilder.placeNotes(notes, after: layout(line: line), visibleRight: visibleRect.maxX - trailingInset, metrics: metrics).map { placed in
            placed.map { NSRect(x: $0.x, y: top, width: $0.width, height: metrics.lineHeight) }
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let pointerArea { removeTrackingArea(pointerArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .cursorUpdate, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(area)
        pointerArea = area
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if visibleRect.contains(point) { NSCursor.iBeam.set() }
        onPointerMoved?(point, hitOffset(at: point), event.modifierFlags)
    }

    override func cursorUpdate(with event: NSEvent) { NSCursor.iBeam.set() }

    override func mouseExited(with event: NSEvent) { onPointerExited?() }

    override func flagsChanged(with event: NSEvent) {
        super.flagsChanged(with: event)
        guard let window else { return }
        let point = convert(window.mouseLocationOutsideOfEventStream, from: nil)
        if visibleRect.contains(point) { onPointerMoved?(point, hitOffset(at: point), event.modifierFlags) }
    }

    func hitOffset(at point: NSPoint) -> Int? {
        guard store.length > 0, point.y >= Self.verticalInset, row(atY: point.y) < rowCount else { return nil }
        let line = rowMap.line(atRow: row(atY: point.y))
        guard point.x <= x(of: NSMaxRange(store.lineRange(line))) else { return nil }
        let offset = offset(at: point)
        let start = x(of: offset)
        return point.x >= start ? offset : max(0, offset - 1)
    }

    @objc func expandSelection(_ sender: Any?) { _ = onEditorCommand?(#selector(expandSelection(_:))) }
    @objc func shrinkSelection(_ sender: Any?) { _ = onEditorCommand?(#selector(shrinkSelection(_:))) }
    @objc func openLineNote(_ sender: Any?) { _ = onEditorCommand?(#selector(openLineNote(_:))) }
    @objc func goToLine(_ sender: Any?) { _ = onEditorCommand?(#selector(goToLine(_:))) }
    @objc func nextChange(_ sender: Any?) { _ = onEditorCommand?(#selector(nextChange(_:))) }
    @objc func previousChange(_ sender: Any?) { _ = onEditorCommand?(#selector(previousChange(_:))) }
}

extension TextEngineView {
    var foldedRanges: [ClosedRange<Int>] { rowMap.folds.ranges }

    func setFolds(_ ranges: [ClosedRange<Int>]) {
        let topLine = store.lineCount > 0 ? line(atY: visibleRect.minY) : 0
        let into = visibleRect.minY - top(ofLine: topLine)
        let valid = ranges.filter { $0.lowerBound >= 1 && $0.upperBound < store.lineCount }
        let next = RowMap(folds: FoldMap(hiding: valid))
        guard next != rowMap else { return }
        rowMap = next
        relayoutAll()
        let anchor = rowMap.folds.isHidden(topLine) ? rowMap.line(atRow: rowMap.row(of: topLine)) : topLine
        scroll(NSPoint(x: visibleRect.minX, y: top(ofLine: anchor) + (anchor == topLine ? into : 0)))
        revealSelections()
        onViewportChange?()
    }

    func fold(_ range: ClosedRange<Int>) { setFolds(foldedRanges + [range]) }

    func unfold(around line: Int) { setFolds(rowMap.folds.unfolding(around: line).ranges) }

    func unfold(containing line: Int) {
        let kept = foldedRanges.filter { !$0.contains(line) }
        if kept.count != foldedRanges.count { setFolds(kept) }
    }

    func revealSelections() {
        guard rowMap.folds.hiddenCount > 0 else { return }
        let lines = selections.selections.flatMap { [store.line(at: $0.head), store.line(at: $0.anchor)] }
        let kept = foldedRanges.filter { range in !lines.contains { range.contains($0) } }
        if kept.count != foldedRanges.count { setFolds(kept) }
    }
}
