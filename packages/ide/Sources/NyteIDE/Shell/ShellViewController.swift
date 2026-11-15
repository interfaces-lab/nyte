import AppKit
import NyteAgent
import NyteCore
import NyteDesign
import NyteEditor

/// The window's layout. One warm chrome runs under everything. The navigator sits flat on it at
/// the leading edge; the editor, terminal and agent are cards on it, separated by one gutter.
/// The titlebar row holds the traffic lights, three glass controls and the flat file tabs.
///
///     ┌ ● ● ●  (sidebar)   tab  tab  tab                         (terminal)(agent) ┐
///     │ nyte  main        ┌───────────────────────────────┐ ┌──────────────────────┐│
///     │ ▸ packages        │ editor                        │ │ agent                ││
///     │ ▾ scripts         │                               │ │                      ││
///     │   build.sh        │ path                Ln 1, Col 1│ │                      ││
///     │                   ├───────────────────────────────┤ │                      ││
///     │                   │ terminal                      │ │ composer             ││
///     └───────────────────┴───────────────────────────────┘ └──────────────────────┘┘
@MainActor
final class ShellViewController: NSViewController, NSMenuItemValidation {
    private let workspace: Workspace
    private let split = GutterSplitViewController(vertical: true, autosave: "shell")
    private let sidebar: SidebarViewController
    private let center: CenterViewController
    private let agent: AgentViewController
    private var sidebarItem: NSSplitViewItem!
    private var agentItem: NSSplitViewItem!

    private let tabs = TabStripView()
    private lazy var sidebarButton = GlassButton(
        symbol: "sidebar.leading", label: "Sidebar", target: self, action: #selector(toggleSidebar(_:))
    )
    private lazy var terminalButton = GlassButton(
        symbol: "apple.terminal", label: "Terminal", target: self, action: #selector(toggleTerminal(_:))
    )
    private lazy var agentButton = GlassButton(
        symbol: "sidebar.trailing", label: "Agent", target: self, action: #selector(toggleAgent(_:))
    )

    private var editor: EditorViewController { center.editor }
    private var tabsKey: String { "tabs:" + workspace.root.path }

