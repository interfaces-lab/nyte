import AppKit
import NyteCore
import NyteUI

@MainActor
public final class ProblemsViewController: NSViewController {
    public var onNavigate: ((FileLocation) -> Void)?
    public var onCountChange: ((Int) -> Void)?
    public var onAskAgent: ((URL, Diagnostic) -> Void)?

    static let askAgentTitle = "Ask Nyte to Fix"
    public private(set) var count = 0

    static let searchWidth: CGFloat = 240

    private enum Filter: Int, CaseIterable {
        case errors, warnings, notes

        init(_ severity: Diagnostic.Severity) {
            switch severity {
            case .error: self = .errors
            case .warning: self = .warnings
            case .information, .hint: self = .notes
            }
        }

        var word: String { ["Errors", "Warnings", "Notes"][rawValue] }
        var severity: Diagnostic.Severity { [.error, .warning, .information][rawValue] }
    }

    private let workspace: Workspace
    private let intelligence: any LanguageIntelligence
    private let list = ListView()
    private let search = SearchField(placeholder: "Filter problems", size: .sm)
    private let tool = ToolWindowView(header: .compact)
    private lazy var severity = FilterGroup(Filter.allCases.map {
        .init($0.word, symbol: SeverityMarks.symbol($0.severity), tone: SeverityMarks.tone($0.severity), count: 0)
    }, size: .sm, label: "Severity") { [weak self] index, isOn in self?.show(Filter.allCases[index], isOn) }
    private var empty: NSView?

    private var files: [URL] = []
    private var fileIndex: [String: Int] = [:]
    private var emptyTitle: String?
    private var problems: [[Diagnostic]] = []
    private var fileOpen: [Bool] = []
    private var rowFile: [Int32] = []
    private var rowProblem: [Int32] = [] { didSet { fileHeaderRows = rowProblem.indices.filter { rowProblem[$0] < 0 } } }
    private var fileHeaderRows: [Int] = []
    private var severityCounts = [Int](repeating: 0, count: Filter.allCases.count)
    private var shown: Set<Filter> = Set(Filter.allCases)
    private var query = ""
    private var shownWidest: String?

