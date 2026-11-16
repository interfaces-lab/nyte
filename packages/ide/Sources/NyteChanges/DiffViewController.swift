import AppKit
import NyteCore
import NyteUI

@MainActor
public final class DiffViewController: NSViewController, NSMenuItemValidation {
    public private(set) var source: DiffSource
    public var onOpenFile: ((URL) -> Void)? { didSet { pane.onOpenFile = onOpenFile == nil ? nil : { [weak self] in self?.openFile() } } }
    public var onRepositoryChange: (() -> Void)?
    public var openText: ((URL) -> String?)?
    public var onSendComments: (([AgentContext]) -> Void)? { didSet { notesDidChange() } }
    public var root: URL?
    var onCommentsChange: (() -> Void)?

    var reviewComments: [ReviewComment] {
        let path = document?.path ?? source.path
        let shown = pane.canvas.document
        return pane.canvas.notes.map { $0.comment(path: path, in: shown) }
    }

    public var comments: [AgentContext] {
        let file = fileURL
        return reviewComments.map { $0.context(file: file) }
    }

    var fileURL: URL {
        switch source {
        case let .repository(repository, path, _), let .revisions(repository, path, _, _): repository.url(of: path)
        case let .texts(path, _, _): root.map { $0.appendingPathComponent(path) } ?? URL(fileURLWithPath: path)
        }
    }
    public var isSideBySide: Bool {
        get { pane.requestedMode == .split }
        set { pane.setMode(newValue ? .split : .unified) }
    }

    var onRevert: ((DiffSelection, DiffDocument) async -> String?)?
    var patchSource: (patches: [String], change: GitChange, scope: String)?
    var fixed: DiffDocument?
    var change: GitChange?
    var onDocument: ((DiffDocument) -> Void)?
    var onBoundary: ((Int) -> Void)? {
        get { pane.canvas.onBoundary }
        set { pane.canvas.onBoundary = newValue }
    }

    let pane = DiffPane()
    private(set) var document: DiffDocument?
    private var loading: Task<Void, Never>?
    private var working: Task<Void, Never>?
    private var pendingHunk: Int?

