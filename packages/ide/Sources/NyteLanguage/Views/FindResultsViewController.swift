import AppKit
import NyteCore
import NyteUI

@MainActor
public final class FindResultsViewController: NSViewController {
    public var onNavigate: ((FileLocation) -> Void)?
    public var onApply: ((WorkspaceEdit) async -> Bool)?
    public var onTitleChange: ((String) -> Void)?
    public var openText: ((URL) -> String?)?

    enum Mode { case empty, usages, preview, done }

    static let context = 12
    static let filterWidth: CGFloat = 220
    static let codeAdvance = TextStyle.code.font().maximumAdvancement.width

    private let workspace: Workspace
    let list = ListView()
    private let tool = ToolWindowView(header: .compact)
    private let heading = Label("", style: .base, color: Palette.contentPrimary)
    private let tally = Label("", style: .sm, color: Palette.contentTertiary)
    private let filter = SearchField(placeholder: "Filter results", size: .sm)
    private let footer = NSStackView()
    private let changes = Label("", style: .sm, color: Palette.contentTertiary)
    private let failure = Label("", style: .sm, color: Palette.dangerInk)
    private let failureReason = Label("", style: .sm, color: Palette.contentSecondary)
    private lazy var failureStack = NSStackView(views: [failure, failureReason])
    private let cancel = Button("Cancel", variant: .outline, size: .sm)
    private let refactor = Button("Refactor", variant: .solid, tone: .primary, size: .sm)
    private let toolbar = Toolbar()
    let previewToggle = IconButton(symbol: SourcePreview.symbol(sideBySide: true), label: "Source preview", size: .sm)
    private var empty: NSView?

    var mode = Mode.empty
    private var caption = ""
    private var edit = WorkspaceEdit()
    var fileURLs: [URL] = []
    var fileKind: [Usage.Kind] = []
    private var showsKinds = false
    let source = SourcePreview()
    var fileFirst: [Int32] = []
    var fileCount: [Int32] = []
    private var fileOpen: [Bool] = []
    var itemFile: [Int32] = []
    var itemRange: [TextSpan] = []
    private var itemEdits: [Range<Int32>] = []
    private var fileChanges: [Int32] = []
    private var itemChecked: [Bool] = []
    var itemPasses: [Bool] = []
    private var query = ""
    private var arena = LineArena()
    var rowFile: [Int32] = []
    var rowItem: [Int32] = []
    private var headerRows: [Int] = []
    private var generation = 0
    private var result = ""

