import AppKit
import NyteUI
import NyteCore

extension EditorViewController {
    public func handle(_ event: IntelligenceEvent) {
        tellFeatures { $0.intelligenceDidReport(event) }
    }

    public func canPerform(_ command: EditorCommand) -> Bool {
        var able = false
        tellFeatures { able = able || $0.canPerform(command) }
        return able
    }

    public func perform(_ command: EditorCommand) {
        var done = false
        tellFeatures { if !done { done = $0.perform(command) } }
    }

    public func lineNotesDidChange() {
        for case let notes as LineNotesFeature in features { notes.reload() }
    }

    public func runMarksDidChange() {
        for case let marks as RunMarksFeature in features { marks.reload() }
    }

    public func baseTextDidChange() {
        for case let changes as ChangeBarsFeature in features { changes.reload() }
    }

    public func rectOfBreakpoint(line: Int) -> NSRect? {
        ruler.rectOfMark(line: line)
    }

    public func breakpointsDidChange() {
        scrollView.verticalRulerView?.needsDisplay = true
        textView.needsDisplay = true
    }

    public func reveal(_ location: FileLocation, asJump: Bool = true) {
        if asJump, let here = caretLocation {
            history.back.append(here)
            history.forward.removeAll()
        }
        let url = location.url.standardizedFileURL
        let wasOpen = document(for: url) != nil
        open(url, preview: !wasOpen)
        if shown?.url == url {
            select(location.range)
        } else {
            setPendingReveal(location.range, for: url)
        }
    }

    public var canGoBack: Bool { !history.back.isEmpty }
    public var canGoForward: Bool { !history.forward.isEmpty }

    public func goBack() {
        guard let target = history.back.popLast() else { return }
        if let here = caretLocation { history.forward.append(here) }
        reveal(target, asJump: false)
    }

    public func goForward() {
        guard let target = history.forward.popLast() else { return }
        if let here = caretLocation { history.back.append(here) }
        reveal(target, asJump: false)
    }

    public func apply(_ edit: WorkspaceEdit) async -> Bool {
        var applied = true
        for file in edit.files where !file.edits.isEmpty {
            if let document = document(for: file.url) {
                applied = replace(file.edits, in: document) && applied
            } else {
                let url = file.url, edits = file.edits
                let saved = await Task.detached(priority: .userInitiated) { FileIO.rewrite(url, applying: edits) }.value
                applied = saved && applied
            }
        }
        return applied
    }

    func replace(_ edits: [TextEdit], in document: Document) -> Bool {
        let store = document.store
        let ranges = edits.compactMap { edit -> TextReplacement? in
            guard let start = document.lines.offset(of: edit.range.start, length: store.length),
                  let end = document.lines.offset(of: edit.range.end, length: store.length), end >= start
            else { return nil }
            return TextReplacement(range: NSRange(location: start, length: end - start), edit.text)
        }.sorted { $0.range.location < $1.range.location }
        guard ranges.count == edits.count,
              zip(ranges, ranges.dropFirst()).allSatisfy({ NSMaxRange($0.range) <= $1.range.location })
        else { return false }
        let selections = document.model.session.selections
        let transaction = TextCommands.through(ranges, store, selections, kind: .named("Edit"))
        if textView.model === document.model { textView.breakUndoCoalescing() }
        apply(transaction, to: document.id)
        if textView.model === document.model { textView.breakUndoCoalescing() }
        return true
    }
}

extension EditorViewController {
    var url: URL? { shown?.url }
    var revision: Int { shown?.revision ?? 0 }
    var lineIndex: LineIndex? { shown?.lines }

    var shownStore: TextStore { textView.store }

    func position(at offset: Int) -> TextPosition? {
        shown?.lines.position(at: offset)
    }

    func offset(of position: TextPosition) -> Int? {
        guard let document = shown else { return nil }
        return document.lines.offset(of: position, length: document.length)
    }

    func range(of range: TextSpan) -> NSRange? {
        guard let start = offset(of: range.start), let end = offset(of: range.end), end >= start else { return nil }
        return NSRange(location: start, length: end - start)
    }

    func span(of range: NSRange) -> TextSpan? {
        guard let start = position(at: range.location), let end = position(at: NSMaxRange(range)) else { return nil }
        return TextSpan(start: start, end: end)
    }

    var visibleRange: NSRange {
        guard shown != nil else { return NSRange(location: 0, length: 0) }
        return textView.visibleCharacterRange
    }

    func rects(for range: NSRange) -> [NSRect] {
        guard shown != nil, NSMaxRange(range) <= textView.store.length else { return [] }
        return textView.rects(for: range)
    }

    var caretLocation: FileLocation? {
        guard let url, let position = position(at: textView.selectedRange().location) else { return nil }
        return FileLocation(url: url, range: TextSpan(at: position))
    }

    func select(_ range: TextSpan) {
        guard let target = self.range(of: TextSpan(at: range.start)) else { return }
        textView.setSelectedRange(target)
        textView.window?.makeFirstResponder(textView)
        textView.scrollRangeToVisible(target)
        centre(target)
    }

    func centre(_ target: NSRange) {
        guard let rect = rects(for: target).first else { return }
        let visible = scrollView.contentView.bounds
        scroll(to: NSPoint(x: visible.minX, y: rect.midY - visible.height / 2))
    }

    @discardableResult
    func edit(_ edits: [TextEdit]) -> Bool {
        guard let document = shown, !edits.isEmpty else { return false }
        textView.breakUndoCoalescing()
        return replace(edits, in: document)
    }

    func replaceUntracked(_ range: NSRange, with text: String) {
        guard shown != nil, NSMaxRange(range) <= textView.store.length else { return }
        textView.replaceUntracked(range, with: text)
    }

    var hasChanges: Bool { features.contains { ($0 as? ChangeBarsFeature)?.hunkCount ?? 0 > 0 } }

    func jumpToChange(forward: Bool) {
        guard let lines = lineIndex else { return }
        let caret = lines.line(at: caretRange.location)
        for case let changes as ChangeBarsFeature in features {
            guard let line = changes.nextHunk(after: caret, forward: forward) else { continue }
            select(TextSpan(at: TextPosition(line: min(line, lines.count - 1), column: 0)))
        }
    }

    var hasLineNoteAtCaret: Bool {
        guard let line = lineIndex?.line(at: caretRange.location) else { return false }
        return features.contains { ($0 as? LineNotesFeature)?.actionableNote(onLine: line) != nil }
    }

    func openLineNoteAtCaret() {
        guard let line = lineIndex?.line(at: caretRange.location) else { return }
        for case let notes as LineNotesFeature in features {
            if let index = notes.actionableNote(onLine: line) { notes.activate(index) }
        }
    }

    func promptForLine() {
        for case let feature as GoToLineFeature in features { feature.show() }
    }

    func present(_ locations: [FileLocation], title: String) {
        onPresentLocations?(locations, title)
    }

    func preview(_ edit: WorkspaceEdit, title: String) {
        onPreviewEdit?(edit, title)
    }
}
