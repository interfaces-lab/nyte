import AppKit
import NyteCore
import NyteUI

@MainActor
public final class StructureViewController: NSViewController {
    public var onNavigate: ((FileLocation) -> Void)?

    static let debounce: Duration = .milliseconds(300)

    private let intelligence: any LanguageIntelligence
    private let list = ListView()
    private let search = SearchField(placeholder: "Filter symbols", size: .sm)
    private let tool = ToolWindowView(header: .compact)
    private var empty: NSView?
    private var shownNotice: Notice?

    private var url: URL?
    private var symbols: [DocumentSymbol] = []
    private var parents: [Int32] = []
    private var hasChildren: [Bool] = []
    private var rows: [Int32] = []
    private var rowOfSymbol: [Int32] = []
    private var closedKeys: Set<String> = []
    private var filterClosed: Set<Int32> = []
    private var query = ""
    private var caret: TextPosition?
    private var request: Task<Void, Never>?
    private var isLoading = false
    private var generation = 0

    static let collapsedParameters = "(\u{2026})"

    public init(intelligence: any LanguageIntelligence) {
        self.intelligence = intelligence
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func loadView() {
        tool.onAppearanceChange = { [weak self] in self?.list.reload() }
        tool.setAccessibilityElement(true)
        tool.setAccessibilityRole(.group)
        tool.setAccessibilityLabel("Structure")
        search.translatesAutoresizingMaskIntoConstraints = false
        tool.header.addSubview(search)
        NSLayoutConstraint.activate([
            search.centerYAnchor.constraint(equalTo: tool.header.centerYAnchor),
            search.leadingAnchor.constraint(equalTo: tool.header.leadingAnchor, constant: tool.header.trailingInset),
            search.trailingAnchor.constraint(equalTo: tool.header.trailingAnchor, constant: -tool.header.trailingInset),
        ])
        Pin.fill(list, in: tool.content)
        tool.follow(list.scrollView)
        list.rowHeight = Metric.rowCompact
        list.isOutline = true
        list.activatesOnClick = true
        list.verticalInset = Space.x1
        list.rowCount = { [weak self] in self?.rows.count ?? 0 }
        list.content = { [weak self] in self?.row($0) ?? RowContent() }
        list.onActivate = { [weak self] in self?.navigate(to: $0) }
        list.onToggle = { [weak self] in self?.toggle($0) }
        search.onChange = { [weak self] in self?.filter($0) }
        search.onMove = { [weak self] in self?.list.moveSelection(by: $0) }
        search.onSubmit = { [weak self] _ in
            guard let self, let row = list.selectedRow ?? rows.indices.first else { return }
            navigate(to: row)
        }
        view = tool
        showState()
    }

    public func show(_ url: URL?) {
        loadViewIfNeeded()
        guard url != self.url else { return }
        self.url = url
        symbols = []
        closedKeys = []
        filterClosed = []
        caret = nil
        rebuildRows()
        list.reload()
        refresh(after: nil)
    }

    public func documentDidChange() {
        loadViewIfNeeded()
        refresh(after: Self.debounce)
    }

    public func caretDidMove(to position: TextPosition?) {
        loadViewIfNeeded()
        caret = position
        selectCaretSymbol()
    }

    private func refresh(after delay: Duration?) {
        request?.cancel()
        request = nil
        generation += 1
        let generation = generation
        guard let url, intelligence.handles(url) else {
            isLoading = false
            return showState()
        }
        isLoading = true
        guard !isStarting(url) else { return showState() }
        request = Task { [weak self] in
            if let delay {
                do { try await Task.sleep(for: delay) } catch { return }
            }
            guard let self else { return }
            let found = await intelligence.symbols(in: url)
            guard !Task.isCancelled, generation == self.generation else { return }
            receive(found)
        }
    }

    public func serverStatusDidChange() {
        loadViewIfNeeded()
        guard let url, isLoading, request == nil, !isStarting(url) else { return showState() }
        refresh(after: nil)
    }

    private func isStarting(_ url: URL) -> Bool {
        guard let state = intelligence.status(for: url)?.state else { return true }
        return state == .starting
    }

    private func receive(_ answer: [DocumentSymbol]) {
        isLoading = false
        let found = Self.nestingMethods(Self.droppingLocals(answer))
        let selectedKey = list.selectedRow.map { key(Int(rows[$0])) }
        let origin = list.scrollView.contentView.bounds.origin
        symbols = found
        parents = Array(repeating: -1, count: found.count)
        hasChildren = Array(repeating: false, count: found.count)
        var stack: [Int32] = []
        for index in found.indices {
            while let last = stack.last, found[Int(last)].depth >= found[index].depth { stack.removeLast() }
            if let last = stack.last {
                parents[index] = last
                hasChildren[Int(last)] = true
            }
            stack.append(Int32(index))
        }
        filterClosed = []
        rebuildRows()
        list.reload()
        if let selectedKey, let symbol = symbols.indices.first(where: { key($0) == selectedKey }), rowOfSymbol[symbol] >= 0 {
            list.selectedRows = IndexSet(integer: Int(rowOfSymbol[symbol]))
        } else {
            list.selectedRows = []
        }
        list.scrollView.contentView.scroll(to: origin)
        list.scrollView.reflectScrolledClipView(list.scrollView.contentView)
        showState()
        selectCaretSymbol()
    }

    private static func droppingLocals(_ symbols: [DocumentSymbol]) -> [DocumentSymbol] {
        var callable = Int.max
        return symbols.filter { symbol in
            if symbol.depth > callable { return false }
            callable = [.function, .method, .constructor].contains(symbol.kind) ? symbol.depth : .max
            return true
        }
    }

    private static func nestingMethods(_ symbols: [DocumentSymbol]) -> [DocumentSymbol] {
        let tops = symbols.indices.filter { symbols[$0].depth == 0 }
        let ends = tops.dropFirst().map { $0 } + [symbols.count]
        let types = Set(tops.filter { symbols[$0].kind != .method && symbols[$0].kind != .function }.map { symbols[$0].name })
        var methods: [String: [(name: String, range: Range<Int>)]] = [:]
        var moved = Set<Int>()
        for (top, end) in zip(tops, ends) where symbols[top].kind == .method {
            guard let match = symbols[top].name.wholeMatch(of: /\(\*?(\w+)\)\.(.+)/), types.contains(String(match.1)) else { continue }
            methods[String(match.1), default: []].append((String(match.2), top..<end))
            moved.insert(top)
        }
        guard !moved.isEmpty else { return symbols }
        var nested: [DocumentSymbol] = []
        nested.reserveCapacity(symbols.count)
        for (top, end) in zip(tops, ends) where !moved.contains(top) {
            nested += symbols[top..<end]
            for method in methods[symbols[top].name] ?? [] {
                for index in method.range {
                    var symbol = symbols[index]
                    symbol.depth += 1
                    if index == method.range.lowerBound { symbol.name = method.name }
                    nested.append(symbol)
                }
            }
        }
        return nested
    }

    private func key(_ symbol: Int) -> String {
        var names = [symbols[symbol].name]
        var parent = parents[symbol]
        while parent >= 0 {
            names.append(symbols[Int(parent)].name)
            parent = parents[Int(parent)]
        }
        return names.reversed().joined(separator: "\u{1F}")
    }

    private func isOpen(_ symbol: Int) -> Bool {
        query.isEmpty ? !closedKeys.contains(key(symbol)) : !filterClosed.contains(Int32(symbol))
    }

    private func rebuildRows() {
        let shown = query.isEmpty ? nil : matchingPaths()
        rows = []
        rowOfSymbol = Array(repeating: -1, count: symbols.count)
        var hiddenBelow = Int.max
        for index in symbols.indices {
            let depth = symbols[index].depth
            if depth > hiddenBelow { continue }
            hiddenBelow = .max
            if let shown, !shown[index] { continue }
            rowOfSymbol[index] = Int32(rows.count)
            rows.append(Int32(index))
            if hasChildren[index], !isOpen(index) { hiddenBelow = depth }
        }
    }

    private func matchingPaths() -> [Bool] {
        var shown = Array(repeating: false, count: symbols.count)
        for index in symbols.indices where symbols[index].name.localizedCaseInsensitiveContains(query) {
            var walk = Int32(index)
            while walk >= 0, !shown[Int(walk)] {
                shown[Int(walk)] = true
                walk = parents[Int(walk)]
            }
        }
        return shown
    }

    private func row(_ index: Int) -> RowContent {
        let symbol = symbols[Int(rows[index])]
        let disclosure: RowContent.Disclosure = hasChildren[Int(rows[index])] ? (isOpen(Int(rows[index])) ? .open : .closed) : .none
        var row = RowContent(title: symbol.name, leading: SymbolMarks.mark(symbol.kind), depth: symbol.depth, disclosure: disclosure)
        if symbol.detail.hasPrefix("("), let shape = CallShape(signature: symbol.detail, after: "") {
            row.detail = shape.parameters
            row.detailShort = shape.parameters.filter { !$0.isWhitespace } == "()" ? "()" : Self.collapsedParameters
            row.detailJoinsTitle = true
            row.meta = shape.result
        } else {
            row.meta = symbol.detail
        }
        if let open = row.meta.firstIndex(of: "<") { row.metaShort = row.meta[..<open] + "<\u{2026}>" }
        if !symbol.signature.isEmpty { row.toolTip = symbol.name + (symbol.signature.hasPrefix("(") ? "" : ": ") + symbol.signature }
        row.detailInk = .secondary
        row.metaInk = .secondary
        let signature = symbol.detail.isEmpty ? "" : ", \(symbol.name)\(symbol.detail)"
        row.accessibilityLabel = "\(symbol.name), \(SymbolMarks.word(symbol.kind))\(symbol.isDeprecated ? ", deprecated" : "")\(signature)"
        if symbol.isDeprecated { row.titleInk = .tertiary }
        if !query.isEmpty { row.emphasizeMatches(of: query) }
        return row
    }

    private func toggle(_ row: Int) {
        let symbol = Int(rows[row])
        guard hasChildren[symbol] else { return }
        if query.isEmpty {
            let key = key(symbol)
            if closedKeys.remove(key) == nil { closedKeys.insert(key) }
        } else if filterClosed.remove(Int32(symbol)) == nil {
            filterClosed.insert(Int32(symbol))
        }
        let before = rows.count
        rebuildRows()
        let change = rows.count - before
        list.reloadRows(IndexSet(integer: row))
        if change > 0 { list.insertRows(IndexSet(integersIn: row + 1..<row + 1 + change)) }
        if change < 0 { list.removeRows(IndexSet(integersIn: row + 1..<row + 1 - change)) }
    }

    private func filter(_ text: String) {
        query = text.trimmingCharacters(in: .whitespaces)
        filterClosed = []
        rebuildRows()
        list.reload()
        if !query.isEmpty, let first = rows.indices.first(where: {
            symbols[Int(rows[$0])].name.localizedCaseInsensitiveContains(query)
        }) {
            list.selectedRows = IndexSet(integer: first)
        }
        showState()
    }

    private func navigate(to row: Int) {
        guard let url, row < rows.count else { return }
        onNavigate?(FileLocation(url: url, range: symbols[Int(rows[row])].selection))
    }

    private func selectCaretSymbol() {
        guard let caret, !symbols.isEmpty else { return }
        let holding = symbols.indices.filter { symbols[$0].range.contains(caret) }
        guard var symbol = holding.max(by: { symbols[$0].range.start < symbols[$1].range.start }) else { return }
        while rowOfSymbol[symbol] < 0, parents[symbol] >= 0 { symbol = Int(parents[symbol]) }
        guard rowOfSymbol[symbol] >= 0 else { return }
        let row = Int(rowOfSymbol[symbol])
        guard list.selectedRow != row else { return }
        list.selectedRows = IndexSet(integer: row)
    }

    private struct Notice: Equatable {
        var symbol: String? = "list.bullet.indent"
        var loading = false
        var title: String
        var description = ""
        var installCommand: String?
    }

    private func showState() {
        let notice = currentNotice()
        search.isHidden = symbols.isEmpty
        list.isHidden = notice != nil
        guard notice != shownNotice else { return }
        shownNotice = notice
        empty?.removeFromSuperview()
        empty = nil
        guard let notice else { return }
        let actions: [(title: String, run: () -> Void)] = notice.installCommand.map { command in
            [("Copy Install Command", {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(command, forType: .string)
            })]
        } ?? []
        let state = EmptyState(symbol: notice.symbol, loading: notice.loading, title: notice.title,
                               description: notice.description, actions: actions)
        empty = state
        Pin.fill(state, in: tool.content)
    }

    private func currentNotice() -> Notice? {
        guard let url else { return Notice(title: "No file open", description: "Open a file to see its outline.") }
        guard intelligence.handles(url) else {
            let type = url.pathExtension.isEmpty ? url.lastPathComponent : ".\(url.pathExtension)"
            return Notice(title: "No outline", description: "No language server reads \(type) files.")
        }
        let status = intelligence.status(for: url)
        switch status?.state {
        case let .missing(hint)?:
            return Notice(title: "\(status?.name ?? "") is not installed", description: "Install it, then reopen the file.",
                          installCommand: hint)
        case let .failed(message)?:
            return Notice(symbol: "exclamationmark.triangle", title: "\(status?.name ?? "") stopped", description: message)
        case .starting? where symbols.isEmpty:
            return Notice(symbol: nil, loading: true, title: "Starting \(status?.name ?? "the language server")")
        case nil where symbols.isEmpty && isLoading:
            return Notice(symbol: nil, loading: true, title: "Starting the language server")
        default:
            break
        }
        if symbols.isEmpty {
            return isLoading ? nil : Notice(title: "No symbols", description: "\(url.lastPathComponent) declares nothing to outline.")
        }
        guard rows.isEmpty else { return nil }
        return Notice(symbol: nil, title: "No matches", description: "No symbol in this file matches the filter.")
    }
}