    public init(workspace: Workspace) {
        self.workspace = workspace
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func loadView() {
        tool.setAccessibilityLabel("Find")
        let previous = IconButton(symbol: "arrow.up", label: "Previous occurrence", size: .sm)
        let next = IconButton(symbol: "arrow.down", label: "Next occurrence", size: .sm)
        let expand = IconButton(symbol: "arrow.up.and.line.horizontal.and.arrow.down", label: "Expand all", size: .sm)
        let collapse = IconButton(symbol: "arrow.down.and.line.horizontal.and.arrow.up", label: "Collapse all", size: .sm)
        previous.toolTip = "Previous occurrence \u{2325}\u{2318}\u{2191}"
        next.toolTip = "Next occurrence \u{2325}\u{2318}\u{2193}"
        previewToggle.toolTip = "Source preview"
        tool.onKey = { [weak self] event in
            guard let self else { return false }
            let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
            switch (event.specialKey, modifiers) {
            case (.upArrow?, [.command, .option]): step(by: -1)
            case (.downArrow?, [.command, .option]): step(by: 1)
            case (.carriageReturn?, []) where mode == .preview, (.enter?, []) where mode == .preview: apply()
            default: return false
            }
            return true
        }
        previous.onPress = { [weak self] in self?.step(by: -1) }
        next.onPress = { [weak self] in self?.step(by: 1) }
        expand.onPress = { [weak self] in self?.setAllOpen(true) }
        collapse.onPress = { [weak self] in self?.setAllOpen(false) }
        previewToggle.onPress = { [weak self] in self?.source.toggle() }
        source.onVisibilityChange = { [weak self] in self?.previewToggle.isOn = $0 }
        for item in [previous, next] { toolbar.add(item) }
        toolbar.addSeparator()
        for item in [expand, collapse, previewToggle] { toolbar.add(item) }
        heading.lineBreakMode = .byTruncatingTail
        heading.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tally.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
        cancel.onPress = { [weak self] in self?.clear() }
        refactor.onPress = { [weak self] in self?.apply() }
        refactor.shortcut = "\u{21A9}"
        failure.lineBreakMode = .byTruncatingMiddle
        failureReason.lineBreakMode = .byTruncatingTail
        for label in [failure, failureReason] { label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal) }
        failureStack.orientation = .vertical
        failureStack.alignment = .leading
        failureStack.spacing = 0
        failureStack.isHidden = true
        footer.setViews([changes, failureStack], in: .leading)
        footer.setViews([cancel, refactor], in: .trailing)
        footer.orientation = .horizontal
        footer.spacing = Space.x2
        filter.onChange = { [weak self] in self?.filter(by: $0) }
        filter.onMove = { [weak self] in self?.list.moveSelection(by: $0) }
        filter.onSubmit = { [weak self] _ in
            guard let self, let row = list.selectedRow else { return }
            activate(row)
        }
        let filterWidth = filter.widthAnchor.constraint(equalToConstant: Self.filterWidth)
        filterWidth.priority = .defaultLow
        NSLayoutConstraint.activate([filter.widthAnchor.constraint(lessThanOrEqualToConstant: Self.filterWidth), filterWidth])
        filter.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tool.header.setViews(leading: [heading, tally], trailing: [toolbar, filter])
        Pin.fill(footer, in: tool.footer, insets: NSEdgeInsets(top: Space.x2, left: tool.footer.leadingInset, bottom: Space.x2,
                                                               right: tool.footer.trailingInset))
        source.embed(list, in: tool.content)
        tool.onAppearanceChange = { [weak self] in self?.list.reload() }
        tool.onWidthChange = { [weak self] in
            guard let self else { return }
            source.arrange(width: view.bounds.width)
            previewToggle.symbol = SourcePreview.symbol(sideBySide: source.split.isVertical)
            list.reload()
        }
        tool.follow(list.scrollView)
        list.rowHeight = Metric.rowCompact
        list.isOutline = true
        list.pinsGroupHeaders = true
        list.verticalInset = Space.x1
        list.rowCount = { [weak self] in self?.rowFile.count ?? 0 }
        list.groupHeader = { [weak self] row in self.flatMap { ListView.header(in: $0.headerRows, forRow: row) } }
        list.content = { [weak self] in self?.row($0) ?? RowContent() }
        list.onActivate = { [weak self] in self?.activate($0) }
        list.onToggle = { [weak self] in self?.toggleFile(at: $0) }
        list.onCheck = { [weak self] in self?.check($0) }
        list.onSelect = { [weak self] in self?.selectionDidChange($0) }
        view = tool
        render()
    }

    public func show(locations: [FileLocation], title: String) {
        show(usages: locations.map { Usage(location: $0) }, title: title)
    }

    public func show(usages: [Usage], title: String) {
        let kinds = Usage.Kind.allCases.filter { kind in usages.contains { $0.kind == kind } }
        var urls: [URL] = []
        var groupKinds: [Usage.Kind] = []
        var spans: [[TextSpan]] = []
        for kind in kinds {
            let byFile = Dictionary(grouping: usages.filter { $0.kind == kind }) { $0.location.url.path }
            for url in FileGroups.ordered(byFile.keys.map { URL(fileURLWithPath: $0) }, in: workspace) {
                urls.append(url)
                groupKinds.append(kind)
                spans.append(Set(byFile[url.path]?.map(\.location.range) ?? []).sorted { $0.start < $1.start })
            }
        }
        load(.usages, title: title, urls: urls, kinds: groupKinds, spans: spans, edit: WorkspaceEdit())
    }

    static func tabTitle(forPreview title: String) -> String {
        title.hasPrefix("Rename") ? "Rename Preview" : "Refactoring Preview"
    }

