import AppKit
import NyteUI
import os

extension TextEngineView {
    var isFocused: Bool { KeyFocus.shows(holdsFocus: window?.firstResponder === self, windowIsKey: window?.isKeyWindow ?? false) }

    func drawContent(_ dirtyRect: NSRect) {
        let signpost = OSSignposter.editor.beginInterval("engine draw")
        defer { OSSignposter.editor.endInterval("engine draw", signpost) }
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        Palette.bgBase.setFill()
        dirtyRect.fill()
        let rows = rows(in: dirtyRect)
        guard !rows.isEmpty else { return drawCarets(in: dirtyRect) }
        drawGrounds(rows, in: dirtyRect)
        for decorator in decorators { decorator.drawUnderText(in: dirtyRect, of: self) }
        for row in rows { drawText(row: row, in: dirtyRect, context: context) }
        drawNotes(rows, context: context)
        drawComposition(in: dirtyRect)
        for decorator in decorators { decorator.drawOverText(in: dirtyRect, of: self) }
        drawCarets(in: dirtyRect)
    }

    private func drawGrounds(_ rows: Range<Int>, in dirtyRect: NSRect) {
        let firstLine = rowMap.line(atRow: rows.lowerBound)
        let lastLine = rowMap.line(atRow: rows.upperBound - 1)
        let start = store.lineRange(firstLine).location
        let end = NSMaxRange(store.lineRange(lastLine))
        if selections.count == 1, selections.primarySelection.isEmpty {
            let line = store.line(at: selections.primarySelection.head)
            if line >= firstLine, line <= lastLine {
                Palette.bgMutedTranslucent.setFill()
                NSRect(x: dirtyRect.minX, y: top(ofLine: line), width: dirtyRect.width, height: metrics.lineHeight).fill(using: .sourceOver)
            }
        }
        (isFocused ? Palette.fillPrimary : Palette.fillSecondary).setFill()
        for selection in visibleSelections(from: start, to: end) where !selection.isEmpty {
            let first = max(firstLine, store.line(at: selection.lower))
            let last = min(lastLine, store.line(at: selection.upper))
            guard first <= last else { continue }
            for line in first...last {
                let span = store.lineRange(line)
                let from = max(selection.lower, span.location)
                let to = min(selection.upper, NSMaxRange(span))
                let left = x(of: from)
                let right = selection.upper > NSMaxRange(span) ? max(bounds.maxX, dirtyRect.maxX) : x(of: to)
                guard right > left else { continue }
                NSRect(x: left, y: top(ofLine: line), width: right - left, height: metrics.lineHeight).intersection(dirtyRect).fill()
            }
        }
    }

    func visibleSelections(from start: Int, to end: Int) -> ArraySlice<Selection> {
        let all = selections.selections
        var low = 0
        var high = all.count
        while low < high {
            let middle = (low + high) / 2
            if all[middle].upper < start { low = middle + 1 } else { high = middle }
        }
        var stop = low
        while stop < all.count, all[stop].lower <= end { stop += 1 }
        return all[low..<stop]
    }

    private func drawText(row: Int, in dirtyRect: NSRect, context: CGContext) {
        let line = rowMap.line(atRow: row)
        let top = top(ofRow: row)
        let shown: ClosedRange<Int>
        if isWindowed(line) {
            let table = windows(of: line)
            shown = table.window(atX: dirtyRect.minX)...table.window(atX: dirtyRect.maxX)
        } else {
            shown = 0...0
        }
        for window in shown { layout(line: line, window: window).draw(at: top, metrics: metrics, in: context) }
    }

    private func drawNotes(_ rows: Range<Int>, context: CGContext) {
        guard !decorators.isEmpty else { return }
        let right = visibleRect.maxX - trailingInset
        for row in rows {
            let line = rowMap.line(atRow: row)
            guard !isWindowed(line) else { continue }
            let notes = decorators.flatMap { $0.trailingNotes(forLine: line, of: self) }
            CodeRowBuilder.drawNotes(notes, after: layout(line: line), top: top(ofRow: row), visibleRight: right, metrics: metrics, in: context)
        }
    }

    private func clipDidScroll() {
        let visible = visibleRect
        guard visible.minX != lastVisibleX, !decorators.isEmpty else { return }
        lastVisibleX = visible.minX
        setNeedsDisplay(visible)
    }

    private func drawComposition(in dirtyRect: NSRect) {
        guard let composition else { return }
        Palette.contentPrimary.setFill()
        for underline in composition.underlines {
            let start = composition.range.location + underline.range.location
            let range = NSRange(location: start, length: underline.range.length)
            let thickness = underline.isThick ? Self.underlineWidth * 2 : Self.underlineWidth
            for rect in rects(for: range) where rect.intersects(dirtyRect) {
                NSRect(x: rect.minX + Self.underlineWidth, y: rect.maxY - thickness - Self.underlineWidth,
                       width: max(0, rect.width - Self.underlineWidth * 2), height: thickness).fill()
            }
        }
    }

