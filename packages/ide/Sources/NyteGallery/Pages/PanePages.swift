import AppKit
@testable import NyteUI

@MainActor
private enum Pane {
    static let width: CGFloat = 480
    static let windowSize = NSSize(width: 900, height: 600)
    static let bodyHeight: CGFloat = 96
    static let perfRows = 100_000
    static let perfSteps = 400
    static let perfStride = 7_919
    static let perfHeight: CGFloat = 640
    static let millisecond: Double = 1_000
    static let perfDepths = 3
    static let percentile = 0.95
}

@MainActor
private func header(_ title: String, middle: NSView? = nil, rule: Bool = false) -> NSView {
    let header = PaneHeader(title: title, actions: [
        IconButton(symbol: "plus", label: "New", size: PaneHeader.actionSize),
        IconButton(symbol: "line.3.horizontal.decrease", label: "Filter", size: PaneHeader.actionSize),
        IconButton(symbol: "ellipsis", label: "More", size: PaneHeader.actionSize),
    ])
    header.middle = middle
    header.showsHairline = rule
    let card = PaneCard()
    card.addSubview(header)
    NSLayoutConstraint.activate([
        header.topAnchor.constraint(equalTo: card.topAnchor),
        header.leadingAnchor.constraint(equalTo: card.leadingAnchor),
        header.trailingAnchor.constraint(equalTo: card.trailingAnchor),
    ])
    return Gallery.sized(card, width: Pane.width, height: Metric.paneHeader + Pane.bodyHeight)
}

@MainActor
private func toolbar(_ axis: Toolbar.Axis) -> NSView {
    let bar = Toolbar(axis: axis)
    for (symbol, label) in [("arrow.clockwise", "Rerun"), ("arrow.up", "Previous"), ("arrow.down", "Next")] {
        bar.add(IconButton(symbol: symbol, label: label, size: .sm))
    }
    bar.addSeparator()
    for (symbol, label) in [("eye", "Preview"), ("arrow.up.and.down", "Expand All"), ("arrow.down.right.and.arrow.up.left", "Collapse All")] {
        bar.add(IconButton(symbol: symbol, label: label, size: .sm))
    }
    return bar
}

@MainActor
private func footer() -> NSView {
    let loading = StatusItem("Indexing", symbol: nil)
    loading.isLoading = true
    let hovered = StatusItem("Go 1.24", symbol: "chevron.left.forwardslash.chevron.right")
    hovered.isHovered = true
    let errors = StatusItem("2", symbol: "xmark.octagon.fill")
    errors.tone = .danger
    let items: [NSView] = [
        Gallery.specimen("rest", StatusItem("hub.go", symbol: "doc")),
        Gallery.specimen("hover", hovered),
        Gallery.specimen("plain", StatusItem("Ln 42, Col 7")),
        Gallery.specimen("loading", loading),
        Gallery.specimen("danger tone", errors),
    ]
    return Gallery.row(items)
}

@MainActor
private func cornerReport() -> String {
    func measure(_ inset: CGFloat, quadrant: Bool) -> String {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: Pane.windowSize),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: true)
        window.toolbar = NSToolbar(identifier: "gallery")
        window.toolbarStyle = .unified
        let root = NSView()
        window.contentView = root
        let card = PaneCard()
        root.addSubview(card)
        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: inset),
            card.topAnchor.constraint(equalTo: root.topAnchor, constant: inset),
            card.widthAnchor.constraint(equalTo: root.widthAnchor, multiplier: quadrant ? 0.5 : 1, constant: -inset * 2),
            card.heightAnchor.constraint(equalTo: root.heightAnchor, multiplier: quadrant ? 0.5 : 1, constant: -inset * 2),
        ])
        root.layoutSubtreeIfNeeded()
        let r = card.effectiveCornerRadii
        let text = r.map { "TL \($0.topLeft) TR \($0.topRight) BL \($0.bottomLeft) BR \($0.bottomRight)" } ?? "none"
        let applied = card.cornerRadii
        return "\(text); applied TL \(applied.topLeft) TR \(applied.topRight) BL \(applied.bottomLeft) BR \(applied.bottomRight)"
    }
    let lines = [
        "full card, gutter inset: " + measure(Metric.gutter, quadrant: false),
        "full card, no inset: " + measure(0, quadrant: false),
        "top-left quarter, gutter inset: " + measure(Metric.gutter, quadrant: true),
    ]
    lines.forEach { print("corners:", $0) }
    return lines.joined(separator: "\n")
}