    public func show(preview edit: WorkspaceEdit, title: String) {
        let byFile = Dictionary(grouping: edit.files.filter { !$0.edits.isEmpty }) { $0.url.path }
        let urls = FileGroups.ordered(byFile.keys.map { URL(fileURLWithPath: $0) }, in: workspace)
        let files = urls.map { url in
            WorkspaceEdit.File(url: url, edits: (byFile[url.path] ?? []).flatMap(\.edits).sorted { $0.range.start < $1.range.start })
        }
        load(.preview, title: title, urls: urls, kinds: urls.map { _ in .other }, spans: files.map { $0.edits.map(\.range) },
             edit: WorkspaceEdit(files: files))
    }

    static func lineGroups(_ spans: [TextSpan], merging: Bool) -> [Range<Int32>] {
        var groups: [Range<Int32>] = []
        for index in spans.indices {
            if merging, let last = groups.last, spans[Int(last.lowerBound)].start.line == spans[index].start.line {
                groups[groups.count - 1] = last.lowerBound..<Int32(index + 1)
            } else {
                groups.append(Int32(index)..<Int32(index + 1))
            }
        }
        return groups
    }

    private func load(_ mode: Mode, title: String, urls: [URL], kinds: [Usage.Kind], spans: [[TextSpan]], edit: WorkspaceEdit) {
        loadViewIfNeeded()
        generation += 1
        let generation = generation
        self.mode = mode
        caption = title
        self.edit = edit
        result = ""
        fileURLs = urls
        fileKind = kinds
        showsKinds = Set(kinds).count > 1 || (kinds.first.map { $0 != .other } ?? false)
        fileFirst = []
        fileCount = []
        itemFile = []
        itemRange = []
        itemEdits = []
        fileChanges = []
        for (file, places) in spans.enumerated() {
            let groups = Self.lineGroups(places, merging: mode == .preview)
            fileFirst.append(Int32(itemRange.count))
            fileCount.append(Int32(groups.count))
            fileChanges.append(Int32(places.count))
            itemFile += repeatElement(Int32(file), count: groups.count)
            itemRange += groups.map { places[Int($0.lowerBound)] }
            itemEdits += groups
        }
        itemChecked = Array(repeating: true, count: itemRange.count)
        fileOpen = Array(repeating: true, count: urls.count)
        let widest = itemRange.isEmpty ? "" : String((itemRange.map(\.start.line).max() ?? 0) + 1)
        list.widestNumber = { widest }
        query = ""
        filter.stringValue = ""
        arena = LineArena()
        updatePasses()
        rebuildRows()
        onTitleChange?(mode == .preview ? Self.tabTitle(forPreview: title) : title)
        list.reload()
        list.selectedRows = []
        source.reset(showing: mode == .usages, width: view.bounds.width)
        render()
        let requests = urls.indices.map { file in
            let first = Int(fileFirst[file])
            let items = first..<first + Int(fileCount[file])
            return (url: urls[file], requests: items.map {
                LineRequest(line: Int32(itemRange[$0].start.line), column: Int32(itemRange[$0].start.column))
            })
        }
        let buffers = Dictionary(urls.compactMap { url in openText?(url).map { (url, $0) } }) { first, _ in first }
        Task { [weak self] in
            let lines = await LineArena.read(requests, buffers: buffers)
            guard let self, generation == self.generation else { return }
            arena = lines
            guard query.isEmpty else { return filter(by: query) }
            list.reload()
            if mode == .usages, list.selectedRow == nil, let first = rowItem.first(where: { $0 >= 0 }) { preview(Int(first)) }
        }
    }

    private func rebuildRows() {
        rowFile = []
        rowItem = []
        rowFile.reserveCapacity(itemRange.count + fileURLs.count)
        rowItem.reserveCapacity(itemRange.count + fileURLs.count)
        var lastKind: Usage.Kind?
        for file in fileURLs.indices {
            let first = Int(fileFirst[file])
            let items = (first..<first + Int(fileCount[file])).filter { itemPasses[$0] }
            guard !items.isEmpty || query.isEmpty else { continue }
            if showsKinds, lastKind != fileKind[file] {
                lastKind = fileKind[file]
                rowFile.append(Int32(file))
                rowItem.append(Self.kindRow)
            }
            rowFile.append(Int32(file))
            rowItem.append(-1)
            guard fileOpen[file] else { continue }
            rowFile += repeatElement(Int32(file), count: items.count)
            rowItem += items.map { Int32($0) }
        }
        headerRows = rowItem.indices.filter { rowItem[$0] < 0 }
    }