    init(workspace: Workspace) {
        self.workspace = workspace
        sidebar = SidebarViewController(workspace: workspace)
        center = CenterViewController(workspace: workspace)
        agent = AgentViewController(workspace: workspace)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: Layout

    override func loadView() {
        let root = ShellRootView()
        root.onLayout = { [weak self] in self?.layoutTitlebarRow() }
        view = root

        let chrome = ChromeBackground()
        let drag = TitlebarDragView()
        drag.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(chrome)
        root.addSubview(drag)

        sidebarItem = NSSplitViewItem(viewController: sidebar)
        sidebarItem.minimumThickness = Metric.sidebarMin
        sidebarItem.maximumThickness = Metric.sidebarMax
        sidebarItem.canCollapse = true
        sidebarItem.holdingPriority = .init(260)

        let centerItem = NSSplitViewItem(viewController: center)
        centerItem.minimumThickness = Metric.editorMin
        centerItem.holdingPriority = .defaultLow

        let agentPane = PaneViewController(content: agent.view)
        agentPane.addChild(agent)
        agentItem = NSSplitViewItem(viewController: agentPane)
        agentItem.minimumThickness = Metric.agentMin
        agentItem.maximumThickness = Metric.agentMax
        agentItem.canCollapse = true
        agentItem.holdingPriority = .init(255)

        [sidebarItem, centerItem, agentItem].forEach(split.addSplitViewItem)
        addChild(split)
        let panes = split.view
        panes.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(panes)
        [tabs, sidebarButton, terminalButton, agentButton].forEach(root.addSubview)

        NSLayoutConstraint.activate([
            chrome.topAnchor.constraint(equalTo: root.topAnchor),
            chrome.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            chrome.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            chrome.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            drag.topAnchor.constraint(equalTo: root.topAnchor),
            drag.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            drag.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            drag.heightAnchor.constraint(equalToConstant: Metric.titlebar),
            panes.topAnchor.constraint(equalTo: root.topAnchor, constant: Metric.titlebar),
            panes.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            panes.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Metric.gutter),
            panes.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Metric.gutter),
            sidebar.view.widthAnchor.constraint(equalToConstant: Metric.sidebarWidth).withPriority(.init(240)),
            agentPane.view.widthAnchor.constraint(equalToConstant: Metric.agentWidth).withPriority(.init(240)),
            sidebarButton.centerYAnchor.constraint(equalTo: root.topAnchor, constant: Metric.titlebar / 2),
            sidebarButton.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Metric.trafficLights + Space.x1),
            agentButton.centerYAnchor.constraint(equalTo: sidebarButton.centerYAnchor),
            agentButton.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Metric.gutter),
            terminalButton.centerYAnchor.constraint(equalTo: sidebarButton.centerYAnchor),
            terminalButton.trailingAnchor.constraint(equalTo: agentButton.leadingAnchor, constant: -Space.x15),
        ])
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        sidebar.navigator.onOpen = { [weak self] url, preview in self?.editor.open(url, preview: preview) }
        editor.onTabsChange = { [weak self] in self?.tabsDidChange() }
        editor.onPositionChange = { [weak self] in self?.center.editorPane.show(position: $0) }
        tabs.onSelect = { [weak self] in self?.editor.select(at: $0) }
        tabs.onClose = { [weak self] in self?.editor.close(at: $0) }
        tabs.menuForTab = { [weak self] in self?.menu(forTab: $0) }
        NotificationCenter.default.addObserver(
            self, selector: #selector(panesDidResize), name: NSSplitView.didResizeSubviewsNotification, object: split.splitView
        )
        restoreTabs()
        tabsDidChange()
    }

    @objc private func panesDidResize() { layoutTitlebarRow() }

    /// Keeps the tab strip exactly over the editor pane, clear of the controls at either end.
    private func layoutTitlebarRow() {
        let editorFrame = center.view.convert(center.view.bounds, to: view)
        let minX = max(editorFrame.minX, sidebarButton.frame.maxX + Space.x3)
        let maxX = min(editorFrame.maxX, terminalButton.frame.minX - Space.x3)
        tabs.frame = NSRect(x: minX, y: 0, width: max(0, maxX - minX), height: Metric.titlebar)
    }

    // MARK: Tabs

    private func tabsDidChange() {
        tabs.items = editor.tabs.map { tab in
            TabStripView.Item(
                title: tab.title, detail: workspace.relativePath(of: tab.url), isDirty: tab.isDirty, isPreview: tab.isPreview
            )
        }
        tabs.selectedIndex = editor.selectedIndex
        center.editorPane.show(file: editor.selectedURL)
        if editor.selectedURL == nil { center.editorPane.show(position: nil) }
        view.window?.title = editor.selectedURL.map { "\($0.lastPathComponent) — \(workspace.name)" } ?? workspace.name
        view.window?.representedURL = editor.selectedURL
        view.window?.isDocumentEdited = editor.tabs.contains(where: \.isDirty)
        let open = editor.tabs.filter { !$0.isPreview }.map { workspace.relativePath(of: $0.url) }
        UserDefaults.standard.set(["open": open, "selected": editor.selectedIndex ?? -1], forKey: tabsKey)
    }

    private func restoreTabs() {
        guard let saved = UserDefaults.standard.dictionary(forKey: tabsKey), let open = saved["open"] as? [String] else { return }
        let existing = open.map { workspace.root.appendingPathComponent($0) }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        existing.forEach { editor.open($0, preview: false) }
        if let selected = saved["selected"] as? Int, editor.tabs.indices.contains(selected) { editor.select(at: selected) }
    }

    private func menu(forTab index: Int) -> NSMenu? {
        guard editor.tabs.indices.contains(index) else { return nil }
        let menu = NSMenu()
        let entries: [(String, String, Selector)] = [
            ("Close", "xmark", #selector(closeTabFromMenu(_:))),
            ("Close Others", "xmark.square", #selector(closeOtherTabs(_:))),
            ("Reveal in Finder", "folder", #selector(revealTabInFinder(_:))),
            ("Copy Path", "document.on.document", #selector(copyTabPath(_:))),
        ]
        for (position, entry) in entries.enumerated() {
            if position == 2 { menu.addItem(.separator()) }
            let item = NSMenuItem(title: entry.0, action: entry.2, keyEquivalent: "")
            item.image = Symbol.image(entry.1)
            item.target = self
            item.tag = index
            menu.addItem(item)
        }
        return menu
    }

    @objc private func closeTabFromMenu(_ sender: NSMenuItem) { editor.close(at: sender.tag) }

    @objc private func closeOtherTabs(_ sender: NSMenuItem) {
        guard editor.tabs.indices.contains(sender.tag) else { return }
        let keep = editor.tabs[sender.tag].url
        for index in editor.tabs.indices.reversed() where editor.tabs[index].url != keep { editor.close(at: index) }
    }

    @objc private func revealTabInFinder(_ sender: NSMenuItem) {
        guard editor.tabs.indices.contains(sender.tag) else { return }
        NSWorkspace.shared.activateFileViewerSelecting([editor.tabs[sender.tag].url])
    }

    @objc private func copyTabPath(_ sender: NSMenuItem) {
        guard editor.tabs.indices.contains(sender.tag) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(editor.tabs[sender.tag].url.path, forType: .string)
    }

    // MARK: Actions

    @objc func toggleSidebar(_ sender: Any?) { split.toggle(sidebarItem) }
    @objc func toggleTerminal(_ sender: Any?) { center.toggleTerminal() }
    @objc func toggleAgent(_ sender: Any?) { split.toggle(agentItem) }

    @objc func askNyte(_ sender: Any?) {
        if agentItem.isCollapsed { split.toggle(agentItem) }
        agent.focusComposer()
    }

    @objc func saveDocument(_ sender: Any?) { editor.saveSelected() }

    @objc func closeTab(_ sender: Any?) {
        guard let index = editor.selectedIndex else { return view.window?.performClose(sender) ?? () }
        editor.close(at: index)
    }

    @objc func selectNextTab(_ sender: Any?) { stepTab(by: 1) }
    @objc func selectPreviousTab(_ sender: Any?) { stepTab(by: -1) }

    private func stepTab(by delta: Int) {
        guard let index = editor.selectedIndex, editor.tabs.count > 1 else { return }
        editor.select(at: (index + delta + editor.tabs.count) % editor.tabs.count)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(toggleSidebar(_:)):
            item.title = sidebarItem.isCollapsed ? "Show Sidebar" : "Hide Sidebar"
        case #selector(toggleTerminal(_:)):
            item.title = center.terminalItem.isCollapsed ? "Show Terminal" : "Hide Terminal"
        case #selector(toggleAgent(_:)):
            item.title = agentItem.isCollapsed ? "Show Agent" : "Hide Agent"
        case #selector(saveDocument(_:)):
            return editor.selectedIndex.map { editor.tabs[$0].isDirty } ?? false
        case #selector(selectNextTab(_:)), #selector(selectPreviousTab(_:)):
            return editor.tabs.count > 1
        default:
            break
        }
        return true
    }
}

/// The shell's root: top-left origin, and a layout callback for the hand-placed titlebar row.
@MainActor
private final class ShellRootView: NSView {
    var onLayout: (() -> Void)?
    override var isFlipped: Bool { true }

    override func layout() {
        super.layout()
        onLayout?()
    }
}
