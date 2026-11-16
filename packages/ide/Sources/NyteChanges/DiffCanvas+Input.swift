import AppKit
import NyteCore
import NyteUI

extension DiffCanvas {
    func installTracking() {
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect],
                                       owner: self))
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let row = rows.row(at: point.y)
        hovered = row >= 0 && point.y < rows.height ? row : -1
        hoveredLink = hovered >= 0 && rows.kinds[hovered] == .fold ? link(at: point, row: hovered) : -1
    }

    override func mouseExited(with event: NSEvent) {
        hovered = -1
        hoveredLink = -1
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        let point = convert(event.locationInWindow, from: nil)
        let row = rows.row(at: point.y)
        guard row >= 0, point.y < rows.height else { return }
        if rows.kinds[row] == .fold {
            expand(fold: row, fully: link(at: point, row: row) == 1 || event.modifierFlags.contains(.option))
            return
        }
        if event.modifierFlags.contains(.shift), anchor >= 0 {
            move(to: row, extending: true)
        } else {
            move(to: row, extending: false)
        }
        dragging = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard dragging else { return }
        autoscroll(with: event)
        let row = rows.row(at: convert(event.locationInWindow, from: nil).y)
        if row >= 0 { move(to: row, extending: true) }
    }

    override func mouseUp(with event: NSEvent) { dragging = false }

    private func link(at point: NSPoint, row: Int) -> Int {
        let links = foldLinks(rows.rect(of: row, width: bounds.width), visibleRect)
        if links.all.insetBy(dx: -Space.x1, dy: 0).contains(point) { return 1 }
        if rows.hiddenLines(ofFold: row) > Int(DiffFolds.step), links.step.insetBy(dx: -Space.x1, dy: 0).contains(point) { return 0 }
        return -1
    }

    func expand(fold row: Int, fully: Bool) {
        guard row >= 0, row < rows.count, rows.kinds[row] == .fold else { return }
        let gap = Int(rows.old[row])
        folds = folds.expanded(gap, fully: fully)
        let anchorRow = row
        rebuild(keepingCursor: false)
        cursor = min(anchorRow, rows.count - 1)
        anchor = cursor
        onCursorChange?()
    }

    func expandAll() {
        folds = folds.expandedAll()
        rebuild(keepingCursor: true)
    }

    func move(to row: Int, extending: Bool) {
        guard rows.count > 0 else { return }
        cursor = min(max(row, 0), rows.count - 1)
        if !extending || anchor < 0 { anchor = cursor }
        reveal(cursor)
        updateActionButtons()
        needsDisplay = true
        onCursorChange?()
        NSAccessibility.post(element: self, notification: .selectedRowsChanged)
    }

    func reveal(_ row: Int) {
        guard row >= 0, row < rows.count else { return }
        let rect = rows.rect(of: row, width: bounds.width)
        scrollToVisible(NSRect(x: visibleRect.minX, y: rect.minY, width: Metric.hairline, height: rect.height))
    }

    func moveToChange(_ direction: Int) {
        let target: Int32? = direction > 0 ? rows.headers.first { Int($0) > cursor } : rows.headers.last { Int($0) < cursor }
        guard let target else {
            onBoundary?(direction)
            return
        }
        showHunk(at: Int(target))
    }

    func showHunk(at header: Int) {
        cursor = header
        anchor = header
        guard let scroll = enclosingScrollView else { return move(to: header, extending: false) }
        let hunk = Int(rows.owner[header])
        let span = rows.rows(ofHunk: hunk)
        let top = rows.tops[span.lowerBound], bottom = rows.tops[span.upperBound]
        let page = scroll.contentView.bounds.height
        let lead = page / 4
        let y = bottom - top > page - lead ? top : max(0, top - lead)
        let clip = scroll.contentView
        if y < clip.bounds.minY || bottom > clip.bounds.maxY {
            clip.scroll(to: NSPoint(x: clip.bounds.minX, y: min(y, max(0, frame.height - page))))
            scroll.reflectScrolledClipView(clip)
        }
        move(to: header, extending: false)
    }

    func firstHunk() { if let first = rows.headers.first { showHunk(at: Int(first)) } }
    func lastHunk() { if let last = rows.headers.last { showHunk(at: Int(last)) } }

    override func keyDown(with event: NSEvent) {
        if handle(event) { return }
        super.keyDown(with: event)
    }

    func handle(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        let shift = modifiers == .shift
        if let key = event.specialKey {
            switch key {
            case .upArrow where modifiers.isEmpty || shift: move(to: cursor < 0 ? 0 : cursor - 1, extending: shift)
            case .downArrow where modifiers.isEmpty || shift: move(to: cursor + 1, extending: shift)
            case .pageDown, .pageUp: page(key == .pageDown, extending: shift)
            case .home: move(to: 0, extending: shift)
            case .end: move(to: rows.count - 1, extending: shift)
            case .f7 where modifiers.isEmpty || shift: moveToChange(shift ? -1 : 1)
            case .carriageReturn, .enter:
                guard cursor >= 0, cursor < rows.count, rows.kinds[cursor] == .fold else { return false }
                expand(fold: cursor, fully: modifiers.contains(.option))
            case .delete, .deleteForward, .backspace:
                guard let action = actions.destructive else { return false }
                perform(action)
            default: return false
            }
            return true
        }
        guard modifiers.isEmpty || shift, let character = event.charactersIgnoringModifiers?.lowercased() else { return false }
        switch character {
        case "c": openComposer()
        case "j": moveToChange(1)
        case "k": moveToChange(-1)
        case "s":
            guard let action = actions.primary else { return false }
            perform(action)
        case "\u{1b}":
            anchor = cursor
            needsDisplay = true
        default: return false
        }
        return true
    }

    func perform(_ action: HunkAction) {
        guard let selection = chosenSelection(), !selection.isEmpty else { return NSSound.beep() }
        onAction?(action, selection)
    }

    private func page(_ down: Bool, extending: Bool) {
        let page = max(Self.lineHeight, (enclosingScrollView?.contentView.bounds.height ?? 0) - Self.lineHeight)
        let y = (cursor >= 0 ? rows.tops[cursor] : visibleRect.minY) + (down ? page : -page)
        move(to: rows.row(at: max(0, min(y, rows.height - 1))), extending: extending)
    }

    @objc func copy(_ sender: Any?) {
        let lines = selectedRows.compactMap { row -> String? in
            switch rows.kinds[row] {
            case .removed: document.old.string(of: Int(rows.old[row]))
            case .context, .added: document.new.string(of: Int(rows.new[row]))
            case .changed: rows.new[row] >= 0 ? document.new.string(of: Int(rows.new[row])) : document.old.string(of: Int(rows.old[row]))
            case .header, .fold, .note, .composer, .gap: nil
            }
        }
        guard !lines.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lines.joined(separator: "\n") + "\n", forType: .string)
    }

    override func becomeFirstResponder() -> Bool {
        needsDisplay = true
        if cursor < 0, let first = rows.headers.first { cursor = Int(first); anchor = cursor; updateActionButtons() }
        return true
    }

    override func resignFirstResponder() -> Bool {
        needsDisplay = true
        return true
    }
}

extension DiffCanvas: NSMenuItemValidation {
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(copy(_:)) { return !selectedRows.isEmpty }
        return false
    }
}
