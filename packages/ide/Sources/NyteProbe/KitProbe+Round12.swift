import AppKit
@testable import NyteUI

@MainActor final class CursorCountingWindow: KitProbeWindow {
    var cursorInvalidations = 0

    override func invalidateCursorRects(for view: NSView) {
        cursorInvalidations += 1
        super.invalidateCursorRects(for: view)
    }

    override func resetCursorRects() {
        cursorInvalidations += 1
        super.resetCursorRects()
    }
}

extension KitCheck {
    static let legibleHeight = TextStyle.base.lineHeight + Space.x1
    static let smallestTarget = Size.xs.compactHeight

    func densities() {
        Density.apply(.compact)
        let compact = [Size.sm.height, Metric.row, Metric.rowCompact, Metric.paneHeader]
        expect("Density: compact is rows 24 and 22, fields and small controls 22, headers 28",
               compact == [22, 24, 22, 28], "\(compact)")
        let legible = [Size.sm, .md, .lg, .xl].allSatisfy { $0.compactHeight >= Self.legibleHeight }
            && Metric.rowCompact >= Self.legibleHeight && Size.xs.compactHeight >= Self.smallestTarget
        expect("Density: every compact control and row keeps 13 pt text with 2 pt clear above and below", legible)
        let window = KitProbeWindow(size: NSSize(width: 400, height: 300))
        let button = Button("Run", size: .sm), input = Input(placeholder: "Filter", size: .sm), header = PaneHeader(title: "Agent")
        let tool = ToolWindowView(header: .pane)
        let list = ListView()
        list.rowCount = { 3 }
        list.content = { RowContent(title: "Row \($0)") }
        list.rowHeight = Metric.rowCompact
        let stack = NSStackView(views: [button, input, header, tool, list])
        stack.orientation = .vertical
        stack.alignment = .leading
        window.place(stack, at: .zero, size: NSSize(width: 400, height: 300))
        for view in [header, tool, list] as [NSView] { view.widthAnchor.constraint(equalToConstant: 300).isActive = true }
        tool.heightAnchor.constraint(equalToConstant: 60).isActive = true
        list.heightAnchor.constraint(equalToConstant: 80).isActive = true
        list.reload()
        let measure = { () -> [CGFloat] in
            window.contentView?.layoutSubtreeIfNeeded()
            return [button.frame.height, input.frame.height, header.frame.height, tool.header.frame.height, list.rect(ofRow: 0).height]
        }
        let before = measure()
        Density.apply(.standard)
        let after = measure()
        Density.apply(.compact)
        let back = measure()
        expect("Density: one switch resizes buttons, fields, headers, strips and rows in place, and back",
               before == [22, 22, 28, 28, 22] && after == [24, 24, 32, 32, 24] && back == before, "\(before) \(after) \(back)")
        window.close()
    }

