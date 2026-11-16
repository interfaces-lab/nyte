import AppKit
import NyteCore
import NyteUI

extension ReviewViewController {
    func revert(_ index: Int, _ selection: DiffSelection, _ document: DiffDocument) async -> String? {
        guard let onRevert else { return "Reverting isn’t available here." }
        let whole = selection == DiffSelection(hunks: document.diff.hunks)
        let text: String? = whole && !document.oldExists ? nil : String(decoding: selection.reversed.apply(
            from: document.new, toward: document.old, hunks: HunkOperations.reversed(document.diff.hunks)), as: UTF8.self)
        let previous: String? = document.newExists ? String(decoding: document.new.bytes, as: UTF8.self) : nil
        do {
            try await onRevert(ReviewRevert(url: root.appendingPathComponent(files[index].path), text: text))
        } catch {
            return error.localizedDescription
        }
        settle(index, after: text, before: document.oldExists ? String(decoding: document.old.bytes, as: UTF8.self) : nil)
        let name = whole ? "Revert File" : "Revert Lines"
        view.window?.undoManager?.registerUndo(withTarget: self) { controller in
            controller.restore(index, to: previous, redo: text, name: name)
        }
        view.window?.undoManager?.setActionName(name)
        return nil
    }

    func restore(_ index: Int, to text: String?, redo: String?, name: String) {
        guard let onRevert else { return }
        let url = root.appendingPathComponent(files[index].path)
        let before: String? = if case let .text(value) = files[index].before { value } else { nil }
        Task { [weak self] in
            do {
                try await onRevert(ReviewRevert(url: url, text: text))
            } catch {
                self?.diffs[index]?.pane.showFailure("Couldn’t undo", message: error.localizedDescription)
                return
            }
            guard let self else { return }
            settle(index, after: text, before: before)
            view.window?.undoManager?.registerUndo(withTarget: self) { controller in
                controller.restore(index, to: redo, redo: text, name: name)
            }
            view.window?.undoManager?.setActionName(name)
        }
    }

    func settle(_ index: Int, after text: String?, before: String?) {
        files[index].after = text.map { .text($0) } ?? .absent
        if text == before { reverted.insert(index) } else { reverted.remove(index) }
        diffs[index]?.replace(source(index))
        list.reloadRows(IndexSet(integer: index))
        updateSummary()
    }

    func confirmRevertFile() {
        guard shown >= 0, let diff = diffs[shown], let document = diff.document, !document.diff.hunks.isEmpty else { return NSSound.beep() }
        let index = shown
        let name = (files[index].path as NSString).lastPathComponent
        let alert = NSAlert()
        alert.messageText = document.oldExists ? "Revert “\(name)” to how it was before?" : "Remove “\(name)”?"
        alert.informativeText = document.oldExists ? "Every edit in this file is undone. You can undo this."
            : "The file was created by this run, so reverting deletes it. You can undo this."
        alert.addButton(withTitle: document.oldExists ? "Revert File" : "Remove File")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        let selection = DiffSelection(hunks: document.diff.hunks)
        let go: () -> Void = { [weak self] in
            Task { [weak self] in
                guard let self, let failure = await revert(index, selection, document) else { return }
                diff.pane.showFailure("Couldn’t revert", message: failure)
            }
        }
        guard let window = view.window else {
            go()
            return
        }
        alert.beginSheetModal(for: window) { response in
            guard response == .alertFirstButtonReturn else { return }
            go()
        }
    }

    func menu(for rows: IndexSet) -> NSMenu? {
        guard let index = rows.first, index < files.count else { return nil }
        let url = root.appendingPathComponent(files[index].path)
        return Menu.make([
            MenuItem("Revert File…", enabled: onRevert != nil && !reverted.contains(index), destructive: true) { [weak self] in
                self?.list.selectedRow = index
                self?.show(index)
                self?.confirmRevertFile()
            },
            .separator,
            MenuItem("Open File", enabled: onOpenFile != nil) { [weak self] in self?.onOpenFile?(url) },
            MenuItem("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) },
            MenuItem("Copy Path") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(url.path, forType: .string)
            },
        ])
    }

    func commentsDidChange() {
        let count = files.indices.reduce(0) { $0 + (diffs[$1]?.pane.canvas.notes.count ?? 0) }
        sendButton.detail = count.formatted()
        sendButton.isHidden = onSendComments == nil || count == 0
        sendButton.setAccessibilityLabel("Send \(Counted.comments(count)) to the agent")
    }

    @objc public func sendComments(_ sender: Any?) {
        let all = comments
        guard let onSendComments, !all.isEmpty else { return }
        onSendComments(all)
        for diff in diffs.values { diff.clearComments() }
    }

    @objc public func nextFile(_ sender: Any?) { cross(from: shown, 1) }
    @objc public func previousFile(_ sender: Any?) { cross(from: shown, -1) }
    @objc public func revertFile(_ sender: Any?) { confirmRevertFile() }
}

extension ReviewViewController: NSMenuItemValidation {
    public func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(sendComments(_:)):
            let count = comments.count
            item.title = count == 0 ? "Send Comments to Agent" : "Send \(Counted.comments(count)) to Agent"
            return onSendComments != nil && count > 0
        case #selector(toggleFileList(_:)):
            item.title = fileList == .shown ? "Hide File List" : "Show File List"
            return true
        case #selector(focusReview(_:)):
            return onFocusReview != nil
        case #selector(nextFile(_:)): return shown + 1 < files.count
        case #selector(previousFile(_:)): return shown > 0
        case #selector(revertFile(_:)):
            item.title = "Revert File…"
            return onRevert != nil && shown >= 0 && !reverted.contains(shown) && !(diffs[shown]?.document?.diff.hunks.isEmpty ?? true)
        default: return false
        }
    }
}