@MainActor
let panesPage = GalleryPage(name: "panes") {
    let scope = Segmented([.init("Current File"), .init("Project")], sizing: .hug, label: "Scope")
    let tabs = TabBar(style: .plain, label: "Debug views")
    tabs.items = [TabBar.Item("Threads & Variables", isClosable: false), TabBar.Item("Console", isClosable: false)]
    tabs.selectedIndex = 0
    return Gallery.page([
        Gallery.section("Pane header", note: "\(Int(Metric.paneHeader))pt. Title 13 semibold primary at 12; a separator and 12 either side before a middle view; sm ghost actions 2 apart at 4.", [
            Gallery.row([
                Gallery.specimen("title and actions", header("Outline")),
                Gallery.specimen("title, then a scope, hairline under", header("Find", middle: scope, rule: true)),
            ]),
            Gallery.specimen("title, then tabs", header("Debug", middle: tabs)),
        ]),
        Gallery.section("Toolbar", note: "Gap 2, separators 1 by 16.", onCard: true, [
            Gallery.row([
                Gallery.specimen("horizontal", toolbar(.horizontal)),
                Gallery.specimen("vertical", toolbar(.vertical)),
            ], spacing: Space.x8),
        ]),
        Gallery.section("Status items", note: "20pt, text 12, tertiary stepping to secondary.", onCard: true, [footer()]),
        Gallery.section("Pane corners, unshown window with a unified toolbar", [
            Label(cornerReport(), style: .sm, color: Palette.contentSecondary),
        ]),
    ])
}

@MainActor
let listPerformancePage = GalleryPage(name: "list-perf") {
    let count = Pane.perfRows
    let list = ListView()
    list.rowHeight = Metric.rowCompact
    list.isOutline = true
    list.rowCount = { count }
    list.content = { index in
        var row = RowContent(title: "handler_\(index).go", detail: "(line \(index % Pane.perfStride))",
                             meta: "\(index)", leading: .symbol("doc", .secondary), depth: index % Pane.perfDepths)
        row.disclosure = index % Pane.perfDepths == 0 ? .open : .none
        return row
    }
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: Specimens.listWidth, height: Pane.perfHeight),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    window.alphaValue = 0
    window.contentView = list
    window.orderBack(nil)
    let start = CACurrentMediaTime()
    list.reload()
    window.displayIfNeeded()
    let reload = (CACurrentMediaTime() - start) * Pane.millisecond
    var frames: [Double] = []
    let clip = list.scrollView.contentView
    let total = CGFloat(count) * Metric.rowCompact - Pane.perfHeight
    for step in 0 ..< Pane.perfSteps {
        let y = CGFloat((step * Pane.perfStride) % count) * Metric.rowCompact
        let begin = CACurrentMediaTime()
        clip.scroll(to: NSPoint(x: 0, y: min(y, total)))
        list.scrollView.reflectScrolledClipView(clip)
        window.displayIfNeeded()
        frames.append((CACurrentMediaTime() - begin) * Pane.millisecond)
    }
    var smooth: [Double] = []
    for step in 0 ..< Pane.perfSteps {
        let begin = CACurrentMediaTime()
        clip.scroll(to: NSPoint(x: 0, y: CGFloat(step) * Metric.rowCompact * 2))
        list.scrollView.reflectScrolledClipView(clip)
        window.displayIfNeeded()
        smooth.append((CACurrentMediaTime() - begin) * Pane.millisecond)
    }
    window.orderOut(nil)
    let percentile = Pane.percentile
    func summary(_ values: [Double]) -> String {
        let sorted = values.sorted()
        let mean = values.reduce(0, +) / Double(values.count)
        return String(format: "mean %.2f ms, p95 %.2f ms, max %.2f ms", mean,
                      sorted[Int(Double(sorted.count) * percentile)], sorted.last ?? 0)
    }
    let report = [
        "100,000 rows, 24pt, \(Pane.perfSteps) frames each, offscreen at 2x",
        String(format: "reload and first display: %.2f ms", reload),
        "jumps across the whole list: " + summary(frames),
        "steady scroll two rows a frame: " + summary(smooth),
    ]
    report.forEach { print("perf:", $0) }
    return Gallery.page([Gallery.section("ListView with 100,000 rows", [
        Label(report.joined(separator: "\n"), style: .sm, color: Palette.contentSecondary),
    ])])
}

