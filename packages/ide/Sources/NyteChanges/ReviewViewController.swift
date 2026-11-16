import AppKit
import NyteCore
import NyteUI

public struct ReviewFile: Sendable {
    public enum Side: Sendable {
        case text(String)
        case absent
        case revision(String)
        case disk
        case unavailable(String)
    }

    public var path: String
    public var before: Side
    public var after: Side
    public var change: GitChange
    public var patches: [String]?

    public init(path: String, before: Side, after: Side, change: GitChange = .modified, patches: [String]? = nil) {
        self.path = path
        self.before = before
        self.after = after
        self.change = change
        self.patches = patches
    }
}

public struct ReviewRevert: Sendable {
    public var url: URL
    public var text: String?
}

@MainActor
public final class ReviewViewController: NSViewController {
    static let listWidth: CGFloat = 220
    static let listMinimum: CGFloat = 160
    static let narrowestDiff: CGFloat = 520

    enum FileList: Equatable {
        case shown
        case folded(byUser: Bool)
    }

    public var onRevert: ((ReviewRevert) async throws -> Void)?
    public var onOpenFile: ((URL) -> Void)?
    public var onFocusReview: (() -> Void)? { didSet { focusButton.isHidden = onFocusReview == nil } }
    public var onSendComments: (([AgentContext]) -> Void)? { didSet { commentsDidChange() } }
    public private(set) var selectedPath: String?

    public var comments: [AgentContext] { files.indices.flatMap { diffs[$0]?.comments ?? [] } }

    let heading: String
    let root: URL
    let repository: GitRepository?
    var files: [ReviewFile]
    var counts: [GitLineCount?]
    var reverted: Set<Int> = []
    var diffs: [Int: DiffViewController] = [:]
    var shown = -1
    var pendingEdge = 0
    var counting: Task<Void, Never>?
    var placedDivider = false
    let scope: String
    static let patchOnly = "This file arrived as a patch without its earlier text, so it can’t be reverted from here."

    let list = ListView()
    let split = HairlineSplitView()
    let detail = NSView()
    let titleLabel = Label("", style: .base, color: Palette.contentPrimary, weight: .semibold)
    let summary = Label("", style: .sm, color: Palette.contentSecondary)
    let revertButton = Button("Revert File", size: .sm)
    let sendButton = Button("Send to Agent", variant: .solid, tone: .primary, size: .sm)
    let filesButton = Button(symbol: "sidebar.left", label: "Hide File List", size: .sm)
    let focusButton = Button(symbol: "arrow.up.left.and.arrow.down.right", label: "Focus Review", size: .sm)
    let side = NSView()
    var fileList = FileList.shown

    public init(title: String, scope: String = "These changes", root: URL, files: [ReviewFile], repository: GitRepository? = nil) {
        heading = title
        self.scope = scope
        self.root = root.standardizedFileURL
        self.files = files
        self.repository = repository
        counts = Array(repeating: nil, count: files.count)
        super.init(nibName: nil, bundle: nil)
        self.title = title
    }

