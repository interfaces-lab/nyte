import AppKit
import NyteAgent
import NyteChanges
import NyteCore
import NyteDebug
import NyteEditor
import NyteFiles
import NyteLanguage
import NyteSearch
import NyteTerminal
import NyteUI

@MainActor
final class ShellViewController: NSViewController {
    let workspace: Workspace
    let memory: WorkspaceMemory
    let services: WorkspaceServices
    let editor: EditorViewController
    let editorPane: EditorPaneController
    let terminal: TerminalViewController
    let agent: AgentViewController
    let navigator: FileNavigatorViewController
    let structure: StructureViewController
    let problems: ProblemsViewController
    let findResults: FindResultsViewController
    let debugView: DebugViewController
    let search: FindInFilesViewController
    let searchEngine: SearchEngine
    let sidebar: SidebarController
    let changesHost: HostController
    var changes: ChangesViewController?
    let dock = DockController()
    let palettes: Palettes
    private(set) lazy var windowToolbar = WindowToolbar(workspaceName: workspace.name, shell: self)

    let split = GutterSplitViewController(vertical: true, autosave: "")
    let body = GutterSplitViewController(vertical: true, autosave: "")
    let center = GutterSplitViewController(vertical: false, autosave: "")
    let surface: SurfaceController
    let sidebarItem: NSSplitViewItem
    let agentItem: NSSplitViewItem
    let dockItem: NSSplitViewItem
    private var paneSizes: PaneSizes?
    private var placedDock = false
    private var userSizedDock = false

    private struct PaneSizes {
        let sidebar: NSLayoutConstraint
        let agent: NSLayoutConstraint
        let dock: NSLayoutConstraint

        var all: [NSLayoutConstraint] { [sidebar, agent, dock] }
    }

    var runTargets: [DebugTarget] = []
    var runTargetsFile: URL?
    var revealed: URL?
    var dismissedBanners: Set<String> = []
    private(set) var appliedPreferences: Preferences?
    var lineNotes: [URL: [LineNote]] = [:]
    var usageNotes: [URL: [LineNote]] = [:]
    var usageActions: [String: (FileLocation, EditorCommand)] = [:]
    var usageTask: Task<Void, Never>?
    var runMarks: [URL: [RunMark]] = [:]
    var repository: GitLocation?
    var lastPosition: EditorPosition?
    var openTabs: [EditorTab] = []
    var closedTabs: [URL] = []
    var recentTabs: [URL] = []
    var changedFiles: [URL] = []
    var diffRefresh: Task<Void, Never>?
    var startedTarget: String?
    weak var preferences: PreferencesCenter?
    var reviewLayout = ReviewLayout.normal
    var isArrangingReview = false
    var diskConflicts: [URL: String] = [:]
    var inlineValuesTask: Task<Void, Never>?
    let serverPanel = ServerStatusPanel()
    var memorySampling: Task<Void, Never>?
    static let memorySampleInterval = Duration.seconds(60)

    static let editorMinHeight: CGFloat = 160
    static let sidebarWidth: CGFloat = 220
    static let paneHolding = NSLayoutConstraint.Priority(270)
    static let dockCapPriority = NSLayoutConstraint.Priority(280)
    static let dockShare: CGFloat = 0.3
    static let sidebarHolding = NSLayoutConstraint.Priority(260)
    static let agentHolding = NSLayoutConstraint.Priority(255)

