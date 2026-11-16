import Foundation

public struct FileTree {
    public typealias Node = Int32

    public static let root: Node = 0

    public struct Flags: OptionSet, Sendable {
        public let rawValue: UInt8
        public init(rawValue: UInt8) { self.rawValue = rawValue }

        public static let directory = Flags(rawValue: 1 << 0)
        public static let symlink = Flags(rawValue: 1 << 1)
        public static let loaded = Flags(rawValue: 1 << 2)
        public static let expanded = Flags(rawValue: 1 << 3)
        public static let hidden = Flags(rawValue: 1 << 4)
        public static let ignored = Flags(rawValue: 1 << 5)
        public static let containsChanges = Flags(rawValue: 1 << 6)
        static let retired = Flags(rawValue: 1 << 7)
    }

    public enum Status: UInt8, Sendable {
        case clean, modified, added, deleted, renamed, untracked, conflicted
    }

    public struct StatusEntry: Sendable {
        public let path: String
        public let status: Status

        public init(path: String, status: Status) {
            self.path = path
            self.status = status
        }
    }

    public struct RowChange: Sendable {
        public let removed: IndexSet
        public let inserted: IndexSet
        public var isEmpty: Bool { removed.isEmpty && inserted.isEmpty }
    }

    public let rootPath: String

    private var parents: [Node] = [-1]
    private var depths: [UInt16] = [0]
    private var flags: [Flags] = [.directory]
    private var statuses: [Status] = [.clean]
    private var icons: [UInt8] = [0]
    private var nameStarts: [UInt32] = [0]
    private var nameLengths: [UInt16] = [0]
    private var childStarts: [Int32] = [0]
    private var childCounts: [Int32] = [0]
    private var rowIndex: [Int32] = [-1]
    private var children: [Node] = []
    private var arena: [UInt8] = []
    private var rows: [Node] = []
    private var free: [Node] = []
    private var garbage = 0

    public init(rootPath: String) {
        self.rootPath = rootPath
    }

    public var rowCount: Int { rows.count }
    public var nodeCount: Int { parents.count - free.count }

    public func node(atRow row: Int) -> Node { rows[row] }

    public func row(of node: Node) -> Int? {
        let row = rowIndex[Int(node)]
        return row < 0 ? nil : Int(row)
    }

    public func isLive(_ node: Node) -> Bool {
        node >= 0 && Int(node) < parents.count && !flags[Int(node)].contains(.retired)
    }

    public func parent(of node: Node) -> Node? {
        let parent = parents[Int(node)]
        return parent < 0 ? nil : parent
    }

    public func depth(of node: Node) -> Int { Int(depths[Int(node)]) }
    public func flags(of node: Node) -> Flags { flags[Int(node)] }
    public func status(of node: Node) -> Status { statuses[Int(node)] }
    public func icon(of node: Node) -> UInt8 { icons[Int(node)] }
    public func name(of node: Node) -> String { String(decoding: nameBytes(node), as: UTF8.self) }
    public func children(of node: Node) -> ArraySlice<Node> {
        let start = Int(childStarts[Int(node)])
        return children[start..<start + Int(childCounts[Int(node)])]
    }

