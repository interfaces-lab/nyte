import AppKit
@testable import NyteUI

@MainActor
let windowPages: [GalleryPage] = [surfacePage, settingsPage, searchPanelPage, debuggerDockPage]

@MainActor
enum WindowSpecimens {
    static let surfaceSize = NSSize(width: 760, height: 420)
    static let settingsSize = NSSize(width: 760, height: 520)

    static func pane(_ title: String, actions: [String], body: NSView) -> NSView {
        let pane = NSView()
        let header = PaneHeader(title: title, actions: actions.map { Button.header(symbol: $0, label: $0) })
        for view in [header, body] {
            view.translatesAutoresizingMaskIntoConstraints = false
            pane.addSubview(view)
        }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: pane.topAnchor),
            header.leadingAnchor.constraint(equalTo: pane.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: pane.trailingAnchor),
            body.topAnchor.constraint(equalTo: header.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: pane.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: pane.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: pane.bottomAnchor),
        ])
        return pane
    }

    static func split(_ views: [NSView], vertical: Bool) -> NSSplitView {
        let split = ContentSplitView()
        split.isVertical = vertical
        split.translatesAutoresizingMaskIntoConstraints = false
        views.forEach(split.addArrangedSubview)
        return split
    }

    static func code() -> NSView {
        let text = Label("func (h *Hub) Run(ctx context.Context) {\n\tfor {\n\t\tselect {\n\t\tcase <-ctx.Done():\n\t\t\treturn\n\t\t}\n\t}\n}",
                         style: .code, color: Palette.contentPrimary)
        text.maximumNumberOfLines = 0
        let host = NSView()
        Pin.fill(text, in: host, insets: NSEdgeInsets(top: Space.x2, left: Space.x4, bottom: 0, right: 0))
        return host
    }

    static func surface() -> NSView {
        let chrome = SurfaceView(fill: Palette.bgChrome)
        let content = ContentSurface()
        let editor = pane("hub.go", actions: ["sidebar.right"], body: code())
        let dock = pane("Terminal", actions: ["plus", "chevron.down"], body: Label("$ go test ./...", style: .code, color: Palette.contentSecondary))
        let agent = pane("Agent", actions: ["clock.arrow.circlepath", "square.and.pencil"], body: NSView())
        let column = split([editor, dock], vertical: false)
        let row = split([column, agent], vertical: true)
        content.embed(row)
        let navigator = NavigatorBar([.init(symbol: "folder", label: "Files"), .init(symbol: "magnifyingglass", label: "Search"),
                                      .init(symbol: "arrow.triangle.branch", label: "Changes")], label: "Navigator")
        for view in [navigator, content] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            chrome.addSubview(view)
        }
        let inset = ContentSurface.inset
        NSLayoutConstraint.activate([
            navigator.topAnchor.constraint(equalTo: chrome.topAnchor, constant: inset),
            navigator.leadingAnchor.constraint(equalTo: chrome.leadingAnchor),
            navigator.widthAnchor.constraint(equalToConstant: Specimens.navigatorWidth),
            content.topAnchor.constraint(equalTo: chrome.topAnchor, constant: inset),
            content.leadingAnchor.constraint(equalTo: navigator.trailingAnchor),
            content.trailingAnchor.constraint(equalTo: chrome.trailingAnchor, constant: -inset),
            content.bottomAnchor.constraint(equalTo: chrome.bottomAnchor, constant: -inset),
        ])
        chrome.layoutSubtreeIfNeeded()
        row.setPosition(surfaceSize.width - Specimens.navigatorWidth - inset - Metric.agentMin * 0.8, ofDividerAt: 0)
        column.setPosition(surfaceSize.height * 0.6, ofDividerAt: 0)
        return Gallery.sized(chrome, width: surfaceSize.width, height: surfaceSize.height)
    }

    static func settings() -> NSView {
        let chrome = SurfaceView(fill: Palette.bgChrome)
        let sidebar = SettingsSidebar([
            .init("General", symbol: "gearshape", hue: .gray), .init("Appearance", symbol: "paintbrush", hue: .blue, status: "Compact, follows system"),
            .init("Editor", symbol: "doc.text", hue: .teal),
            .init("Languages", symbol: "chevron.left.forwardslash.chevron.right", hue: .green, status: "gopls missing"),
            .init("Debugger", symbol: "ladybug", hue: .red), .init("Terminal", symbol: "terminal", hue: .gray),
            .init("Agent", symbol: "bubble.left", hue: .orange), .init("Keys", symbol: "keyboard", hue: .gray),
            .init("Tools", symbol: "wrench.and.screwdriver", hue: .brown),
        ])
        sidebar.selectedCategory = 1
        sidebar.search.field.refusesFirstResponder = true
        let header = SettingsHeader(title: "Appearance")
        let density = Segmented([.init("Compact"), .init("Standard")], size: .sm, sizing: .hug, label: "Density")
        let theme = Button("System", size: .sm)
        theme.trailingSymbol = "chevron.up.chevron.down"
        let groups = NSStackView(views: [
            SettingsGroup(heading: "Window", rows: [
                SettingsRow("Density", description: "Compact fits more rows; Standard gives controls more room.", control: density),
                SettingsRow("Theme", control: theme),
                SettingsRow("Show the agent pane at launch", control: Switch(label: "Show the agent pane at launch")),
            ]),
            SettingsGroup(heading: "Editor", rows: [
                SettingsRow("Font size", description: "Applies to the editor, the terminal and code in the transcript.",
                            control: {
                                let field = Input("13", size: .sm)
                                field.widthAnchor.constraint(equalToConstant: Space.x8 * 2).isActive = true
                                return field
                            }()),
                SettingsRow("Comment slant", control: Switch(label: "Comment slant", isOn: true)),
            ]),
        ])
        groups.orientation = .vertical
        groups.alignment = .width
        groups.spacing = Space.x5
        for group in groups.arrangedSubviews { group.widthAnchor.constraint(equalTo: groups.widthAnchor).isActive = true }
        let content = NSView()
        for view in [header, groups] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(view)
        }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: content.topAnchor),
            header.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            groups.topAnchor.constraint(equalTo: header.bottomAnchor, constant: Space.x2),
            groups.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: Space.x5),
            groups.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -Space.x5),
        ])
        let page = SurfaceView(fill: Palette.bgBase)
        Pin.fill(content, in: page)
        for view in [sidebar, page] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            chrome.addSubview(view)
        }
        NSLayoutConstraint.activate([
            sidebar.topAnchor.constraint(equalTo: chrome.topAnchor, constant: Space.x2),
            sidebar.leadingAnchor.constraint(equalTo: chrome.leadingAnchor),
            sidebar.bottomAnchor.constraint(equalTo: chrome.bottomAnchor),
            sidebar.widthAnchor.constraint(equalToConstant: SettingsSidebar.width),
            page.topAnchor.constraint(equalTo: chrome.topAnchor),
            page.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor),
            page.trailingAnchor.constraint(equalTo: chrome.trailingAnchor),
            page.bottomAnchor.constraint(equalTo: chrome.bottomAnchor),
        ])
        return Gallery.sized(chrome, width: settingsSize.width, height: settingsSize.height)
    }

    static var searchViews: [CommandView] = []

    static func search() -> NSView {
        let view = CommandView(placeholder: "Search everywhere")
        view.scopes = ["All", "Files", "Symbols", "Commands", "Text"]
        let found: [RowContent] = {
            @MainActor func file(_ name: String, _ folder: String) -> RowContent {
                var row = RowContent(title: name, detail: folder, leading: .image(Specimens.icon(name)))
                row.detailTruncation = .path
                return row
            }
            @MainActor func command(_ title: String, _ keys: String) -> RowContent {
                var row = RowContent(title: title, meta: keys)
                row.leading = .symbol("command", .tertiary)
                return row
            }
            return [RowContent.header("Files", meta: "3"), file("hub.go", "internal/server/realtime"), file("hub_test.go", "internal/server/realtime"),
                    file("client.go", "internal/server/realtime"), RowContent.header("Symbols", meta: "2"),
                    RowContent(title: "Hub", detail: "struct", leading: .mark(.code(letter: "T", semanticType: "struct"))),
                    RowContent(title: "NewHub", detail: "() *Hub", leading: .mark(.code(letter: "f", semanticType: "function"))),
                    RowContent.header("Commands", meta: "2"), command("Go to Hub Definition", "⌘B"), command("Find Usages of Hub", "⌥F7")]
        }()
        view.scopedResults = { _, _ in found }
        view.preview = { _, row in
            let label = Label("\(row.title)\n\ntype Hub struct {\n\tclients map[*Client]bool\n}", style: .code, color: Palette.contentPrimary)
            label.maximumNumberOfLines = 0
            let host = NSView()
            Pin.fill(label, in: host, insets: NSEdgeInsets(top: Space.x3, left: Space.x3, bottom: 0, right: 0))
            return host
        }
        searchViews.append(view)
        let surface = FloatingSurface(radius: Radius.surface)
        surface.translatesAutoresizingMaskIntoConstraints = false
        Pin.fill(view, in: surface)
        return Gallery.sized(surface, width: view.width, height: view.height)
    }

    static func fillSearch() {
        for view in searchViews {
            view.setQuery("hub")
            view.layoutSubtreeIfNeeded()
        }
        searchViews = []
    }
}

