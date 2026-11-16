import AppKit
import NyteCore
import NyteUI

extension FileNavigatorViewController {
    struct Renaming {
        let node: FileTree.Node
        let original: String
        let host: NSView
        let input: Input
    }

    private static let renameSize = Size.sm

    func beginRename(row: Int) {
        guard renaming == nil, row < tree.rowCount, let table = list.scrollView.documentView else { return }
        let node = tree.node(atRow: row)
        guard node != FileTree.root else { return }
        let name = tree.name(of: node)
        let input = Input(name, size: Self.renameSize)
        input.field.setAccessibilityLabel("Name")
        let host = NSView()
        host.addSubview(input)
        NSLayoutConstraint.activate([
            input.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            input.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            input.centerYAnchor.constraint(equalTo: host.centerYAnchor),
        ])
        table.addSubview(host)
        renaming = Renaming(node: node, original: name, host: host, input: input)
        input.onSubmit = { [weak self] text in self?.commitRename(text) }
        input.onCancel = { [weak self] in self?.cancelRename() }
        input.onEndEditing = { [weak self] text in self?.commitRename(text) }
        list.reloadRows(IndexSet(integer: row))
        positionRenameField()
        view.window?.makeFirstResponder(input.field)
        let stem = tree.flags(of: node).contains(.directory) ? name : (name as NSString).deletingPathExtension
        input.field.currentEditor()?.selectedRange = NSRange(location: 0, length: (stem.isEmpty ? name : stem).utf16.count)
    }

    func positionRenameField() {
        guard let renaming else { return }
        guard tree.isLive(renaming.node), let row = tree.row(of: renaming.node),
              let table = list.scrollView.documentView as? NSTableView else { return cancelRename() }
        var content = RowContent(depth: tree.depth(of: renaming.node))
        content.layout = .tree
        let rowRect = table.rect(ofRow: row)
        let x = RowCell.Geometry.titleX(content) - RowCell.Geometry.gap
        let end = rowRect.maxX - RowCell.Geometry.inset
        let height = Self.renameSize.height
        renaming.host.frame = NSRect(x: x, y: rowRect.midY - height / 2, width: max(0, end - x), height: height)
    }

    func cancelRename() {
        finishRename()
    }

    private func commitRename(_ text: String) {
        guard let current = renaming else { return }
        finishRename()
        guard text != current.original, tree.isLive(current.node) else { return }
        let item = url(current.node)
        let original = current.original
        Task {
            let siblings = await FileOperations.siblingNames(of: item)
            if let problem = FileNaming.problem(with: text, existing: siblings, current: original) {
                return show(FileOperationFailure(title: FileOperation.rename(item, to: text).failureTitle,
                                                 reason: FileNaming.describe(problem, name: text)))
            }
            perform(.rename(item, to: text), select: true)
        }
    }

    private func finishRename() {
        guard let current = renaming else { return }
        renaming = nil
        current.host.removeFromSuperview()
        if let row = tree.row(of: current.node) { list.reloadRows(IndexSet(integer: row)) }
        list.focus()
    }
}
