import AppKit
import NyteCore
import NyteDebug
import NyteEditor
import NyteTerminal
import NyteUI

extension ShellViewController {
    func wire() {
        wireEditor()
        wireLanguage()
        wireDebugger()
        wirePanes()
        wireToolWindows()
        wirePalettes()
        wireAssistance()
        wireSearch()
        wireContext()
    }

    private func wireEditor() {
        navigator.onOpen = { [weak self] url, preview in self?.editor.open(url, preview: preview) }
        navigator.onFilesChange = { [weak self] urls in
            self?.gitMetadataDidChange(urls)
            self?.changes?.filesDidChange(urls)
            if urls.contains(where: { $0.path.hasSuffix("/.nyte/run-configurations.json") }) { self?.refreshRunTargets() }
            let files = urls.filter { !$0.path.contains("/.git/") }
            guard !files.isEmpty else { return }
            self?.services.language.filesDidChange(files)
            self?.search.filesDidChange()
            self?.editor.filesDidChange(files)
        }
        editor.onTabsChange = { [weak self] in
            guard let self else { return }
            let edited = editor.selectedIndex.map { editor.tabs[$0].isDirty }
            if edited == true, editor.selectedURL == revealed { structure.documentDidChange() }
            tabsDidChange()
        }
        editor.onPositionChange = { [weak self] position in
            self?.lastPosition = position
            self?.editorPane.foot.show(position: position)
            self?.structure.caretDidMove(to: position.map { TextPosition(line: $0.line - 1, column: $0.column - 1) })
        }
        editor.onTextChange = { [weak self] url in self?.bufferDidChange(url) }
        editor.onDiskChange = { [weak self] url in self?.diskDidChange(under: url) }
        editor.onSymbolPathChange = { [weak self] in self?.editorPane.foot.show(symbols: $0) }
        editor.onProblemsChange = { [weak self] in self?.editorPane.problems.counts = $0 }
        editor.textMenu = { [weak self] in self?.textMenu() }
        editorPane.tabs.menuForTab = { [weak self] in self?.tabMenu($0) }
        editorPane.onShownDocumentChange = { [weak self] in self?.shownDocumentDidChange() }
        editorPane.foot.onPressCrumb = { [weak self] in self?.pressCrumb($0) }
        editorPane.foot.onCopyInstallCommand = { Self.copy($0) }
        editorPane.foot.onShowServer = { [weak self] anchor in self?.showServerPanel(from: anchor) }
        editorPane.onDismissBanner = { [weak self] key in
            guard key.hasPrefix(Self.diskBanner) else {
                self?.dismissedBanners.insert(key)
                return
            }
            self?.keepMine(key)
        }
    }

    private func wireLanguage() {
        let language = services.language
        editor.intelligence = language
        language.applyEdit = { [weak self] edit in await self?.editor.apply(edit) ?? false }
        language.onEvent = { [weak self] event in self?.intelligenceDidReport(event) }
    }

    private func wireDebugger() {
        let debugger = services.debugger
        editor.breakpoints = { [weak debugger] url in debugger?.breakpoints(in: url) ?? [] }
        editor.onToggleBreakpoint = { [weak debugger] url, line in debugger?.toggleBreakpoint(line: line, in: url) }
        editor.onLinesShift = { [weak debugger] url, line, delta in debugger?.shift(in: url, fromLine: line, by: delta) }
        debugger.onChange = { [weak self] change in self?.debuggerDidChange(change) }
    }

