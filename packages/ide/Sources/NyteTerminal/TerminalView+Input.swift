import AppKit
import NyteUI

extension TerminalView: @MainActor NSTextInputClient {
    private static let nanosecondsPerSecond: Double = 1_000_000_000

    override func keyDown(with event: NSEvent) {
        restartBlink()
        let key = KeyMap.key(for: event.keyCode)
        if isExited {
            if key == .enter || key == .numpadEnter { onRestart?() }
            return
        }
        guard let session else { return }
        NSCursor.setHiddenUntilMouseMoves(true)
        let phase: KeyPhase = event.isARepeat ? .repeating : .press
        if KeyMap.isOptionMeta(event.modifierFlags, preferences.optionAsMeta), !hasMarkedText() {
            let plain = event.modifierFlags.subtracting([.option, .control, .command])
            let input = keyInput(event, phase: phase, text: KeyMap.printable(event.characters(byApplyingModifiers: plain)))
            return session.enqueue { $0.key(input) }
        }
        let hadMarkedText = hasMarkedText()
        let layoutBefore = hadMarkedText ? nil : inputContext?.selectedKeyboardInputSource
        typedDuringKey = []
        interpretKeyEvents([event])
        let accumulated = typedDuringKey ?? []
        typedDuringKey = nil
        let stroke = TerminalTyping.Stroke(
            hadMarkedText: hadMarkedText, hasMarkedText: hasMarkedText(),
            layoutChanged: !hadMarkedText && layoutBefore != inputContext?.selectedKeyboardInputSource,
            accumulated: accumulated, key: key, modifiers: KeyMap.modifiers(event.modifierFlags),
            characters: event.characters ?? ""
        )
        switch TerminalTyping.resolve(stroke) {
        case .drop, .composing:
            return
        case let .key(text) where !KeyMap.printable(text).isEmpty:
            let input = keyInput(event, phase: phase, text: text)
            session.enqueue { $0.key(input) }
        case .key, .plainKey:
            sendPlainKey(event, phase: phase)
        case let .texts(texts):
            for text in texts { session.enqueue { $0.text(text) } }
        case let .committed(texts, replayKey):
            for text in texts { session.enqueue { $0.text(text) } }
            if replayKey { sendPlainKey(event, phase: phase) }
        }
    }

    private func sendPlainKey(_ event: NSEvent, phase: KeyPhase) {
        let shifted = event.modifierFlags.intersection([.shift, .capsLock])
        let input = keyInput(event, phase: phase, text: KeyMap.printable(event.characters(byApplyingModifiers: shifted)))
        session?.enqueue { $0.key(input) }
    }

    override func keyUp(with event: NSEvent) {
        guard let session, !isExited, !hasMarkedText() else { return }
        let input = keyInput(event, phase: .release, text: "")
        session.enqueue { $0.key(input) }
    }

    override func flagsChanged(with event: NSEvent) {
        if let window { updateLinkHover(at: window.mouseLocationOutsideOfEventStream, commandDown: event.modifierFlags.contains(.command)) }
        guard let session, !isExited, !hasMarkedText() else { return }
        let key = KeyMap.key(for: event.keyCode)
        let held = KeyMap.heldFlag(for: key)
        guard !held.isEmpty else { return }
        let input = KeyInput(
            phase: event.modifierFlags.contains(held) ? .press : .release, key: key,
            modifiers: KeyMap.modifiers(event.modifierFlags), consumed: [], text: "", unshifted: 0
        )
        session.enqueue { $0.key(input) }
    }

    private func keyInput(_ event: NSEvent, phase: KeyPhase, text: String) -> KeyInput {
        let modifiers = KeyMap.modifiers(event.modifierFlags)
        let consumable: TerminalModifiers = KeyMap.isOptionMeta(event.modifierFlags, preferences.optionAsMeta) ? .shift : [.shift, .option]
        let unshifted = KeyMap.printable(event.characters(byApplyingModifiers: [])).unicodeScalars.first?.value ?? 0
        return KeyInput(phase: phase, key: KeyMap.key(for: event.keyCode), modifiers: modifiers,
                        consumed: text.isEmpty ? [] : modifiers.intersection(consumable), text: text, unshifted: unshifted)
    }