    private func drawCarets(in dirtyRect: NSRect) {
        guard caretsShown, isFocused, isEditable else { return }
        Palette.contentPrimary.setFill()
        let visible = visibleRect.union(dirtyRect)
        let start = store.lineRange(rowMap.line(atRow: row(atY: visible.minY))).location
        let end = NSMaxRange(store.lineRange(rowMap.line(atRow: row(atY: visible.maxY))))
        for selection in visibleSelections(from: start, to: end) {
            let rect = caretRect(at: selection.head)
            if rect.intersects(dirtyRect) { rect.fill() }
        }
    }

    func invalidateCarets() {
        let visible = visibleRect
        guard store.lineCount > 0 else { return }
        let start = store.lineRange(rowMap.line(atRow: row(atY: visible.minY))).location
        let end = NSMaxRange(store.lineRange(rowMap.line(atRow: row(atY: visible.maxY))))
        for selection in visibleSelections(from: start, to: end) { setNeedsDisplay(caretRect(at: selection.head)) }
    }

    func updateBlink(isFirstResponder: Bool? = nil) {
        let mode = CaretBlink.mode(isFirstResponder: isFirstResponder ?? (window?.firstResponder === self), isKey: window?.isKeyWindow ?? false,
                                   isVisible: !isHiddenOrHasHiddenAncestor && window != nil,
                                   isOccluded: !(window?.occlusionState.contains(.visible) ?? false))
        switch (mode, blink) {
        case (.hidden, .blinking(let timer)):
            timer.invalidate()
            blink = .idle
        case (.blinking, .idle):
            caretsShown = true
            scheduleBlink(after: CaretBlink.onPeriod)
        default: break
        }
        invalidateCarets()
    }

    func restartBlink() {
        guard case .blinking(let timer) = blink else { return }
        timer.invalidate()
        caretsShown = true
        scheduleBlink(after: CaretBlink.onPeriod)
    }

    private func scheduleBlink(after delay: TimeInterval) {
        let timer = Timer(timeInterval: delay, target: self, selector: #selector(toggleBlink), userInfo: nil, repeats: false)
        RunLoop.main.add(timer, forMode: .common)
        blink = .blinking(timer)
    }

    @objc private func toggleBlink() {
        guard case .blinking = blink else { return }
        caretsShown.toggle()
        invalidateCarets()
        scheduleBlink(after: caretsShown ? CaretBlink.onPeriod : CaretBlink.offPeriod)
    }

    func observeWindowState(moving newWindow: NSWindow?) {
        let center = NotificationCenter.default
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification, NSWindow.didChangeOcclusionStateNotification] {
            center.removeObserver(self, name: name, object: nil)
            if let newWindow { center.addObserver(self, selector: #selector(windowStateDidChange), name: name, object: newWindow) }
        }
        if newWindow == nil, case .blinking(let timer) = blink {
            timer.invalidate()
            blink = .idle
        }
    }

    @objc private func windowStateDidChange() {
        updateBlink()
        guard store.lineCount > 0 else { return }
        for selection in selections.selections where !selection.isEmpty {
            invalidate(lines: store.line(at: selection.lower)...store.line(at: selection.upper))
        }
    }

    override func viewWillMove(toSuperview newSuperview: NSView?) {
        super.viewWillMove(toSuperview: newSuperview)
        let center = NotificationCenter.default
        center.removeObserver(self, name: NSView.boundsDidChangeNotification, object: nil)
        center.removeObserver(self, name: NSView.frameDidChangeNotification, object: nil)
        guard let clip = newSuperview as? NSClipView else { return }
        clip.postsBoundsChangedNotifications = true
        clip.postsFrameChangedNotifications = true
        center.addObserver(self, selector: #selector(clipBoundsDidChange), name: NSView.boundsDidChangeNotification, object: clip)
        center.addObserver(self, selector: #selector(clipFrameDidChange), name: NSView.frameDidChangeNotification, object: clip)
    }

    @objc private func clipBoundsDidChange() {
        followViewport()
        clipDidScroll()
        onViewportChange?()
    }
    @objc private func clipFrameDidChange() {
        fitFrame()
        followViewport()
    }

    func followViewport() {
        let visible = visibleRect
        guard canvas.frame != visible || canvas.bounds.origin != visible.origin else { return }
        canvas.frame = visible
        canvas.bounds = visible
        canvas.placeSurface()
    }

    override var needsDisplay: Bool {
        get { canvas.needsDisplay }
        set { canvas.needsDisplay = newValue }
    }

    override func setNeedsDisplay(_ invalidRect: NSRect) {
        let rect = invalidRect.intersection(canvas.bounds)
        if !rect.isEmpty { canvas.setNeedsDisplay(rect) }
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        followViewport()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        updateBlink()
    }

    override func viewDidHide() {
        super.viewDidHide()
        updateBlink()
    }

    override func viewDidUnhide() {
        super.viewDidUnhide()
        updateBlink()
    }

    override func becomeFirstResponder() -> Bool {
        guard super.becomeFirstResponder() else { return false }
        focusDidChange(to: true)
        return true
    }

    override func resignFirstResponder() -> Bool {
        guard super.resignFirstResponder() else { return false }
        if composition != nil { commitComposition() }
        focusDidChange(to: false)
        onFocusLeave?()
        return true
    }

    private func focusDidChange(to focused: Bool) {
        updateBlink(isFirstResponder: focused)
        for selection in selections.selections where !selection.isEmpty {
            invalidate(lines: store.line(at: selection.lower)...store.line(at: selection.upper))
        }
    }
}
