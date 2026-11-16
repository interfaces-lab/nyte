import AppKit
import NyteCore
import NyteUI

@MainActor
final class Palettes {
    enum Scope: Int, CaseIterable {
        case all, files, symbols, commands, text

        var title: String {
            switch self {
            case .all: "All"
            case .files: "Files"
            case .symbols: "Symbols"
            case .commands: "Commands"
            case .text: "Text"
            }
        }
    }

    enum Target {
        case file(String)
        case symbol(FileLocation)
        case command(CommandID)
        case text(FileLocation)
        case findInFiles(String)
    }

    struct TextHit: Sendable {
        let location: FileLocation
        let path: String
        let line: String
    }

    private let workspace: Workspace
    private var index = FileIndex()
    private var indexing = false
    var openTabs: () -> [URL] = { [] }
    var recentTabs: () -> [URL] = { [] }
    var onOpenFile: ((URL) -> Void)?
    var onOpenFileBeside: ((URL) -> Void)?
    var commands: () -> [(command: Command, title: String, enabled: Bool)] = { [] }
    var onRunCommand: ((CommandID) -> Void)?
    var symbolSearch: ((String) -> AsyncStream<SymbolResults>)?
    var textSearch: ((String, Int) async -> [TextHit])?
    var onRevealSymbol: ((FileLocation) -> Void)?
    var onFindInFiles: ((String) -> Void)?
    private var symbolBatches: [String: SymbolResults] = [:]
    private var searching: Task<Void, Never>?
    private var texts: [String: [TextHit]] = [:]
    private var textTask: Task<Void, Never>?
    private var targets: [String: [Target?]] = [:]
    private var filePaths: [String: [String]] = [:]

    nonisolated static let fileLimit = 50
    static let identityFirst: [RowContent.Part] = [.metaShort, .meta, .detailShort, .detail, .secondaryMeta, .value, .title]
    static let allLimit = 4
    static let textLimit = 8

    private(set) lazy var search: CommandPanel = {
        let panel = CommandPanel(placeholder: "Search files, symbols, commands and text")
        panel.view.scopes = Scope.allCases.map(\.title)
        panel.view.emptyText = "No matches"
        panel.view.scopedResults = { [weak self] query, scope in await self?.rows(query, scope: Scope(rawValue: scope) ?? .all) ?? [] }
        panel.onActivate = { [weak self] row, _ in self?.activate(row, beside: false) }
        panel.view.onActivateBeside = { [weak self] row, _ in self?.activate(row, beside: true) }
        return panel
    }()

    private(set) lazy var recent: CommandPanel = {
        let panel = CommandPanel(placeholder: "Switch to a recent file")
        panel.view.emptyText = "No other open files"
        panel.results = { [weak self] query in self?.recentRows(query) ?? [] }
        panel.onActivate = { [weak self] row, _ in
            guard let self, let path = filePaths[recent.view.query]?[safe: row] else { return }
            onOpenFile?(workspace.root.appendingPathComponent(path))
        }
        let dismiss = panel.view.onDismiss
        panel.view.onDismiss = { [weak self] in
            dismiss?()
            self?.stopSwitcher()
        }
        return panel
    }()
    private var switcherMonitor: Any?
    private var isSwitcherArmed = false

    init(workspace: Workspace) {
        self.workspace = workspace
    }

    var shown: CommandPanel? { [search, recent].first { $0.isShown } }

    func show(_ scope: Scope, in window: NSWindow) {
        targets = [:]
        texts = [:]
        symbolBatches = [:]
        refreshIndex()
        search.view.scope = scope.rawValue
        search.show(in: window)
    }

    private func key(_ query: String, _ scope: Scope) -> String { "\(scope.rawValue)|\(query)" }

    private func activate(_ row: Int, beside: Bool) {
        let query = search.view.query
        guard let target = targets[key(query, Scope(rawValue: search.view.scope) ?? .all)]?[safe: row] ?? nil else { return }
        switch target {
        case let .file(path):
            let url = workspace.root.appendingPathComponent(path)
            beside ? onOpenFileBeside?(url) : onOpenFile?(url)
        case let .symbol(location), let .text(location):
            onRevealSymbol?(location)
        case let .command(id):
            DispatchQueue.main.async { [weak self] in self?.onRunCommand?(id) }
        case let .findInFiles(text):
            onFindInFiles?(text)
        }
    }