    public init(source: DiffSource) {
        self.source = source
        super.init(nibName: nil, bundle: nil)
        title = Self.title(for: source)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    static func title(for source: DiffSource) -> String {
        let name = (source.path as NSString).lastPathComponent
        switch source {
        case let .repository(_, _, comparison): return comparison == .staged ? name + " (Staged)" : name
        case let .texts(_, before, after): return "\(name) (\(before.title) \u{2192} \(after.title))"
        case .revisions: return name
        }
    }

    override public func loadView() {
        let root = NSView()
        Pin.fill(pane, in: root)
        pane.canvas.onAction = { [weak self] action, selection in self?.perform(action, selection) }
        pane.canvas.onNotesChange = { [weak self] in self?.notesDidChange() }
        pane.sendButton.onPress = { [weak self] in self?.sendComments(nil) }
        pane.setAccessibilityLabel(title)
        view = root
        refresh()
    }

    override public func viewWillDisappear() {
        super.viewWillDisappear()
        loading?.cancel()
    }

    public func focus() { view.window?.makeFirstResponder(pane.canvas) }

    public func refresh() {
        loading?.cancel()
        if document == nil { pane.showLoading(path: source.path) }
        if let fixed {
            show(fixed)
            return
        }
        if let patchSource {
            show(DiffDocument.fromPatches(path: source.path, patches: patchSource.patches, change: patchSource.change,
                                          scope: patchSource.scope))
            return
        }
        let source = source
        var buffer: String?
        if case let .repository(repository, path, .worktree) = source { buffer = openText?(repository.url(of: path)) }
        loading = Task { [weak self] in
            let document = await DiffDocument.load(source, buffer: buffer)
            guard !Task.isCancelled, let self else { return }
            show(document)
        }
    }

    func show(_ loaded: DiffDocument) {
        var document = loaded
        if let change { document.change = change }
        let hunk = pendingHunk ?? pane.canvas.cursorHunk
        pendingHunk = nil
        let canvas = pane.canvas
        if let composing = canvas.composing {
            let draft = canvas.composer?.field.string ?? composing.draft
            let quoted = self.document.flatMap { DiffNote.make(id: 0, side: composing.side, lines: composing.lines, in: $0) }
            if let moved = quoted?.reanchored(in: document) {
                canvas.composing = DiffCanvas.Composing(editing: composing.editing, side: moved.side, lines: moved.lines, draft: draft)
            } else {
                canvas.composing = nil
            }
        }
        canvas.notes = canvas.notes.compactMap { $0.reanchored(in: document) }
        self.document = document
        pane.show(document, actions: actions(for: document))
        notesDidChange()
        onDocument?(document)
        guard let hunk, !pane.canvas.rows.headers.isEmpty else { return }
        pane.canvas.showHunk(at: Int(pane.canvas.rows.headers[min(hunk, pane.canvas.rows.headers.count - 1)]))
    }

    private func actions(for document: DiffDocument) -> HunkActions {
        guard document.shape == .text, document.conflict == nil else { return .none }
        switch source {
        case let .repository(_, _, comparison):
            guard !document.unsaved else { return .none }
            return comparison == .worktree ? HunkActions(primary: .stage, destructive: .discard) : HunkActions(primary: .unstage)
        case .texts, .revisions:
            return onRevert == nil || document.patch != nil ? .none : HunkActions(destructive: .revert)
        }
    }

    func replace(_ source: DiffSource) {
        self.source = source
        title = Self.title(for: source)
        pendingHunk = pane.canvas.cursorHunk
        refresh()
    }

    func reloadActions() {
        guard let document else { return }
        pane.canvas.actions = actions(for: document)
    }

    private func openFile() {
        onOpenFile?(fileURL)
    }

    func notesDidChange() {
        let count = pane.canvas.notes.count
        pane.sendButton.detail = count.formatted()
        pane.sendButton.isHidden = onSendComments == nil || count == 0
        pane.sendButton.setAccessibilityLabel("Send \(count) \(count == 1 ? "comment" : "comments") to the agent")
        onCommentsChange?()
    }

    @objc public func sendComments(_ sender: Any?) {
        guard let onSendComments, !pane.canvas.notes.isEmpty else { return }
        onSendComments(comments)
        clearComments()
    }

    func clearComments() {
        pane.canvas.notes.removeAll()
        pane.canvas.rebuild(keepingCursor: true)
        notesDidChange()
    }

    @objc public func addComment(_ sender: Any?) { pane.canvas.openComposer() }

    @objc public func nextChange(_ sender: Any?) { pane.canvas.moveToChange(1) }
    @objc public func previousChange(_ sender: Any?) { pane.canvas.moveToChange(-1) }
    @objc public func toggleSideBySide(_ sender: Any?) { isSideBySide.toggle() }
    @objc public func expandAllUnchanged(_ sender: Any?) { pane.canvas.expandAll() }

    @objc public func stageSelection(_ sender: Any?) {
        guard let action = pane.canvas.actions.primary else { return }
        pane.canvas.perform(action)
    }

    @objc public func discardSelection(_ sender: Any?) {
        guard let action = pane.canvas.actions.destructive else { return }
        pane.canvas.perform(action)
    }

    public func validateMenuItem(_ item: NSMenuItem) -> Bool {
        let canvas = pane.canvas
        let hasHunks = !(document?.diff.hunks.isEmpty ?? true)
        switch item.action {
        case #selector(nextChange(_:)), #selector(previousChange(_:)):
            return hasHunks || canvas.onBoundary != nil
        case #selector(toggleSideBySide(_:)):
            item.state = isSideBySide ? .on : .off
            return document?.shape == .text
        case #selector(sendComments(_:)):
            let count = pane.canvas.notes.count
            item.title = count == 0 ? "Send Comments to Agent" : "Send \(Counted.comments(count)) to Agent"
            return onSendComments != nil && count > 0
        case #selector(addComment(_:)):
            item.title = canvas.linesChosen ? "Comment on Lines" : "Comment on Hunk"
            return DiffNote.target(rows: canvas.rows, selected: canvas.selectedRows, document: canvas.document) != nil
        case #selector(expandAllUnchanged(_:)):
            return canvas.rows.kinds.contains(.fold)
        case #selector(stageSelection(_:)):
            guard let action = canvas.actions.primary else { return false }
            item.title = action.title(lines: canvas.linesChosen)
            return canvas.chosenSelection() != nil
        case #selector(discardSelection(_:)):
            guard let action = canvas.actions.destructive else { return false }
            item.title = action.title(lines: canvas.linesChosen) + "…"
            return canvas.chosenSelection() != nil
        default:
            return false
        }
    }

    func perform(_ action: HunkAction, _ selection: DiffSelection) {
        guard working == nil, let document else { return NSSound.beep() }
        guard action.isDestructive else { return run(action, selection, document) }
        confirm(action, selection, document)
    }

    private func confirm(_ action: HunkAction, _ selection: DiffSelection, _ document: DiffDocument) {
        let lines = selection.old.count + selection.new.count
        let alert = NSAlert()
        alert.messageText = action == .revert ? "Revert \(Counted.lines(lines)) in “\((document.path as NSString).lastPathComponent)”?"
            : "Discard \(Counted.lines(lines)) in “\((document.path as NSString).lastPathComponent)”?"
        alert.informativeText = action == .revert ? "The file goes back to how it was before these edits. You can undo this."
            : "The working tree goes back to the staged version of these lines. You can undo this."
        alert.addButton(withTitle: action == .revert ? "Revert" : "Discard")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        guard let window = view.window else { return run(action, selection, document) }
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            self?.run(action, selection, document)
        }
    }

