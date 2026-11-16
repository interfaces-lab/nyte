import AppKit
import NyteCore
import NyteUI

enum RowIdentity: Hashable {
    case folder(String)
    case file(Int32)
    case match(Int32)
    case failures
    case failure(Int32)
}

struct RowLayout {
    typealias RowKind = FindInFilesViewController.RowKind
    typealias FolderRow = FindInFilesViewController.FolderRow

    struct Inputs {
        var results: SearchResults
        var display: [Int32]
        var fileOpen: [Bool]
        var fileShown: [Int32]
        var dismissed: [Bool]
        var groupsByFolder: Bool
        var closedFolders: Set<String>
        var failures: Int
        var failuresOpen: Bool
    }

    private struct Node {
        var path: String
        var name: String
        var children: [Child] = []
        var count = 0
    }

    private enum Child {
        case folder(Int)
        case file(Int32)
    }

    var kind: [RowKind] = []
    var index: [Int32] = []
    var depth: [UInt8] = []
    var folders: [FolderRow] = []

    var identities: [RowIdentity] {
        kind.indices.map { row in
            switch kind[row] {
            case .folder: .folder(folders[Int(index[row])].path)
            case .file: .file(index[row])
            case .match: .match(index[row])
            case .failures: .failures
            case .failure: .failure(index[row])
            }
        }
    }

    static func build(_ inputs: Inputs) -> RowLayout {
        var layout = RowLayout()
        let visible = inputs.display.filter { inputs.fileShown[Int($0)] > 0 }
        if inputs.groupsByFolder {
            var nodes = [Node(path: "", name: "")]
            var known: [String: Int] = [:]
            for file in visible {
                var node = 0
                var chain = [0]
                var prefix = ""
                for component in (inputs.results.paths[Int(file)] as NSString).deletingLastPathComponent.split(separator: "/") {
                    prefix += component + "/"
                    if let existing = known[prefix] {
                        node = existing
                    } else {
                        nodes.append(Node(path: prefix, name: String(component)))
                        known[prefix] = nodes.count - 1
                        nodes[node].children.append(.folder(nodes.count - 1))
                        node = nodes.count - 1
                    }
                    chain.append(node)
                }
                nodes[node].children.append(.file(file))
                for member in chain { nodes[member].count += Int(inputs.fileShown[Int(file)]) }
            }
            layout.emit(0, depth: 0, nodes: nodes, inputs: inputs)
        } else {
            for file in visible { layout.emitFile(file, depth: 0, inputs: inputs) }
        }
        guard inputs.failures > 0 else { return layout }
        layout.append(.failures, -1, depth: 0)
        guard inputs.failuresOpen else { return layout }
        for failure in 0..<inputs.failures { layout.append(.failure, Int32(failure), depth: 1) }
        return layout
    }

    private mutating func emit(_ node: Int, depth: Int, nodes: [Node], inputs: Inputs) {
        for child in nodes[node].children {
            switch child {
            case let .file(file):
                emitFile(file, depth: depth, inputs: inputs)
            case let .folder(start):
                var last = start
                var title = nodes[start].name + "/"
                while nodes[last].children.count == 1, case let .folder(next) = nodes[last].children[0] {
                    last = next
                    title += nodes[next].name + "/"
                }
                folders.append(FolderRow(path: nodes[last].path, title: title, count: nodes[start].count))
                append(.folder, Int32(folders.count - 1), depth: depth)
                if !inputs.closedFolders.contains(nodes[last].path) { emit(last, depth: depth + 1, nodes: nodes, inputs: inputs) }
            }
        }
    }

    private mutating func emitFile(_ file: Int32, depth: Int, inputs: Inputs) {
        append(.file, file, depth: depth)
        guard inputs.fileOpen[Int(file)] else { return }
        for match in inputs.results.fileMatches[Int(file)] where !inputs.dismissed[Int(match)] {
            append(.match, match, depth: depth + 1)
        }
    }

    private mutating func append(_ rowKind: RowKind, _ rowIndex: Int32, depth rowDepth: Int) {
        kind.append(rowKind)
        index.append(rowIndex)
        depth.append(UInt8(min(rowDepth, Int(UInt8.max))))
    }
}

struct RowSplice: Equatable {
    var start: Int
    var removed: Int
    var inserted: Int

    var isEmpty: Bool { removed == 0 && inserted == 0 }
    var oldRows: Range<Int> { start..<start + removed }

    static func diff(_ old: [RowIdentity], _ new: [RowIdentity]) -> RowSplice {
        var prefix = 0
        while prefix < old.count, prefix < new.count, old[prefix] == new[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < old.count - prefix, suffix < new.count - prefix, old[old.count - 1 - suffix] == new[new.count - 1 - suffix] {
            suffix += 1
        }
        return RowSplice(start: prefix, removed: old.count - prefix - suffix, inserted: new.count - prefix - suffix)
    }
}

enum Placement: Equatable {
    case now
    case nowKeepingView
    case hold