    public func relativePath(of node: Node) -> String {
        var chain: [Node] = []
        var cursor = node
        while cursor != Self.root, cursor >= 0 {
            chain.append(cursor)
            cursor = parents[Int(cursor)]
        }
        var bytes: [UInt8] = []
        for id in chain.reversed() {
            if !bytes.isEmpty { bytes.append(UInt8(ascii: "/")) }
            bytes.append(contentsOf: nameBytes(id))
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    public func path(of node: Node) -> String {
        node == Self.root ? rootPath : rootPath + "/" + relativePath(of: node)
    }

    public func node(at relativePath: String) -> Node? {
        var node = Self.root
        for component in relativePath.utf8.split(separator: UInt8(ascii: "/")) {
            guard let child = child(of: node, named: component) else { return nil }
            node = child
        }
        return node
    }

    public func child(of directory: Node, named name: String) -> Node? {
        child(of: directory, named: name.utf8)
    }

    public var expandedPaths: [String] {
        rows.filter { flags[Int($0)].contains([.directory, .expanded]) }.map { relativePath(of: $0) }
    }

    public func loadedDirectories(in directory: Node) -> [Node] {
        var found: [Node] = []
        var stack = [directory]
        while let id = stack.popLast() {
            guard flags[Int(id)].contains([.directory, .loaded]) else { continue }
            found.append(id)
            stack.append(contentsOf: children(of: id))
        }
        return found
    }

    public var byteCount: Int {
        parents.capacity * MemoryLayout<Node>.stride
            + depths.capacity * MemoryLayout<UInt16>.stride
            + flags.capacity * MemoryLayout<Flags>.stride
            + statuses.capacity * MemoryLayout<Status>.stride
            + icons.capacity * MemoryLayout<UInt8>.stride
            + nameStarts.capacity * MemoryLayout<UInt32>.stride
            + nameLengths.capacity * MemoryLayout<UInt16>.stride
            + childStarts.capacity * MemoryLayout<Int32>.stride
            + childCounts.capacity * MemoryLayout<Int32>.stride
            + rowIndex.capacity * MemoryLayout<Int32>.stride
            + children.capacity * MemoryLayout<Node>.stride
            + arena.capacity
            + rows.capacity * MemoryLayout<Node>.stride
            + free.capacity * MemoryLayout<Node>.stride
    }

    public mutating func load(
        _ listing: DirectoryListing, into directory: Node, icon: (_ name: String) -> UInt8
    ) -> RowChange {
        let index = Int(directory)
        let showing = directory == Self.root || (rowIndex[index] >= 0 && flags[index].contains(.expanded))
        let runStart = directory == Self.root ? 0 : Int(rowIndex[index]) + 1
        let oldRun = showing ? Array(rows[runStart..<runEnd(after: directory)]) : []
        let plan = merge(listing, into: directory)
        var retired: [Node] = []
        plan.gone.forEach { retire($0, into: &retired) }

        var fresh = Set<Node>()
        let merged = plan.order.map { entry in
            guard entry < 0 else { return entry }
            let id = makeNode(listing, Int(-entry - 1), parent: directory, icon: icon)
            fresh.insert(id)
            return id
        }
        let oldStart = Int(childStarts[index])
        let oldCount = Int(childCounts[index])
        if merged.count <= oldCount {
            children.replaceSubrange(oldStart..<oldStart + merged.count, with: merged)
            garbage += (oldCount - merged.count) * MemoryLayout<Node>.stride
        } else {
            childStarts[index] = Int32(children.count)
            children.append(contentsOf: merged)
            garbage += oldCount * MemoryLayout<Node>.stride
        }
        childCounts[index] = Int32(merged.count)
        flags[index].insert(.loaded)

        guard showing else {
            free.append(contentsOf: retired)
            compactIfWasteful()
            return RowChange(removed: [], inserted: [])
        }
        let newRun = visibleDescendants(of: directory)
        let removed = IndexSet(oldRun.indices.filter { flags[Int(oldRun[$0])].contains(.retired) }.map { runStart + $0 })
        let inserted = IndexSet(newRun.indices.filter { fresh.contains(newRun[$0]) }.map { runStart + $0 })
        rows.replaceSubrange(runStart..<runStart + oldRun.count, with: newRun)
        reindexRows(from: runStart)
        free.append(contentsOf: retired)
        compactIfWasteful()
        return RowChange(removed: removed, inserted: inserted)
    }

    public mutating func expand(_ directory: Node) -> Range<Int> {
        let index = Int(directory)
        guard directory != Self.root, flags[index].contains(.directory), !flags[index].contains(.expanded) else {
            return 0..<0
        }
        flags[index].insert(.expanded)
        guard rowIndex[index] >= 0, flags[index].contains(.loaded) else { return 0..<0 }
        let start = Int(rowIndex[index]) + 1
        let run = visibleDescendants(of: directory)
        rows.insert(contentsOf: run, at: start)
        reindexRows(from: start)
        return start..<start + run.count
    }

    public mutating func collapse(_ directory: Node) -> Range<Int> {
        let index = Int(directory)
        guard directory != Self.root, flags[index].contains(.expanded) else { return 0..<0 }
        flags[index].remove(.expanded)
        guard rowIndex[index] >= 0 else { return 0..<0 }
        let start = Int(rowIndex[index]) + 1
        let end = runEnd(after: directory)
        rows[start..<end].forEach { rowIndex[Int($0)] = -1 }
        rows.removeSubrange(start..<end)
        reindexRows(from: start)
        return start..<end
    }

    public mutating func applyStatus(_ changes: [StatusEntry], ignored: [String]) {
        for id in flags.indices {
            flags[id].remove([.ignored, .containsChanges])
            statuses[id] = .clean
        }
        for change in changes {
            let found = resolve(change.path)
            for id in found.chain where flags[Int(id)].contains(.directory) {
                flags[Int(id)].insert(.containsChanges)
            }
            if found.complete, let last = found.chain.last { statuses[Int(last)] = change.status }
        }
        for path in ignored {
            let found = resolve(path)
            if found.complete, let last = found.chain.last { flags[Int(last)].insert(.ignored) }
        }
        var stack = [Self.root]
        while let directory = stack.popLast() {
            let parent = Int(directory)
            for child in children(of: directory) {
                let id = Int(child)
                if flags[parent].contains(.ignored) { flags[id].insert(.ignored) }
                if statuses[parent] == .untracked {
                    statuses[id] = .untracked
                    if flags[id].contains(.directory) { flags[id].insert(.containsChanges) }
                }
                if flags[id].contains([.directory, .loaded]) { stack.append(child) }
            }
        }
    }

    private func nameBytes(_ node: Node) -> ArraySlice<UInt8> {
        let start = Int(nameStarts[Int(node)])
        return arena[start..<start + Int(nameLengths[Int(node)])]
    }

    private func child<Name: Collection<UInt8>>(of directory: Node, named name: Name) -> Node? {
        children(of: directory).first { nameBytes($0).elementsEqual(name) }
    }

    private func resolve(_ relativePath: String) -> (chain: [Node], complete: Bool) {
        var chain: [Node] = []
        var node = Self.root
        for component in relativePath.utf8.split(separator: UInt8(ascii: "/")) {
            guard let child = child(of: node, named: component) else { return (chain, false) }
            chain.append(child)
            node = child
        }
        return (chain, true)
    }

    private func merge(_ listing: DirectoryListing, into directory: Node) -> (order: [Node], gone: [Node]) {
        let old = children(of: directory)
        var order: [Node] = []
        order.reserveCapacity(listing.count)
        var gone: [Node] = []
        arena.withUnsafeBufferPointer { mine in
            listing.names.withUnsafeBufferPointer { theirs in
                var i = old.startIndex
                var k = 0
                while i < old.endIndex || k < listing.count {
                    guard k < listing.count else {
                        gone.append(old[i])
                        i += 1
                        continue
                    }
                    guard i < old.endIndex else {
                        order.append(-Node(k) - 1)
                        k += 1
                        continue
                    }
                    let id = Int(old[i])
                    let existing = UnsafeBufferPointer(
                        rebasing: mine[Int(nameStarts[id])..<Int(nameStarts[id]) + Int(nameLengths[id])]
                    )
                    let incoming = UnsafeBufferPointer(
                        rebasing: theirs[Int(listing.starts[k])..<Int(listing.starts[k]) + Int(listing.lengths[k])]
                    )
                    let comparison = Self.compare(
                        existing, flags[id].contains(.directory), incoming, listing.kinds[k].contains(.directory)
                    )
                    if comparison == 0 {
                        order.append(old[i])
                        i += 1
                        k += 1
                    } else if comparison < 0 {
                        gone.append(old[i])
                        i += 1
                    } else {
                        order.append(-Node(k) - 1)
                        k += 1
                    }
                }
            }
        }
        return (order, gone)
    }

    private mutating func makeNode(
        _ listing: DirectoryListing, _ entry: Int, parent: Node, icon: (String) -> UInt8
    ) -> Node {
        let start = Int(listing.starts[entry])
        let length = listing.lengths[entry]
        let nameStart = UInt32(arena.count)
        let name = listing.names[start..<start + Int(length)]
        arena.append(contentsOf: name)
        let iconIndex = listing.kinds[entry].contains(.directory) ? 0 : icon(String(decoding: name, as: UTF8.self))
        let depth: UInt16 = parent == Self.root ? 0 : depths[Int(parent)] + 1
        guard let id = free.popLast() else {
            parents.append(parent)
            depths.append(depth)
            flags.append(listing.kinds[entry])
            statuses.append(.clean)
            icons.append(iconIndex)
            nameStarts.append(nameStart)
            nameLengths.append(length)
            childStarts.append(0)
            childCounts.append(0)
            rowIndex.append(-1)
            return Node(parents.count - 1)
        }
        let index = Int(id)
        parents[index] = parent
        depths[index] = depth
        flags[index] = listing.kinds[entry]
        statuses[index] = .clean
        icons[index] = iconIndex
        nameStarts[index] = nameStart
        nameLengths[index] = length
        childStarts[index] = 0
        childCounts[index] = 0
        rowIndex[index] = -1
        return id
    }

    private mutating func retire(_ node: Node, into retired: inout [Node]) {
        var stack = [node]
        while let id = stack.popLast() {
            let index = Int(id)
            stack.append(contentsOf: children(of: id))
            garbage += Int(childCounts[index]) * MemoryLayout<Node>.stride + Int(nameLengths[index])
            flags[index] = .retired
            statuses[index] = .clean
            childCounts[index] = 0
            rowIndex[index] = -1
            retired.append(id)
        }
    }

    private func visibleDescendants(of directory: Node) -> [Node] {
        var run: [Node] = []
        var stack: [Range<Int>] = []
        if flags[Int(directory)].contains(.loaded) { stack.append(children(of: directory).indices) }
        while let range = stack.popLast() {
            guard let first = range.first else { continue }
            stack.append(first + 1..<range.upperBound)
            let id = children[first]
            run.append(id)
            if flags[Int(id)].contains([.directory, .expanded, .loaded]) { stack.append(children(of: id).indices) }
        }
        return run
    }

    private func runEnd(after directory: Node) -> Int {
        guard directory != Self.root else { return rows.count }
        let depth = depths[Int(directory)]
        var end = Int(rowIndex[Int(directory)]) + 1
        while end < rows.count, depths[Int(rows[end])] > depth { end += 1 }
        return end
    }

    private mutating func reindexRows(from start: Int) {
        for row in start..<rows.count { rowIndex[Int(rows[row])] = Int32(row) }
    }

    private mutating func compactIfWasteful() {
        let held = children.count * MemoryLayout<Node>.stride + arena.count
        guard garbage > 1 << 16, garbage * 2 > held else { return }
        var compactChildren: [Node] = []
        compactChildren.reserveCapacity(children.count)
        var compactArena: [UInt8] = []
        for id in parents.indices where !flags[id].contains(.retired) {
            let start = Int(nameStarts[id])
            nameStarts[id] = UInt32(compactArena.count)
            compactArena.append(contentsOf: arena[start..<start + Int(nameLengths[id])])
            let childStart = Int(childStarts[id])
            childStarts[id] = Int32(compactChildren.count)
            compactChildren.append(contentsOf: children[childStart..<childStart + Int(childCounts[id])])
        }
        children = compactChildren
        arena = compactArena
        garbage = 0
    }
}