    private func rows(_ query: String, scope: Scope) async -> [RowContent] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        var sections: [(title: String, items: [(RowContent, Target)])] = []
        switch scope {
        case .files: sections = [("", await fileItems(trimmed))]
        case .symbols: sections = [("", symbolItems(trimmed))]
        case .commands: sections = [("", commandItems(trimmed))]
        case .text: sections = [("", textItems(trimmed, limit: Self.textLimit))]
        case .all:
            guard !trimmed.isEmpty else { return await rows(query, scope: .files) }
            sections = [
                ("Files", Array(await fileItems(trimmed).prefix(Self.allLimit))),
                ("Symbols", Array(symbolItems(trimmed).prefix(Self.allLimit))),
                ("Commands", Array(commandItems(trimmed).prefix(Self.allLimit))),
                ("Text", Array(textItems(trimmed, limit: Self.allLimit))),
            ].filter { !$0.items.isEmpty }
        }
        var rows: [RowContent] = []
        var aligned: [Target?] = []
        for section in sections {
            let title = section.title, items = section.items
            if !title.isEmpty {
                rows.append(RowContent.header(title, meta: "\(items.count)"))
                aligned.append(nil)
            }
            rows += items.map { row, _ in row }
            aligned += items.map { _, target in Optional(target) }
        }
        targets[key(query, scope)] = aligned
        return rows
    }

    private func refreshIndex() {
        guard !indexing else { return }
        indexing = true
        let root = workspace.root
        Task {
            let fresh = await Task.detached(priority: .userInitiated) { FileIndex.load(root: root) }.value
            index = fresh
            indexing = false
            if search.isShown { search.view.setQuery(search.view.query) }
        }
    }

    private func fileItems(_ trimmed: String) async -> [(RowContent, Target)] {
        let paths: [String]
        if trimmed.isEmpty {
            paths = openTabs().map { workspace.relativePath(of: $0) }
        } else {
            let snapshot = index
            paths = await Task.detached(priority: .userInitiated) {
                snapshot.search(trimmed, limit: Self.fileLimit).map { snapshot.path(at: $0.path) }
            }.value
        }
        return zip(fileRows(paths, query: trimmed), paths.map(Target.file)).map { ($0, $1) }
    }

    private func recentRows(_ query: String) -> [RowContent] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let paths = recentTabs().dropFirst().map { workspace.relativePath(of: $0) }
            .filter { trimmed.isEmpty || FuzzyMatch.score(trimmed, in: $0) != nil }
        filePaths[query] = paths
        return fileRows(paths, query: trimmed)
    }

    private func fileRows(_ paths: [String], query trimmed: String) -> [RowContent] {
        let appearance = NSApp.effectiveAppearance
        return paths.map { path in
            let name = (path as NSString).lastPathComponent
            var row = RowContent(title: name, detail: (path as NSString).deletingLastPathComponent,
                                 leading: .image(FileIcon.forFile(named: name).image(for: appearance)))
            row.yieldOrder = Self.identityFirst
            row.titleTruncation = .keepingExtension(preferEnd: false)
            row.detailTruncation = .path
            row.emphasizeMatches(of: trimmed)
            return row
        }
    }

    private func commandItems(_ trimmed: String) -> [(RowContent, Target)] {
        let ranked = commands().compactMap { entry -> (score: Int, entry: (command: Command, title: String, enabled: Bool))? in
            guard let score = FuzzyMatch.score(trimmed, in: entry.title) else { return nil }
            return (score + (entry.enabled ? FuzzyMatch.enabledBonus : 0), entry)
        }
        let ordered = trimmed.isEmpty ? ranked.filter(\.entry.enabled) : ranked.sorted { $0.score > $1.score }
        return ordered.map { item in
            var row = RowContent(title: item.entry.title, detail: item.entry.command.menu.title,
                                 meta: item.entry.command.key?.display ?? "")
            row.titleInk = item.entry.enabled ? .primary : .tertiary
            row.emphasizeMatches(of: trimmed)
            return (row, .command(item.entry.command.id))
        }
    }

    private func symbolItems(_ trimmed: String) -> [(RowContent, Target)] {
        guard !trimmed.isEmpty else { return [] }
        guard let batch = symbolBatches[trimmed] else {
            searchSymbols(trimmed)
            return []
        }
        return batch.matches.map { match in
            let symbol = match.symbol
            let mark = symbol.kind.mark
            let place = match.file.isEmpty ? symbol.location.url.lastPathComponent : match.file
            var row = RowContent(title: symbol.name, detail: symbol.container.isEmpty ? place : "\(symbol.container)  \(place)",
                                 leading: .mark(.code(letter: mark.letter, semanticType: "\(mark.token)")))
            row.emphasis = match.matched
            row.meta = "\(symbol.location.range.start.line + 1)"
            row.yieldOrder = Self.identityFirst
            row.detailTruncation = .middle
            return (row, .symbol(symbol.location))
        }
    }

    private func textItems(_ trimmed: String, limit: Int) -> [(RowContent, Target)] {
        guard !trimmed.isEmpty else { return [] }
        guard let hits = texts[trimmed] else {
            searchText(trimmed)
            return []
        }
        let found = hits.prefix(limit).map { hit -> (RowContent, Target) in
            var row = RowContent(title: hit.line.trimmingCharacters(in: .whitespaces),
                                 detail: hit.path, meta: "\(hit.location.range.start.line + 1)")
            row.monospace = true
            row.yieldOrder = Self.identityFirst
            row.detailTruncation = .path
            row.emphasizeMatches(of: trimmed)
            return (row, .text(hit.location))
        }
        var more = RowContent(title: "Open in Find in Files", leading: .symbol("magnifyingglass", .secondary))
        more.titleInk = .secondary
        return found + [(more, .findInFiles(trimmed))]
    }

    private func searchSymbols(_ query: String) {
        searching?.cancel()
        guard let stream = symbolSearch?(query) else { return }
        searching = Task { [weak self] in
            for await batch in stream {
                guard let self, !Task.isCancelled else { return }
                symbolBatches[batch.query] = batch
                guard batch.query == search.view.query.trimmingCharacters(in: .whitespaces) else { continue }
                search.view.setQuery(search.view.query)
            }
        }
    }

    private func searchText(_ query: String) {
        textTask?.cancel()
        guard let textSearch else { return }
        textTask = Task { [weak self] in
            let hits = await textSearch(query, Self.textLimit)
            guard let self, !Task.isCancelled else { return }
            texts[query] = hits
            guard query == search.view.query.trimmingCharacters(in: .whitespaces) else { return }
            search.view.setQuery(search.view.query)
        }
    }

    func showRecent(in window: NSWindow, holdingControl: Bool = NSEvent.modifierFlags.contains(.control)) {
        filePaths = [:]
        recent.show(in: window)
        isSwitcherArmed = holdingControl
        stopSwitcher()
        switcherMonitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged, .keyDown]) { [weak self] event in
            self?.handleSwitcher(event) ?? event
        }
    }

    func handleSwitcher(_ event: NSEvent) -> NSEvent? {
        guard recent.isShown else {
            stopSwitcher()
            return event
        }
        let character = event.type == .keyDown ? event.charactersIgnoringModifiers : nil
        let rows = recent.view.rows.count
        let decision = SwitcherKey.decide(event.type, modifiers: event.modifierFlags, character: character, isArmed: isSwitcherArmed)
        switch decision {
        case .pass:
            return event
        case .next, .previous:
            guard rows > 0 else { return nil }
            let step = decision == .next ? 1 : -1
            recent.view.selectedRow = ((recent.view.selectedRow ?? 0) + step + rows) % rows
            return nil
        case .commit:
            let row = recent.view.selectedRow
            let content = row.flatMap { recent.view.rows[safe: $0] }
            recent.dismiss()
            stopSwitcher()
            if let row, let content { recent.onActivate?(row, content) }
            return event
        }
    }

    func stopSwitcher() {
        switcherMonitor.map(NSEvent.removeMonitor)
        switcherMonitor = nil
    }
}