    static func decide(_ change: RowSplice, visible: Range<Int>, interacting: Bool) -> Placement {
        if visible.isEmpty || change.start >= visible.upperBound { return .now }
        if change.oldRows.upperBound <= visible.lowerBound, change.start < visible.lowerBound || change.removed == 0 {
            return .nowKeepingView
        }
        return interacting ? .hold : .now
    }
}

extension FindInFilesViewController {
    func layoutInputs(display: [Int32]) -> RowLayout.Inputs {
        RowLayout.Inputs(results: results, display: display, fileOpen: fileOpen, fileShown: fileShown, dismissed: dismissed,
                         groupsByFolder: groupsByFolder, closedFolders: closedFolders, failures: failures.count,
                         failuresOpen: failuresOpen)
    }

    func adopt(_ layout: RowLayout) {
        rowKind = layout.kind
        rowIndex = layout.index
        rowDepth = layout.depth
        folderRows = layout.folders
    }

    func rebuildRows() {
        adopt(RowLayout.build(layoutInputs(display: displayFiles)))
    }

    var identities: [RowIdentity] {
        RowLayout(kind: rowKind, index: rowIndex, depth: rowDepth, folders: folderRows).identities
    }

    func relayout(keepingSelection: Bool = true) {
        let selected = keepingSelection ? Set(list.selectedRows.compactMap { identities.indices.contains($0) ? identities[$0] : nil }) : []
        rebuildRows()
        list.reload()
        guard keepingSelection else { return }
        let current = identities
        list.selectedRows = IndexSet(current.indices.filter { selected.contains(current[$0]) })
    }

    func replaceResults(with fresh: SearchResults) {
        let interval = signposter.beginInterval("search swap")
        defer { signposter.endInterval("search swap", interval) }
        awaitingSwap = false
        swaps += 1
        previewTask?.cancel()
        results = fresh
        widestLine = 0
        noteWidest(fresh)
        fileOpen = Array(repeating: true, count: fresh.fileCount)
        fileShown = fresh.fileMatches.map { Int32($0.count) }
        dismissed = Array(repeating: false, count: fresh.matchCount)
        displayFiles = (0..<Int32(fresh.fileCount)).sorted { fresh.fileOrder[Int($0)] < fresh.fileOrder[Int($1)] }
        unplaced = []
        syntaxCache = [:]
        failures = []
        failuresOpen = false
        rebuildRows()
        list.reload()
        list.selectedRows = []
        restoreSelection(from: 0)
        selectFirstIfNone()
    }

    func appendResults(_ batch: SearchResults) {
        let first = results.fileCount
        results.append(batch)
        noteWidest(batch)
        fileOpen += Array(repeating: true, count: batch.fileCount)
        fileShown += batch.fileMatches.map { Int32($0.count) }
        dismissed += Array(repeating: false, count: batch.matchCount)
        unplaced += (first..<results.fileCount).map { Int32($0) }
    }

    func noteWidest(_ batch: SearchResults) {
        let widest = batch.matchLine.max() ?? 0
        guard widest > widestLine else { return }
        let grows = String(widest + 1).count > String(widestLine + 1).count
        widestLine = widest
        if grows { list.widestNumber = list.widestNumber }
    }

    func selectFirstIfNone() {
        guard list.selectedRow == nil, keptSelection == nil else { return }
        guard let first = rowKind.firstIndex(of: .match) else { return preview.clear("") }
        list.selectedRows = IndexSet(integer: first)
        selectionChanged()
    }

    func appendFailureRows() {
        let old = identities
        rebuildRows()
        let change = RowSplice.diff(old, identities)
        guard !change.isEmpty else { return }
        list.insertRows(IndexSet(integersIn: change.start..<change.start + change.inserted), animated: false)
    }

    func restoreSelection(from file: Int) {
        guard let kept = keptSelection, list.selectedRow == nil else { return }
        for index in file..<results.fileCount where results.paths[index] == kept.path {
            let match = results.fileMatches[index].first { results.matchLine[Int($0)] == kept.line }
                ?? results.fileMatches[index].first
            guard let match, let row = rowIndex.indices.first(where: { rowKind[$0] == .match && rowIndex[$0] == match }) else { return }
            keptSelection = nil
            list.selectedRows = IndexSet(integer: row)
            selectionChanged()
            return
        }
    }

    func toggleGroup(at row: Int) {
        guard rowKind.indices.contains(row) else { return }
        noteInteraction()
        switch rowKind[row] {
        case .file: fileOpen[Int(rowIndex[row])].toggle()
        case .folder:
            let path = folderRows[Int(rowIndex[row])].path
            if closedFolders.contains(path) { closedFolders.remove(path) } else { closedFolders.insert(path) }
        case .failures: failuresOpen.toggle()
        case .match, .failure: return
        }
        let old = identities
        rebuildRows()
        let change = RowSplice.diff(old, identities)
        list.reloadRows(IndexSet(integer: row))
        if change.removed > 0 { list.removeRows(IndexSet(integersIn: change.oldRows), animated: true) }
        if change.inserted > 0 { list.insertRows(IndexSet(integersIn: change.start..<change.start + change.inserted), animated: true) }
    }

    func setGroupsByFolder(_ grouped: Bool) {
        groupsByFolder = grouped
        bar.grouping.isOn = grouped
        bar.grouping.setAccessibilityValue(grouped)
        relayout()
        if let row = list.selectedRow { list.scrollRowToVisible(row) }
    }
}
