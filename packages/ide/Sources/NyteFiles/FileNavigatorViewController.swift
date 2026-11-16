import AppKit
import NyteCore
import NyteUI
import os

enum FilesLog {
    static let logger = Logger(subsystem: "ai.nyte.ide", category: "files")
}

@MainActor
public final class FileNavigatorViewController: NSViewController {
    public var onOpen: ((URL, _ preview: Bool) -> Void)?
    public var onFilesChange: (([URL]) -> Void)?
    public var onOpenInTerminal: ((URL) -> Void)?
    public var onFindInFolder: ((URL) -> Void)?
    public var onAskAgent: (([URL]) -> Void)?

    enum GitRefresh { case idle, running, runningStale }
    enum GitSource { case unknown, repository(GitRepository), none }
    enum AfterReload { case select(String), rename(String) }

    let workspace: Workspace
    var tree: FileTree
    let list = ListView()
    var renaming: Renaming?
    var afterReload: AfterReload?
    lazy var history = FileHistory(undoManager: { [weak self] in self?.view.window?.undoManager }) { [weak self] operation, result in
        self?.finished(operation, result)
    }
    private var watcher: DirectoryWatcher?
    private var git: GitStatus?
    private var gitSource = GitSource.unknown
    private var gitRefresh = GitRefresh.idle
    private var pendingReloads = Set<String>()
    private var isReloading = false
    private var revealGeneration = 0
    private var isRevealing = false

    public init(workspace: Workspace) {
        self.workspace = workspace
        tree = FileTree(rootPath: workspace.root.path)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }


    override public func loadView() {
        let root = NavigatorView()
        root.onAppearanceChange = { [weak self] in self?.list.reload() }
        root.onWidthChange = { [weak self] in
            guard let self else { return }
            self.list.reloadRows(IndexSet(integersIn: self.list.visibleRows))
        }
        list.isOutline = true
        list.deletesWithCommandOnly = true
        list.rowCount = { [weak self] in self?.tree.rowCount ?? 0 }
        list.content = { [weak self] row in self?.content(row) ?? RowContent() }
        list.onSelect = { [weak self] rows in self?.selectionChanged(rows) }
        list.onActivate = { [weak self] row in self?.activate(row) }
        list.onToggle = { [weak self] row in self?.toggle(row: row) }
        list.onReturn = { [weak self] row in self?.beginRename(row: row) }
        list.onDelete = { [weak self] rows in rows.first.map { self?.trash(row: $0) } }
        list.menuForRows = { [weak self] rows in self?.menu(for: rows) }
        list.setAccessibilityLabel("Files")
        root.addSubview(list)
        NSLayoutConstraint.activate([
            list.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            list.topAnchor.constraint(equalTo: root.topAnchor),
            list.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        view = root
    }

    override public func viewDidLoad() {
        super.viewDidLoad()
        NotificationCenter.default.addObserver(
            self, selector: #selector(refreshGit), name: NSApplication.didBecomeActiveNotification, object: nil
        )
        Task { await open() }
    }

    public func reveal(_ url: URL) {
        let relative = workspace.relativePath(of: url)
        guard !relative.hasPrefix("/") else { return }
        revealGeneration += 1
        let generation = revealGeneration
        Task { await reveal(relative, generation: generation) }
    }

    private func open() async {
        let saved = NavigatorState.load(root: workspace.root.path, from: .standard).expanded.sorted { $0.utf8.count < $1.utf8.count }
        let listings = await read([""] + saved)
        guard let rootListing = listings[""] else {
            return FilesLog.logger.error("Could not list the workspace folder \(self.workspace.root.path, privacy: .public)")
        }
        _ = tree.load(rootListing, into: FileTree.root, icon: Self.icon)
        for path in saved {
            guard let node = tree.node(at: path), tree.flags(of: node).contains(.directory) else { continue }
            _ = tree.expand(node)
            if let listing = listings[path] { _ = tree.load(listing, into: node, icon: Self.icon) }
        }
        list.reload()
        let realRoot = realpath(workspace.root.path, nil).map { resolved in
            defer { free(resolved) }
            return String(cString: resolved)
        } ?? workspace.root.path
        watcher = DirectoryWatcher(path: realRoot) { [weak self] changes in self?.filesChanged(changes, under: realRoot) }
        refreshGit()
    }

    private func read(_ paths: [String]) async -> [String: DirectoryListing] {
        let root = workspace.root.path
        return await withTaskGroup(of: (String, DirectoryListing?).self) { group in
            for path in paths {
                group.addTask { (path, await DirectoryListing.read(path.isEmpty ? root : root + "/" + path)) }
            }
            var listings: [String: DirectoryListing] = [:]
            for await (path, listing) in group {
                if listing == nil { FilesLog.logger.error("Could not list \(path, privacy: .public)") }
                listings[path] = listing
            }
            return listings
        }
    }

    @discardableResult
    private func load(_ node: FileTree.Node) async -> Bool {
        guard !tree.flags(of: node).contains(.loaded) else { return true }
        let path = tree.relativePath(of: node)
        guard let listing = await DirectoryListing.read(tree.path(of: node)) else {
            FilesLog.logger.error("Could not list \(path, privacy: .public)")
            return false
        }
        guard tree.node(at: path) == node else { return false }
        if !tree.flags(of: node).contains(.loaded) {
            apply(tree.load(listing, into: node, icon: Self.icon))
            applyMarks()
        }
        return true
    }

    private static func icon(_ name: String) -> UInt8 { FileIcon.forFile(named: name).index }

    private func filesChanged(_ changes: [DirectoryWatcher.Change], under realRoot: String) {
        let prefix = realRoot + "/"
        let files = changes.filter(\.isFile).map { URL(fileURLWithPath: $0.path) }
        if !files.isEmpty { onFilesChange?(files) }
        for change in changes {
            let item = change.path.hasSuffix("/") ? String(change.path.dropLast()) : change.path
            let path = item == realRoot ? item : (item as NSString).deletingLastPathComponent
            guard path == realRoot || path.hasPrefix(prefix) else { continue }
            let relative = path == realRoot ? "" : String(path.dropFirst(prefix.count))
            guard let node = tree.node(at: relative), tree.flags(of: node).contains(.loaded) else { continue }
            let directories = change.recursive ? tree.loadedDirectories(in: node) : [node]
            pendingReloads.formUnion(directories.map { tree.relativePath(of: $0) })
        }
        reloadPending()
        refreshGit()
    }

    func reloadDirectory(of url: URL) {
        let parent = workspace.relativePath(of: url.deletingLastPathComponent())
        pendingReloads.insert(parent == workspace.root.path ? "" : parent)
        reloadPending()
        refreshGit()
    }

    private func reloadPending() {
        guard !isReloading, !pendingReloads.isEmpty else { return }
        isReloading = true
        Task {
            while !pendingReloads.isEmpty {
                let paths = pendingReloads.sorted { $0.utf8.count < $1.utf8.count }
                pendingReloads = []
                let listings = await read(paths)
                keepingScrollAnchor {
                    for path in paths {
                        guard let node = tree.node(at: path), tree.flags(of: node).contains(.loaded),
                              let listing = listings[path] else { continue }
                        apply(tree.load(listing, into: node, icon: Self.icon))
                    }
                }
                applyMarks()
            }
            isReloading = false
            finishAfterReload()
        }
    }

    private func finishAfterReload() {
        guard let pending = afterReload else { return }
        let path = switch pending {
        case let .select(path), let .rename(path): path
        }
        guard let node = tree.node(at: path) else { return }
        afterReload = nil
        if let parent = tree.parent(of: node), parent != FileTree.root, !tree.flags(of: parent).contains(.expanded) { expand(parent) }
        guard let row = tree.row(of: node) else { return }
        select(row)
        if case .rename = pending { beginRename(row: row) }
    }

    @objc private func refreshGit() {
        switch gitRefresh {
        case .running, .runningStale:
            gitRefresh = .runningStale
            return
        case .idle:
            gitRefresh = .running
        }
        Task {
            repeat {
                gitRefresh = .running
                git = await readGit()
                applyMarks()
            } while gitRefresh == .runningStale
            gitRefresh = .idle
        }
    }

    private func readGit() async -> GitStatus? {
        if case .unknown = gitSource {
            switch await GitRepository.locate(workspace.root) {
            case let .repository(repository):
                gitSource = .repository(repository)
            case .notRepository:
                gitSource = .none
            case let .gitMissing(message):
                FilesLog.logger.error("No git status in the navigator: \(message, privacy: .public)")
                gitSource = .none
            case let .failed(failure):
                FilesLog.logger.error("\(failure.command, privacy: .public) failed: \(failure.message, privacy: .public)")
                return git
            }
        }
        guard case let .repository(repository) = gitSource else { return nil }
        do {
            return try await GitStatus.read(repository, workspace: workspace.root)
        } catch {
            if error.reason != .cancelled {
                FilesLog.logger.error("\(error.command, privacy: .public) failed: \(error.message, privacy: .public)")
            }
            return git
        }
    }

    private func applyMarks() {
        tree.applyStatus(git?.changes ?? [], ignored: git?.ignored ?? [])
        list.reloadRows(IndexSet(integersIn: list.visibleRows))
    }

    private func toggle(row: Int) {
        let node = tree.node(atRow: row)
        guard tree.flags(of: node).contains(.directory) else { return }
        let wholeSubtree = NSApp.currentEvent?.modifierFlags.contains(.option) == true
        switch (tree.flags(of: node).contains(.expanded), wholeSubtree) {
        case (true, false): collapse(node)
        case (false, false): expand(node)
        case (true, true): collapseSubtree(node)
        case (false, true): Task { await expandSubtree(node) }
        }
    }

    override public func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
        guard flags == .option, let key = event.specialKey, key == .rightArrow || key == .leftArrow,
              let row = list.selectedRow, row < tree.rowCount else { return super.keyDown(with: event) }
        let node = tree.node(atRow: row)
        guard tree.flags(of: node).contains(.directory) else { return super.keyDown(with: event) }
        if key == .rightArrow { Task { await expandSubtree(node) } } else { collapseSubtree(node) }
    }

    private func expandSubtree(_ node: FileTree.Node) async {
        if !tree.flags(of: node).contains(.expanded) { expand(node) }
        guard await load(node), tree.isLive(node) else { return }
        for child in tree.children(of: node) where tree.flags(of: child).contains(.directory) && !tree.flags(of: child).contains(.symlink) {
            await expandSubtree(child)
        }
    }

    private func collapseSubtree(_ node: FileTree.Node) {
        collapse(node)
        for directory in tree.loadedDirectories(in: node) where directory != node { _ = tree.collapse(directory) }
        NavigatorState(expanded: tree.expandedPaths).save(root: workspace.root.path, to: .standard)
    }

    func expand(_ node: FileTree.Node) {
        list.insertRows(IndexSet(integersIn: tree.expand(node)), animated: false)
        didToggle(node)
        guard !tree.flags(of: node).contains(.loaded) else { return }
        Task { await load(node) }
    }

    private func collapse(_ node: FileTree.Node) {
        if let renaming, tree.isLive(renaming.node), isDescendant(renaming.node, of: node) { cancelRename() }
        list.removeRows(IndexSet(integersIn: tree.collapse(node)), animated: false)
        didToggle(node)
    }

    private func isDescendant(_ node: FileTree.Node, of ancestor: FileTree.Node) -> Bool {
        var cursor = tree.parent(of: node)
        while let current = cursor {
            if current == ancestor { return true }
            cursor = tree.parent(of: current)
        }
        return false
    }

    private func didToggle(_ node: FileTree.Node) {
        if let row = tree.row(of: node) { list.reloadRows(IndexSet(integer: row)) }
        positionRenameField()
        NavigatorState(expanded: tree.expandedPaths).save(root: workspace.root.path, to: .standard)
    }

    private func reveal(_ relative: String, generation: Int) async {
        var node = FileTree.root
        for component in relative.split(separator: "/") {
            guard await load(node), generation == revealGeneration else { return }
            if node != FileTree.root, !tree.flags(of: node).contains(.expanded) { expand(node) }
            guard let child = tree.child(of: node, named: String(component)) else { return }
            node = child
        }
        guard let row = tree.row(of: node) else { return }
        isRevealing = true
        list.selectedRow = row
        isRevealing = false
    }

    private func apply(_ change: FileTree.RowChange) {
        guard !change.isEmpty else { return }
        list.removeRows(change.removed, animated: false)
        list.insertRows(change.inserted, animated: false)
        if let renaming, !tree.isLive(renaming.node) { cancelRename() }
        positionRenameField()
    }

    private func keepingScrollAnchor(_ body: () -> Void) {
        let clip = list.scrollView.contentView
        let anchorRow = list.visibleRows.first
        let anchor = anchorRow.map { tree.node(atRow: $0) }
        let offset = anchorRow.map { clip.bounds.minY - CGFloat($0) * list.rowHeight } ?? 0
        body()
        guard let anchor, tree.isLive(anchor), let row = tree.row(of: anchor) else { return }
        clip.scroll(to: NSPoint(x: 0, y: CGFloat(row) * list.rowHeight + offset))
        list.scrollView.reflectScrolledClipView(clip)
    }

    func url(_ node: FileTree.Node) -> URL {
        workspace.root.appendingPathComponent(tree.relativePath(of: node), isDirectory: tree.flags(of: node).contains(.directory))
    }

    func select(_ row: Int) {
        isRevealing = true
        list.selectedRow = row
        isRevealing = false
    }

    private func selectionChanged(_ rows: IndexSet) {
        guard !isRevealing, let row = rows.first, rows.count == 1 else { return }
        let node = tree.node(atRow: row)
        guard !tree.flags(of: node).contains(.directory) else { return }
        onOpen?(url(node), true)
    }

    private func activate(_ row: Int) {
        let node = tree.node(atRow: row)
        guard tree.flags(of: node).contains(.directory) else { return onOpen?(url(node), false) ?? () }
        toggle(row: row)
    }

    private func content(_ row: Int) -> RowContent {
        let node = tree.node(atRow: row)
        var content = baseContent(node)
        if renaming?.node == node { return hidingTitle(content) }
        if collidesWithSibling(row, content) { content.titleTruncation = .keepingExtension(preferEnd: true) }
        return content
    }

    private func baseContent(_ node: FileTree.Node) -> RowContent {
        let flags = tree.flags(of: node)
        let name = tree.name(of: node)
        var content = RowContent(title: name, depth: tree.depth(of: node))
        content.layout = .tree
        content.titleTruncation = .keepingExtension(preferEnd: false)
        let isIgnored = flags.contains(.ignored)
        guard !flags.contains(.directory) else {
            content.disclosure = flags.contains(.expanded) ? .open : .closed
            content.titleInk = isIgnored ? .tertiary : .secondary
            content.leading = FileIcon.folderLeading(open: flags.contains(.expanded), ink: content.titleInk)
            if flags.contains(.containsChanges) {
                content.changeDot = Palette.gitContainsChange
                content.accessibilityLabel = name + ", contains changes"
            }
            if isIgnored { content.accessibilityLabel = name + ", ignored" }
            return content
        }
        let image = FileIcon(index: tree.icon(of: node)).image(for: view.effectiveAppearance)
        let mark = Self.change(tree.status(of: node))
        content.titleInk = mark?.ink ?? (isIgnored ? .tertiary : .secondary)
        content.leading = mark.map { .tinted(image, $0.ink.color) } ?? (isIgnored ? .tinted(image, Palette.fileIconNeutral) : .image(image))
        content.status = mark?.status
        if let mark { content.accessibilityLabel = name + ", " + mark.word } else if isIgnored { content.accessibilityLabel = name + ", ignored" }
        return content
    }

    private func widthContent(_ node: FileTree.Node) -> RowContent {
        var content = RowContent(title: tree.name(of: node), depth: tree.depth(of: node))
        content.layout = .tree
        let flags = tree.flags(of: node)
        if flags.contains(.directory) {
            if flags.contains(.containsChanges) { content.changeDot = Palette.gitContainsChange }
        } else {
            content.status = Self.change(tree.status(of: node))?.status
        }
        return content
    }

    private func collidesWithSibling(_ row: Int, _ content: RowContent) -> Bool {
        let width = list.scrollView.contentView.bounds.width
        let font = TextStyle.base.font()
        func fitted(_ content: RowContent) -> String {
            RowContent.fit(content.title, width: RowCell.Geometry.titleRoom(content, width: width), font: font,
                           truncation: .keepingExtension(preferEnd: false))
        }
        let mine = fitted(content)
        guard mine != content.title else { return false }
        let node = tree.node(atRow: row)
        let parent = tree.parent(of: node)
        return [row - 1, row + 1].contains { neighbour in
            guard neighbour >= 0, neighbour < tree.rowCount else { return false }
            let other = tree.node(atRow: neighbour)
            return tree.parent(of: other) == parent && fitted(widthContent(other)) == mine
        }
    }

    private func hidingTitle(_ content: RowContent) -> RowContent {
        var hidden = content
        hidden.title = ""
        hidden.status = nil
        hidden.changeDot = nil
        return hidden
    }

    static func change(_ status: FileTree.Status) -> GitChange? {
        switch status {
        case .clean: nil
        case .modified: .modified
        case .added: .added
        case .deleted: .deleted
        case .renamed: .renamed
        case .untracked: .untracked
        case .conflicted: .conflicted
        }
    }
}

@MainActor
private final class NavigatorView: NSView {
    var onAppearanceChange: (() -> Void)?
    var onWidthChange: (() -> Void)?
    private var lastWidth: CGFloat = 0

    override func layout() {
        super.layout()
        guard bounds.width != lastWidth else { return }
        lastWidth = bounds.width
        onWidthChange?()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        onAppearanceChange?()
    }
}