    func fieldsOnTheme() {
        let window = KitProbeWindow(size: NSSize(width: 300, height: 100))
        let host = NSView(frame: NSRect(x: 0, y: 0, width: 260, height: 60))
        let field = Input(placeholder: "Filter symbols", variant: .quiet, size: .sm)
        host.addSubview(field)
        field.translatesAutoresizingMaskIntoConstraints = true
        field.frame = NSRect(x: 20, y: 20, width: 200, height: Size.sm.height)
        window.place(host, at: .zero, size: host.frame.size)
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return expect("Fields: render", false) }
        host.cacheDisplay(in: host.bounds, to: rep)
        let scale = CGFloat(rep.pixelsWide) / host.bounds.width
        let outside = [NSPoint(x: 120, y: 17), NSPoint(x: 120, y: 20 + Size.sm.height + 3), NSPoint(x: 17, y: 30)].map { point in
            rep.colorAt(x: Int(point.x * scale), y: Int(point.y * scale))?.alphaComponent ?? 1
        }
        expect("Fields: no shadow around a field, and no layer shadow", outside.allSatisfy { $0 < 0.01 }
               && (field.layer?.shadowOpacity ?? 0) == 0 && field.shadow == nil, "\(outside)")
        let command = CommandView(placeholder: "Search")
        expect("Fields: the command panel's field is a borderless row under a hairline; the panel surface has a hairline edge",
               !command.field.isBordered && !command.field.drawsBackground && command.field.focusRingType == .none
                   && FloatingSurface().ring === Palette.strokeQuaternary)
        window.close()
    }

    func hoverPanel() {
        let window = CursorCountingWindow(size: NSSize(width: 300, height: 200))
        let field = NSTextView(frame: NSRect(x: 10, y: 10, width: 200, height: 40))
        window.contentView?.addSubview(field)
        window.makeFirstResponder(field)
        window.cursorInvalidations = 0
        let panel = FloatingPanel(radius: Radius.card, presentation: .hover)
        panel.content = Label("func Printf(format string, a ...any)")
        panel.show(size: NSSize(width: 240, height: 60), anchoredTo: NSRect(x: 10, y: 10, width: 40, height: 16), in: window.contentView ?? field)
        spin()
        expect("Hover panel: never key or main, leaves the window key and its first responder, and leaves its cursor rects alone",
               panel.isShown && !panel.window.canBecomeKey && !panel.window.canBecomeMain && window.isKeyWindow
                   && window.firstResponder === field && window.cursorInvalidations == 0 && panel.window.ignoresMouseEvents,
               "\(window.cursorInvalidations) \(panel.window.ignoresMouseEvents)")
        panel.dismiss()
        spin()
        window.close()
    }

    func quietScrollers() {
        let scroll = QuietScrollView(frame: NSRect(x: 0, y: 0, width: 200, height: 100))
        scroll.scrollerStyle = .overlay
        scroll.hasVerticalScroller = true
        let atRest = scroll.verticalScroller.map { !$0.isHidden && scroll.showsScrollers } ?? false
        if let wheel = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -4, wheel2: 0, wheel3: 0),
           let event = NSEvent(cgEvent: wheel) {
            scroll.scrollWheel(with: event)
        }
        expect("Scrollers: an overlay scroller stays away until the user scrolls, and nothing flashes before",
               !atRest && scroll.showsScrollers && scroll.hasVerticalScroller)
    }

    func contentSplit() {
        let window = KitProbeWindow(size: NSSize(width: 600, height: 300))
        let controller = GutterSplitViewController(vertical: true, autosave: "")
        for _ in 0..<3 { controller.addSplitViewItem(NSSplitViewItem(viewController: NSViewController.blank())) }
        controller.defaultPositions = [0: 200]
        window.place(controller.view, at: .zero, size: NSSize(width: 600, height: 300))
        controller.view.layoutSubtreeIfNeeded()
        let split = controller.splitView
        split.setPosition(120, ofDividerAt: 0)
        let edge = controller.splitViewItems[0].viewController.view.frame.maxX
        let drawn = NSRect(x: edge, y: 0, width: Metric.hairline, height: 300)
        let effective = controller.splitView(split, effectiveRect: drawn, forDrawnRect: drawn, ofDividerAt: 0)
        click(split, at: NSPoint(x: edge, y: 150))
        let doubled = NSEvent.mouseEvent(with: .leftMouseDown, location: split.convert(NSPoint(x: edge, y: 150), to: nil), modifierFlags: [],
                                         timestamp: 0, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 2,
                                         pressure: 1)
        doubled.map(split.mouseDown)
        controller.view.layoutSubtreeIfNeeded()
        let reset = controller.splitViewItems[0].viewController.view.frame.maxX
        expect("Content split: hairline dividers, a wider grab area, double-click resets to the default",
               split.dividerThickness == Metric.hairline && effective.width >= Metric.hairline + ContentSplitView.grabMargin * 2
                   && reset == 200 && ContentSurface().radius == Metric.contentRadius, "\(effective) \(reset)")
        window.close()
    }

    func navigatorAndTabs() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 120))
        var chosen: [Int] = []
        let bar = NavigatorBar([.init(symbol: "folder", label: "Files"), .init(symbol: "magnifyingglass", label: "Search"),
                                .init(symbol: "arrow.triangle.branch", label: "Changes")], label: "Navigator") { chosen.append($0) }
        window.place(bar, at: .zero, size: NSSize(width: 200, height: Metric.paneHeader))
        bar.layoutSubtreeIfNeeded()
        bar.buttons[2].performClick(nil)
        expect("Navigator bar: plain header buttons at one size; the selected one is on, the others plain",
               chosen == [2] && bar.buttons.map(\.isOn) == [false, false, true]
                   && bar.buttons.allSatisfy { $0.frame.height == PaneHeader.actionSize.height && $0.variant == .ghost })
        let tabs = TextTabs(["Frames", "Variables", "Console"], label: "Debug views")
        window.place(tabs, at: NSPoint(x: 0, y: 60))
        tabs.choose(1)
        let input = Input(placeholder: "Filter")
        let strip = ToolStrip()
        strip.setViews(leading: [input])
        let prompt = PromptRow(placeholder: "Evaluate")
        prompt.disabledReason = "The program has exited"
        expect("Pane parts: text tabs on no track with a list-selection fill, a field in a strip goes plain, a prompt shows its reason",
               tabs.selectedIndex == 1 && TextTabs.selectedFill() === Palette.fillSecondary && input.variant == .strip
                   && !prompt.input.isEnabled && prompt.input.placeholder == "The program has exited" && prompt.input.variant == .bare)
        window.close()
    }

    func searchPanel() {
        let window = KitProbeWindow(size: NSSize(width: 900, height: 500))
        let view = CommandView(placeholder: "Search")
        var opened: [String] = []
        view.scopes = ["All", "Files", "Symbols", "Commands", "Text"]
        view.scopedResults = { query, scope in [RowContent.header("Files", meta: "1"), RowContent(title: "\(query)\(scope).go")] }
        view.preview = { _, row in Label(row.title) }
        view.onActivateBeside = { _, row in opened.append("beside \(row.title)") }
        window.place(view, at: .zero, size: NSSize(width: view.width, height: view.height))
        window.makeFirstResponder(view.field)
        view.setQuery("hub")
        spin()
        _ = view.control(view.field, textView: NSTextView(), doCommandBy: #selector(NSResponder.insertTab(_:)))
        let afterTab = view.scope
        _ = view.performKeyEquivalent(with: key((code: 20, text: "3"), .command, in: window))
        let afterDigit = view.scope
        spin()
        view.layoutSubtreeIfNeeded()
        _ = view.performKeyEquivalent(with: key(Keys.returnKey, .command, in: window))
        expect("Search panel: Tab and Command-digits move between scopes, the preview shows when wide, Command-Return opens beside",
               afterTab == 1 && afterDigit == 2 && view.showsPreview && view.width == CommandView.wideWidth
                   && opened == ["beside hub2.go"], "\(afterTab) \(afterDigit) \(opened)")
        window.close()
    }

    func settingsParts() {
        let window = KitProbeWindow(size: NSSize(width: 600, height: 400))
        var picked: [Int] = []
        let sidebar = SettingsSidebar([.init("General", symbol: "gearshape", hue: .gray), .init("Editor", symbol: "doc.text", hue: .blue,
                                       status: "Go, TypeScript"), .init("Agents", symbol: "person.2", hue: .orange, keywords: ["models"])])
        sidebar.onSelect = { picked.append($0) }
        window.place(sidebar, at: .zero, size: NSSize(width: SettingsSidebar.width, height: 400))
        sidebar.layoutSubtreeIfNeeded()
        sidebar.search.stringValue = "models"
        let filtered = sidebar.shown
        sidebar.search.stringValue = ""
        let row = SettingsRow("Format on save", description: "Runs the language server's formatter.", control: Switch(label: "Format on save"))
        let group = SettingsGroup(heading: "Editing", rows: [row, SettingsRow("Tab width", control: Button("4", size: .sm))])
        window.place(group, at: NSPoint(x: 220, y: 10), size: NSSize(width: 360, height: 200))
        group.layoutSubtreeIfNeeded()
        expect("Settings: a 200 pt sidebar searches titles and keywords; groups separate rows with inset hairlines",
               SettingsSidebar.width == 200 && filtered == [2] && sidebar.shown == [0, 1, 2]
                   && group.rows.map { $0.showsRule } == [false, true] && SettingsSidebar.tile(symbol: "gearshape", hue: .gray).size.width
                       == SettingsSidebar.tileSide, "\(filtered)")
        window.close()
    }

    func marksAfterTitle() {
        var row = RowContent(title: "hub.go", leading: .image(FileIcon.forFile(named: "hub.go").image(dark: false)), depth: 1)
        row.status = GitChange.modified.status
        row.layout = .tree
        let trailing = inkColumns(row, state: RowRenderer.State(), width: 220).max() ?? 0
        row.marksFollowTitle = true
        let columns = inkColumns(row, state: RowRenderer.State(), width: 220)
        let titleEnd = Int(RowRenderer.titleStart(row, reservesDisclosure: false) + Draw.width(of: "hub.go"))
        let markEnd = titleEnd + Int(RowCell.Geometry.gap + RowCell.Geometry.lane) + 2
        let following = columns.max() ?? 0
        expect("Rows: a git mark can sit right after the title instead of at the far edge",
               trailing > 190 && following <= markEnd && columns.contains { $0 > titleEnd + 2 }, "\(trailing) \(following) \(titleEnd)")
    }
}

