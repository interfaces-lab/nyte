import AppKit
import NyteCore
import NyteUI

@MainActor @objc public protocol FileNavigatorCommands {
    func newFile(_ sender: Any?)
    func newFolder(_ sender: Any?)
    func renameItem(_ sender: Any?)
    func moveToTrash(_ sender: Any?)
    func duplicateItem(_ sender: Any?)
    func revealInFinder(_ sender: Any?)
    func openInTerminal(_ sender: Any?)
    func findInFolder(_ sender: Any?)
    func askNyte(_ sender: Any?)
    func copyPath(_ sender: Any?)
    func copyRelativePath(_ sender: Any?)
}

extension FileNavigatorViewController: FileNavigatorCommands, NSMenuItemValidation, NSUserInterfaceValidations {
    private static let backspace = "\u{8}"

    func menu(for rows: IndexSet) -> NSMenu? {
        let nodes = rows.filter { $0 < tree.rowCount }.map { tree.node(atRow: $0) }
        guard let first = nodes.first else { return nil }
        let items = nodes.map(url)
        let editable = !nodes.contains(FileTree.root)
        return Menu.make([
            MenuItem("New File", symbol: "document.badge.plus", showsIcon: true) { [weak self] in self?.create(.file, near: first) },
            MenuItem("New Folder", symbol: "folder.badge.plus", showsIcon: true) { [weak self] in self?.create(.folder, near: first) },
            .separator,
            MenuItem("Rename", key: "\r", modifiers: [], enabled: editable && nodes.count == 1) { [weak self] in
                guard let self, let row = self.tree.row(of: first) else { return }
                self.beginRename(row: row)
            },
            MenuItem("Move to Trash", key: Self.backspace, enabled: editable) { [weak self] in nodes.forEach { self?.trash($0) } },
            MenuItem("Duplicate", enabled: editable) { [weak self] in
                items.forEach { self?.perform(.duplicate($0), select: items.count == 1) }
            },
            .separator,
            MenuItem("Reveal in Finder", symbol: "folder", showsIcon: true) { NSWorkspace.shared.activateFileViewerSelecting(items) },
            MenuItem("Open in Terminal", symbol: "terminal", showsIcon: true, enabled: onOpenInTerminal != nil && nodes.count == 1) {
                [weak self] in self?.openTerminal(at: first)
            },
        ] + (onFindInFolder == nil ? [] : [
            MenuItem("Find in Folder…", symbol: "magnifyingglass", showsIcon: true, enabled: nodes.count == 1) {
                [weak self] in self?.findInFolder(at: first)
            },
        ]) + (onAskAgent == nil ? [] : [
            MenuItem("Ask Nyte About…", symbol: "sparkle", showsIcon: true) { [weak self] in self?.onAskAgent?(items) },
        ]) + [
            .separator,
            MenuItem("Copy Path") { Self.copy(items.map(\.path).joined(separator: "\n")) },
            MenuItem("Copy Relative Path") { [weak self] in
                guard let self else { return }
                Self.copy(nodes.map { self.tree.relativePath(of: $0) }.joined(separator: "\n"))
            },
        ])
    }

    private var selectedNode: FileTree.Node? {
        guard let row = list.selectedRow, row < tree.rowCount else { return nil }
        return tree.node(atRow: row)
    }

    @objc public func newFile(_ sender: Any?) { create(.file, near: selectedNode ?? FileTree.root) }
    @objc public func newFolder(_ sender: Any?) { create(.folder, near: selectedNode ?? FileTree.root) }

    @objc public func renameItem(_ sender: Any?) {
        guard let row = list.selectedRow else { return }
        beginRename(row: row)
    }

    @objc public func moveToTrash(_ sender: Any?) { selectedNode.map(trash) }

    @objc public func duplicateItem(_ sender: Any?) {
        guard let node = selectedNode else { return }
        perform(.duplicate(url(node)), select: true)
    }