    public init(workspace: Workspace, intelligence: any LanguageIntelligence) {
        self.workspace = workspace
        self.intelligence = intelligence
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func loadView() {
        tool.onAppearanceChange = { [weak self] in self?.list.reload() }
        tool.onKey = { [weak self] event in
            let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
            guard let self, modifiers == .option, event.specialKey == .carriageReturn || event.specialKey == .enter,
                  let row = list.selectedRow
            else { return false }
            return askAgent(row)
        }
        tool.setAccessibilityElement(true)
        tool.setAccessibilityRole(.group)
        tool.setAccessibilityLabel("Problems")
        let searchWidth = search.widthAnchor.constraint(equalToConstant: Self.searchWidth)
        searchWidth.priority = .defaultLow
        NSLayoutConstraint.activate([search.widthAnchor.constraint(lessThanOrEqualToConstant: Self.searchWidth), searchWidth])
        search.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tool.header.leadingInset = tool.header.trailingInset
        tool.header.setViews(leading: [severity], trailing: [search])
        Pin.fill(list, in: tool.content)
        tool.follow(list.scrollView)
        list.rowHeight = Metric.rowCompact
        list.isOutline = true
        list.pinsGroupHeaders = true
        list.verticalInset = Space.x1
        list.rowCount = { [weak self] in self?.rowFile.count ?? 0 }
        list.groupHeader = { [weak self] row in self.flatMap { ListView.header(in: $0.fileHeaderRows, forRow: row) } }
        list.content = { [weak self] in self?.row($0) ?? RowContent() }
        list.onActivate = { [weak self] in self?.activate($0) }
        list.onToggle = { [weak self] in self?.toggleFile(at: $0) }
        list.menuForRow = { [weak self] in self?.menu(for: $0) }
        search.onChange = { [weak self] in self?.filter($0) }
        search.onMove = { [weak self] in self?.list.moveSelection(by: $0) }
        search.onCommand = { [weak self] command in
            guard let self, command == #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)), let row = list.selectedRow else { return false }
            return askAgent(row)
        }
        search.onSubmit = { [weak self] _ in
            guard let self, let row = list.selectedRow else { return }
            activate(row)
        }
        view = tool
        loadAll()
    }

    public func diagnosticsDidChange(for url: URL) {
        guard isViewLoaded else { return }
        let fresh = sorted(intelligence.diagnostics(for: url))
        let file: Int
        if let known = fileIndex[url.standardizedFileURL.path] {
            file = known
        } else {
            guard !fresh.isEmpty else { return }
            file = insertFile(URL(fileURLWithPath: url.standardizedFileURL.path))
        }
        let range = rowRange(of: file)
        tally(problems[file], sign: -1)
        problems[file] = fresh
        tally(fresh, sign: 1)
        let block = rows(for: file)
        rowFile.replaceSubrange(range, with: repeatElement(Int32(file), count: block.count))
        rowProblem.replaceSubrange(range, with: block)
        updateWidestNumber()
        ListSplice.replace(list, at: range.lowerBound, removing: range.count, inserting: block.count, animated: false)
        if fresh.isEmpty { removeFile(file) }
        countsDidChange()
    }

    private func loadAll() {
        let urls = FileGroups.ordered(intelligence.filesWithDiagnostics.map { URL(fileURLWithPath: $0.standardizedFileURL.path) },
                                      in: workspace)
        files = urls
        problems = urls.map { sorted(intelligence.diagnostics(for: $0)) }
        fileOpen = Array(repeating: true, count: urls.count)
        reindex()
        severityCounts = severityCounts.map { _ in 0 }
        for list in problems { tally(list, sign: 1) }
        rebuildRows()
        updateWidestNumber()
        list.reload()
        countsDidChange()
    }

    private func sorted(_ diagnostics: [Diagnostic]) -> [Diagnostic] {
        diagnostics.sorted { left, right in
            left.severity == right.severity ? left.range.start < right.range.start : left.severity.isMoreSevere(than: right.severity)
        }
    }

    private func tally(_ diagnostics: [Diagnostic], sign: Int) {
        for diagnostic in diagnostics { severityCounts[Filter(diagnostic.severity).rawValue] += sign }
    }

    private func reindex() {
        fileIndex = Dictionary(files.enumerated().map { ($1.path, $0) }) { first, _ in first }
    }

    private func insertFile(_ url: URL) -> Int {
        let path = workspace.relativePath(of: url)
        let position = files.firstIndex {
            path.localizedStandardCompare(workspace.relativePath(of: $0)) == .orderedAscending
        } ?? files.count
        files.insert(url, at: position)
        problems.insert([], at: position)
        fileOpen.insert(true, at: position)
        for index in rowFile.indices where rowFile[index] >= position { rowFile[index] += 1 }
        reindex()
        return position
    }

    private func removeFile(_ file: Int) {
        files.remove(at: file)
        problems.remove(at: file)
        fileOpen.remove(at: file)
        for index in rowFile.indices where rowFile[index] > file { rowFile[index] -= 1 }
        reindex()
    }

    private func rowRange(of file: Int) -> Range<Int> {
        let target = Int32(file)
        var low = 0
        var high = rowFile.count
        while low < high {
            let middle = (low + high) / 2
            if rowFile[middle] < target { low = middle + 1 } else { high = middle }
        }
        var end = low
        while end < rowFile.count, rowFile[end] == target { end += 1 }
        return low..<end
    }

    private func passes(_ diagnostic: Diagnostic) -> Bool {
        guard shown.contains(Filter(diagnostic.severity)) else { return false }
        guard !query.isEmpty else { return true }
        return diagnostic.message.localizedCaseInsensitiveContains(query)
            || diagnostic.source.localizedCaseInsensitiveContains(query)
            || diagnostic.code.localizedCaseInsensitiveContains(query)
    }

    private func visibleProblems(of file: Int) -> [Int32] {
        problems[file].indices.compactMap { passes(problems[file][$0]) ? Int32($0) : nil }
    }

    private func rows(for file: Int) -> [Int32] {
        let visible = visibleProblems(of: file)
        guard !visible.isEmpty else { return [] }
        return [-1] + (fileOpen[file] ? visible : [])
    }

    private func updateWidestNumber() {
        let widest = problems.lazy.flatMap { $0 }.map(\.range.start.line).max().map { String($0 + 1) } ?? ""
        guard widest != shownWidest else { return }
        shownWidest = widest
        list.widestNumber = { widest }
    }

    private func rebuildRows() {
        let blocks = files.indices.map { rows(for: $0) }
        rowFile = blocks.indices.flatMap { repeatElement(Int32($0), count: blocks[$0].count) }
        rowProblem = blocks.flatMap(\.self)
    }

    private func row(_ index: Int) -> RowContent {
        let file = Int(rowFile[index])
        let problem = Int(rowProblem[index])
        guard problem >= 0 else {
            let visible = visibleProblems(of: file).count
            return FileGroups.row(files[file], in: workspace, count: Counted.phrase(visible, "problem", "problems"),
                                  open: fileOpen[file], appearance: view.effectiveAppearance)
        }
        let diagnostic = problems[file][problem]
        let message = diagnostic.message.prefix { $0 != "\n" }
        let line = diagnostic.range.start.line + 1
        var row = RowContent(title: String(message), detail: Self.label(source: diagnostic),
                             leading: SeverityMarks.leading(diagnostic.severity), depth: 1)
        row.number = String(line)
        row.detailInk = .secondary
        row.detailGap = Space.x2
        if !query.isEmpty { row.emphasizeMatches(of: query) }
        row.accessibilityLabel = "\(SeverityMarks.word(diagnostic.severity)), line \(line): \(message)"
        return row
    }

    static let uninformativeCodes: Set<String> = ["default"]

    static func label(source diagnostic: Diagnostic) -> String {
        let code = uninformativeCodes.contains(diagnostic.code) ? "" : diagnostic.code
        return [diagnostic.source, code].filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
    }

    private func activate(_ row: Int) {
        guard rowProblem[row] >= 0 else { return toggleFile(at: row) }
        navigate(row)
    }

    private func navigate(_ row: Int) {
        let file = Int(rowFile[row])
        let problem = Int(rowProblem[row])
        guard problem >= 0 else { return }
        onNavigate?(FileLocation(url: files[file], range: problems[file][problem].range))
    }

    private func toggleFile(at row: Int) {
        let file = Int(rowFile[row])
        guard rowProblem[row] < 0 else { return }
        let range = rowRange(of: file)
        fileOpen[file].toggle()
        let block = rows(for: file)
        rowFile.replaceSubrange(range, with: repeatElement(Int32(file), count: block.count))
        rowProblem.replaceSubrange(range, with: block)
        list.reloadRows(IndexSet(integer: range.lowerBound))
        let start = range.lowerBound + 1
        if block.count > range.count { list.insertRows(IndexSet(integersIn: start..<start + block.count - range.count)) }
        if block.count < range.count { list.removeRows(IndexSet(integersIn: start..<start + range.count - block.count)) }
    }

    private func menu(for row: Int) -> NSMenu? {
        let file = Int(rowFile[row])
        let problem = Int(rowProblem[row])
        guard problem >= 0 else { return nil }
        let message = problems[file][problem].message
        let location = FileLocation(url: files[file], range: problems[file][problem].range)
        return Menu.make([
            MenuItem(Self.askAgentTitle, key: "\r", modifiers: .option, enabled: onAskAgent != nil) { [weak self] in
                _ = self?.askAgent(row)
            },
            .separator,
            MenuItem("Copy Message") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(message, forType: .string)
            },
            MenuItem("Go to Problem") { [weak self] in self?.onNavigate?(location) },
        ])
    }