    private func row(_ index: Int) -> RowContent {
        let file = Int(rowFile[index])
        let item = Int(rowItem[index])
        if item == Self.kindRow { return kindRow(for: fileKind[file]) }
        guard item >= 0 else {
            let noun = mode == .preview ? ("change", "changes") : ("result", "results")
            let first = Int(fileFirst[file])
            let shown = query.isEmpty ? Int(fileChanges[file]) : itemPasses[first..<first + Int(fileCount[file])].lazy.filter { $0 }.count
            var row = FileGroups.row(fileURLs[file], in: workspace, count: Counted.phrase(shown, noun.0, noun.1),
                                     open: fileOpen[file], appearance: view.effectiveAppearance)
            if mode == .preview { row.check = fileCheck(file) }
            return row
        }
        let line = item < arena.count ? arena.text(item) : ""
        var row = RowContent(title: line, depth: 1)
        row.number = String(itemRange[item].start.line + 1)
        row.monospace = true
        row.accessibilityLabel = "Line \(itemRange[item].start.line + 1): \(line)"
        let span = itemRange[item]
        let column = item < arena.count ? Int(arena.columns[item]) : 0
        let start = max(0, span.start.column - column)
        let length = (line as NSString).length
        let end = span.end.line == span.start.line ? max(start, span.end.column - column) : length
        let matched = NSRange(location: min(start, length), length: max(0, min(end, length) - min(start, length)))
        guard mode == .preview else {
            let shift = fit(&row, keeping: matched)
            row.syntax = LineColors.shown(item < arena.count ? arena.tokens(item) : [], shift: shift)
            if !query.isEmpty { row.emphasizeMatches(of: query) } else if matched.length > 0 {
                row.emphasis = [NSRange(location: matched.location - shift, length: matched.length)]
            }
            return row
        }
        row.check = itemChecked[item] ? .on : .off
        guard itemChecked[item] else {
            let shift = fit(&row, keeping: matched)
            row.syntax = LineColors.shown(item < arena.count ? arena.tokens(item) : [], shift: shift)
            return row
        }
        let preview = Self.preview(of: line, column: column, edits: itemEdits[item].map { edit.files[file].edits[Int($0)] })
        row.title = preview.text
        row.accessibilityLabel = "Line \(itemRange[item].start.line + 1) becomes \(preview.result)"
        let changed = (preview.removed + preview.added).reduce(preview.removed.first ?? matched) { NSUnionRange($0, $1) }
        let shift = fit(&row, keeping: changed)
        row.syntax = LineColors.shown(LineColors.moved(item < arena.count ? arena.tokens(item) : [], through: preview.kept), shift: shift)
        row.removed = preview.removed.map { NSRange(location: $0.location - shift, length: $0.length) }
        row.added = preview.added.map { NSRange(location: $0.location - shift, length: $0.length) }
        return row
    }

    private func fit(_ row: inout RowContent, keeping range: NSRange) -> Int {
        let room = row.fitted(width: list.bounds.width, reservesDisclosure: true, numberColumn: list.numberColumn)
        guard room.titleTruncated else { return 0 }
        let columns = Int(room.titleWidth / Self.codeAdvance)
        guard columns > Self.context, NSMaxRange(range) > columns else { return 0 }
        let shift = min(range.location - Self.context, NSMaxRange(range) - columns + Self.context)
        guard shift > 1 else { return 0 }
        row.title = "\u{2026}" + (row.title as NSString).substring(from: shift + 1)
        return shift
    }

    private func fileCheck(_ file: Int) -> Checkbox.State {
        let first = Int(fileFirst[file])
        let checked = itemChecked[first..<first + Int(fileCount[file])].lazy.filter { $0 }.count
        return checked == 0 ? .off : (checked == Int(fileCount[file]) ? .on : .mixed)
    }

    private func activate(_ row: Int) {
        if mode == .preview, NSApp.currentEvent?.type == .keyDown { return apply() }
        guard rowItem[row] != Self.kindRow else { return }
        guard rowItem[row] >= 0 else { return toggleFile(at: row) }
        navigate(row)
    }