@MainActor
enum ToolWindowSpecimens {
    static let width: CGFloat = 360
    static let height: CGFloat = 240
    static var scrolled: [(list: ListView, offset: CGFloat)] = []

    static func problems(scrolledBy offset: CGFloat) -> NSView {
        let window = ToolWindowView()
        window.setAccessibilityLabel("Problems")
        let count = CountBadge(12, size: .xs)
        window.header.setViews(leading: [Label("Problems", style: .base, color: Palette.contentPrimary, weight: .semibold), count],
                               trailing: [SearchField(size: .sm), Button(symbol: "line.3.horizontal.decrease", label: "Filter", size: .sm)])
        let list = ListView()
        let rows = Specimens.groupedProblems
        list.rowCount = { rows.count }
        list.content = { rows[$0] }
        list.rowHeight = Metric.rowCompact
        list.verticalInset = Space.x1
        list.pinsGroupHeaders = true
        Pin.fill(list, in: window.content)
        window.follow(list.scrollView)
        list.reload()
        scrolled.append((list, offset))
        let card = PaneCard()
        card.embed(window)
        return Gallery.sized(card, width: width, height: height)
    }

    static func refactor() -> NSView {
        let window = ToolWindowView(header: .compact, footer: .pane)
        window.headerRule = .always
        window.header.setViews(leading: [Label("Rename Counts to Totals", style: .sm, color: Palette.contentSecondary)])
        window.footer.setViews(leading: [Label("5 changes in 2 files", style: .sm, color: Palette.contentTertiary)],
                               trailing: [Button("Cancel", variant: .outline, size: .sm), Button("Refactor", variant: .solid, tone: .primary, size: .sm)])
        let list = ListView()
        let rows = Specimens.refactorPreview
        list.rowCount = { rows.count }
        list.content = { rows[$0] }
        list.rowHeight = Metric.rowCompact
        list.isOutline = true
        list.verticalInset = Space.x1
        Pin.fill(list, in: window.content)
        window.follow(list.scrollView)
        list.reload()
        let card = PaneCard()
        card.embed(window)
        return Gallery.sized(card, width: width, height: height)
    }

    static func scroll() {
        for (list, offset) in scrolled {
            list.layoutSubtreeIfNeeded()
            let clip = list.scrollView.contentView
            clip.scroll(to: NSPoint(x: 0, y: offset - list.verticalInset))
            list.scrollView.reflectScrolledClipView(clip)
        }
        scrolled = []
    }
}

