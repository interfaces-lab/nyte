import AppKit
import NyteCore
import NyteUI

@MainActor
final class DiscardToken {
    var undo: DiscardUndo
    let plan: DiscardPlan

    init(undo: DiscardUndo, plan: DiscardPlan) {
        self.undo = undo
        self.plan = plan
    }
}

extension ChangesViewController: NSMenuItemValidation {
    var selectedEntries: [(entry: GitEntry, group: ChangeGroup)] { entries(in: list.selectedRows) }

    func toggleStaged(rows: IndexSet) {
        let chosen = entries(in: rows)
        let unstaging = chosen.filter { $0.group == .staged }.map(\.entry)
        let staging = chosen.filter { $0.group != .staged }.map(\.entry)
        let headExists = headExists
        run(unstaging.isEmpty ? "Couldn’t stage" : "Couldn’t unstage") { repository throws(GitFailure) in
            try await repository.stage(staging.map(\.path))
            try await repository.unstage(Self.paths(unstaging), headExists: headExists)
        }
    }

    var headExists: Bool { snapshot?.report.branch.isUnborn == false }

    static func paths(_ entries: [GitEntry]) -> [String] {
        entries.flatMap { [$0.path] + [$0.originalPath].compactMap { $0 } }
    }

    func run(_ failureTitle: String, _ body: @escaping @Sendable (GitRepository) async throws(GitFailure) -> Void) {
        guard let repository, operation == nil else { return NSSound.beep() }
        operation = Task { [weak self] in
            do throws(GitFailure) {
                try await body(repository)
                self?.showNotice(nil)
            } catch {
                self?.showNotice(Banner(failureTitle, detail: error.message, tone: .danger,
                                        onDismiss: { [weak self] in self?.showNotice(nil) }))
            }
            self?.operation = nil
            self?.refresh()
        }
    }

    func showNotice(_ banner: Banner?) {
        notice.map { noticeHost.removeView($0) }
        notice = banner
        guard let banner else { return }
        noticeHost.addView(banner, in: .top)
        noticeHost.edgeInsets = NSEdgeInsets(top: Space.x1, left: 0, bottom: Space.x2, right: 0)
    }

