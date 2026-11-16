import AppKit
import NyteCore
import NyteUI
import os

@MainActor
public final class FindInFilesViewController: NSViewController {
    public enum OpenIntent: Sendable {
        case focusEditor
        case keepFocus
    }

    public var onOpen: ((FileLocation, OpenIntent) -> Void)?
    public var unsavedText: (() -> [URL: String])?
    public var openFiles: (() -> [URL])?
    public var changedFiles: (() -> [URL])? { didSet { updateScopes() } }
    public var onApply: ((WorkspaceEdit) async -> Bool)?
    public var onAskAgent: (([AgentContext]) -> Void)?
    public var limits = SearchQuery.Limits()

    enum Phase {
        case idle
        case searching(SearchProgress)
        case done(SearchSummary)
    }

    enum Scope: Equatable {
        case workspace, openFiles, changedFiles
        case folder(String)
    }

    enum RowKind: UInt8 {
        case folder, file, match, failures, failure
    }

    struct FolderRow {
        var path: String
        var title: String
        var count: Int
    }

    static let interactionGrace = Duration.milliseconds(1_500)

    static let listShare: CGFloat = 0.55
    static let stackedShare: CGFloat = 0.5

    let workspace: Workspace
    let engine: SearchEngine
    let bar = QueryBar()
    let list = ListView()
    let preview = CodeView()
    let split = HairlineSplitView()
    let listHost = NSView()
    let content = NSView()
    let bannerHost = NSStackView()
    var empty: NSView?
    var signposter = OSSignposter(logger: Logger.search)

    var phase = Phase.idle
    var results = SearchResults()
    var awaitingSwap = false
    var fileOpen: [Bool] = []
    var fileShown: [Int32] = []
    var dismissed: [Bool] = []
    var failuresOpen = false
    var failures: [SearchFailure] = []
    var rowKind: [RowKind] = [] { didSet { headerRowsStale = true } }
    var headerRowsStale = true
    var headerRows: [Int] = []
    var rowIndex: [Int32] = []
    var rowDepth: [UInt8] = []
    var folderRows: [FolderRow] = []
    var displayFiles: [Int32] = []
    var unplaced: [Int32] = []
    var closedFolders: Set<String> = []
    var groupsByFolder = false
    var lastInteraction = ContinuousClock.now - FindInFilesViewController.interactionGrace
    var compensating = false
    var placementTask: Task<Void, Never>?
    var bulkTask: Task<Void, Never>?
    var syntaxCache: [Int32: [(range: NSRange, color: SyntaxColor)]] = [:]
    var swaps = 0
    var shownPreview = PreviewText()
    var widestLine: Int32 = 0
    var generation = 0
    var runTask: Task<Void, Never>?
    var run: SearchRun?
    var lastQuery: SearchQuery?
    var unsaved: [String: String] = [:]
    var caseSensitive = false
    var wholeWord = false
    var isRegex = false
    var preservesCase = false
    var includesIgnored = false
    var scope = Scope.workspace
    var history: SearchHistory
    var historyCursor = HistoryCursor()
    var keptSelection: (path: String, line: Int32, column: Int32)?
    var previewTask: Task<Void, Never>?
    var previewKey: (path: String, line: Int32)?
    var replacer: Replacer?
    var replaceExpression: NSRegularExpression?
    var lastPlacement: PreviewPlacement?
    let lexCheckpoints = LexCheckpoints()