    public convenience init(changes: AgentChangeSet) {
        let files = changes.files.map { file -> ReviewFile in
            let change = ReviewViewController.change(file.status)
            switch file.content {
            case let .texts(before, after):
                return ReviewFile(path: file.path, before: change == .added || change == .untracked ? .absent : .text(before),
                                  after: change == .deleted ? .absent : .text(after), change: change)
            case let .patches(patches):
                return ReviewFile(path: file.path, before: .absent, after: .absent, change: change, patches: patches)
            case let .unavailable(reason):
                return ReviewFile(path: file.path, before: .unavailable(reason), after: .disk, change: change)
            }
        }
        self.init(title: changes.title, scope: Self.scope(changes.scope), root: changes.root, files: files)
        for (index, file) in changes.files.enumerated() {
            if case .unavailable = file.content { counts[index] = GitLineCount(added: file.added, removed: file.removed) }
        }
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    static func scope(_ scope: AgentChangeSet.Scope) -> String {
        switch scope {
        case .step: "This step"
        case .run: "This turn"
        case .session: "This run"
        }
    }

    var scopeWords: String { scope.prefix(1).lowercased() + scope.dropFirst() }

    static func change(_ status: AgentChangeSet.Status) -> GitChange {
        switch status {
        case .added: .added
        case .modified, .unknown: .modified
        case .deleted: .deleted
        case .renamed: .renamed
        case .untracked: .untracked
        case .conflicted: .conflicted
        }
    }

    override public func loadView() {
        let root = ToolWindowView(header: .hidden)
        root.onAppearanceChange = { [weak self] in self?.list.reload() }
        root.onWidthChange = { [weak self] in self?.list.reload() }
        root.setAccessibilityElement(true)
        root.setAccessibilityRole(.group)
        root.setAccessibilityLabel("Review: " + heading)

        sendButton.isHidden = true
        sendButton.onPress = { [weak self] in self?.sendComments(nil) }
        let top = NSStackView(views: [titleLabel, summary, sendButton])
        top.orientation = .vertical
        top.alignment = .leading
        top.spacing = Space.x05
        top.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.stringValue = heading
        titleLabel.lineBreakMode = .byTruncatingTail
        summary.font = TextStyle.sm.tabularFont()
        side.addSubview(top)
        list.translatesAutoresizingMaskIntoConstraints = false
        side.addSubview(list)
        NSLayoutConstraint.activate([
            top.topAnchor.constraint(equalTo: side.topAnchor, constant: Space.x3),
            top.leadingAnchor.constraint(equalTo: side.leadingAnchor, constant: RowCell.Geometry.inset + RowCell.Geometry.padding),
            top.trailingAnchor.constraint(lessThanOrEqualTo: side.trailingAnchor, constant: -Space.x3),
            list.topAnchor.constraint(equalTo: top.bottomAnchor, constant: Space.x2),
            list.leadingAnchor.constraint(equalTo: side.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: side.trailingAnchor),
            list.bottomAnchor.constraint(equalTo: side.bottomAnchor),
            side.widthAnchor.constraint(greaterThanOrEqualToConstant: Self.listMinimum),
        ])
        split.isVertical = true
        split.addArrangedSubview(side)
        split.addArrangedSubview(detail)
        split.setHoldingPriority(.defaultHigh, forSubviewAt: 0)
        Pin.fill(split, in: root.content)
        list.rowHeight = Metric.rowCompact
        list.verticalInset = Space.x1
        list.rowCount = { [weak self] in self?.files.count ?? 0 }
        list.content = { [weak self] in self?.row($0) ?? RowContent() }
        list.onSelect = { [weak self] rows in
            guard let row = rows.first else { return }
            self?.show(row)
        }
        list.menuForRows = { [weak self] in self?.menu(for: $0) }
        revertButton.tone = .danger
        revertButton.onPress = { [weak self] in self?.confirmRevertFile() }
        filesButton.isOn = true
        filesButton.onPress = { [weak self] in self?.toggleFileList(nil) }
        focusButton.isHidden = onFocusReview == nil
        focusButton.onPress = { [weak self] in self?.onFocusReview?() }
        view = root
        list.reload()
        updateSummary()
        countMissing()
        guard !files.isEmpty else { return }
        list.selectedRow = 0
        show(0)
    }

    override public func viewDidLayout() {
        super.viewDidLayout()
        guard split.bounds.width > 0 else { return }
        if !placedDivider {
            placedDivider = true
            split.setPosition(Self.listWidth, ofDividerAt: 0)
        }
        fitFileList()
    }

    func fitFileList() {
        let roomy = split.bounds.width - Self.listWidth >= Self.narrowestDiff
        switch fileList {
        case .shown where !roomy: setFileList(.folded(byUser: false))
        case .folded(byUser: false) where roomy: setFileList(.shown)
        default: break
        }
    }

    func setFileList(_ state: FileList) {
        guard state != fileList else { return }
        fileList = state
        side.isHidden = state != .shown
        split.adjustSubviews()
        if state == .shown { split.setPosition(Self.listWidth, ofDividerAt: 0) }
        filesButton.setAccessibilityLabel(state == .shown ? "Hide File List" : "Show File List")
        filesButton.toolTip = filesButton.accessibilityLabel()
        filesButton.isOn = state == .shown
    }

    @objc public func toggleFileList(_ sender: Any?) {
        setFileList(fileList == .shown ? .folded(byUser: true) : .shown)
    }

    @objc public func focusReview(_ sender: Any?) { onFocusReview?() }

    override public func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        guard modifiers.isEmpty, event.charactersIgnoringModifiers == "l" else { return super.keyDown(with: event) }
        toggleFileList(nil)
    }