    private func wirePanes() {
        navigator.onOpenInTerminal = { [weak self] folder in self?.openTerminal(at: folder) }
        navigator.onFindInFolder = { [weak self] folder in self?.find(inFolder: folder) }
        navigator.onAskAgent = { [weak self] urls in self?.ask(urls.map(AgentContext.file)) }
        agent.onReviewChanges = { [weak self] changeSet in self?.openReview(changeSet) }
        agent.onWaitingChange = { [weak self] sessions in self?.windowToolbar.show(waiting: sessions) }
        agent.onOpenFile = { [weak self] url, line in
            let place = TextPosition(line: max((line ?? 1) - 1, 0), column: 0)
            self?.editor.reveal(FileLocation(url: url, range: TextSpan(at: place)))
        }
        terminal.onTitleChange = { [weak self] title in self?.dock.update(.terminal, toolTip: title) }
        wireTerminal(terminal)
        dock.onHide = { [weak self] sender in self?.setDock(open: false, from: sender) }
        dock.onSelect = { [weak self] id in self?.memory.update { $0.dockWindow = id.rawValue } }
        sidebar.onSelect = { [weak self] navigator in self?.memory.update { $0.navigator = navigator.id } }
    }

    private func wireToolWindows() {
        findResults.openText = { [weak self] url in self?.editor.text(of: url) }
        let reveal: (FileLocation) -> Void = { [weak self] location in self?.editor.reveal(location) }
        structure.onNavigate = reveal
        problems.onNavigate = reveal
        findResults.onNavigate = reveal
        debugView.onInstall = { [weak self] install in self?.runInTerminal(install.command, directory: install.directory, title: install.title) }
        debugView.onNavigate = { [weak self] location in
            self?.editor.reveal(location)
            self?.showExecutionPoint(reveal: false)
        }
        problems.onCountChange = { [weak self] count in self?.dock.update(.problems, count: .some(count)) }
        editorPane.problems.onPress = { [weak self] in self?.showToolWindow(.problems) }
        editor.onPresentLocations = { [weak self] locations, title in
            self?.showFind(title)
            self?.findResults.show(locations: locations, title: title)
        }
        editor.onPreviewEdit = { [weak self] edit, title in
            self?.showFind(title)
            self?.findResults.show(preview: edit, title: title)
        }
        findResults.onApply = { [weak self] edit in await self?.editor.apply(edit) ?? false }
        findResults.onTitleChange = { [weak self] title in self?.dock.update(.find, title: title, toolTip: title) }
    }

    func openTerminal(at folder: URL) {
        guard folder.standardizedFileURL != workspace.root else {
            showToolWindow(.terminal)
            return terminal.focusTerminal()
        }
        if dock.contains(.folderTerminal) { dock.close(.folderTerminal) }
        let shell = TerminalViewController(workspace: workspace, directory: folder, preferences: terminal.preferences)
        wireTerminal(shell)
        shell.onTitleChange = { [weak self] title in self?.dock.update(.folderTerminal, toolTip: title) }
        dock.add(ToolWindow(id: .folderTerminal, title: folder.lastPathComponent, toolTip: shell.paneTitle, isClosable: true,
                            controller: shell))
        showToolWindow(.folderTerminal)
        shell.focusTerminal()
    }

    func wireTerminal(_ controller: TerminalViewController) {
        controller.onOpenFile = { [weak self] location in
            self?.editor.reveal(location)
            self?.editor.focus()
        }
        controller.onAskAgent = { [weak self] context in self?.ask([context]) }
    }

    func showFind(_ title: String) {
        if !dock.contains(.find) {
            dock.add(ToolWindow(id: .find, title: "Find", toolTip: title, isClosable: true, controller: findResults))
        }
        dock.update(.find, toolTip: title)
        showToolWindow(.find)
    }

    func showBreakpoints() {
        showDebug()
        debugView.showBreakpoints()
    }

    func showDebug() {
        if !dock.contains(.debug) {
            dock.add(ToolWindow(id: .debug, title: "Debug", isClosable: true, controller: debugView))
        }
        showToolWindow(.debug)
    }

