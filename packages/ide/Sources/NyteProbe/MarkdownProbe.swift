import AppKit
@testable import NyteDiagrams
@testable import NyteUI

@MainActor func runMarkdownProbe(_ arguments: [String]) {
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
    UserDefaults.standard.setVolatileDomain(["NSScrollAnimationEnabled": false], forName: UserDefaults.argumentDomain)
    application.finishLaunching()
    setvbuf(stdout, nil, _IOLBF, 0)
    Diagrams.install()
    let check = MarkdownCheck()
    switch arguments.first {
    case "check": check.run()
    case "cost": check.cost()
    default: fail("usage: NyteProbe markdown check | cost")
    }
    print(check.failures == 0 ? "markdown \(arguments[0]): all \(check.passes) passed" : "markdown \(arguments[0]): \(check.failures) failed, \(check.passes) passed")
    exit(check.failures == 0 ? 0 : 1)
}

@MainActor final class MarkdownProbeWindow: NSWindow {
    init(size: NSSize, dark: Bool = false) {
        super.init(contentRect: NSRect(origin: NSPoint(x: -30_000, y: -30_000), size: size), styleMask: [.borderless],
                   backing: .buffered, defer: false)
        isReleasedWhenClosed = false
        appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        contentView = NSView(frame: NSRect(origin: .zero, size: size))
    }

    override var isKeyWindow: Bool { true }
}

struct SplitMix {
    var state: UInt64
    mutating func next(_ range: ClosedRange<Int>) -> Int {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return range.lowerBound + Int((z ^ (z >> 31)) % UInt64(range.count))
    }
}

@MainActor final class MarkdownCheck {
    var failures = 0
    var passes = 0
    static let width: CGFloat = 368

    func expect(_ label: String, _ condition: Bool, _ got: @autoclosure () -> String = "") {
        if condition {
            passes += 1
            print("ok   \(label)")
            return
        }
        failures += 1
        let detail = got()
        print("FAIL \(label)" + (detail.isEmpty ? "" : "\n     got: \(detail)"))
    }

    func spin(until condition: () -> Bool, seconds: TimeInterval = 10) {
        let deadline = Date().addingTimeInterval(seconds)
        while !condition(), Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
    }

    func mount(_ markdown: String, width: CGFloat = width, body: TextStyle = .prose, dark: Bool = false) -> (MarkdownView, NSWindow) {
        let view = MarkdownView(body: body)
        view.update(markdown)
        let height = max(1, MarkdownView.height(for: markdown, width: width, body: body))
        let window = MarkdownProbeWindow(size: NSSize(width: width, height: height), dark: dark)
        view.frame = NSRect(x: 0, y: 0, width: width, height: height)
        view.onHeightChange = { [weak view, weak window] in
            guard let view else { return }
            let next = MarkdownView.height(for: view.markdown, width: width, body: body)
            view.frame.size.height = next
            window?.setContentSize(NSSize(width: width, height: next))
        }
        window.contentView?.addSubview(view)
        view.layoutSubtreeIfNeeded()
        return (view, window)
    }

    func run() {
        documentation()
        hover()
        overflow()
        selection()
        links()
        streaming()
        accessibility()
        diagrams()
        diagramFit()
    }

    static let docs = """
    ```go
    func (h *Hub) Broadcast(ctx context.Context, msg []byte, opts ...BroadcastOption) (sent int, err error)
    ```

    Broadcast sends `msg` to every client. A full client is **skipped**.

    - Safe from any goroutine.
    - See [Hub.Run](https://pkg.go.dev) for the loop.

    | Return | Meaning |
    |--------|---------|
    | `0` | No client was ready |
    | `n` | `n` clients got the message |
    """