    private func navigate(_ row: Int) {
        let item = Int(rowItem[row])
        guard item >= 0 else { return }
        onNavigate?(FileLocation(url: fileURLs[Int(itemFile[item])], range: itemRange[item]))
    }

    private func filter(by text: String) {
        query = text.trimmingCharacters(in: .whitespaces)
        updatePasses()
        rebuildRows()
        list.reload()
        list.selectedRows = rowItem.firstIndex { $0 >= 0 }.map { IndexSet(integer: $0) } ?? []
        render()
    }

    private func updatePasses() {
        guard !query.isEmpty else { return itemPasses = Array(repeating: true, count: itemRange.count) }
        itemPasses = itemRange.indices.map { item in item < arena.count && !RowContent.matches(of: query, in: arena.text(item)).isEmpty }
    }

    private func step(by delta: Int) {
        guard !itemRange.isEmpty else { return }
        let current = list.selectedRow.flatMap { rowItem[$0] >= 0 ? Int(rowItem[$0]) : nil }
        let target: Int
        if let current {
            target = (current + delta + itemRange.count) % itemRange.count
        } else if let selected = list.selectedRow {
            let file = Int(rowFile[selected])
            target = delta > 0 ? Int(fileFirst[file]) : (Int(fileFirst[file]) - 1 + itemRange.count) % itemRange.count
        } else {
            target = delta > 0 ? 0 : itemRange.count - 1
        }
        let total = itemRange.count
        let passes = itemPasses
        guard let target = (0..<total).lazy.map({ (target + $0 * delta.signum() + total) % total }).first(where: { passes[$0] }) else { return }
        let file = Int(itemFile[target])
        if !fileOpen[file] {
            fileOpen[file] = true
            rebuildRows()
            list.reload()
        }
        guard let row = rowItem.firstIndex(of: Int32(target)) else { return }
        list.selectedRows = IndexSet(integer: row)
        navigate(row)
    }

    private func setAllOpen(_ open: Bool) {
        let selectedFile = list.selectedRow.map { Int(rowFile[$0]) }
        fileOpen = fileOpen.map { _ in open }
        rebuildRows()
        list.reload()
        if !open, let selectedFile { list.selectedRows = IndexSet(integer: rowFile.firstIndex(of: Int32(selectedFile)) ?? 0) }
    }

    private func toggleFile(at row: Int) {
        guard rowItem[row] == -1 else { return }
        let file = Int(rowFile[row])
        fileOpen[file].toggle()
        rebuildRows()
        list.reloadRows(IndexSet(integer: row))
        let first = Int(fileFirst[file])
        let shown = itemPasses[first..<first + Int(fileCount[file])].lazy.filter { $0 }.count
        let items = IndexSet(integersIn: row + 1..<row + 1 + shown)
        if fileOpen[file] { list.insertRows(items) } else { list.removeRows(items) }
    }

    private func check(_ rows: IndexSet) {
        guard mode == .preview else { return }
        let target = rows.contains { row in
            let item = Int(rowItem[row])
            return item >= 0 ? !itemChecked[item] : fileCheck(Int(rowFile[row])) != .on
        }
        for row in rows {
            let item = Int(rowItem[row])
            if item >= 0 {
                itemChecked[item] = target
                continue
            }
            let file = Int(rowFile[row])
            let first = Int(fileFirst[file])
            for index in first..<first + Int(fileCount[file]) { itemChecked[index] = target }
        }
        let files = Set(rows.map { rowFile[$0] })
        list.reloadRows(IndexSet(rowFile.indices.filter { files.contains(rowFile[$0]) }))
        updateFooter()
    }

    private func apply() {
        guard mode == .preview, !refactor.isLoading, let onApply else { return }
        let files = edit.files.indices.compactMap { file -> WorkspaceEdit.File? in
            let first = Int(fileFirst[file])
            let items = first..<first + Int(fileCount[file])
            let edits = items.filter { itemChecked[$0] }.flatMap { itemEdits[$0].map { edit.files[file].edits[Int($0)] } }
            return edits.isEmpty ? nil : WorkspaceEdit.File(url: edit.files[file].url, edits: edits)
        }
        guard !files.isEmpty else { return }
        let total = files.reduce(0) { $0 + $1.edits.count }
        let summary = "\(Counted.phrase(total, "change", "changes")) made in \(Counted.phrase(files.count, "file", "files"))"
        let generation = generation
        refactor.isLoading = true
        cancel.isEnabled = false
        failureStack.isHidden = true
        Task { [weak self] in
            var changed: [URL] = []
            for file in files {
                let applied = await onApply(WorkspaceEdit(files: [file]))
                guard let self, generation == self.generation else { return }
                guard applied else {
                    let reason = await Self.reason(file.url)
                    return failed(file.url, reason: reason, changed: changed)
                }
                changed.append(file.url)
            }
            guard let self, generation == self.generation else { return }
            finish(summary)
        }
    }