    func insertText(_ string: Any, replacementRange: NSRange) {
        let units: [UInt16]
        switch string {
        case let attributed as NSAttributedString: units = Array(attributed.string.utf16)
        case let plain as String: units = Array(plain.utf16)
        default: return
        }
        let text = surrogates.accept(units)
        if markedText != nil {
            markedText = nil
            invalidate(rowRect(cursor.row))
        }
        guard !text.isEmpty else { return }
        if typedDuringKey != nil {
            typedDuringKey?.append(text)
        } else {
            session?.enqueue { $0.text(text) }
        }
    }

    override func doCommand(by selector: Selector) {}

    func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
        let text: NSAttributedString = switch string {
        case let attributed as NSAttributedString: attributed
        case let plain as String: NSAttributedString(string: plain)
        default: NSAttributedString()
        }
        markedText = text.length > 0 ? text : nil
        markedSelection = selectedRange
        invalidate(rowRect(cursor.row))
    }

    func unmarkText() {
        guard markedText != nil else { return }
        markedText = nil
        invalidate(rowRect(cursor.row))
    }

    func selectedRange() -> NSRange {
        guard let markedText else { return NSRange(location: 0, length: 0) }
        let span = TerminalTyping.markedSpan(
            requested: TerminalTyping.Span(location: markedSelection.location, length: markedSelection.length),
            markedLength: markedText.length
        )
        return NSRange(location: span.location, length: span.length)
    }

    func markedRange() -> NSRange {
        guard let markedText else { return NSRange(location: NSNotFound, length: 0) }
        return NSRange(location: 0, length: markedText.length)
    }

    func hasMarkedText() -> Bool { markedText != nil }

    func attributedSubstring(forProposedRange range: NSRange, actualRange: NSRangePointer?) -> NSAttributedString? {
        guard let markedText, range.location != NSNotFound,
              range.location + range.length <= markedText.length else { return nil }
        actualRange?.pointee = range
        return markedText.attributedSubstring(from: range)
    }

    func validAttributesForMarkedText() -> [NSAttributedString.Key] { [] }

    func firstRect(forCharacterRange range: NSRange, actualRange: NSRangePointer?) -> NSRect {
        let marked = markedText?.string ?? ""
        let length = (marked as NSString).length
        let span = TerminalTyping.markedSpan(requested: TerminalTyping.Span(location: range.location, length: range.length),
                                             markedLength: length)
        actualRange?.pointee = NSRange(location: span.location, length: span.length)
        let origin = cellRect(column: cursor.column, row: cursor.row)
        let lead: CGFloat
        if length == 0 {
            let cells = range.location == NSNotFound ? 0 : min(range.location, max(columns - cursor.column, 0))
            lead = CGFloat(cells) * metrics.cellWidth
        } else {
            lead = measure((marked as NSString).substring(to: span.location))
        }
        let width = span.length == 0 ? 0 : measure((marked as NSString).substring(with: NSRange(location: span.location, length: span.length)))
        let rect = NSRect(x: origin.minX + lead, y: origin.minY, width: width, height: origin.height)
        guard let window else { return rect }
        return window.convertToScreen(convert(rect, to: nil))
    }

    private func measure(_ text: String) -> CGFloat {
        NSAttributedString(string: text, attributes: markedTextAttributes).size().width
    }

    func characterIndex(for point: NSPoint) -> Int { NSNotFound }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        if event.modifierFlags.contains(.command) {
            updateLinkHover(at: event.locationInWindow, commandDown: true)
            if openHoveredLink() { return }
            return openLink(at: event)
        }
        if event.modifierFlags.contains(.control), !mouseTracking, let menu = menu(for: event) {
            return NSMenu.popUpContextMenu(menu, with: event, for: self)
        }
        pointer(event, .press, .left)
    }

    override func mouseDragged(with event: NSEvent) { pointer(event, .drag, .left) }
    override func mouseUp(with event: NSEvent) { pointer(event, .release, .left) }
    override func rightMouseDown(with event: NSEvent) {
        guard mouseTracking else { return super.rightMouseDown(with: event) }
        pointer(event, .press, .right)
    }
    override func rightMouseDragged(with event: NSEvent) { pointer(event, .drag, .right) }
    override func rightMouseUp(with event: NSEvent) { pointer(event, .release, .right) }
    override func otherMouseDown(with event: NSEvent) { pointer(event, .press, .middle) }
    override func otherMouseDragged(with event: NSEvent) { pointer(event, .drag, .middle) }
    override func otherMouseUp(with event: NSEvent) { pointer(event, .release, .middle) }

    override func mouseMoved(with event: NSEvent) {
        updateLinkHover(at: event.locationInWindow, commandDown: event.modifierFlags.contains(.command))
        guard mouseTracking else { return }
        pointer(event, .motion, .none)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }

    override func mouseExited(with event: NSEvent) { clearHover() }

    override func scrollWheel(with event: NSEvent) {
        guard let session else { return }
        let rows: Int
        if event.hasPreciseScrollingDeltas {
            scrollRemainder += event.scrollingDeltaY / metrics.cellHeight
            rows = Int(scrollRemainder)
            scrollRemainder -= CGFloat(rows)
        } else {
            rows = event.scrollingDeltaY == 0 ? 0 : Int(event.scrollingDeltaY.rounded(.awayFromZero))
        }
        guard rows != 0 else { return }
        let place = gridPosition(event)
        let input = ScrollInput(rows: -rows, column: place.column, row: place.row, x: place.x, y: place.y,
                                modifiers: KeyMap.modifiers(event.modifierFlags))
        session.enqueue { $0.scroll(input) }
    }

    private func pointer(_ event: NSEvent, _ phase: PointerInput.Phase, _ button: MouseButton) {
        guard let session else { return }
        let place = gridPosition(event)
        let input = PointerInput(
            phase: phase, button: button, modifiers: KeyMap.modifiers(event.modifierFlags),
            column: place.column, row: place.row, x: place.x, y: place.y,
            time: UInt64(event.timestamp * Self.nanosecondsPerSecond),
            repeatInterval: UInt64(NSEvent.doubleClickInterval * Self.nanosecondsPerSecond),
            forceSelection: event.modifierFlags.contains(.shift)
        )
        session.enqueue { $0.pointer(input) }
    }

    private func gridPosition(_ event: NSEvent) -> (column: Int, row: Int, x: Double, y: Double) {
        let point = convert(event.locationInWindow, from: nil)
        let x = point.x - Self.padding.width
        let y = point.y - Self.padding.height
        let column = min(max(Int((x / metrics.cellWidth).rounded(.down)), 0), max(columns - 1, 0))
        let row = min(max(Int((y / metrics.cellHeight).rounded(.down)), 0), max(layouts.count - 1, 0))
        return (column, row, Double(max(x, 0) * metrics.scale), Double(max(y, 0) * metrics.scale))
    }

    private func openLink(at event: NSEvent) {
        let place = gridPosition(event)
        let fallback = plainURL(column: place.column, row: place.row)
        let resolved = reply { (_: TerminalView, link: String?) in
            guard let candidate = link ?? fallback, let url = URL(string: candidate),
                  let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
            NSWorkspace.shared.open(url)
        }
        session?.enqueue { $0.hyperlink(column: place.column, row: place.row, reply: resolved) }
    }

    private func plainURL(column: Int, row: Int) -> String? {
        guard let source = layouts[safe: row]??.source, let hit = source.cluster(at: column) else { return nil }
        let text = { (cluster: Int) in String(decoding: source.text[source.utf16Range(first: cluster, count: 1)], as: UTF16.self) }
        let adjacent = { (cluster: Int, next: Int) in
            Int(source.clusterColumn[cluster]) + Int(source.clusterWidth[cluster]) == Int(source.clusterColumn[next])
        }
        var first = hit
        while first > 0, adjacent(first - 1, first), text(first - 1) != " " { first -= 1 }
        var last = hit
        while last + 1 < source.clusterStart.count, adjacent(last, last + 1), text(last + 1) != " " { last += 1 }
        let token = (first...last).map(text).joined()
        let trimmed = token.trimmingCharacters(in: CharacterSet(charactersIn: "<>()[]{}\"'`,.;:!?"))
        return trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") ? trimmed : nil
    }
}
