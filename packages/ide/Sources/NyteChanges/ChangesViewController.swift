import AppKit
import NyteCore
import NyteUI
import os

@MainActor
public final class ChangesViewController: NSViewController {
    enum Phase {
        case locating
        case gitMissing(String)
        case notRepository
        case failed(GitRepository?, GitFailure)
        case ready(GitRepository, ChangesSnapshot?)
    }

    enum Refresh { case idle, running, runningStale }

    static let countsNeedWidth: CGFloat = 360

    public var onOpenDiff: ((DiffViewController) -> Void)?
    public var onOpenFile: ((URL) -> Void)?
    public var onCountChange: ((Int) -> Void)?
    public var openText: ((URL) -> String?)?
    public var onChangedFilesChange: ((ChangedFiles) -> Void)?
    public private(set) var changedFiles = ChangedFiles()
    public private(set) var count = 0

    let workspace: Workspace
    let environment: [String: String]
    let gitExecutable: URL
    var phase = Phase.locating
    var rows = ChangeRows()
    var collapsed: Set<ChangeGroup> = []
    var refreshing = Refresh.idle
    var refreshTask: Task<Void, Never>?
    var operation: Task<Void, Never>?
    var message = ""
    var amending = false
    var committing = false
    var amendPrefill: String?
    var diffs: [WeakDiff] = []
    var wasWide: Bool?
    var openDiff: (path: String, comparison: DiffComparison)?

    let list = ListView()
    let commitBox = CommitBox()
    let branch = Label("", style: .sm, color: Palette.contentSecondary)
    let tracking = Label("", style: .sm, color: Palette.contentTertiary)
    let content = NSView()
    var state: NSView?
    var notice: Banner?
    let noticeHost = NSStackView()