    @objc public func revealInFinder(_ sender: Any?) {
        guard let node = selectedNode else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url(node)])
    }

    @objc public func openInTerminal(_ sender: Any?) { openTerminal(at: selectedNode ?? FileTree.root) }

    @objc public func findInFolder(_ sender: Any?) { findInFolder(at: selectedNode ?? FileTree.root) }

    @objc public func askNyte(_ sender: Any?) {
        guard let node = selectedNode else { return }
        onAskAgent?([url(node)])
    }

    @objc public func copyPath(_ sender: Any?) {
        guard let node = selectedNode else { return }
        Self.copy(url(node).path)
    }

    @objc public func copyRelativePath(_ sender: Any?) {
        guard let node = selectedNode else { return }
        Self.copy(tree.relativePath(of: node))
    }

    public func validateMenuItem(_ item: NSMenuItem) -> Bool { validateUserInterfaceItem(item) }

    public func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        switch item.action {
        case #selector(newFile(_:)), #selector(newFolder(_:)): renaming == nil
        case #selector(openInTerminal(_:)): onOpenInTerminal != nil
        case #selector(findInFolder(_:)): onFindInFolder != nil
        case #selector(askNyte(_:)): onAskAgent != nil && selectedNode != nil
        case #selector(renameItem(_:)), #selector(moveToTrash(_:)), #selector(duplicateItem(_:)):
            renaming == nil && selectedNode.map { $0 != FileTree.root } == true
        case #selector(revealInFinder(_:)), #selector(copyPath(_:)), #selector(copyRelativePath(_:)): selectedNode != nil
        default: false
        }
    }

    enum Kind { case file, folder }

    private func create(_ kind: Kind, near node: FileTree.Node) {
        let folder = tree.flags(of: node).contains(.directory) ? node : (tree.parent(of: node) ?? FileTree.root)
        if folder != FileTree.root, !tree.flags(of: folder).contains(.expanded) { expand(folder) }
        let target = url(folder)
        perform(kind == .file ? .createFile(in: target) : .createFolder(in: target), select: true, rename: true)
    }

    func trash(row: Int) { trash(tree.node(atRow: row)) }

    private func trash(_ node: FileTree.Node) {
        guard node != FileTree.root else { return }
        let item = url(node)
        guard tree.flags(of: node).contains(.directory) else { return perform(.trash(item), select: false) }
        Task {
            let count = await FileOperations.itemCount(in: item)
            guard count > 0 else { return perform(.trash(item), select: false) }
            confirmTrash(item, count: count)
        }
    }

    private func confirmTrash(_ item: URL, count: Int) {
        let alert = NSAlert()
        alert.messageText = "Move “\(item.lastPathComponent)” to the Trash?"
        alert.informativeText = count == 1 ? "The folder contains 1 item." : "The folder contains \(count) items."
        alert.addButton(withTitle: "Move to Trash")
        alert.addButton(withTitle: "Cancel")
        guard let window = view.window else { return perform(.trash(item), select: false) }
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            self?.perform(.trash(item), select: false)
        }
    }

    func perform(_ operation: FileOperation, select: Bool, rename: Bool = false) {
        let task = history.start(operation)
        guard select else { return }
        Task {
            guard case let .success(result) = await task.value else { return }
            let path = workspace.relativePath(of: operation.workspaceItem(result: result))
            afterReload = rename ? .rename(path) : .select(path)
        }
    }

    func finished(_ operation: FileOperation, _ result: Result<URL, FileOperationFailure>) {
        switch result {
        case let .success(url):
            let item = operation.workspaceItem(result: url)
            if operation.selectsResult { afterReload = .select(workspace.relativePath(of: item)) }
            reloadDirectory(of: item)
        case let .failure(failure):
            show(failure)
        }
    }

    func show(_ failure: FileOperationFailure) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = failure.title
        alert.informativeText = failure.reason
        guard let window = view.window else { return FilesLog.logger.error("\(failure.title, privacy: .public)") }
        alert.beginSheetModal(for: window)
    }

    private func openTerminal(at node: FileTree.Node) { onOpenInTerminal?(folder(of: node)) }

    private func findInFolder(at node: FileTree.Node) { onFindInFolder?(folder(of: node)) }

    private func folder(of node: FileTree.Node) -> URL {
        let item = url(node)
        return tree.flags(of: node).contains(.directory) ? item : item.deletingLastPathComponent()
    }

    private static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