@MainActor
let surfacePage = GalleryPage(name: "surface") {
    Gallery.page([
        Gallery.section("Content surface", note: "One rounded surface inset \(Int(ContentSurface.inset)) pt from the window with a "
                        + "\(Int(ContentSurface.radius)) pt radius, as the desktop app's main card; the editor, dock and agent split "
                        + "inside it by hairlines with no gaps. The navigator bar is plain header buttons, the selected one filled.", [
            WindowSpecimens.surface(),
        ]),
    ])
}

@MainActor
let settingsPage = GalleryPage(name: "settings") {
    Gallery.page([
        Gallery.section("Settings", note: "A 200 pt sidebar with search and categories on coloured tiles, an optional status line; "
                        + "the content has the title with back and forward, then grouped rows of a title, a description and a control.", [
            WindowSpecimens.settings(),
        ]),
    ])
}

@MainActor
let searchPanelPage = GalleryPage(name: "search-panel", prepare: { WindowSpecimens.fillSearch() }) {
    Gallery.page([
        Gallery.section("Search panel", note: "The command panel with scopes: a borderless field over a hairline, text tabs for All, "
                        + "Files, Symbols, Commands and Text (Tab or Command-1 to 5), sections with counts, keys at the trailing edge, "
                        + "and a preview of the selected item when the panel is wide.", [
            WindowSpecimens.search(),
        ]),
    ])
}
