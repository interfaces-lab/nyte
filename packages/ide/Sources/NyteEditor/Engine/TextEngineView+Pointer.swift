import AppKit
import NyteUI
import os

extension TextEngineView: @MainActor NSDraggingSource {
    enum Granularity {
        case character, word, line
    }

    static let autoscrollDelay = Motion.fast
    static let autoscrollPeriod = Motion.instant

    override func resetCursorRects() {
        addCursorRect(visibleRect, cursor: .iBeam)
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        if composition != nil { commitComposition() }
        let modifiers = event.modifierFlags.intersection([.shift, .option, .command, .control])
        if modifiers == .control, let menu = menu(for: event) { return NSMenu.popUpContextMenu(menu, with: event, for: self) }
        let point = convert(event.locationInWindow, from: nil)
        let offset = offset(at: point)
        if let onClick, onClick(point, offset, event) { return }
        if modifiers == .option { return trackColumn(from: event, offset: offset) }
        let granularity: Granularity = switch event.clickCount {
        case 1: .character
        case 2: .word
        default: .line
        }
        if modifiers.isEmpty, granularity == .character,
           selections.selections.contains(where: { !$0.isEmpty && NSLocationInRange(offset, $0.range) }),
           waitForDrag(from: event) {
            return beginTextDrag(with: event)
        }
        let anchorRange: NSRange
        if modifiers.contains(.shift) {
            let primary = selections.primarySelection
            anchorRange = NSRange(location: primary.anchor, length: 0)
        } else {
            anchorRange = range(at: offset, granularity: granularity)
        }
        breakUndoCoalescing()
        trackSelection(anchor: anchorRange, granularity: granularity, from: event)
    }

    func range(at offset: Int, granularity: Granularity) -> NSRange {
        switch granularity {
        case .character: return NSRange(location: offset, length: 0)
        case .word: return TextUnits.word(at: offset, in: store, rule: context.words) ?? NSRange(location: offset, length: 0)
        case .line:
            let line = store.line(at: offset)
            let start = store.lineRange(line).location
            let end = line + 1 < store.lineCount ? store.lineRange(line + 1).location : store.length
            return NSRange(location: start, length: end - start)
        }
    }

    static func extend(anchor: NSRange, to hit: NSRange) -> Selection {
        if hit.location < anchor.location { return Selection(anchor: NSMaxRange(anchor), head: hit.location) }
        return Selection(anchor: anchor.location, head: max(NSMaxRange(anchor), NSMaxRange(hit)))
    }

    private func trackSelection(anchor: NSRange, granularity: Granularity, from event: NSEvent) {
        let signpost = OSSignposter.editor.beginInterval("engine pointer")
        defer { OSSignposter.editor.endInterval("engine pointer", signpost) }
        let point = convert(event.locationInWindow, from: nil)
        let hit = range(at: offset(at: point), granularity: granularity)
        select(SelectionSet([Self.extend(anchor: anchor, to: hit)]), scrolls: false)
        track(event) { [unowned self] point in
            select(SelectionSet([Self.extend(anchor: anchor, to: range(at: offset(at: point), granularity: granularity))]), scrolls: false)
        }
    }

    private func trackColumn(from event: NSEvent, offset: Int) {
        let start = convert(event.locationInWindow, from: nil)
        let startLine = store.line(at: offset)
        let base = selections
        var dragged = false
        track(event) { [unowned self] point in
            dragged = true
            let line = rowMap.line(atRow: row(atY: point.y))
            select(TextCommands.column(from: (startLine, start.x), to: (line, point.x), in: store, measure: columnMeasure), scrolls: false)
        }
        guard !dragged else { return }
        breakUndoCoalescing()
        select(base.removing(caretAt: offset) ?? base.adding(Selection(caret: offset)), scrolls: false)
    }