    private func wirePalettes() {
        palettes.openTabs = { [weak self] in self?.editor.tabs.map(\.url) ?? [] }
        palettes.recentTabs = { [weak self] in self?.recentTabs ?? [] }
        palettes.onOpenFile = { [weak self] url in
            self?.editor.open(url, preview: false)
            self?.navigator.reveal(url)
            self?.editor.focus()
        }
        palettes.commands = { [weak self] in
            guard let self else { return [] }
            return Commands.all.map { ($0, title(for: $0), canRun($0)) }
        }
        palettes.onRunCommand = { [weak self] id in self?.run(id, from: nil) }
        palettes.onOpenFileBeside = { [weak self] url in self?.editor.open(url, preview: false) }
        palettes.onFindInFiles = { [weak self] text in
            self?.findInFiles()
            self?.search.find(text)
        }
        palettes.textSearch = { [weak self] text, limit in await self?.quickText(text, limit: limit) ?? [] }
        palettes.symbolSearch = { [weak self] query in
            self?.services.language.symbolSearch(query, near: self?.editor.selectedURL) ?? AsyncStream { $0.finish() }
        }
        palettes.onRevealSymbol = { [weak self] location in self?.editor.reveal(location) }
    }

    func intelligenceDidReport(_ event: IntelligenceEvent) {
        editor.handle(event)
        switch event {
        case let .diagnostics(url):
            problems.diagnosticsDidChange(for: url)
            if url.standardizedFileURL == editor.selectedURL {
                structure.documentDidChange()
                refreshRunMarks(for: url)
                refreshUsages(for: url)
            }
        case .status:
            refreshServerStatus()
            structure.serverStatusDidChange()
        case let .notice(sentence, severity):
            showNotice(sentence, severity: severity)
        }
    }

