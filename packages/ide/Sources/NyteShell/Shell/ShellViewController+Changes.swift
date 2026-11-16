import AppKit
import NyteChanges
import NyteCore

extension ShellViewController {
    func startChanges(environment given: [String: String]? = nil) {
        let toolchain = services.toolchain
        Task { [weak self] in
            let environment = if let given { given } else { await toolchain.environment() }
            guard let self else { return }
            let controller = ChangesViewController(workspace: workspace, environment: environment)
            controller.openText = { [weak self] url in self?.editor.text(of: url) }
            controller.onOpenFile = { [weak self] url in self?.openFile(url) }
            controller.onOpenDiff = { [weak self] diff in self?.openDiff(diff) }
            controller.onCountChange = { [weak self] count in self?.sidebar.setCount(count, for: "changes") }
            controller.onChangedFilesChange = { [weak self] files in self?.changedFiles = files.searchable }
            changes = controller
            changesHost.embed(controller)
            controller.refresh()
        }
    }

    func openFile(_ url: URL) {
        editor.open(url, preview: false)
        editor.focus()
    }

    func openDiff(_ diff: DiffViewController) {
        diff.openText = { [weak self] url in self?.editor.text(of: url) }
        diff.onOpenFile = { [weak self] url in self?.openFile(url) }
        diff.onSendComments = { [weak self] comments in self?.ask(comments) }
        diff.onRepositoryChange = { [weak self] in
            self?.changes?.refresh()
            self?.editor.baseTextDidChange()
        }
        let title = diff.title ?? "Diff"
        editorPane.show(PaneDocument(id: "diff:" + title, title: title, toolTip: title, symbol: "plus.forwardslash.minus",
                                     controller: diff))
        diff.focus()
    }

    func openReview(_ changeSet: AgentChangeSet) {
        let review = ReviewViewController(changes: changeSet)
        review.onOpenFile = { [weak self] url in self?.openFile(url) }
        review.onSendComments = { [weak self] comments in self?.ask(comments) }
        review.onFocusReview = { [weak self] in self?.toggleFocusReview() }
        review.onRevert = { [weak self] revert in try await self?.revert(revert) }
        let title = review.title ?? "Review"
        editorPane.show(PaneDocument(id: "review:" + title, title: title, toolTip: title, symbol: "checklist", controller: review))
        review.focusDiff()
    }

    private func revert(_ revert: ReviewRevert) async throws {
        let url = revert.url.standardizedFileURL
        if editor.tabs.contains(where: { $0.url == url }), let current = editor.text(of: url) ?? editorText(url),
           let text = revert.text {
            let lines = current.components(separatedBy: "\n")
            let end = TextPosition(line: lines.count - 1, column: (lines.last ?? "").utf16.count)
            let edit = WorkspaceEdit(files: [.init(url: url, edits: [TextEdit(range: TextSpan(start: TextPosition(line: 0, column: 0), end: end),
                                                                              text: text)])])
            guard await editor.apply(edit) else { throw ReviewFailure("\(url.lastPathComponent) could not be changed in the editor.") }
            return
        }
        if let text = revert.text {
            try text.write(to: url, atomically: true, encoding: .utf8)
        } else {
            try FileManager.default.removeItem(at: url)
        }
    }

    private func editorText(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
}

struct ReviewFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