    func documentation() {
        let prose = Prose.render(Self.docs, body: .base)
        var blocks: [NSTextTableBlock] = []
        prose.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: prose.length)) { value, _, _ in
            for case let block as NSTextTableBlock in (value as? NSParagraphStyle)?.textBlocks ?? [] where !blocks.contains(block) {
                blocks.append(block)
            }
        }
        expect("docs: Prose.render draws the table as a text table, not pipes", !prose.string.contains("|") && !prose.string.contains("---"),
               prose.string)
        expect("docs: Prose table has 2 columns and 3 rows", blocks.first?.table.numberOfColumns == 2 && Set(blocks.map(\.startingRow)) == [0, 1, 2],
               "\(blocks.count) cells")
        let (view, window) = mount(Self.docs, width: 396, body: .base)
        defer { window.close() }
        let table = view.layoutEngine.blocks.first { view.layoutEngine.document.kinds[$0] == .table }
        let grid = table.map { view.layoutEngine.grid($0, width: 396) }
        let cells = grid.map { grid in grid.cells.indices.map(grid.cellText) } ?? []
        let proseCells = blocks.compactMap { block -> String? in
            var found: String?
            prose.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: prose.length)) { value, range, stop in
                guard (value as? NSParagraphStyle)?.textBlocks.first === block else { return }
                found = (prose.string as NSString).substring(with: range).trimmingCharacters(in: .newlines)
                    .replacingOccurrences(of: "\u{2060}", with: "").replacingOccurrences(of: "\u{200B}", with: "")
                stop.pointee = true
            }
            return found
        }
        expect("docs: MarkdownView and Prose agree on every table cell", cells == proseCells && cells.count == 6, "\(cells) vs \(proseCells)")
        expect("docs: Prose keeps the fenced code as code without fences", prose.string.contains("func (h *Hub) Broadcast") && !prose.string.contains("```"))
        expect("docs: Prose renders list items with markers", prose.string.contains("\u{2022}\tSafe from any goroutine."))
        expect("docs: code in a hover-width view gets its copy button",
               view.realized.values.contains { ($0 as? CodePanel)?.subviews.contains { $0 is Button && !$0.isHidden } == true })
    }

    func hover() {
        for width: CGFloat in [280, 350, 420] {
            let view = DocumentationView()
            view.language = "go"
            view.show(notes: [], markdown: Self.docs)
            let size = view.fittingSize(maxWidth: width, maxHeight: 200)
            let window = MarkdownProbeWindow(size: size)
            defer { window.close() }
            view.frame = NSRect(origin: .zero, size: size)
            window.contentView?.addSubview(view)
            view.layoutSubtreeIfNeeded()
            guard let scroll = view.subviews.compactMap({ $0 as? NSScrollView }).first, let body = scroll.documentView as? MarkdownView
            else { return expect("hover \(Int(width)): body is a MarkdownView in a scroll view", false) }
            let inner = width - DocumentationView.inset * 2
            let content = MarkdownView.height(for: body.markdown, width: inner, body: .base)
            expect("hover \(Int(width)): sizes to its width and content", size.width == width && body.frame.width == inner
                && body.frame.height == content && size.height == min(200, (content + DocumentationView.verticalInset * 2).rounded(.up)),
                   "\(size) body \(body.frame.size) content \(content)")
            let code = body.realized.values.compactMap { $0 as? CodePanel }.first
            let side = code.flatMap { Self.find(SideScroll.self, in: $0) }
            expect("hover \(Int(width)): the long signature wraps at the panel's width with no horizontal scroller", code.map { $0.frame.maxX <= inner && $0.wraps && $0.frame.height > CodePanel.height(lines: 1, note: false, compact: true) } == true && side?.overflows == false && side?.hasHorizontalScroller == false)
            let inside = code.flatMap { panel in panel.subviews.compactMap { $0 as? SideScroll }.first }
            let chain = sequence(first: inside as NSResponder?) { $0?.nextResponder }.prefix(12).compactMap { $0 }
            let wheeled = chain.contains { $0 === scroll } && !(inside?.hasVerticalScroller ?? true)
            scroll.contentView.scroll(to: NSPoint(x: 0, y: body.frame.height - scroll.contentSize.height))
            scroll.reflectScrolledClipView(scroll.contentView)
            body.layoutSubtreeIfNeeded()
            let table = body.realized.values.compactMap { $0 as? TablePanel }.first
            expect("hover \(Int(width)): a vertical wheel over code passes up to the hover's scroller, and the table is realized at the end",
                   content <= 200 || (wheeled && table.map { $0.frame.intersects(body.visibleRect) && $0.frame.maxX <= inner } == true),
                   "wheeled \(wheeled), table \(String(describing: table?.frame)) visible \(body.visibleRect)")
        }
    }

    func overflow() {
        let long = "```go\n" + String(repeating: "veryLongIdentifier := compute(", count: 8) + "\n```\n\n| Benchmark | M1 | M3 | Linux | Notes |\n|---|---|---|---|---|\n"
            + "| Parse | 1.9 ms | 1.2 ms | 2.4 ms | md4c, cold cache |\n| First layout | 14 ms | 9 ms | n/a | TextKit 1, one container, ensureLayout over the whole document |\n"
        let (view, window) = mount(long)
        defer { window.close() }
        var masks = 0
        var faded = 0
        func walk(_ node: NSView) {
            if node.layer?.mask != nil { masks += 1 }
            if node.alphaValue < 1 { faded += 1 }
            node.subviews.forEach(walk)
        }
        let code = view.realized.values.compactMap { $0 as? CodePanel }.first
        let scroll = code.flatMap { panel in panel.subviews.compactMap { $0 as? SideScroll }.first }
        scroll?.contentView.scroll(to: NSPoint(x: 120, y: 0))
        scroll?.reflectScrolledClipView(scroll?.contentView ?? NSClipView())
        walk(view)
        expect("overflow: no view fades or masks its ink", masks == 0 && faded == 0, "\(masks) masks, \(faded) faded")
        expect("overflow: long code stays one unwrapped line and scrolls", scroll?.overflows == true && scroll?.documentVisibleRect.minX == 120,
               "\(String(describing: scroll?.documentVisibleRect))")
        expect("overflow: the code scroller follows the system style", scroll?.hasHorizontalScroller == true
            && scroll?.scrollerStyle == NSScroller.preferredScrollerStyle)
        let table = view.realized.values.compactMap { $0 as? TablePanel }.first
        guard let table, let grid = table.grid, let tableScroll = table.subviews.first as? SideScroll else { return expect("overflow: table panel realized", false) }
        expect("overflow: the wide table scrolls instead of squeezing columns", grid.overflows && (grid.columns.last ?? 0) > TableGrid.maxColumn,
               "\(grid.columns)")
        let oneLine = grid.lineHeight + grid.padding * 2
        let shortRow = grid.rows[1] == oneLine
        expect("overflow: hidden columns do not make visible rows tall", shortRow && grid.rows.allSatisfy { $0 == oneLine }, "\(grid.rows)")
        tableScroll.contentView.scroll(to: NSPoint(x: 90, y: 0))
        tableScroll.reflectScrolledClipView(tableScroll.contentView)
        let canvas = tableScroll.documentView as? TableCanvas
        expect("overflow: the first column stays in place while the table scrolls",
               canvas?.shown(grid.cellRect(0), column: 0).minX == 90 && canvas?.shown(grid.cellRect(1), column: 1).minX == grid.columnStarts[1])
    }

    static let mixed = "Start of the selection here.\n\n- first item\n- second item\n\n```swift\nlet answer = 42\nprint(answer)\n```\n\n| Key | Value |\n|---|---|\n| a | 1 |\n\nEnd of the selection."

    func selection() {
        let (view, window) = mount(Self.mixed)
        defer { window.close() }
        let text = view.textView
        let length = text.textStorage?.length ?? 0
        let start = text.layoutManager?.boundingRect(forGlyphRange: NSRange(location: 0, length: 1), in: text.textContainer ?? NSTextContainer()) ?? .zero
        let end = text.layoutManager?.boundingRect(forGlyphRange: NSRange(location: max(0, length - 1), length: 1), in: text.textContainer ?? NSTextContainer()) ?? .zero
        func mouse(_ type: NSEvent.EventType, _ point: NSPoint) -> NSEvent? {
            NSEvent.mouseEvent(with: type, location: text.convert(point, to: nil), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        }
        let from = NSPoint(x: start.minX + 1, y: start.midY)
        let to = NSPoint(x: end.maxX + 1, y: end.midY)
        for event in [mouse(.leftMouseDragged, to), mouse(.leftMouseUp, to)].compactMap({ $0 }) { NSApp.postEvent(event, atStart: false) }
        if let down = mouse(.leftMouseDown, from) { window.makeFirstResponder(text); text.mouseDown(with: down) }
        let range = text.selectedRange()
        expect("select: one drag spans paragraphs, list, code and table", range.location == 0 && range.length >= length - 1, "\(range) of \(length)")
        let board = NSPasteboard(name: NSPasteboard.Name("nyte.markdown.check.\(getpid())"))
        defer { board.releaseGlobally() }
        _ = text.writeSelection(to: board, types: text.writablePasteboardTypes)
        let plain = board.string(forType: .string) ?? ""
        let source = board.string(forType: MarkdownPasteboard.markdownType) ?? ""
        expect("copy: plain text holds every block in order",
               plain == "Start of the selection here.\n\n\u{2022} first item\n\u{2022} second item\n\nlet answer = 42\nprint(answer)\n\nKey\tValue\na\t1\n\nEnd of the selection.",
               plain.debugDescription)
        expect("copy: the Markdown flavour is the original source", source == Self.mixed, source.debugDescription)
        let item = NSMenuItem(title: "", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        expect("copy: after the drag the text view is first responder and validates ⌘C's copy:", window.firstResponder === text
            && NSApp.target(forAction: #selector(NSText.copy(_:)), to: text, from: nil) as AnyObject === text && text.validateUserInterfaceItem(item)
            && item.title == "Copy")
        let markdownItem = NSMenuItem(title: "", action: #selector(MarkdownTextView.copyAsMarkdown(_:)), keyEquivalent: "")
        expect("copy: Copy as Markdown validates with its title", text.validateUserInterfaceItem(markdownItem) && markdownItem.title == "Copy as Markdown")
        text.setSelectedRange(NSRange(location: 0, length: 0))
        expect("copy: Copy is disabled without a selection", !text.validateUserInterfaceItem(item))
        let code = view.realized.values.compactMap { $0 as? CodePanel }.first
        expect("copy: the code block's button copies its source exactly", code?.code == "let answer = 42\nprint(answer)"
            && code?.subviews.contains { $0 is Button && !$0.isHidden && $0.accessibilityLabel() == "Copy" } == true)
    }

    func links() {
        let (view, window) = mount("Read [the guide](https://example.com/guide) and [the spec](https://example.com/spec).")
        defer { window.close() }
        var opened: [String] = []
        view.onOpenLink = { opened.append($0.absoluteString) }
        let text = view.textView
        expect("links: link text shows the pointing-hand cursor", (text.linkTextAttributes?[.cursor] as? NSCursor) == .pointingHand)
        window.makeFirstResponder(text)
        func key(_ code: UInt16, _ characters: String, _ flags: NSEvent.ModifierFlags = []) -> NSEvent? {
            NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                             windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters,
                             isARepeat: false, keyCode: code)
        }
        let links = text.linkRanges
        key(48, "\t").map(text.keyDown)
        let first = text.selectedRange()
        key(48, "\t").map(text.keyDown)
        let second = text.selectedRange()
        key(36, "\r").map(text.keyDown)
        expect("links: Tab moves through links from the keyboard", links.count == 2 && first == links[0] && second == links[1], "\(first) \(second) \(links)")
        expect("links: Return opens the focused link through the host's closure", opened == ["https://example.com/spec"], "\(opened)")
        let elements = (view.accessibilityChildren() ?? []).compactMap { $0 as? NSAccessibilityElement }.filter { $0.accessibilityRole() == .link }
        _ = elements.first?.accessibilityPerformPress()
        expect("links: VoiceOver sees both links and can press them", elements.map { $0.accessibilityLabel() ?? "" } == ["the guide", "the spec"]
            && opened.last == "https://example.com/guide")
    }

    static func longDocument(_ seed: Int) -> String {
        var random = SplitMix(state: UInt64(seed))
        return (0 ..< 24).map { index in
            switch random.next(0 ... 5) {
            case 0: "## Section \(index)\n\nThis paragraph has **bold**, `code` and a [link](https://example.com/\(index)) in it, and runs on for a while."
            case 1: (1 ... 12).map { "\($0). Item \($0) of the plan\n   - nested detail \($0)" }.joined(separator: "\n")
            case 2: "```ts\n" + (0 ..< 30).map { "const value\($0) = compute(\($0));" }.joined(separator: "\n") + "\n```"
            case 3: "| Name | Count |\n|---|---:|\n" + (0 ..< 8).map { "| row \($0) | \($0 * 7) |" }.joined(separator: "\n")
            case 4: "> [!WARNING]\n> Stream carefully, item \(index).\n\n> A quote with *emphasis*."
            default: "- [x] done \(index)\n- [ ] open \(index)\n\n---"
            }
        }.joined(separator: "\n\n")
    }

    func rects(_ view: MarkdownView) -> [NSRect] { (0 ..< view.layoutEngine.document.count).map { LayoutBox.rect(view.layoutEngine, $0) } }

    func streaming() {
        for seed in 1 ... 3 {
            let full = Self.longDocument(seed)
            let (view, window) = mount("")
            window.setContentSize(NSSize(width: Self.width, height: 3000))
            var random = SplitMix(state: UInt64(seed * 97))
            var shown = ""
            var index = full.startIndex
            var counts: [Int] = []
            var moved = 0
            var widened = 0
            var swapped = 0
            while index < full.endIndex {
                let next = full.index(index, offsetBy: random.next(1 ... 24), limitedBy: full.endIndex) ?? full.endIndex
                shown += full[index ..< next]
                index = next
                let before = rects(view)
                let previous = view.layoutEngine.document
                let panels = view.realized
                view.update(shown)
                view.frame.size.height = view.contentHeight
                view.layoutSubtreeIfNeeded()
                let engine = view.layoutEngine
                let first = engine.rebuilt.lowerBound
                counts.append(engine.rebuilt.count)
                let changed = (0 ..< engine.document.count).first { !engine.document.leafMatches($0, in: previous) } ?? engine.document.count
                if first < changed { widened += 1 }
                let after = rects(view)
                moved += (0 ..< min(first, before.count)).filter { before[$0] != after[$0] }.count
                swapped += panels.filter { $0.key < first && after[$0.key].intersects(view.visibleRect) && view.realized[$0.key] !== $0.value }.count
            }
            let oneShot = MarkdownView()
            oneShot.update(full)
            oneShot.frame = NSRect(x: 0, y: 0, width: Self.width, height: MarkdownView.height(for: full, width: Self.width))
            oneShot.layoutSubtreeIfNeeded()
            let same = view.layoutEngine.document.count == oneShot.layoutEngine.document.count
                && (0 ..< oneShot.layoutEngine.document.count).allSatisfy { oneShot.layoutEngine.document.leafMatches($0, in: view.layoutEngine.document) }
            expect("stream \(seed): \(counts.count) appends end in the same block tree as one render", same
                && view.layoutEngine.storage.string == oneShot.layoutEngine.storage.string)
            expect("stream \(seed): same heights and block rects as one render", view.contentHeight == oneShot.contentHeight && rects(view) == rects(oneShot),
                   "\(view.contentHeight) vs \(oneShot.contentHeight)")
            expect("stream \(seed): no block above the one being written moved or changed height", moved == 0, "\(moved) moved")
            expect("stream \(seed): finished blocks keep their panels", swapped == 0, "\(swapped) swapped")
            let sorted = counts.sorted()
            print("note stream \(seed): \(view.layoutEngine.document.count) blocks; re-laid-out per append median \(sorted[sorted.count / 2]), "
                + "p95 \(sorted[sorted.count * 95 / 100]), max \(sorted.last ?? 0); \(widened) appends re-laid-out earlier list items because the number column widened")
            window.close()
        }
    }

    func accessibility() {
        let source = "## Setup\n\nRead [docs](https://example.com).\n\n- one\n- two\n\n```go\nfmt.Println(1)\n```\n\n| A | B |\n|---|---|\n| x | y |\n\n> [!WARNING]\n> Careful."
        let (view, window) = mount(source)
        defer { window.close() }
        let top = view.accessibilityChildren() ?? []
        func describe(_ node: Any) -> String {
            if let element = node as? NSAccessibilityElement { return (element.accessibilityRole()?.rawValue ?? "") + ":" + (element.accessibilityLabel() ?? "") }
            if let view = node as? NSView { return (view.accessibilityRole()?.rawValue ?? "") + ":" + (view.accessibilityLabel() ?? "") }
            return "?"
        }
        let order = top.map(describe)
        let expected = ["AXHeading:Setup", "AXStaticText:Read docs.", "AXLink:docs", "AXList:List", "AXGroup:Go code", "AXTable:Table, 2 rows, 2 columns", "AXGroup:Warning"]
        expect("a11y: blocks read in document order with their roles", order == expected, "\(order)")
        let heading = top.first as? NSAccessibilityElement
        expect("a11y: the heading carries its level", heading?.accessibilityValue() as? Int == 2 && heading?.accessibilityRoleDescription() == "heading level 2")
        let list = (top.count > 3 ? top[3] : nil) as? NSAccessibilityElement
        expect("a11y: list items are list items", (list?.accessibilityChildren() ?? []).map(describe) == ["AXStaticText:one, Bullet point", "AXStaticText:two, Bullet point"])
        let code = top.count > 4 ? top[4] as? NSView : nil
        expect("a11y: code reads as a code block with its source", code?.accessibilityRoleDescription() == "code block" && code?.accessibilityValue() as? String == "fmt.Println(1)")
        let table = top.count > 5 ? top[5] as? NSView : nil
        let rows = table?.accessibilityRows() as? [NSAccessibilityElement] ?? []
        expect("a11y: the table exposes rows and cells", rows.count == 2 && (rows.last?.accessibilityChildren() ?? []).map(describe) == ["AXCell:x", "AXCell:y"],
               rows.map { ($0.accessibilityChildren() ?? []).map(describe).joined(separator: ",") }.joined(separator: " | "))
        let alert = top.last as? NSAccessibilityElement
        expect("a11y: the alert names its kind", alert?.accessibilityRoleDescription() == "warning alert" && (alert?.accessibilityChildren() ?? []).map(describe) == ["AXStaticText:Careful."])
        let screen = window.convertToScreen(view.convert(view.bounds, to: nil))
        let frames = top.compactMap { ($0 as? NSAccessibilityElement)?.accessibilityFrame() ?? ($0 as? NSView)?.accessibilityFrame() }
        expect("a11y: frames sit inside the view and descend in reading order", frames.allSatisfy { screen.insetBy(dx: -1, dy: -1).contains($0) }
            && zip(frames, frames.dropFirst()).allSatisfy { $0.maxY >= $1.maxY }, "\(frames) in \(screen)")
    }

    static let specimens: [(String, String)] = [
        ("flowchart", "graph TD\n    A[Client] -->|POST /api| B{Auth}\n    B -->|valid| C[Handler]\n    B -->|invalid| D[401]\n    C --> E[(Database)]"),
        ("sequence", "sequenceDiagram\n    participant C as Client\n    participant H as Hub\n    C->>H: Broadcast(msg)\n    H-->>C: sent count\n    Note over C,H: buffered send"),
        ("class", "classDiagram\n    class Hub {\n        +map clients\n        -int count\n        +Broadcast(msg) int\n    }\n    class Client {\n        +chan send\n    }\n    Hub \"1\" --> \"*\" Client : holds"),
        ("state", "stateDiagram-v2\n    [*] --> Connecting\n    Connecting --> Open: handshake\n    Open --> Closed: read error\n    Closed --> [*]"),
        ("er", "erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    CUSTOMER {\n        string name PK\n        int age\n    }"),
    ]

    func diagrams() {
        for dark in [false, true] {
            let look: DiagramLook = dark ? .dark : .light
            let text = [Palette.contentPrimary, Palette.contentSecondary, Palette.contentTertiary].map { DiagramPalette.resolve($0, in: look) }
            let stroke = DiagramPalette.resolve(Palette.strokePrimary, in: look)
            for (name, source) in Self.specimens {
                let (view, window) = mount("```mermaid\n\(source)\n```", dark: dark)
                var canvas: DiagramCanvas?
                spin(until: {
                    view.layoutSubtreeIfNeeded()
                    canvas = view.realized.values.compactMap { Self.find(DiagramCanvas.self, in: $0) }.first { $0.drawn != nil && $0.box.width > 0 }
                    return canvas != nil
                })
                guard let canvas, let panel = canvas.enclosingScrollView?.superview,
                      let rep = panel.bitmapImageRepForCachingDisplay(in: panel.bounds)
                else { expect("contrast \(name): diagram drew", false); continue }
                panel.cacheDisplay(in: panel.bounds, to: rep)
                let region = canvas.convert(canvas.box, to: panel)
                let inks = DiagramSample(rep: rep, region: region, flipped: panel.isFlipped).inks()
                let texts = inks.filter { ink in text.contains { DiagramSample.near(ink.color, $0) } }
                let strokes = inks.filter { DiagramSample.near($0.color, stroke) }
                let worstText = texts.map(\.ratio).min() ?? 0
                let worstStroke = strokes.map(\.ratio).min() ?? 0
                print("note contrast \(name) \(dark ? "dark" : "light"): " + inks.prefix(8).map(\.summary).joined(separator: "; "))
                expect("contrast \(name) \(dark ? "dark" : "light"): text \(String(format: "%.2f", worstText)):1, outlines \(String(format: "%.2f", worstStroke)):1",
                       worstText >= 4.5 && worstStroke >= 3 && !texts.isEmpty && !strokes.isEmpty)
                window.close()
            }
        }
        let window = mount("```mermaid\ngantt\n    title Release\n```").1
        defer { window.close() }
        spin(until: { DiagramProvider.shared.failures["gantt\n    title Release"] != nil })
        expect("diagram failure says why", DiagramProvider.shared.failures["gantt\n    title Release"]?.contains("gantt diagrams aren’t supported") == true,
               DiagramProvider.shared.failures.description)
    }
    static let wideFlow = "graph LR\n    Cancel -.->|ctx.Done| Hub\n    Request --> Hub\n    Hub -->|broadcast| Writer\n    Writer -->|frame| Client\n    Client -->|ack| Store"

    func diagramFit() {
        let table: [(CGSize, CGFloat, CGFloat, DiagramFit)] = [
            (CGSize(width: 300, height: 200), 13, 376, DiagramFit(scale: 1, scrolls: false)), (CGSize(width: 440, height: 200), 13, 376, DiagramFit(scale: 0.85, scrolls: false)),
            (CGSize(width: 480, height: 200), 13, 376, DiagramFit(scale: 11 / 13, scrolls: true)), (CGSize(width: 480, height: 200), 11, 376, DiagramFit(scale: 1, scrolls: true)),
            (CGSize(width: 480, height: 200), 9, 376, DiagramFit(scale: 1, scrolls: true)), (CGSize(width: 600, height: 200), 12, 560, DiagramFit(scale: 0.93, scrolls: false)),
        ]
        for (size, text, width, want) in table {
            let got = DiagramFit.decide(size: size, smallestText: text, width: width)
            expect("fit \(Int(size.width))pt diagram, \(Int(text))pt text, \(Int(width))pt room: scale \(String(format: "%.3f", want.scale)), scrolls \(want.scrolls)",
                   abs(got.scale - want.scale) < 0.001 && got.scrolls == want.scrolls, "\(got)")
        }
        for (name, source, scrolls) in [("wide flow with labels", Self.wideFlow, true), ("narrow flow without labels", "graph LR\n    Parsing --> Measuring\n    Measuring --> Presenting", false)] {
            let (view, window) = mount("```mermaid\n\(source)\n```", width: 368)
            defer { window.close() }
            var panel: DiagramPanel?
            spin(until: {
                view.layoutSubtreeIfNeeded()
                panel = view.realized.values.compactMap { $0 as? DiagramPanel }.first
                return panel.map { DiagramProvider.shared.sizes[source] != nil && $0.cue != .none || !scrolls && DiagramProvider.shared.sizes[source] != nil } ?? false
            })
            guard let panel else { expect("fit \(name): panel realized", false); continue }
            let size = DiagramProvider.shared.sizes[source] ?? .zero
            let floor = DiagramFit.readableText / (DiagramProvider.shared.texts[source] ?? DiagramFit.readableText)
            expect("fit \(name) at 368pt: \(scrolls ? "keeps readable text and scrolls" : "scales down to fit")",
                   panel.fit.scrolls == scrolls && (scrolls ? panel.fit.scale >= min(1, floor) - 0.001 : (size.width * panel.fit.scale <= DiagramPanel.room(368))),
                   "\(panel.fit) natural \(size)")
            expect("fit \(name): \(scrolls ? "shows the trailing-edge cue and offers Expand" : "shows no cue and no Expand")",
                   scrolls ? panel.cue == .overflow(trailing: true, leading: false) && panel.offersExpand : panel.cue == .none && !panel.offersExpand,
                   "\(panel.cue), expand \(panel.offersExpand)")
            guard scrolls else { continue }
            let expanded = DiagramFit.expandedSize(diagram: size, within: CGSize(width: 1200, height: 800))
            expect("fit \(name): Expand opens at full size within the window", expanded.width == (size.width + DiagramPanel.padding * 2).rounded(.up) && expanded.height <= 800)
        }
    }
    static func find<T: NSView>(_ type: T.Type, in node: NSView) -> T? {
        if let match = node as? T { return match }
        return node.subviews.lazy.compactMap { find(type, in: $0) }.first
    }

    func cost() {
        let messages = (0 ..< 2000).map { Self.longDocument($0).split(separator: "\n\n").prefix(3).joined(separator: "\n\n") }
        let bytes = messages.reduce(0) { $0 + $1.utf8.count }
        var started = Date()
        var base = Footprint.megabytes
        let total = messages.reduce(CGFloat(0)) { $0 + MarkdownView.height(for: $1, width: Self.width) }
        print("cost transcript: 2000 messages, \(bytes / 1024) KB of Markdown, measured \(Int(total)) pt tall in \(Self.ms(started)) ms, footprint +\(Footprint.megabytes - base) MB")
        base = Footprint.megabytes
        started = Date()
        let visible = messages.prefix(12).map { mount($0) }
        print("cost transcript: 12 visible message views laid out in \(Self.ms(started)) ms, footprint +\(Footprint.megabytes - base) MB, panels realized \(visible.reduce(0) { $0 + $1.0.realized.count })")
        visible.forEach { $0.1.close() }
        let long = messages.prefix(60).joined(separator: "\n\n")
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: Self.width, height: 600))
        let view = MarkdownView()
        view.update(long)
        let window = MarkdownProbeWindow(size: scroll.frame.size)
        window.contentView?.addSubview(scroll)
        scroll.documentView = view
        view.frame = NSRect(x: 0, y: 0, width: Self.width, height: MarkdownView.height(for: long, width: Self.width))
        scroll.tile()
        scroll.layoutSubtreeIfNeeded()
        view.layoutSubtreeIfNeeded()
        let atTop = view.realized.count
        scroll.contentView.scroll(to: NSPoint(x: 0, y: view.frame.height / 2))
        view.layoutSubtreeIfNeeded()
        print("cost offscreen: one \(Int(view.frame.height)) pt view with \(view.layoutEngine.blocks.count) panel blocks in a 600 pt viewport realizes \(atTop) at the top, "
            + "\(view.realized.count) halfway down; its text is laid out whole")
        window.close()
        let code = "```swift\n" + (0 ..< 10_000).map { "let value\($0) = compute(\($0)) // line \($0)" }.joined(separator: "\n") + "\n```"
        base = Footprint.megabytes
        started = Date()
        let (codeView, codeWindow) = mount(code)
        print("cost code: 10,000 lines measured and realized in \(Self.ms(started)) ms, \(Int(codeView.contentHeight)) pt, footprint +\(Footprint.megabytes - base) MB")
        codeWindow.close()
        let table = "| Name | Count | Notes |\n|---|---:|---|\n" + (0 ..< 500).map { "| row \($0) | \($0 * 7) | note for row \($0) with `code` |" }.joined(separator: "\n")
        base = Footprint.megabytes
        started = Date()
        let (tableView, tableWindow) = mount(table)
        print("cost table: 500 rows measured and realized in \(Self.ms(started)) ms, \(Int(tableView.contentHeight)) pt, footprint +\(Footprint.megabytes - base) MB")
        if let panel = tableView.realized.values.first, let rep = panel.bitmapImageRepForCachingDisplay(in: NSRect(x: 0, y: 0, width: Self.width, height: 600)) {
            started = Date()
            panel.cacheDisplay(in: NSRect(x: 0, y: 0, width: Self.width, height: 600), to: rep)
            print("cost table: drawing a 600 pt window of it took \(Self.ms(started)) ms")
        }
        tableWindow.close()
        base = Footprint.megabytes
        let diagramWindow = mount(Self.specimens.map { "```mermaid\n\($0.1)\n```" }.joined(separator: "\n\n")).1
        spin(until: { DiagramProvider.shared.sizes.count >= Self.specimens.count })
        print("cost diagrams: \(DiagramProvider.shared.sizes.count) drawn, cache \(DiagramProvider.shared.residentBytes / 1024) KB, footprint +\(Footprint.megabytes - base) MB")
        diagramWindow.close()
    }

    static func ms(_ since: Date) -> Int { Int(Date().timeIntervalSince(since) * 1000) }
}