    @discardableResult
    private func askAgent(_ row: Int) -> Bool {
        let file = Int(rowFile[row])
        let problem = Int(rowProblem[row])
        guard problem >= 0, let onAskAgent else { return false }
        onAskAgent(files[file], problems[file][problem])
        return true
    }

    private func show(_ filter: Filter, _ isOn: Bool) {
        if isOn { shown.insert(filter) } else { shown.remove(filter) }
        refilter()
    }

    private func filter(_ text: String) {
        query = text.trimmingCharacters(in: .whitespaces)
        refilter()
    }

    private func refilter() {
        rebuildRows()
        list.reload()
        countsDidChange()
    }

    private func countsDidChange() {
        let filters = zip(severity.filters, Filter.allCases).map { item, filter in
            var item = item
            item.count = severityCounts[filter.rawValue]
            item.isOn = shown.contains(filter)
            return item
        }
        if filters != severity.filters { severity.filters = filters }
        search.count = query.isEmpty ? "" : String(rowProblem.lazy.filter { $0 >= 0 }.count)
        let total = severityCounts.reduce(0, +)
        if total != count {
            count = total
            onCountChange?(total)
        }
        showState()
    }

    private func showState() {
        let title: String? = count == 0 ? "No problems" : (rowFile.isEmpty ? "No matching problems" : nil)
        guard title != emptyTitle else { return }
        emptyTitle = title
        empty?.removeFromSuperview()
        empty = nil
        list.isHidden = title != nil
        guard let title else { return }
        let state = count == 0
            ? EmptyState(symbol: "checkmark.circle", title: title)
            : EmptyState(title: title, description: "The filter hides all \(Counted.phrase(count, "problem", "problems")).")
        empty = state
        Pin.fill(state, in: tool.content)
    }
}