    private func track(_ event: NSEvent, _ moved: (NSPoint) -> Void) {
        guard let window else { return }
        NSEvent.startPeriodicEvents(afterDelay: Self.autoscrollDelay, withPeriod: Self.autoscrollPeriod)
        defer { NSEvent.stopPeriodicEvents() }
        var last = convert(event.locationInWindow, from: nil)
        while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp, .periodic]) {
            if next.type == .leftMouseUp { break }
            if next.type == .leftMouseDragged { last = convert(next.locationInWindow, from: nil) }
            if !visibleRect.contains(last) { scrollToVisible(NSRect(x: last.x, y: last.y, width: 1, height: 1)) }
            moved(last)
        }
    }

    private func waitForDrag(from event: NSEvent) -> Bool {
        guard let window else { return false }
        let start = event.locationInWindow
        while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            if next.type == .leftMouseUp {
                select(SelectionSet(caret: offset(at: convert(next.locationInWindow, from: nil))), scrolls: false)
                return false
            }
            if hypot(next.locationInWindow.x - start.x, next.locationInWindow.y - start.y) >= Metric.dragThreshold { return true }
        }
        return false
    }

    private func beginTextDrag(with event: NSEvent) {
        let text = selectedText
        let item = NSDraggingItem(pasteboardWriter: text as NSString)
        let rect = rects(for: selections.primarySelection.range).reduce(NSRect.null) { $0.union($1) }
        let image = NSImage(size: rect.size, flipped: true) { [metrics] bounds in
            NSAttributedString(string: text, attributes: [.font: metrics.font, .foregroundColor: Palette.contentPrimary])
                .draw(in: bounds)
            return true
        }
        item.setDraggingFrame(rect, contents: image)
        beginDraggingSession(with: [item], event: event, source: self)
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        context == .withinApplication ? [.move, .copy] : .copy
    }

    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation { draggingUpdated(sender) }

    override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
        guard isEditable else { return [] }
        let offset = offset(at: convert(sender.draggingLocation, from: nil))
        let ownDrag = sender.draggingSource as? TextEngineView === self
        if ownDrag, selections.selections.contains(where: { $0.lower < offset && offset < $0.upper }) { return [] }
        return Self.dropOperation(ownDrag: ownDrag, copying: NSEvent.modifierFlags.contains(.option))
    }

    static func dropOperation(ownDrag: Bool, copying: Bool) -> NSDragOperation {
        ownDrag && !copying ? .move : .copy
    }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        let offset = offset(at: convert(sender.draggingLocation, from: nil))
        let board = sender.draggingPasteboard
        if let urls = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            if onDropFiles?(urls, offset) == true { return true }
            return insertDropped(urls.map(\.path).joined(separator: "\n"), at: offset, moving: false)
        }
        guard let text = board.string(forType: .string) else { return false }
        let moving = sender.draggingSource as? TextEngineView === self && draggingUpdated(sender) == .move
        return insertDropped(text, at: offset, moving: moving)
    }

    private func insertDropped(_ text: String, at offset: Int, moving: Bool) -> Bool {
        let units = Array(text.utf16)
        let removed = moving ? selections.selections.filter { !$0.isEmpty }.map { TextReplacement(range: $0.range, text: []) } : []
        guard !removed.contains(where: { $0.range.location < offset && offset < NSMaxRange($0.range) }) else { return false }
        var transaction = TextCommands.through(removed + [TextReplacement(range: NSRange(location: offset, length: 0), text: units)],
                                               store, selections, kind: .named(moving ? "Move" : "Drop"))
        let start = transaction.mapped(offset, stickingRight: false)
        transaction.after = SelectionSet([Selection(anchor: start, head: start + units.count)])
        breakUndoCoalescing()
        perform(transaction)
        window?.makeFirstResponder(self)
        return true
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let offset = offset(at: convert(event.locationInWindow, from: nil))
        if !selections.selections.contains(where: { NSLocationInRange(offset, $0.range) || $0.head == offset }) {
            select(SelectionSet(caret: offset), scrolls: false)
        }
        return contextMenuProvider?(event, offset)
    }
}