@MainActor
let toolWindowPage = GalleryPage(name: "tool-window", prepare: { ToolWindowSpecimens.scroll() }) {
    Gallery.page([
        Gallery.section("Tool window", note: "A header strip at the pane header's 36 or the compact 28, content, and an optional "
                        + "footer. The hairline under the header shows only while the list beneath is scrolled; the one over the "
                        + "footer only while more rows sit below it.", [
            Gallery.row([
                Gallery.specimen("at the top: no rule", ToolWindowSpecimens.problems(scrolledBy: 0)),
                Gallery.specimen("scrolled: rule under the header", ToolWindowSpecimens.problems(scrolledBy: Metric.rowCompact * 3)),
            ], spacing: Space.x6),
            Gallery.row([
                Gallery.specimen("compact header, rule always; footer", ToolWindowSpecimens.refactor()),
            ]),
        ]),
        Gallery.section("Strip density", note: "The debugger's action strip and thread strip under the dock's 36 pt tabs. Today "
                        + "they are 32 and 28; the dense role is 24, the height of the small controls it holds, which keep their full "
                        + "24 pt hit area and centred baseline.", [
            Gallery.row([
                Gallery.specimen("compact 28 + compact 28", DensitySpecimens.strips(.compact, .compact)),
                Gallery.specimen("compact 28 + dense 24", DensitySpecimens.strips(.compact, .dense)),
            ], spacing: Space.x6),
            Gallery.row([
                Gallery.specimen("toolbar 32 + dense 24", DensitySpecimens.strips(.toolbar, .dense)),
            ]),
            Gallery.row([
                Gallery.specimen("dock tabs 32, then toolbar 32 + compact 28 + dense 24 = 84; the field in the strip presentation",
                                 DensitySpecimens.stack()),
            ]),
        ]),
        Gallery.section("Header rows", note: "The editor card's tab bar, the agent pane's header and the dock's tab row share "
                        + "Metric.paneHeader. Every hit area is the control's own; only the clearance follows the row.", [
            Gallery.row([Gallery.specimen(HeaderSpecimens.caption(Metric.paneHeader), HeaderSpecimens.rows(Metric.paneHeader))]),
        ]),
        Gallery.section("Field above a list", note: "The prompt sits on the tertiary step, lighter than the session titles under it; "
                        + "entered text is primary, 13 pt regular.", [
            Gallery.row([Gallery.specimen("navigator", DensitySpecimens.navigator())]),
        ]),
    ])
}

@MainActor
enum DensitySpecimens {
    static let width: CGFloat = 400
    static let evaluateWidth = Space.x8 * 5 + Space.x5

    static func stack() -> NSView {
        let dock = ToolWindowView(header: .pane)
        dock.headerRule = .always
        dock.header.leadingInset = PaneHeader.actionInset
        let tabs = TabBar(style: .plain, label: "Dock")
        tabs.items = ["Terminal", "Problems", "Debug"].map { TabBar.Item($0, isClosable: false) }
        tabs.selectedIndex = 2
        tabs.widthAnchor.constraint(equalToConstant: tabsWidth).isActive = true
        dock.header.setViews(leading: [tabs], trailing: [Button(symbol: "chevron.down", label: "Hide", size: .sm)])
        Pin.fill(strips(.toolbar, .compact, thread: .dense), in: dock.content)
        let card = PaneCard()
        card.embed(dock)
        let height = Metric.paneHeader + Size.lg.height + Metric.tab + Size.sm.height + Metric.rowCompact * 4
        return Gallery.sized(card, width: width, height: height)
    }

    static let tabsWidth = Space.x8 * 7

    static func strips(_ second: ToolWindowView.Strip, _ third: ToolWindowView.Strip) -> NSView {
        let card = PaneCard()
        card.embed(strips(second, third, thread: nil))
        let height = (second.height ?? 0) + (third.height ?? 0) + Metric.rowCompact * 5
        return Gallery.sized(card, width: width, height: height)
    }

