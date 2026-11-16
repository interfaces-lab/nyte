import AppKit
@testable import NyteUI

extension KitCheck {
    static let bigFile = 10_000

    func codeView() {
        let window = KitProbeWindow(size: NSSize(width: 420, height: 220))
        let view = CodeView()
        window.place(view, at: .zero, size: NSSize(width: 420, height: 220))
        let go = Language.detect(fileName: "hub.go")
        let lines = ["still inside the comment", "*/", "func run() {}"]
        let carried = CodeViewSource(name: "hub.go", language: go, firstLine: 40, lines: lines,
                                     entryState: CodeViewSource.state(after: ["/*", "Hub fans out."], language: go))
        view.show(carried)
        let firstInk = { () -> NSColor? in
            let runs = CTLineGetGlyphRuns(view.canvas.ctLine(0)) as? [CTRun] ?? []
            let attributes = runs.first.map { CTRunGetAttributes($0) as NSDictionary }
            return attributes?[NSAttributedString.Key.foregroundColor] as? NSColor
        }
        let carriedInk = firstInk()
        let carriedFont = (CTLineGetGlyphRuns(view.canvas.ctLine(0)) as? [CTRun])?.first
            .flatMap { (CTRunGetAttributes($0) as NSDictionary)[NSAttributedString.Key.font] as? NSFont }
        view.show(CodeViewSource(language: go, firstLine: 40, lines: lines))
        let freshInk = firstInk()
        let comment = resolved(SyntaxColor.comment.color)
        expect("Code view: a window that starts mid-comment draws comment ink and slant from the carried state",
               resolved(carriedInk) == comment && carriedFont == TextStyle.code.slantedFont(flippedTextMatrix: true) && resolved(freshInk) != comment,
               "\(String(describing: carriedInk)) \(String(describing: freshInk))")
                expect("Code view: a text area to accessibility, named for its source, with the text as value",
               view.canvas.accessibilityRole() == .textArea && carried.name == "hub.go"
                   && (view.canvas.accessibilityValue() as? String)?.hasPrefix("still inside") == true)
        view.show(CodeViewSource(language: go, lines: ["// llllllll"]))
        view.layoutSubtreeIfNeeded()
        expect("Code view: comments lean forward under the flipped Core Text matrix", lean(of: view.canvas) > 0,
               "\(lean(of: view.canvas))")

        var asked = Set<Int>()
        let big = { (state: ((Int) -> UInt8?)?) -> CodeViewSource in
            var source = CodeViewSource(name: "big.go", language: go, lineCount: Self.bigFile) { index in
                asked.insert(index)
                return "\tvalue := compute(\(index)) // line \(index)"
            }
            source.state = state
            return source
        }
        let narrowGutter = view.gutter.thickness
        view.show(big(nil))
        view.layoutSubtreeIfNeeded()
        drawVisible(view)
        expect("Code view: lines come from the closure only for what is drawn", !asked.isEmpty && asked.count < 40, "\(asked.count)")
        expect("Code view: the gutter widens for five-digit line numbers, and the code starts clear of it",
               view.gutter.thickness > narrowGutter && view.gutter.frame.maxX == view.scrollView.frame.minX,
               "\(narrowGutter) → \(view.gutter.thickness), \(view.gutter.frame) \(view.scrollView.frame)")
        asked = []
        let far = CodeMark(line: 7_000, start: 1, end: 6, isCurrent: true)
        view.show(big { _ in LexState.normal }, marks: [far])
        view.layoutSubtreeIfNeeded()
        drawVisible(view)
        let visible = view.scrollView.contentView.bounds
        expect("Code view: the current mark is revealed, and a host's line states spare the lexer the lines above",
               visible.intersects(view.canvas.rect(of: far)) && asked.count < 60, "\(visible) \(asked.count)")

        let wide = ["short", String(repeating: "wide ", count: 60), "end"]
        view.show(CodeViewSource(language: go, lines: wide))
        view.layoutSubtreeIfNeeded()
        expect("Code view: the canvas grows to its widest line for sideways scrolling", view.canvas.frame.width > 600,
               "\(view.canvas.frame.width)")
        let canvas = view.canvas
        let start = NSPoint(x: CodeCanvas.textInset, y: canvas.top(ofLine: 0) + 4)
        let end = NSPoint(x: CodeCanvas.textInset + canvas.x(of: 4, inLine: 1), y: canvas.top(ofLine: 1) + 4)
        click(canvas, at: start, releaseAt: end)
        let dragged = canvas.selectedText
        canvas.keyDown(with: key(Keys.letterA, .command, in: window))
        expect("Code view: dragging selects across lines; Command-A selects the whole window",
               dragged == "short\nwide" && canvas.selectedText == wide.joined(separator: "\n") && window.firstResponder === canvas,
               "\(dragged.debugDescription)")
        let copy = NSMenuItem(title: "Copy", action: #selector(CodeCanvas.copy(_:)), keyEquivalent: "c")
        expect("Code view: Copy is enabled with a selection", canvas.validateMenuItem(copy))
        click(canvas, at: start, modifiers: [])
        expect("Code view: a click clears the selection", canvas.selectedText.isEmpty && !canvas.validateMenuItem(copy))
        let word = NSPoint(x: CodeCanvas.textInset + canvas.x(of: 7, inLine: 1), y: start.y + CodeCanvas.style.lineHeight)
        NSApp.postEvent(mouse(.leftMouseUp, at: word, in: canvas, clicks: 2), atStart: false)
        canvas.mouseDown(with: mouse(.leftMouseDown, at: word, in: canvas, clicks: 2))
        NSApp.discardEvents(matching: .any, before: nil)
        expect("Code view: a double click selects a word", canvas.selectedText == "wide", canvas.selectedText.debugDescription)
        view.clear("Select a result to preview it")
        expect("Code view: clearing hides the code and shows the message", view.scrollView.isHidden && view.source == nil)
        window.makeFirstResponder(nil)
        window.close()
    }

    func resolved(_ color: NSColor?) -> String {
        var text = ""
        NSAppearance(named: .aqua)?.performAsCurrentDrawingAppearance {
            text = color?.usingColorSpace(.sRGB).map { String(format: "%.3f %.3f %.3f", $0.redComponent, $0.greenComponent, $0.blueComponent) } ?? "none"
        }
        return text
    }

    func lean(of canvas: CodeCanvas) -> Int {
        let line = NSRect(x: CodeCanvas.textInset + canvas.x(of: 3, inLine: 0), y: canvas.top(ofLine: 0), width: Space.x8,
                          height: CodeCanvas.style.lineHeight)
        guard let rep = canvas.bitmapImageRepForCachingDisplay(in: line) else { return 0 }
        canvas.cacheDisplay(in: line, to: rep)
        let inked = { (x: Int, y: Int) in (rep.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.5 }
        let rows = (0..<rep.pixelsHigh).filter { y in (0..<rep.pixelsWide).contains { inked($0, y) } }
        guard let top = rows.first, let bottom = rows.last else { return 0 }
        let left = { (y: Int) in (0..<rep.pixelsWide).first { inked($0, y) } ?? 0 }
        return left(top) - left(bottom)
    }

    func drawVisible(_ view: CodeView) {
        let visible = view.scrollView.contentView.documentVisibleRect
        guard let rep = view.canvas.bitmapImageRepForCachingDisplay(in: visible) else { return }
        view.canvas.cacheDisplay(in: visible, to: rep)
    }

    func toolWindow() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 240))
        let tool = ToolWindowView(header: .pane, footer: .compact)
        var keys = 0, widths = 0
        tool.onKey = { _ in keys += 1; return true }
        tool.onWidthChange = { widths += 1 }
        let list = ListView()
        list.rowCount = { 60 }
        list.content = { RowContent(title: "Row \($0)") }
        Pin.fill(list, in: tool.content)
        tool.follow(list.scrollView)
        window.place(tool, at: .zero, size: NSSize(width: 320, height: 240))
        list.reload()
        tool.layoutSubtreeIfNeeded()
        expect("Tool window: a 36pt header, a 28pt footer, content between",
               tool.header.frame.height == Metric.paneHeader && tool.footer.frame.height == Metric.tab
                   && tool.content.frame.height == 240 - Metric.paneHeader - Metric.tab,
               "\(tool.header.frame) \(tool.footer.frame) \(tool.content.frame)")
        let atTop = (tool.headerLine.line.isHidden, tool.footerLine.line.isHidden)
        list.scrollView.contentView.scroll(to: NSPoint(x: 0, y: Metric.row * 5))
        list.scrollView.reflectScrolledClipView(list.scrollView.contentView)
        let scrolled = tool.headerLine.line.isHidden
        list.scrollView.contentView.scroll(to: NSPoint(x: 0, y: Metric.row * 60))
        list.scrollView.reflectScrolledClipView(list.scrollView.contentView)
        let atBottom = tool.footerLine.line.isHidden
        expect("Tool window: the header rule shows only while scrolled; the footer rule only while rows sit below",
               atTop == (true, false) && !scrolled && atBottom, "\(atTop) \(scrolled) \(atBottom)")
        tool.headerRule = .always
        list.scrollView.contentView.scroll(to: .zero)
        list.scrollView.reflectScrolledClipView(list.scrollView.contentView)
        let always = !tool.headerLine.line.isHidden
        tool.headerStrip = .compact
        tool.footerStrip = .hidden
        tool.layoutSubtreeIfNeeded()
        expect("Tool window: a compact header, a rule that always shows, a footer that hides",
               always && tool.header.frame.height == Metric.tab && tool.footer.isHidden && tool.footerLine.line.isHidden
                   && tool.content.frame.minY == 0, "\(tool.header.frame) \(tool.content.frame)")
        tool.keyDown(with: key(Keys.letterR, in: window))
        tool.setFrameSize(NSSize(width: 300, height: 240))
        expect("Tool window: key and width callbacks", keys == 1 && widths >= 1, "\(keys) \(widths)")
        window.close()
    }

    func borderlessTextArea() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 300))
        let area = TextArea(placeholder: "Ask the agent", textStyle: .prose, chrome: .borderless, minimumLines: 1, maximumLines: 8)
        var focus: [Bool] = []
        area.onFocusChange = { focus.append($0) }
        window.place(area, at: NSPoint(x: 10, y: 10), size: NSSize(width: 300, height: TextStyle.prose.lineHeight))
        area.translatesAutoresizingMaskIntoConstraints = false
        area.widthAnchor.constraint(equalToConstant: 300).isActive = true
        let heights = [1, 3].map { lines -> CGFloat in
            area.string = Array(repeating: "line", count: lines).joined(separator: "\n")
            window.contentView?.layoutSubtreeIfNeeded()
            return area.textView.enclosingScrollView?.frame.height ?? 0
        }
        expect("TextArea borderless: no inset, grows a prose line at a time",
               heights == [TextStyle.prose.lineHeight, TextStyle.prose.lineHeight * 3] && area.textView.textContainerInset == .zero,
               "\(heights)")
        area.string = ""
        let typingFont = area.textView.typingAttributes[.font] as? NSFont
        expect("TextArea: typing stays in the chosen style after the host clears it", typingFont == TextStyle.prose.font())
        window.makeFirstResponder(area.textView)
        window.makeFirstResponder(nil)
        expect("TextArea: reports focus so a host can ring its own surface", focus == [true, false], "\(focus)")
        expect("TextArea: the placeholder reaches accessibility", area.textView.accessibilityPlaceholderValue() == "Ask the agent")
        window.close()
    }

    func chips() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 100))
        let first = Chip("hub.go:41-58"), second = Chip("client.go"), label = Chip("+3")
        var removed: [String] = [], pressed = 0, peeks: [Bool] = []
        for chip in [first, second] {
            chip.alwaysFocusable = true
            chip.onPress = { pressed += 1 }
            chip.onRemove = { [weak chip] in
                removed.append(chip?.title ?? "")
                chip?.removeFromSuperview()
            }
        }
        first.onPeek = { peeks.append($0) }
        window.place(first, at: NSPoint(x: 10, y: 10))
        window.place(second, at: NSPoint(x: 160, y: 10))
        window.place(label, at: NSPoint(x: 300, y: 10))
        first.nextKeyView = second
        second.nextKeyView = first
        expect("Chip: a button to accessibility when it opens something, text when it is only a label, with a Remove action",
               first.accessibilityRole() == .button && label.accessibilityRole() == .staticText
                   && first.accessibilityCustomActions()?.map(\.name) == ["Remove"] && label.accessibilityCustomActions() == nil)
        let cross = first.removeTarget
        expect("Chip: the remove target is a 16pt square inside the chip",
               cross.width == Size.xxs.height && first.bounds.contains(cross), "\(cross)")
        first.toolTip = "internal/hub.go"
        expect("Chip: the cross has its own tooltip; the rest keeps the host's",
               first.view(first, stringForToolTip: 0, point: NSPoint(x: cross.midX, y: cross.midY), userData: nil) == "Remove"
                   && first.view(first, stringForToolTip: 0, point: NSPoint(x: 4, y: 4), userData: nil) == "internal/hub.go")
        click(first, at: NSPoint(x: 6, y: first.bounds.midY))
        click(first, at: NSPoint(x: cross.midX, y: cross.midY), releaseAt: NSPoint(x: cross.midX, y: first.bounds.maxY + 20))
        expect("Chip: a click on the body presses; leaving the cross before release cancels",
               pressed == 1 && removed.isEmpty, "\(pressed) \(removed)")
        first.mouseEntered(with: mouse(.mouseMoved, at: NSPoint(x: 4, y: 4), in: first))
        first.mouseExited(with: mouse(.mouseMoved, at: NSPoint(x: -4, y: 4), in: first))
        window.makeFirstResponder(first)
        first.keyDown(with: key((code: 51, text: "\u{7F}"), .command, in: window))
        let commandKept = removed.isEmpty
        first.keyDown(with: key((code: 51, text: "\u{7F}"), in: window))
        expect("Chip: Delete removes a focused chip (Command-Delete does not), and focus moves to its neighbour",
               commandKept && removed == ["hub.go:41-58"] && window.firstResponder === second,
               "\(removed) \(String(describing: window.firstResponder))")
        expect("Chip: hovering and focusing peek, leaving hides the peek", peeks.first == true && peeks.contains(false), "\(peeks)")
        second.isEnabled = false
        second.keyDown(with: key((code: 51, text: "\u{7F}"), in: window))
        expect("Chip: a disabled chip refuses removal from keys and accessibility, and is disabled to accessibility",
               !second.accessibilityPerformDelete() && removed.count == 1 && !second.isAccessibilityEnabled())
        second.isEnabled = true
        expect("Chip: accessibility can delete it", second.accessibilityPerformDelete() && removed == ["hub.go:41-58", "client.go"])
        window.close()
    }
}