enum Footprint {
    static var megabytes: Int {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return result == KERN_SUCCESS ? Int(info.phys_footprint >> 20) : 0
    }
}

struct DiagramSample {
    struct Ink {
        let color: DiagramRamp.Ink
        let count: Int
        let ground: DiagramRamp.Ink
        let ratio: Double
        var summary: String { "\(DiagramSample.hex(color)) ×\(count) on \(DiagramSample.hex(ground)) \(String(format: "%.2f", ratio)):1" }
    }

    let pixels: [DiagramRamp.Ink?]
    let width: Int
    let height: Int

    init(rep: NSBitmapImageRep, region: NSRect, flipped: Bool) {
        let srgb = rep.converting(to: .sRGB, renderingIntent: .default) ?? rep
        let scale = CGFloat(srgb.pixelsWide) / rep.size.width
        let top = flipped ? region.minY : rep.size.height - region.maxY
        let x0 = Int(region.minX * scale), y0 = Int(top * scale)
        let columns = Int(region.width * scale)
        width = columns
        height = Int(region.height * scale)
        pixels = (0 ..< columns * height).map { index in
            guard let color = srgb.colorAt(x: x0 + index % columns, y: y0 + index / columns), color.alphaComponent > 0.99 else { return nil }
            let byte = { (value: CGFloat) in UInt8(max(0, min(255, (value * 255).rounded()))) }
            return DiagramRamp.Ink(red: byte(color.redComponent), green: byte(color.greenComponent), blue: byte(color.blueComponent))
        }
    }