    init(workspace: Workspace, services: WorkspaceServices) {
        self.workspace = workspace
        self.services = services
        memory = WorkspaceMemory(workspace)
        editor = EditorViewController(workspace: workspace)
        editorPane = EditorPaneController(workspace: workspace, editor: editor)
        terminal = TerminalViewController(workspace: workspace)
        agent = AgentViewController(workspace: workspace)
        navigator = FileNavigatorViewController(workspace: workspace)
        structure = StructureViewController(intelligence: services.language)
        problems = ProblemsViewController(workspace: workspace, intelligence: services.language)
        findResults = FindResultsViewController(workspace: workspace)
        debugView = DebugViewController(debugger: services.debugger)
        searchEngine = SearchEngine(root: workspace.root)
        search = FindInFilesViewController(workspace: workspace, engine: searchEngine)
        let host = HostController()
        changesHost = host
        sidebar = SidebarController(navigators: [
            Navigator(id: "files", title: "Files", symbol: "folder", controller: navigator),
            Navigator(id: "structure", title: "Structure", symbol: "list.bullet.indent", controller: structure),
            Navigator(id: "changes", title: "Changes", symbol: "plusminus", controller: host),
        ], selectedID: memory.state.navigator)
        palettes = Palettes(workspace: workspace)
        surface = SurfaceController(body: body)
        sidebarItem = NSSplitViewItem(viewController: sidebar)
        agentItem = NSSplitViewItem(viewController: agent)
        dockItem = NSSplitViewItem(viewController: dock)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let root = FlippedView()
        let chrome = ChromeBackground()
        root.addSubview(chrome)

        let editorItem = NSSplitViewItem(viewController: editorPane)
        editorItem.minimumThickness = Self.editorMinHeight
        editorItem.holdingPriority = .defaultLow

        dockItem.minimumThickness = Metric.terminalMin
        dockItem.canCollapse = true
        dockItem.holdingPriority = Self.sidebarHolding
        center.addSplitViewItem(editorItem)
        center.addSplitViewItem(dockItem)

        sidebarItem.minimumThickness = PaneFit.sidebarMinimum
        sidebarItem.maximumThickness = Metric.sidebarMax
        sidebarItem.canCollapse = true
        sidebarItem.canCollapseFromWindowResize = true
        sidebarItem.holdingPriority = Self.sidebarHolding

        let centerItem = NSSplitViewItem(viewController: center)
        centerItem.minimumThickness = Metric.editorMin
        centerItem.holdingPriority = .defaultLow
        agentItem.minimumThickness = Metric.agentMin
        agentItem.maximumThickness = Metric.agentMax
        agentItem.canCollapse = true
        agentItem.canCollapseFromWindowResize = true
        agentItem.holdingPriority = Self.agentHolding

        [centerItem, agentItem].forEach(body.addSplitViewItem)
        let surfaceItem = NSSplitViewItem(viewController: surface)
        surfaceItem.minimumThickness = Metric.editorMin
        surfaceItem.holdingPriority = .defaultLow
        [sidebarItem, surfaceItem].forEach(split.addSplitViewItem)
        addChild(split)
        let panes = split.view
        panes.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(panes)

        NSLayoutConstraint.activate([
            chrome.topAnchor.constraint(equalTo: root.topAnchor),
            chrome.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            chrome.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            chrome.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            panes.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            panes.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            panes.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -ContentSurface.inset),
            panes.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -ContentSurface.inset),
        ])
        let panesState = memory.state.panes
        let sizes = PaneSizes(
            sidebar: sidebar.view.widthAnchor.constraint(equalToConstant: panesState.sidebarWidth ?? Self.sidebarWidth),
            agent: agent.view.widthAnchor.constraint(equalToConstant: panesState.agentWidth ?? Metric.agentWidth),
            dock: dock.view.heightAnchor.constraint(equalToConstant: panesState.dockHeight ?? Metric.terminalHeight)
        )
        sizes.all.forEach { $0.priority = Self.paneHolding }
        NSLayoutConstraint.activate(sizes.all)
        paneSizes = sizes
        dock.view.heightAnchor.constraint(lessThanOrEqualTo: center.view.heightAnchor, multiplier: Self.dockShare)
            .withPriority(Self.dockCapPriority).isActive = true
        sidebarItem.isCollapsed = !panesState.isSidebarOpen
        surface.insetsLeadingEdge(sidebarItem.isCollapsed)
        agentItem.isCollapsed = !panesState.isAgentOpen
        dockItem.isCollapsed = !panesState.isDockOpen
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        dock.add(ToolWindow(id: .terminal, title: "Terminal", toolTip: terminal.paneTitle, isClosable: false,
                            controller: terminal))
        dock.add(ToolWindow(id: .problems, title: "Problems", count: problems.count, isClosable: false, controller: problems))
        wire()
        restoreTabs()
        tabsDidChange()
        restoreDock()
        refreshBranch()
        refreshRunTargets()
        startChanges()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(refreshBranch), name: NSApplication.didBecomeActiveNotification, object: nil)
        for splitView in [split.splitView, body.splitView, self.center.splitView] {
            center.addObserver(self, selector: #selector(panesDidResize(_:)), name: NSSplitView.didResizeSubviewsNotification,
                               object: splitView)
        }
    }

    func fitToolbarPlace() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            windowToolbar.fit(columnEndingAt: sidebarItem.isCollapsed ? nil : sidebar.view.convert(sidebar.view.bounds, to: nil).maxX)
        }
    }

    func raiseDock(to wanted: CGFloat) {
        guard !dockItem.isCollapsed, let sizes = paneSizes else { return }
        let column = center.view.frame.height
        let limit = userSizedDock ? wanted : min(wanted, column * Self.dockShare)
        guard dock.view.frame.height < limit else { return }
        sizes.dock.constant = limit
        center.splitView.setPosition(column - limit - Metric.hairline, ofDividerAt: 0)
    }

    private func placeDock() {
        guard !placedDock, let sizes = paneSizes, !dockItem.isCollapsed else { return }
        placedDock = true
        view.layoutSubtreeIfNeeded()
        let column = center.view.frame.height
        let height = min(sizes.dock.constant, column * Self.dockShare)
        center.splitView.setPosition(column - height - Metric.hairline, ofDividerAt: 0)
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        Task { @MainActor [weak self] in
            self?.placeDock()
            self?.fitToolbarPlace()
            if self?.editor.selectedURL != nil { self?.editor.focus() }
        }
        startMemorySampling()
    }

    override func viewWillDisappear() {
        super.viewWillDisappear()
        memorySampling?.cancel()
        memorySampling = nil
    }

    @objc private func refreshBranch() {
        windowToolbar.show(branch: GitHead.branch(in: workspace.root))
    }

    private func restoreDock() {
        if let saved = memory.state.dockWindow.flatMap(ToolWindowID.init(rawValue:)), dock.contains(saved) { dock.show(saved) }
    }

    func setDock(open: Bool, from sender: Any?) {
        guard dockItem.isCollapsed == open else { return }
        userMovedPanes()
        terminal.isResizeSuspended = true
        center.toggle(dockItem, from: sender) { [weak self] in
            guard let self else { return }
            terminal.isResizeSuspended = false
            rememberPanes()
        }
    }

    func showToolWindow(_ id: ToolWindowID, from sender: Any? = nil) {
        guard dock.contains(id) else { return }
        dock.show(id)
        setDock(open: true, from: sender)
    }

    func setAgent(open: Bool, from sender: Any?) {
        guard agentItem.isCollapsed == open else { return }
        body.toggle(agentItem, from: sender) { [weak self] in self?.rememberPanes() }
    }

    func setSidebar(open: Bool, from sender: Any?) {
        guard sidebarItem.isCollapsed == open else { return }
        userMovedPanes()
        surface.insetsLeadingEdge(!open)
        split.toggle(sidebarItem, from: sender) { [weak self] in self?.rememberPanes() }
    }

    func fitPanes(toWindowWidth width: CGFloat) {
        for pane in PaneFit.collapses(width: width, isSidebarOpen: !sidebarItem.isCollapsed, isAgentOpen: !agentItem.isCollapsed) {
            switch pane {
            case .agent: agentItem.isCollapsed = true
            case .sidebar:
                sidebarItem.isCollapsed = true
                surface.insetsLeadingEdge(true)
            }
        }
        rememberPanes()
    }

    @objc func panesDidResize(_ notification: Notification) {
        let dragging = [NSEvent.EventType.leftMouseDragged, .leftMouseUp].contains(NSApp.currentEvent?.type)
        guard dragging, notification.userInfo?["NSSplitViewDividerIndex"] != nil, let sizes = paneSizes else { return }
        let columns = split.splitView.arrangedSubviews.map(\.frame.width)
        let inner = body.splitView.arrangedSubviews.map(\.frame.width)
        let rows = center.splitView.arrangedSubviews.map(\.frame.height)
        guard columns.count == split.splitViewItems.count, inner.count == body.splitViewItems.count,
              rows.count == center.splitViewItems.count else { return }
        let measured: [(NSSplitViewItem, NSLayoutConstraint, CGFloat)] = [
            (sidebarItem, sizes.sidebar, columns[0]), (agentItem, sizes.agent, inner[1]), (dockItem, sizes.dock, rows[1]),
        ]
        for (item, constraint, length) in measured where !item.isCollapsed && length >= item.minimumThickness {
            constraint.constant = length
            if item === dockItem { userSizedDock = true }
        }
        rememberPanes()
    }

    private func rememberPanes() {
        fitToolbarPlace()
        guard let sizes = paneSizes else { return }
        memory.update { state in
            state.panes = WorkspaceState.Panes(
                sidebarWidth: sizes.sidebar.constant, agentWidth: sizes.agent.constant, dockHeight: sizes.dock.constant,
                isSidebarOpen: !sidebarItem.isCollapsed, isAgentOpen: !agentItem.isCollapsed,
                isDockOpen: !dockItem.isCollapsed
            )
        }
    }

    func preferencesDidChange(_ preferences: Preferences) {
        appliedPreferences = preferences
        if services.language.settings != preferences.language {
            services.language.settings = preferences.language
            refreshUsages(for: editor.selectedURL)
        }
        let terminalPreferences = preferences.terminal.terminalPreferences
        for controller in [terminal, dock.controller(.folderTerminal)].compactMap({ $0 as? TerminalViewController })
        where controller.preferences != terminalPreferences {
            controller.apply(terminalPreferences)
        }
        let debugging = preferences.tools.debugSettings
        if services.debugger.settings != debugging { services.debugger.settings = debugging }
        let editing = preferences.editor
        editor.apply(EditorPreferences(
            fontFamily: editing.fontFamily, fontSize: editing.fontSize, lineHeight: (editing.fontSize * editing.lineHeight).rounded(),
            defaultIndent: Indent(usesTabs: editing.usesTabs, width: editing.tabWidth), showsIndentGuides: editing.showsIndentGuides,
            showsStickyDeclarations: editing.showsStickyDeclarations, showsInlayHints: editing.showsInlayHints,
            showsChangeBars: editing.showsChangeBars, trimsTrailingWhitespace: editing.trimsTrailingWhitespace,
            ensuresFinalNewline: editing.ensuresFinalNewline
        ))
    }

    func refreshToolbar() {
        view.window?.toolbar?.validateVisibleItems()
        windowToolbar.validateGroups { [weak self] id in Commands.command(id).map { self?.canRun($0) ?? false } ?? false }
        for id in [CommandID.startDebugging, .runWithoutDebugging, .stop, .toggleBottomPanel, .toggleAgent] {
            guard let command = Commands.command(id) else { continue }
            if id == .startDebugging {
                windowToolbar.retitle(id, title: title(for: command), label: isPaused ? "Continue" : "Debug",
                                      symbol: isPaused ? "forward.end" : "ladybug")
            } else {
                windowToolbar.retitle(id, title: title(for: command))
            }
        }
    }
}

extension NSLayoutConstraint {
    func withPriority(_ priority: NSLayoutConstraint.Priority) -> NSLayoutConstraint {
        self.priority = priority
        return self
    }
}