    static func strips(_ second: ToolWindowView.Strip, _ third: ToolWindowView.Strip, thread fourth: ToolWindowView.Strip?) -> NSView {
        let actions = ToolWindowView(header: second)
        actions.headerRule = .always
        actions.header.leadingInset = RowCell.Geometry.inset
        actions.header.setViews(leading: ["play.fill", "arrow.turn.down.right", "arrow.down.to.line", "arrow.up.to.line", "stop.fill"]
            .map { Button(symbol: $0, label: $0, size: .sm) }, trailing: [Segmented([.init("Variables"), .init("Console")], size: .sm,
                                                                                          sizing: .hug, label: "View")])
        let thread = ToolWindowView(header: fourth ?? third)
        thread.headerRule = .always
        thread.header.leadingInset = RowCell.Geometry.inset
        let picker = Button("Thread 1 · main", size: .sm)
        picker.trailingSymbol = "chevron.down"
        picker.restInk = Palette.contentPrimary
        let evaluate = SearchField(placeholder: "Evaluate", size: .sm, variant: fourth == nil ? .quiet : .strip)
        evaluate.field.refusesFirstResponder = true
        evaluate.widthAnchor.constraint(equalToConstant: evaluateWidth).isActive = true
        thread.header.setViews(leading: [picker], trailing: [evaluate])
        if fourth != nil {
            let tabs = ToolWindowView(header: third)
            tabs.headerRule = .always
            tabs.header.leadingInset = RowCell.Geometry.inset
            tabs.header.setViews(leading: [Segmented([.init("Frames"), .init("Variables"), .init("Breakpoints")], size: .sm, sizing: .hug,
                                                     label: "Debug views")])
            Pin.fill(thread, in: tabs.content)
            Pin.fill(tabs, in: actions.content)
        } else {
            Pin.fill(thread, in: actions.content)
        }
        let list = ListView()
        let rows = Specimens.variables
        list.rowCount = { rows.count }
        list.content = { rows[$0] }
        list.rowHeight = Metric.rowCompact
        list.isOutline = true
        Pin.fill(list, in: thread.content)
        list.reload()
        return actions
    }

    static func navigator() -> NSView {
        let stack = NSView()
        let field = SearchField(placeholder: "Filter sessions", size: .md)
        field.field.refusesFirstResponder = true
        let list = ListView()
        let rows = Specimens.sessionStates
        list.rowCount = { rows.count }
        list.content = { rows[$0] }
        list.rowHeight = Metric.rowCompact
        for view in [field, list] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            stack.addSubview(view)
        }
        NSLayoutConstraint.activate([
            field.topAnchor.constraint(equalTo: stack.topAnchor, constant: Space.x2),
            field.leadingAnchor.constraint(equalTo: stack.leadingAnchor, constant: Space.x2),
            field.trailingAnchor.constraint(equalTo: stack.trailingAnchor, constant: -Space.x2),
            list.topAnchor.constraint(equalTo: field.bottomAnchor, constant: Space.x1),
            list.leadingAnchor.constraint(equalTo: stack.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: stack.trailingAnchor),
            list.bottomAnchor.constraint(equalTo: stack.bottomAnchor),
        ])
        list.reload()
        let card = PaneCard()
        card.embed(stack)
        return Gallery.sized(card, width: Specimens.factWidths[1], height: Space.x2 + Size.md.height + Space.x1
                                + Metric.rowCompact * CGFloat(rows.count) + Space.x1)
    }
}

@MainActor
enum HeaderSpecimens {
    static let width: CGFloat = 360

    static func rows(_ height: CGFloat) -> NSView {
        let editor = NSView()
        let tabs = TabBar(style: .file, label: "Editor")
        tabs.items = [TabBar.Item("hub.go", icon: Specimens.icon("hub.go")), TabBar.Item("client.go", icon: Specimens.icon("client.go"))]
        tabs.selectedIndex = 0
        Pin.fill(tabs, in: editor)
        let agent = PaneHeader(title: "Agent", actions: ["plus", "clock.arrow.circlepath", "ellipsis"].map {
            Button(symbol: $0, label: $0, size: PaneHeader.actionSize)
        })
        agent.rowHeight = height
        let dock = NSView()
        let tools = TabBar(style: .plain, label: "Dock")
        tools.items = ["Terminal", "Problems", "Debug"].map { TabBar.Item($0, isClosable: false) }
        tools.selectedIndex = 2
        Pin.fill(tools, in: dock)
        let stack = NSStackView(views: [editor, Hairline(), agent, Hairline(), dock])
        stack.orientation = .vertical
        stack.spacing = 0
        stack.alignment = .width
        for view in [editor, dock] { view.heightAnchor.constraint(equalToConstant: height).isActive = true }
        let card = PaneCard()
        card.embed(stack)
        return Gallery.sized(card, width: width, height: height * 3 + Metric.hairline * 2)
    }