    public func select(path: String) {
        guard let index = files.firstIndex(where: { $0.path == path }) else { return }
        list.selectedRow = index
        show(index)
    }

    public func focusDiff() {
        guard let diff = diffs[shown] else { return }
        view.window?.makeFirstResponder(diff.pane.canvas)
    }

    func row(_ index: Int) -> RowContent {
        let file = files[index]
        let name = (file.path as NSString).lastPathComponent
        var row = RowContent(title: name, leading: .image(FileIcon.forFile(named: name).image(for: view.effectiveAppearance)))
        row.detail = (file.path as NSString).deletingLastPathComponent
        row.detailInk = .secondary
        row.detailTruncation = .path
        row.status = file.change.status
        row.yieldOrder = [.detail, .meta, .counts, .title]
        if case let .unavailable(reason) = file.before { row.toolTip = reason }
        if reverted.contains(index) {
            row.titleInk = .tertiary
            row.meta = "reverted"
        } else if let count = counts[index] {
            row.diff = (count.added, count.removed)
        }
        let numbers = counts[index].map { ", \($0.added) added, \($0.removed) removed" } ?? ""
        let noted = diffs[index]?.pane.canvas.notes.count ?? 0
        if noted > 0 {
            row.badge = RowContent.Badge(list.bounds.width >= ChangesViewController.countsNeedWidth ? Counted.comments(noted) : noted.formatted())
        }
        let remarks = noted > 0 ? ", " + Counted.comments(noted) : ""
        row.accessibilityLabel = "\(name), \(file.change.word)\(reverted.contains(index) ? ", reverted" : numbers)\(remarks)"
        return row
    }

    func updateSummary() {
        let live = counts.indices.filter { !reverted.contains($0) }.compactMap { counts[$0] }
        let added = live.reduce(0) { $0 + $1.added }, removed = live.reduce(0) { $0 + $1.removed }
        summary.stringValue = "\(scope)  \(Counted.files(files.count))  +\(added.formatted()) \u{2212}\(removed.formatted())"
        summary.setAccessibilityLabel("\(scope), \(Counted.files(files.count)), \(added) lines added, \(removed) removed")
    }

    func source(_ index: Int) -> DiffSource {
        let file = files[index]
        func text(_ side: ReviewFile.Side) -> String? {
            switch side {
            case let .text(value): value
            case .absent, .revision, .unavailable: nil
            case .disk: try? String(contentsOf: root.appendingPathComponent(file.path), encoding: .utf8)
            }
        }
        if let repository, case let .revision(from) = file.before {
            let to: String? = if case let .revision(name) = file.after { name } else { nil }
            return .revisions(repository, path: file.path, from: from, to: to)
        }
        return .texts(path: file.path, before: DiffText(title: "Before " + scopeWords, text: text(file.before)),
                      after: DiffText(title: "After " + scopeWords, text: text(file.after)))
    }