    func discard(rows: IndexSet) {
        let chosen = entries(in: rows)
        guard let repository, let group = chosen.first?.group else { return }
        let plan = DiscardPlan.make(chosen.filter { $0.group == group }.map(\.entry), group: group, root: repository.root)
        guard !plan.isEmpty else {
            showNotice(Banner("Nothing to discard", detail: "Conflicts and submodules are resolved in the editor or in their own repository.",
                              onDismiss: { [weak self] in self?.showNotice(nil) }))
            return
        }
        let alert = NSAlert()
        let names = plan.paths.map { ($0 as NSString).lastPathComponent }
        alert.messageText = names.count == 1 ? "Discard changes to “\(names[0])”?" : "Discard changes to \(Counted.files(names.count))?"
        var detail = group == .staged ? "Staged and unstaged changes go back to the last commit." :
            "Unstaged changes go back to the staged version; untracked files are deleted."
        if plan.lost.isEmpty {
            detail += " You can undo this."
        } else {
            let lost = plan.lost.map { "“\(($0 as NSString).lastPathComponent)”" }.joined(separator: ", ")
            detail += " \(lost) \(plan.lost.count == 1 ? "is" : "are") too large to keep and can’t be brought back."
        }
        alert.informativeText = detail
        alert.addButton(withTitle: "Discard")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        guard let window = view.window else { return performDiscard(plan, in: repository) }
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            self?.performDiscard(plan, in: repository)
        }
    }

    func performDiscard(_ plan: DiscardPlan, in repository: GitRepository) {
        guard operation == nil else { return NSSound.beep() }
        operation = Task { [weak self] in
            do throws(GitFailure) {
                let undo = try await DiscardUndo.perform(plan, in: repository)
                guard let self else { return }
                operation = nil
                registerUndo(DiscardToken(undo: undo, plan: plan), in: repository)
            } catch {
                guard let self else { return }
                operation = nil
                showNotice(Banner("Couldn’t discard", detail: error.message, tone: .danger,
                                  onDismiss: { [weak self] in self?.showNotice(nil) }))
            }
            self?.refresh()
            for diff in self?.diffs.compactMap(\.controller) ?? [] { diff.refresh() }
        }
    }

    private func registerUndo(_ token: DiscardToken, in repository: GitRepository) {
        let count = token.plan.paths.count
        let manager = view.window?.undoManager
        manager?.registerUndo(withTarget: token) { [weak self] token in self?.restore(token, in: repository) }
        manager?.setActionName("Discard Changes")
        guard !token.undo.isEmpty else { return showNotice(nil) }
        showNotice(Banner("Discarded \(Counted.files(count))", detail: token.plan.lost.isEmpty ? "" : "Some files were too large to keep.",
                          action: ("Undo", { [weak self, weak manager] in
                              manager?.removeAllActions(withTarget: token)
                              self?.restore(token, in: repository)
                          }), onDismiss: { [weak self] in self?.showNotice(nil) }))
    }

    private func restore(_ token: DiscardToken, in repository: GitRepository) {
        showNotice(nil)
        let undo = token.undo
        view.window?.undoManager?.registerUndo(withTarget: token) { [weak self] token in
            self?.performDiscard(token.plan, in: repository)
        }
        run("Couldn’t undo the discard") { repository throws(GitFailure) in try await undo.restore(in: repository) }
    }

    func openDiff(row: Int) {
        guard let (entry, group) = entries(in: IndexSet(integer: row)).first, !rows.isHeader(row) else { return }
        openDiff(entry, group)
    }

    func openDiff(_ entry: GitEntry, _ group: ChangeGroup) {
        guard let repository, let onOpenDiff else { return }
        let comparison: DiffComparison = group == .staged ? .staged : .worktree
        diffs.removeAll { $0.controller == nil }
        if let open = diffs.compactMap(\.controller).first(where: { controller in
            guard case let .repository(_, path, kind) = controller.source else { return false }
            return path == entry.path && kind == comparison
        }) {
            open.refresh()
            return onOpenDiff(open)
        }
        let diff = DiffViewController(source: .repository(repository, path: entry.path, comparison: comparison))
        diff.onRepositoryChange = { [weak self] in self?.refresh() }
        diff.onOpenFile = onOpenFile
        diff.openText = openText
        diffs.append(WeakDiff(controller: diff))
        onOpenDiff(diff)
    }

    static let stageAction = RowContent.Action("stage", symbol: "plus.circle", label: "Stage")
    static let unstageAction = RowContent.Action("unstage", symbol: "minus.circle", label: "Unstage")
    static let resolveAction = RowContent.Action("resolve", symbol: "checkmark.circle", label: "Mark Resolved")
    static let discardAction = RowContent.Action("discard", symbol: "arrow.uturn.backward", label: "Discard Changes…")

    static func actions(for group: ChangeGroup, entry: GitEntry) -> [RowContent.Action] {
        switch group {
        case .staged: entry.submodule == nil ? [unstageAction, discardAction] : [unstageAction]
        case .changes: entry.submodule == nil ? [stageAction, discardAction] : [stageAction]
        case .conflicts: [resolveAction]
        }
    }

    func perform(action id: String, on rowIndexes: IndexSet) {
        switch id {
        case Self.stageAction.id, Self.resolveAction.id: toggleStaged(rows: rowIndexes.filteredIndexSet { rows.groups[$0] != .staged })
        case Self.unstageAction.id: toggleStaged(rows: rowIndexes.filteredIndexSet { rows.groups[$0] == .staged })
        case Self.discardAction.id: discard(rows: rowIndexes)
        default: assertionFailure("unknown row action \(id)")
        }
    }

    public func showOpenDiff(path: String?, comparison: DiffComparison) {
        let previous = openDiff
        openDiff = path.map { (path: $0, comparison: comparison) }
        if let path {
            markOpenDiff(path, comparison)
        } else if let previous, let row = row(of: previous.path, previous.comparison), list.selectedRows == IndexSet(integer: row) {
            list.selectedRows = []
        }
    }

    func markOpenDiff(_ path: String, _ comparison: DiffComparison) {
        guard let row = row(of: path, comparison) else { return }
        list.selectedRows = IndexSet(integer: row)
    }

    func row(of path: String, _ comparison: DiffComparison) -> Int? {
        guard let snapshot else { return nil }
        let wanted: [ChangeGroup] = comparison == .staged ? [.staged] : [.changes, .conflicts]
        return (0..<rows.count).first { index in
            !rows.isHeader(index) && wanted.contains(rows.groups[index]) && snapshot.report.entries[Int(rows.entries[index])].path == path
        }
    }

    func menu(for rowIndexes: IndexSet) -> NSMenu? {
        let chosen = entries(in: rowIndexes)
        guard let repository, !chosen.isEmpty else { return nil }
        let groups = Set(chosen.map(\.group))
        var seen = Set<String>()
        let files = chosen.map(\.entry).filter { seen.insert($0.path).inserted }
        let single = rowIndexes.count == 1 && !rows.isHeader(rowIndexes.first ?? 0)
        var items: [MenuItem] = []
        if !groups.isDisjoint(with: [.staged, .changes]) && groups.contains(.conflicts) {
            items.append(MenuItem("Discard Changes…", key: "\u{8}", modifiers: .command, destructive: true) { [weak self] in
                self?.discard(rows: rowIndexes)
            })
        }
        if !items.isEmpty { items.append(.separator) }
        if single, let first = chosen.first {
            items.append(MenuItem("Show Diff", key: "") { [weak self] in self?.openDiff(first.entry, first.group) })
        }
        items.append(MenuItem("Open File", key: "", enabled: onOpenFile != nil) { [weak self] in
            for file in files { self?.onOpenFile?(repository.url(of: file.path)) }
        })
        items.append(MenuItem("Reveal in Finder", key: "") {
            NSWorkspace.shared.activateFileViewerSelecting(files.map { repository.url(of: $0.path) })
        })
        items.append(MenuItem("Copy Path", key: "") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(files.map { repository.url(of: $0.path).path }.joined(separator: "\n"), forType: .string)
        })
        return Menu.make(items)
    }

    func commit() {
        let entries = snapshot?.report.entries ?? []
        let readiness = CommitReadiness.decide(message: message, staged: entries.filter(\.isStaged).count,
                                               conflicts: entries.filter { $0.conflict != nil }.count, amend: amending, busy: committing)
        guard readiness == .ready, let repository else { return NSSound.beep() }
        committing = true
        commitBox.showFailure(nil)
        updateCommitBox()
        let message = message, amend = amending
        Task { [weak self] in
            do throws(GitFailure) {
                _ = try await repository.commit(message: message, amend: amend)
                guard let self else { return }
                self.message = ""
                commitBox.field.string = ""
                amending = false
                amendPrefill = nil
                commitBox.amend.state = .off
            } catch {
                self?.commitBox.showFailure(error)
            }
            self?.committing = false
            self?.updateCommitBox()
            self?.refresh()
        }
    }

    func setAmending(_ on: Bool) {
        amending = on
        updateCommitBox()
        if !on {
            if let amendPrefill, message == amendPrefill { commitBox.field.string = "" }
            amendPrefill = nil
            return
        }
        guard message.isEmpty, let repository, headExists else { return }
        Task { [weak self] in
            guard let text = try? await repository.headMessage(), let self, amending, message.isEmpty else { return }
            amendPrefill = text
            commitBox.field.string = text
        }
    }

    @objc public func stageSelected(_ sender: Any?) {
        toggleStaged(rows: list.selectedRows.filteredIndexSet { rows.groups[$0] != .staged })
    }

    @objc public func unstageSelected(_ sender: Any?) {
        toggleStaged(rows: list.selectedRows.filteredIndexSet { rows.groups[$0] == .staged })
    }

    @objc public func discardSelected(_ sender: Any?) { discard(rows: list.selectedRows) }

    @objc public func showSelectedDiff(_ sender: Any?) {
        guard let row = list.selectedRow else { return }
        openDiff(row: row)
    }

    @objc public func commitChanges(_ sender: Any?) { commit() }
    @objc public func refreshChanges(_ sender: Any?) { refresh() }

    public func validateMenuItem(_ item: NSMenuItem) -> Bool {
        let chosen = selectedEntries
        switch item.action {
        case #selector(stageSelected(_:)):
            item.title = chosen.allSatisfy { $0.group == .conflicts } && !chosen.isEmpty ? "Mark Resolved" : "Stage"
            return operation == nil && chosen.contains { $0.group != .staged }
        case #selector(unstageSelected(_:)):
            return operation == nil && chosen.contains { $0.group == .staged }
        case #selector(discardSelected(_:)):
            item.title = "Discard Changes…"
            return operation == nil && chosen.contains { $0.group != .conflicts }
        case #selector(showSelectedDiff(_:)):
            return list.selectedRow.map { !rows.isHeader($0) } ?? false
        case #selector(commitChanges(_:)):
            item.title = amending ? "Amend Commit" : "Commit"
            let entries = snapshot?.report.entries ?? []
            return CommitReadiness.decide(message: message, staged: entries.filter(\.isStaged).count,
                                          conflicts: entries.filter { $0.conflict != nil }.count, amend: amending,
                                          busy: committing) == .ready
        case #selector(refreshChanges(_:)):
            return repository != nil
        default:
            return false
        }
    }
}