    static func near(_ a: DiagramRamp.Ink, _ b: DiagramRamp.Ink) -> Bool {
        abs(Int(a.red) - Int(b.red)) <= 2 && abs(Int(a.green) - Int(b.green)) <= 2 && abs(Int(a.blue) - Int(b.blue)) <= 2
    }

    static func hex(_ ink: DiagramRamp.Ink) -> String { String(format: "#%02x%02x%02x", ink.red, ink.green, ink.blue) }

    static func luminance(_ ink: DiagramRamp.Ink) -> Double {
        let channel = { (value: UInt8) -> Double in
            let c = Double(value) / 255
            return c <= 0.040_45 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(ink.red) + 0.7152 * channel(ink.green) + 0.0722 * channel(ink.blue)
    }

    static func contrast(_ a: DiagramRamp.Ink, _ b: DiagramRamp.Ink) -> Double {
        let (x, y) = (luminance(a), luminance(b))
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    func inks() -> [Ink] {
        var counts: [DiagramRamp.Ink: Int] = [:]
        for case let pixel? in pixels { counts[pixel, default: 0] += 1 }
        let fills = Set(counts.filter { $0.value >= pixels.count / 50 }.keys)
        return counts.filter { !fills.contains($0.key) && $0.value >= 12 }.sorted { $0.value > $1.value }.prefix(16).compactMap { color, count in
            var grounds: [DiagramRamp.Ink: Int] = [:]
            for index in pixels.indices where pixels[index] == color {
                let (x, y) = (index % width, index / width)
                for dy in -4 ... 4 { for dx in -4 ... 4 {
                    let (nx, ny) = (x + dx, y + dy)
                    guard nx >= 0, ny >= 0, nx < width, ny < height, let near = pixels[ny * width + nx], fills.contains(near) else { continue }
                    grounds[near, default: 0] += 1
                } }
            }
            let total = grounds.values.reduce(0, +)
            let main = grounds.filter { $0.value * 10 >= total }.map { ($0.key, Self.contrast(color, $0.key)) }.min { $0.1 < $1.1 }
            guard let main else { return nil }
            return Ink(color: color, count: count, ground: main.0, ratio: main.1)
        }
    }
}