    func show(_ index: Int) {
        guard index >= 0, index < files.count else { return }
        let diff = diffs[index] ?? makeDiff(index)
        let previous = shown >= 0 ? diffs[shown] : nil
        shown = index
        selectedPath = files[index].path
        if previous !== diff {
            previous?.view.removeFromSuperview()
            Pin.fill(diff.view, in: detail)
        }
        let focused = view.window?.firstResponder is DiffCanvas
        if focused { view.window?.makeFirstResponder(diff.pane.canvas) }
    }

    private func makeDiff(_ index: Int) -> DiffViewController {
        let diff = DiffViewController(source: source(index))
        diff.root = root
        diff.change = files[index].change
        if let patches = files[index].patches { diff.patchSource = (patches, files[index].change, scopeWords) }
        if case let .unavailable(reason) = files[index].before {
            var document = DiffDocument(path: files[index].path, oldTitle: "Before " + scopeWords, newTitle: "After " + scopeWords)
            document.shape = .unavailable(reason)
            diff.fixed = document
        }
        diff.onRevert = { [weak self] selection, document in await self?.revert(index, selection, document) }
        diff.onBoundary = { [weak self] direction in self?.cross(from: index, direction) }
        diff.onDocument = { [weak self] document in self?.loaded(index, document) }
        diff.onCommentsChange = { [weak self] in
            self?.list.reloadRows(IndexSet(integer: index))
            self?.commentsDidChange()
        }
        diff.onOpenFile = onOpenFile
        diff.pane.header.actions = [focusButton, filesButton, revertButton, diff.pane.previousButton, diff.pane.nextButton,
                                    diff.pane.modeControl]
        diff.reloadActions()
        _ = diff.view
        diffs[index] = diff
        return diff
    }

    func loaded(_ index: Int, _ document: DiffDocument) {
        if document.shape == .text || document.shape == .identical {
            counts[index] = GitLineCount(added: document.diff.addedLines, removed: document.diff.removedLines)
            list.reloadRows(IndexSet(integer: index))
            updateSummary()
        }
        revertButton.isEnabled = onRevert != nil && !reverted.contains(index) && document.shape != .identical && document.patch == nil
        revertButton.toolTip = document.patch == nil ? nil : Self.patchOnly
        guard index == shown, pendingEdge != 0 else { return }
        let edge = pendingEdge
        pendingEdge = 0
        if edge > 0 { diffs[index]?.pane.canvas.firstHunk() } else { diffs[index]?.pane.canvas.lastHunk() }
    }

    func cross(from index: Int, _ direction: Int) {
        var next = index + direction
        while next >= 0, next < files.count, reverted.contains(next) { next += direction }
        guard next >= 0, next < files.count else { return NSSound.beep() }
        let focused = view.window?.firstResponder is DiffCanvas
        pendingEdge = direction
        list.selectedRow = next
        show(next)
        if let diff = diffs[next], diff.document != nil {
            pendingEdge = 0
            if direction > 0 { diff.pane.canvas.firstHunk() } else { diff.pane.canvas.lastHunk() }
        }
        if focused, let diff = diffs[next] { view.window?.makeFirstResponder(diff.pane.canvas) }
    }

    private func countMissing() {
        let missing = counts.indices.filter { counts[$0] == nil }
        guard !missing.isEmpty else { return }
        let sources = missing.map { ($0, source($0), files[$0].patches, files[$0].change) }
        let words = scopeWords
        counting = Task { [weak self] in
            for (index, source, patches, change) in sources {
                let document = if let patches {
                    DiffDocument.fromPatches(path: source.path, patches: patches, change: change, scope: words)
                } else {
                    await DiffDocument.load(source)
                }
                guard !Task.isCancelled, let self else { return }
                counts[index] = GitLineCount(added: document.diff.addedLines, removed: document.diff.removedLines)
                list.reloadRows(IndexSet(integer: index))
                updateSummary()
            }
        }
    }

    override public func viewWillDisappear() {
        super.viewWillDisappear()
        counting?.cancel()
    }
}