    private func run(_ action: HunkAction, _ selection: DiffSelection, _ document: DiffDocument) {
        pendingHunk = pane.canvas.cursorHunk
        if action == .revert {
            guard let onRevert else { return }
            working = Task { [weak self] in
                let failure = await onRevert(selection, document)
                guard let self else { return }
                working = nil
                if let failure { pane.showFailure("Couldn’t revert", message: failure) }
            }
            return
        }
        guard case let .repository(repository, path, _) = source else { return }
        working = Task { [weak self] in
            do throws(GitFailure) {
                let undo = try await HunkOperations.perform(action, selection, document, path: path, in: repository)
                guard let self else { return }
                if let undo { register(undo, in: repository, name: action.title(lines: true)) }
            } catch {
                self?.pane.showFailure("Couldn’t \(action.title(lines: false).lowercased())", message: error.message)
            }
            guard let self else { return }
            working = nil
            refresh()
            onRepositoryChange?()
        }
    }

    private func register(_ patch: HunkOperations.Undo, in repository: GitRepository, name: String) {
        guard let manager = view.window?.undoManager else { return }
        manager.registerUndo(withTarget: self) { controller in controller.replay(patch.inverted, in: repository, name: name) }
        manager.setActionName(name)
    }

    private func replay(_ patch: HunkOperations.Undo, in repository: GitRepository, name: String) {
        register(patch.inverted, in: repository, name: name)
        working = Task { [weak self] in
            do throws(GitFailure) {
                try await patch.apply(in: repository)
            } catch {
                self?.pane.showFailure("Couldn’t undo", message: error.message)
            }
            guard let self else { return }
            working = nil
            refresh()
            onRepositoryChange?()
        }
    }
}

enum Counted {
    static func lines(_ count: Int) -> String { "\(count.formatted()) \(count == 1 ? "line" : "lines")" }
    static func files(_ count: Int) -> String { "\(count.formatted()) \(count == 1 ? "file" : "files")" }
    static func comments(_ count: Int) -> String { "\(count.formatted()) \(count == 1 ? "comment" : "comments")" }
}