extension NSViewController {
    static func blank() -> NSViewController {
        let controller = NSViewController()
        controller.view = NSView()
        return controller
    }
}

extension KitCheck {
    func drivenSelection() {
        let ringInk = { (focus: RowCell.Focus) -> Bool in
            let cell = RowCell(frame: NSRect(x: 0, y: 0, width: 200, height: Metric.row))
            cell.content = RowContent(title: "hub.go")
            cell.isSelected = true
            cell.focus = focus
            guard let rep = cell.bitmapImageRepForCachingDisplay(in: cell.bounds) else { return false }
            cell.cacheDisplay(in: cell.bounds, to: rep)
            let scale = CGFloat(rep.pixelsWide) / cell.bounds.width
            let x = Int((RowCell.Geometry.inset + RowCell.focusWidth / 2) * scale), y = Int(cell.bounds.midY * scale)
            guard let pixel = rep.colorAt(x: x, y: y) else { return false }
            return pixel.blueComponent > pixel.redComponent + 0.2
        }
        let window = KitProbeWindow(size: NSSize(width: 300, height: 200))
        let sidebar = SettingsSidebar([.init("General", symbol: "gearshape", hue: .gray), .init("Editor", symbol: "doc.text", hue: .teal)])
        window.place(sidebar, at: .zero, size: NSSize(width: SettingsSidebar.width, height: 200))
        sidebar.layoutSubtreeIfNeeded()
        let command = CommandView(placeholder: "Search")
        expect("Selection: a list driven from a field shows the fill only; the ring is for a list that holds focus itself",
               ringInk(.focused) && !ringInk(.driven) && !sidebar.list.acceptsFocus && sidebar.list.showsFocusAlways
                   && !command.list.acceptsFocus)
        window.close()
    }
}