    func refreshServerStatus() {
        let status = editor.selectedURL.flatMap { services.language.status(for: $0) }
        editorPane.foot.show(server: status)
        if let url = editor.selectedURL, diskConflicts[url] != nil { return }
        guard let status, !dismissedBanners.contains(status.name) else { return editorPane.clearBanner() }
        switch status.state {
        case let .missing(hint):
            let language = editor.selectedURL.map { Self.languageName(of: $0) } ?? "These"
            editorPane.showBanner(key: status.name + ".missing",
                                  title: "\(language) files have no completion or problems until \(status.name) is installed.",
                                  actions: [Banner.Action("Copy Install Command") { Self.copy(hint) }])
        case let .failed(sentence):
            editorPane.showBanner(key: status.name + ".failed", title: sentence)
        case .ready where status.isOverMemoryCeiling, .busy where status.isOverMemoryCeiling:
            let memory = status.residentBytes.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .memory) } ?? ""
            let language = services.language
            editorPane.showBanner(key: status.name + ".memory", title: "\(status.shortName) is using \(memory) of memory.",
                                  actions: [Banner.Action("Restart") { Task { await language.restart(status.id) } }])
        case .starting, .ready, .busy:
            editorPane.clearBanner()
        }
    }

    func showServerPanel(from anchor: NSView) {
        let language = services.language
        serverPanel.view.onRestart = { [weak self] status in
            self?.serverPanel.dismiss()
            Task { await language.restart(status.id) }
        }
        serverPanel.view.onInstall = { [weak self] install in
            self?.serverPanel.dismiss()
            self?.runInTerminal(install.command, directory: install.directory, title: install.title)
        }
        serverPanel.view.onOffer = { [weak self] offer in
            guard let self else { return }
            language.useTSServer(offer == .useTSServer)
            let chosen = language.settings
            preferences?.update { $0.language = chosen }
            serverPanel.dismiss()
        }
        serverPanel.view.onReloadEnvironment = { [weak self] in self?.reloadEnvironment() }
        Task {
            let environment = await language.environmentReading()
            serverPanel.show(serverStatuses(), environment: environment, from: anchor)
            _ = await language.sampleMemory()
            serverPanel.update(serverStatuses(), environment: environment)
        }
    }

    func reloadEnvironment() {
        let language = services.language
        Task {
            let reading = await language.reloadEnvironment()
            startChanges(environment: reading.values)
            serverPanel.update(serverStatuses(), environment: reading)
        }
    }

    func serverStatuses() -> [ServerStatus] {
        let current = editor.selectedURL.flatMap { services.language.status(for: $0) }
        let others = services.language.statuses.filter { $0.id != current?.id }
        return (current.map { [$0] } ?? []) + others
    }

    func startMemorySampling() {
        guard memorySampling == nil else { return }
        let language = services.language
        memorySampling = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.memorySampleInterval)
                guard !Task.isCancelled else { return }
                _ = await language.sampleMemory()
                self?.refreshServerStatus()
            }
        }
    }

    private static func languageName(of url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "go": "Go"
        case "ts", "tsx", "mts", "cts": "TypeScript"
        case "js", "jsx", "mjs", "cjs": "JavaScript"
        default: url.pathExtension.uppercased()
        }
    }

    static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func tabsDidChange() {
        noteTabs()
        editorPane.refreshTabs()
        let url = editor.selectedURL
        editorPane.foot.show(file: url, in: workspace)
        if url == nil { editorPane.foot.show(position: nil) }
        if let url, url != revealed { navigator.reveal(url) }
        structure.show(url)
        if url != revealed {
            refreshRunTargets()
            refreshRunMarks(for: url)
            refreshUsages(for: url)
        }
        revealed = url
        refreshServerStatus()
        showDiskConflict()
        view.window?.title = workspace.name
        view.window?.subtitle = url?.lastPathComponent ?? ""
        view.window?.representedURL = url
        view.window?.isDocumentEdited = editor.tabs.contains(where: \.isDirty)
        let open = editor.tabs.filter { !$0.isPreview }.map { workspace.relativePath(of: $0.url) }
        let selected = editor.selectedIndex.flatMap { index in
            open.firstIndex(of: workspace.relativePath(of: editor.tabs[index].url))
        }
        memory.update { state in
            state.openTabs = open
            state.selectedTab = selected
        }
        persistViews()
        refreshToolbar()
    }

    func restoreTabs() {
        let saved = memory.state
        for path in saved.openTabs {
            let url = workspace.root.appendingPathComponent(path)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            editor.open(url, preview: false)
            if let view = saved.views[path] { editor.restore(view, for: url) }
        }
        if let selected = saved.selectedTab, editor.tabs.indices.contains(selected) { editor.select(at: selected) }
    }

    func persistViews() {
        let open = editor.tabs.filter { !$0.isPreview }
        let views = Dictionary(open.compactMap { tab in editor.viewState(of: tab.url).map { (workspace.relativePath(of: tab.url), $0) } }) { first, _ in first }
        memory.update { $0.views = views }
    }

    private func pressCrumb(_ crumb: EditorFoot.Crumb) {
        switch crumb {
        case let .folder(url), let .file(url):
            setSidebar(open: true, from: nil)
            sidebar.select(id: "files")
            navigator.reveal(url)
        case let .symbol(symbol):
            guard let url = editor.selectedURL else { return }
            editor.reveal(FileLocation(url: url, range: symbol.selection))
        }
    }

    func debuggerDidChange(_ change: Debugger.Change) {
        debugView.debuggerDidChange(change)
        switch change {
        case .breakpoints:
            editor.breakpointsDidChange()
        case .state:
            showExecutionPoint(reveal: true)
            switch services.debugger.state {
            case .starting: showDebug()
            case .paused:
                showDebug()
                raiseDock(to: DebugViewController.readableHeight + Metric.paneHeader)
            default: break
            }
            editor.breakpointsDidChange()
            showRunTarget()
            refreshToolbar()
        case .output, .threads:
            break
        }
    }

    private func showExecutionPoint(reveal: Bool) {
        let debugger = services.debugger
        guard case .paused = debugger.state, let frame = debugger.selectedFrame, let url = frame.url else {
            editor.executionPoint = nil
            return refreshInlineValues()
        }
        let place = FileLocation(url: url, range: TextSpan(at: TextPosition(line: frame.line, column: frame.column)))
        editor.executionPoint = place
        if reveal { editor.reveal(place, asJump: false) }
        refreshInlineValues()
    }
}