    private func failed(_ url: URL, reason: String, changed: [URL]) {
        refactor.isLoading = false
        cancel.isEnabled = true
        for file in edit.files.indices where changed.contains(edit.files[file].url) {
            let first = Int(fileFirst[file])
            for item in first..<first + Int(fileCount[file]) { itemChecked[item] = false }
        }
        list.reload()
        let done = changed.isEmpty
            ? "" : " \(Counted.phrase(changed.count, "file", "files")) did change: \(changed.map(\.lastPathComponent).joined(separator: ", "))."
        failure.stringValue = "Could not change \(workspace.relativePath(of: url)).\(done)"
        failureReason.stringValue = reason
        failureStack.isHidden = false
        changes.isHidden = true
        refactor.title = Self.retryTitle
        refactor.isEnabled = itemChecked.contains(true)
    }

    static let refactorTitle = "Refactor"
    static let retryTitle = "Retry"

    private func finish(_ summary: String) {
        clear()
        result = summary
        mode = .done
        render()
    }

    private func clear() {
        onTitleChange?("Find")
        generation += 1
        mode = .empty
        caption = ""
        edit = WorkspaceEdit()
        fileURLs = []
        fileFirst = []
        fileCount = []
        fileOpen = []
        itemFile = []
        itemRange = []
        itemEdits = []
        fileChanges = []
        itemChecked = []
        itemPasses = []
        query = ""
        filter.stringValue = ""
        arena = LineArena()
        rowFile = []
        rowItem = []
        headerRows = []
        list.reload()
        render()
    }

    private func updateFooter() {
        let files = Set(itemChecked.indices.filter { itemChecked[$0] }.map { itemFile[$0] }).count
        let checked = itemChecked.indices.filter { itemChecked[$0] }.reduce(0) { $0 + itemEdits[$1].count }
        let all = itemEdits.reduce(0) { $0 + $1.count }
        let changes = checked == all
            ? Counted.phrase(checked, "change", "changes")
            : "\(checked) of \(Counted.phrase(all, "change", "changes"))"
        self.changes.stringValue = "\(changes) in \(Counted.phrase(files, "file", "files"))"
        self.changes.isHidden = false
        failureStack.isHidden = true
        refactor.isEnabled = checked > 0
    }

    private func render() {
        let showsResults = mode == .usages || mode == .preview
        list.isHidden = !showsResults
        tool.headerStrip = showsResults ? .compact : .hidden
        heading.stringValue = showsResults ? caption : ""
        let fileCount = Counted.phrase(fileURLs.count, "file", "files")
        tally.isHidden = mode != .usages
        previewToggle.isHidden = mode != .usages
        let shown = itemPasses.lazy.filter { $0 }.count
        tally.stringValue = query.isEmpty
            ? "\(Counted.phrase(itemRange.count, "result", "results")) in \(fileCount)"
            : "\(shown.formatted()) of \(Counted.phrase(itemRange.count, "result", "results"))"
        if mode == .preview { updateFooter() }
        tool.footerStrip = mode == .preview ? .fitting : .hidden
        empty?.removeFromSuperview()
        empty = nil
        let state: EmptyState? = switch mode {
        case .empty: EmptyState(symbol: "text.magnifyingglass", title: "No results",
                                description: "Find usages or rename a symbol to see the results here.")
        case .done: EmptyState(symbol: "checkmark.circle", title: result)
        default: nil
        }
        if mode == .preview {
            refactor.isLoading = false
            refactor.title = Self.refactorTitle
            cancel.isEnabled = true
        }
        guard let state else { return }
        empty = state
        Pin.fill(state, in: tool.content)
    }
}