    static func caption(_ height: CGFloat) -> String {
        let clear = { (control: CGFloat) in String(format: "%.0f", (height - control) / 2) }
        return "\(Int(height)) pt: tab 28, close 16×16, clear \(clear(Metric.tab)); actions 24×24, clear "
            + "\(clear(PaneHeader.actionSize.height)); dock tab 24, clear \(clear(Metric.toolTab))"
    }
}

@MainActor
enum DockSpecimens {
    static let width: CGFloat = 520
    static let outputLines = 6

    static func debugger(exited: Bool) -> NSView {
        let dock = ToolWindowView(header: .pane)
        dock.headerRule = .always
        dock.header.leadingInset = PaneHeader.actionInset
        let tabs = TabBar(style: .plain, label: "Dock")
        tabs.items = ["Terminal", "Problems", "Debug"].map { TabBar.Item($0, isClosable: false) }
        tabs.selectedIndex = 2
        tabs.widthAnchor.constraint(equalToConstant: DensitySpecimens.tabsWidth).isActive = true
        dock.header.setViews(leading: [tabs], trailing: [Button.header(symbol: "chevron.down", label: "Hide")])
        let controls = ToolWindowView(header: .toolbar)
        controls.headerRule = .always
        controls.header.leadingInset = RowCell.Geometry.inset
        controls.header.setViews(leading: ["play.fill", "arrow.turn.down.right", "arrow.down.to.line", "arrow.up.to.line", "stop.fill"]
            .map { Button.header(symbol: $0, label: $0) }, trailing: [TextTabs(["Variables", "Console"], selectedIndex: 1, label: "Debug views")])
        let filter = ToolWindowView(header: .dense)
        filter.headerRule = .always
        filter.header.leadingInset = RowCell.Geometry.inset
        let field = SearchField(placeholder: "Filter output", size: .sm)
        filter.header.setViews(leading: [field])
        field.widthAnchor.constraint(equalToConstant: width - RowCell.Geometry.inset * 2).isActive = true
        let output = Label((1...outputLines).map { "hub: client \($0) registered (\($0 * 3) open)" }.joined(separator: "\n"), style: .code,
                           color: Palette.contentPrimary)
        output.maximumNumberOfLines = 0
        let prompt = PromptRow(placeholder: "Evaluate while paused")
        if exited { prompt.disabledReason = "The program has exited" }
        let body = NSView()
        for view in [output, prompt] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            body.addSubview(view)
        }
        NSLayoutConstraint.activate([
            output.topAnchor.constraint(equalTo: body.topAnchor, constant: Space.x2),
            output.leadingAnchor.constraint(equalTo: body.leadingAnchor, constant: RowCell.Geometry.inset + RowCell.Geometry.padding),
            prompt.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            prompt.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            prompt.bottomAnchor.constraint(equalTo: body.bottomAnchor),
        ])
        Pin.fill(body, in: filter.content)
        Pin.fill(filter, in: controls.content)
        Pin.fill(controls, in: dock.content)
        let surface = ContentSurface()
        surface.embed(dock)
        let height = Metric.paneHeader + Size.lg.height + Size.sm.height + Space.x2 + TextStyle.code.lineHeight * CGFloat(outputLines)
            + Space.x2 + Metric.rowCompact + Metric.hairline * 4
        return Gallery.sized(surface, width: width, height: height)
    }
}

@MainActor
let debuggerDockPage = GalleryPage(name: "debugger-dock") {
    Gallery.page([
        Gallery.section("Debugger dock", note: "One level of container: the dock's tabs, a strip of plain controls with text tabs, a "
                        + "filter that is only a glyph and its prompt at rest, the output, and a borderless prompt under a hairline.", [
            Gallery.row([
                Gallery.specimen("paused", DockSpecimens.debugger(exited: false)),
                Gallery.specimen("exited", DockSpecimens.debugger(exited: true)),
            ], spacing: Space.x6),
        ]),
    ])
}