    public init(workspace: Workspace, environment: [String: String] = ProcessInfo.processInfo.environment,
                git: URL = GitRepository.systemGit) {
        self.workspace = workspace
        self.environment = environment
        gitExecutable = git
        super.init(nibName: nil, bundle: nil)
        title = "Changes"
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var repository: GitRepository? {
        switch phase {
        case let .ready(repository, _): repository
        case let .failed(repository, _): repository
        case .locating, .gitMissing, .notRepository: nil
        }
    }

    var snapshot: ChangesSnapshot? {
        guard case let .ready(_, snapshot) = phase else { return nil }
        return snapshot
    }

    override public func loadView() {
        let root = ToolWindowView(header: .compact)
        root.onAppearanceChange = { [weak self] in self?.list.reload() }
        root.onWidthChange = { [weak self] in
            guard let self else { return }
            let wide = root.bounds.width >= Self.countsNeedWidth
            guard wide != wasWide else { return }
            wasWide = wide
            list.reload()
        }
        root.setAccessibilityElement(true)
        root.setAccessibilityRole(.group)
        root.setAccessibilityLabel("Changes")
        tracking.font = TextStyle.sm.tabularFont()
        branch.lineBreakMode = .byTruncatingMiddle
        root.header.setViews(leading: [branch, tracking])
        noticeHost.orientation = .vertical
        noticeHost.alignment = .width
        let body = root.content
        for view in [content, noticeHost, commitBox] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            body.addSubview(view)
        }
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: body.topAnchor),
            content.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            noticeHost.topAnchor.constraint(equalTo: content.bottomAnchor),
            noticeHost.leadingAnchor.constraint(equalTo: body.leadingAnchor, constant: Space.x2),
            noticeHost.trailingAnchor.constraint(equalTo: body.trailingAnchor, constant: -Space.x2),
            commitBox.topAnchor.constraint(equalTo: noticeHost.bottomAnchor),
            commitBox.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            commitBox.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            commitBox.bottomAnchor.constraint(equalTo: body.bottomAnchor),
        ])
        root.follow(list.scrollView)
        Pin.fill(list, in: content)
        list.rowHeight = Metric.rowCompact
        list.isOutline = true
        list.pinsGroupHeaders = true
        list.groupHeader = { [weak self] row in self.flatMap { ListView.header(in: $0.rows.headerRows, forRow: row) } }
        list.allowsMultipleSelection = true
        list.deletesWithCommandOnly = true
        list.verticalInset = Space.x1
        list.rowCount = { [weak self] in self?.rows.count ?? 0 }
        list.content = { [weak self] in self?.row($0) ?? RowContent() }
        list.onActivate = { [weak self] in self?.openDiff(row: $0) }
        list.onReturn = { [weak self] in self?.openDiff(row: $0) }
        list.onToggle = { [weak self] in self?.toggleGroup(row: $0) }
        list.onCheck = { [weak self] in self?.toggleStaged(rows: $0) }
        list.onDelete = { [weak self] in self?.discard(rows: $0) }
        list.menuForRows = { [weak self] in self?.menu(for: $0) }
        list.onAction = { [weak self] id, rows in self?.perform(action: id, on: rows) }
        commitBox.onCommit = { [weak self] in self?.commit() }
        commitBox.onAmendChange = { [weak self] in self?.setAmending($0) }
        commitBox.onMessageChange = { [weak self] in
            self?.message = $0
            self?.updateCommitBox()
        }
        view = root
        render()
        refresh()
    }

    public func refresh() {
        switch refreshing {
        case .running, .runningStale:
            refreshing = .runningStale
            return
        case .idle:
            refreshing = .running
        }
        refreshTask = Task { [weak self] in
            await self?.reload()
        }
    }

    public func filesDidChange(_ urls: [URL]) {
        let root = repository?.root.path ?? workspace.root.path
        let relevant = urls.contains { $0.standardizedFileURL.path.hasPrefix(root) }
        guard relevant else { return }
        refresh()
        let touchesGit = urls.contains { $0.path.contains("/.git/") || $0.lastPathComponent == ".git" }
        for diff in diffs.compactMap(\.controller) where touchesGit || urls.contains(where: { $0.path.hasSuffix("/" + diff.source.path) }) {
            diff.refresh()
        }
    }

    private func reload() async {
        repeat {
            refreshing = .running
            let signpost = OSSignposter.changes.beginInterval("changes refresh")
            if repository == nil { await locate() }
            if let repository {
                do throws(GitFailure) {
                    let fresh = try await ChangesSnapshot.load(repository)
                    apply(.ready(repository, fresh))
                } catch {
                    if error.reason != .cancelled { apply(.failed(repository, error)) }
                }
            }
            OSSignposter.changes.endInterval("changes refresh", signpost)
        } while refreshing == .runningStale && !Task.isCancelled
        refreshing = .idle
    }

    private func locate() async {
        switch await GitRepository.locate(workspace.root, executable: gitExecutable, environment: environment) {
        case let .repository(repository): phase = .ready(repository, nil)
        case .notRepository: apply(.notRepository)
        case let .gitMissing(message): apply(.gitMissing(message))
        case let .failed(failure): apply(.failed(nil, failure))
        }
    }

    func apply(_ next: Phase) {
        if case let .ready(_, old) = phase, case let .ready(_, new) = next, old == new, new != nil { return }
        let selected = isViewLoaded ? selectedPaths() : []
        phase = next
        render(restoring: selected)
    }

    func render(restoring selected: [(path: String, group: ChangeGroup)]? = nil) {
        guard isViewLoaded else { return }
        let selected = selected ?? selectedPaths()
        rows = snapshot.map { ChangeRows.build($0, collapsed: collapsed) } ?? ChangeRows()
        updateState()
        list.reload()
        restoreSelection(selected)
        if list.selectedRows.isEmpty, let openDiff { markOpenDiff(openDiff.path, openDiff.comparison) }
        updateBranch()
        updateCommitBox()
        if let snapshot, let repository {
            let fresh = ChangedFiles(snapshot.report, root: repository)
            if fresh != changedFiles {
                changedFiles = fresh
                onChangedFilesChange?(fresh)
            }
        }
        let total = snapshot.map { Set($0.report.entries.filter { $0.index != .ignored }.map(\.path)).count } ?? 0
        if total != count {
            count = total
            onCountChange?(total)
        }
    }

    private func updateState() {
        let next: NSView? = switch phase {
        case .locating, .ready(_, nil):
            EmptyState(loading: true, title: "Reading changes…")
        case let .gitMissing(message):
            EmptyState(symbol: "exclamationmark.triangle", title: "Git isn’t available",
                       description: message + " Install the Command Line Tools to use Changes.", command: "xcode-select --install")
        case .notRepository:
            EmptyState(symbol: "arrow.triangle.branch", title: "Not a Git repository",
                       description: "Changes appear here once this folder is a Git repository.", command: "git init")
        case let .failed(_, failure):
            EmptyState(symbol: "exclamationmark.triangle", title: "Couldn’t read changes", description: failure.message,
                       actions: [("Try Again", { [weak self] in self?.refresh() })])
        case let .ready(_, snapshot?) where rows.count == 0:
            EmptyState(symbol: "checkmark.circle", title: "No changes",
                       description: snapshot.report.branch.name.map { "The working tree matches \($0)." } ?? "The working tree is clean.")
        case .ready:
            nil
        }
        state?.removeFromSuperview()
        state = next
        list.isHidden = next != nil
        if let next { Pin.fill(next, in: content) }
        commitBox.isHidden = repository == nil
    }

    private func updateBranch() {
        guard let snapshot else {
            branch.stringValue = ""
            tracking.stringValue = ""
            return
        }
        let line = BranchLine.make(snapshot.report.branch, subject: snapshot.subject)
        branch.stringValue = line.name
        tracking.stringValue = line.tracking
        tracking.isHidden = line.tracking.isEmpty
        branch.toolTip = line.tip
        tracking.toolTip = line.tip
        branch.setAccessibilityLabel(line.spoken)
        tracking.setAccessibilityElement(false)
    }

    func updateCommitBox() {
        let entries = snapshot?.report.entries ?? []
        let readiness = CommitReadiness.decide(message: message, staged: entries.filter(\.isStaged).count,
                                               conflicts: entries.filter { $0.conflict != nil }.count, amend: amending,
                                               busy: committing)
        commitBox.update(readiness: readiness, message: message, busy: committing)
    }

    func row(_ index: Int) -> RowContent {
        guard index < rows.count, let snapshot else { return RowContent() }
        let group = rows.groups[index]
        guard !rows.isHeader(index) else {
            let members = rows.members(of: group, in: snapshot).count
            var header = RowContent.header(group.title, meta: members.formatted(), disclosure: collapsed.contains(group) ? .closed : .open)
            header.isGroupHeader = true
            header.check = group == .staged ? .on : .off
            if group == .conflicts { header.check = nil }
            header.accessibilityLabel = "\(group.title), \(Counted.files(members))"
            return header
        }
        let entry = snapshot.report.entries[Int(rows.entries[index])]
        let name = (entry.path as NSString).lastPathComponent
        var row = RowContent(title: name, leading: .image(FileIcon.forFile(named: name).image(for: view.effectiveAppearance)))
        row.depth = 0
        row.detail = (entry.path as NSString).deletingLastPathComponent
        row.detailInk = .secondary
        row.detailTruncation = .path
        row.check = group == .conflicts ? nil : (group == .staged ? .on : .off)
        row.actions = Self.actions(for: group, entry: entry)
        let mark = StatusMark.letter(entry, in: group)
        row.status = RowContent.Status(mark.letter, ink: StatusMark.change(entry, in: group).ink)
        if let original = entry.originalPath, group == .staged {
            let source = "\u{2190} " + (original as NSString).lastPathComponent
            row.detail = row.detail.isEmpty ? source : row.detail + "  " + source
            row.detailTruncation = .tail
        }
        let counts = snapshot.count(for: entry, in: group)
        if let counts, !counts.isBinary {
            row.diff = (counts.added, counts.removed)
        } else if counts?.isBinary == true {
            row.meta = "binary"
        }
        let folder = (entry.path as NSString).deletingLastPathComponent
        let renamed = group == .staged ? entry.originalPath.map { ", from \(($0 as NSString).lastPathComponent)" } ?? "" : ""
        let place = (folder.isEmpty ? "" : ", in \(folder)") + renamed
        let numbers = counts.map { $0.isBinary ? ", binary" : ", \($0.added) added, \($0.removed) removed" } ?? ""
        row.accessibilityLabel = "\(name), \(mark.word)\(group == .staged ? ", staged" : "")\(numbers)\(place)"
        return row
    }

    func entries(in rowsIndexes: IndexSet) -> [(entry: GitEntry, group: ChangeGroup)] {
        guard let snapshot else { return [] }
        var found: [(entry: GitEntry, group: ChangeGroup)] = []
        for index in rowsIndexes where index < rows.count {
            let group = rows.groups[index]
            if rows.isHeader(index) {
                found += rows.members(of: group, in: snapshot).map { (entry: snapshot.report.entries[$0], group: group) }
            } else {
                found.append((entry: snapshot.report.entries[Int(rows.entries[index])], group: group))
            }
        }
        return found
    }

    private func selectedPaths() -> [(path: String, group: ChangeGroup)] {
        guard let snapshot else { return [] }
        return list.selectedRows.compactMap { index in
            guard index < rows.count, !rows.isHeader(index), Int(rows.entries[index]) < snapshot.report.entries.count else { return nil }
            return (path: snapshot.report.entries[Int(rows.entries[index])].path, group: rows.groups[index])
        }
    }

    private func restoreSelection(_ paths: [(path: String, group: ChangeGroup)]) {
        guard let snapshot, !paths.isEmpty else { return }
        var restored = IndexSet()
        for index in 0..<rows.count where !rows.isHeader(index) {
            let path = snapshot.report.entries[Int(rows.entries[index])].path
            if paths.contains(where: { $0.path == path && $0.group == rows.groups[index] }) { restored.insert(index) }
        }
        if restored.isEmpty {
            restored = paths.compactMap { pair in
                (0..<rows.count).first { !rows.isHeader($0) && snapshot.report.entries[Int(rows.entries[$0])].path == pair.path }
            }.reduce(into: IndexSet()) { $0.insert($1) }
        }
        list.selectedRows = restored
    }

    private func toggleGroup(row: Int) {
        let group = rows.groups[row]
        if collapsed.contains(group) { collapsed.remove(group) } else { collapsed.insert(group) }
        render()
    }

    struct WeakDiff {
        weak var controller: DiffViewController?
    }
}

extension StatusMark {
    static func change(_ entry: GitEntry, in group: ChangeGroup) -> GitChange {
        if entry.conflict != nil { return .conflicted }
        switch group == .staged ? entry.index : entry.worktree {
        case .added, .copied: return .added
        case .deleted: return .deleted
        case .renamed: return .renamed
        case .untracked: return .untracked
        case .unmerged: return .conflicted
        case .modified, .typeChanged, .unmodified, .ignored: return .modified
        }
    }
}