    public init(workspace: Workspace, engine: SearchEngine? = nil) {
        self.workspace = workspace
        self.engine = engine ?? SearchEngine(root: workspace.root)
        history = SearchHistory.load(root: workspace.root)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    isolated deinit {
        runTask?.cancel()
        run?.cancel()
        previewTask?.cancel()
        placementTask?.cancel()
        bulkTask?.cancel()
    }

    override public func loadView() {
        let root = ToolWindowView(header: .fitting)
        root.setAccessibilityLabel("Find in Files")
        root.onKey = { [weak self] in self?.handleKey($0) ?? false }
        root.onWidthChange = { [weak self] in self?.layoutChanged() }
        root.onAppearanceChange = { [weak self] in self?.list.reload() }
        Pin.fill(bar, in: root.header, insets: NSEdgeInsets(top: Space.x1, left: Metric.paneInset, bottom: Space.x1, right: Metric.paneInset))
        bannerHost.orientation = .vertical
        bannerHost.alignment = .leading
        bannerHost.translatesAutoresizingMaskIntoConstraints = false
        content.translatesAutoresizingMaskIntoConstraints = false
        for view in [bannerHost, content] { root.content.addSubview(view) }
        NSLayoutConstraint.activate([
            bannerHost.topAnchor.constraint(equalTo: root.content.topAnchor),
            bannerHost.leadingAnchor.constraint(equalTo: root.content.leadingAnchor, constant: Metric.paneInset),
            bannerHost.trailingAnchor.constraint(equalTo: root.content.trailingAnchor, constant: -Metric.paneInset),
            content.topAnchor.constraint(equalTo: bannerHost.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: root.content.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: root.content.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: root.content.bottomAnchor),
        ])
        Pin.fill(split, in: content)
        split.addArrangedSubview(listHost)
        split.addArrangedSubview(preview)
        split.isVertical = true
        Pin.fill(list, in: listHost)
        root.follow(list.scrollView)
        configureList()
        configureBar()
        view = root
        updateScopes()
        render()
    }

    override public func viewDidAppear() {
        super.viewDidAppear()
        warmFiles()
    }

    public func warmFiles() {
        let engine = engine, ignored = includesIgnored
        Task.detached(priority: .utility) { _ = engine.files(includingIgnored: ignored) }
    }

    public func find(_ text: String?) {
        loadViewIfNeeded()
        if let text, !text.isEmpty, !text.contains("\n") {
            bar.field.stringValue = text
            historyCursor.reset()
        }
        view.window?.makeFirstResponder(bar.field.field)
        list.showsFocusAlways = true
        bar.field.field.currentEditor()?.selectAll(nil)
        startSearch()
    }

    public func find(inFolder url: URL) {
        loadViewIfNeeded()
        let relative = workspace.relativePath(of: url)
        choose(relative == url.standardizedFileURL.path || relative.isEmpty ? .workspace : .folder(relative))
        view.window?.makeFirstResponder(bar.field.field)
    }

    public func filesDidChange() {
        engine.invalidateFiles()
    }

    public var query: SearchQuery {
        let globsIn = SearchQuery.globs(from: bar.include.stringValue)
        let globsOut = SearchQuery.globs(from: bar.exclude.stringValue)
        let searchScope: SearchQuery.Scope = switch scope {
        case .workspace: .workspace
        case let .folder(path): .folder(path)
        case .openFiles: .files((openFiles?() ?? []).map(workspace.relativePath(of:)))
        case .changedFiles: .files((changedFiles?() ?? []).map(workspace.relativePath(of:)))
        }
        return SearchQuery(bar.field.stringValue, caseMode: caseSensitive ? .sensitive : .smart, wholeWord: wholeWord, isRegex: isRegex,
                           include: globsIn, exclude: globsOut, scope: searchScope, includesIgnored: includesIgnored, limits: limits)
    }

    func startSearch() {
        let query = query
        replacer = nil
        bulkTask?.cancel()
        guard !query.text.isEmpty else {
            stopRun()
            generation += 1
            lastQuery = nil
            setPatternError(nil)
            phase = .idle
            replaceResults(with: SearchResults())
            return render()
        }
        if let error = SearchEngine.validate(query) {
            setPatternError(error.message)
            return
        }
        setPatternError(nil)
        stopRun()
        generation += 1
        let generation = generation
        unsaved = Dictionary((unsavedText?() ?? [:]).map { (workspace.relativePath(of: $0.key), $0.value) }) { first, _ in first }
        let started: SearchRun
        do {
            started = try engine.start(query, unsaved: unsaved)
        } catch {
            return setPatternError(error.message)
        }
        if let row = list.selectedRow, rowKind[row] == .match {
            let match = Int(rowIndex[row])
            keptSelection = (results.paths[Int(results.matchFile[match])], results.matchLine[match], results.matchColumn[match])
        }
        lastQuery = query
        run = started
        awaitingSwap = true
        phase = .searching(SearchProgress())
        render()
        runTask = Task { [weak self] in
            for await event in started.events {
                guard let self, self.generation == generation else { return }
                self.receive(event)
            }
        }
    }

    func stopRun() {
        runTask?.cancel()
        runTask = nil
        run?.cancel()
        run = nil
    }

    func stopSearch() {
        run?.cancel()
    }

    private func receive(_ event: SearchEvent) {
        switch event {
        case let .batch(batch, progress):
            let interval = signposter.beginInterval("search batch")
            defer { signposter.endInterval("search batch", interval) }
            if awaitingSwap {
                if !batch.isEmpty { replaceResults(with: batch) }
            } else if !batch.isEmpty {
                appendResults(batch)
            }
            placeUnplaced()
            phase = .searching(progress)
            render()
        case let .finished(summary):
            if awaitingSwap { replaceResults(with: SearchResults()) }
            keptSelection = nil
            selectFirstIfNone()
            failures = summary.failures
            placeUnplaced()
            if !failures.isEmpty { appendFailureRows() }
            phase = .done(summary)
            run = nil
            render()
        }
    }

    func setPatternError(_ message: String?) {
        bar.field.isInvalid = message != nil
        bar.field.message = message ?? ""
        view.needsLayout = true
    }

    private func layoutChanged() {
        list.reload()
        view.needsLayout = true
    }

    override public func viewDidLayout() {
        super.viewDidLayout()
        let placement = PreviewPlacement.decide(width: view.bounds.width)
        guard placement != lastPlacement, split.bounds.width > 0, split.bounds.height > 0 else { return }
        lastPlacement = placement
        split.isVertical = placement == .beside
        split.adjustSubviews()
        let total = placement == .beside ? split.bounds.width : split.bounds.height
        split.setPosition((total * (placement == .beside ? Self.listShare : Self.stackedShare)).rounded(), ofDividerAt: 0)
    }
}

enum PreviewPlacement: Equatable {
    case beside, below

    static let narrowWidth: CGFloat = 760

    static func decide(width: CGFloat) -> PreviewPlacement {
        width >= narrowWidth ? .beside : .below
    }
}
