import AppKit
import NyteCore
import NyteLanguage
import NyteUI

private enum Places {
    static let caretInSubmit = TextPosition(line: 52, column: 2)
    static let goCounts = TextPosition(line: 5, column: 5)
    static let goCountsEnd = TextPosition(line: 5, column: 11)
    static let goTotalField = TextPosition(line: 14, column: 10)
    static let goTotalFieldEnd = TextPosition(line: 14, column: 16)
    static let tsCounts = TextPosition(line: 1, column: 17)
    static let newLine = 3
    static let specimensPerRow = 3
    static let rowsPerScrollStep: CGFloat = 3
    static let arenaPoll: Duration = .milliseconds(5)
    static let goCountsLineEnd = TextPosition(line: 5, column: 20)
    static let unsavedNote = " // renamed soon, not saved"
    static let findFilter = "stat"
    static let goStatsVariable = TextPosition(line: 31, column: 1)
}

@MainActor
private enum ToolSize {
    static let sidebar = NSSize(width: Metric.sidebarWidth, height: 520)
    static let narrowSidebar = NSSize(width: 200, height: 520)
    static let bottom = NSSize(width: 860, height: 260)
    static let dock = NSSize(width: 640, height: 260)
    static let tallDock = NSSize(width: 640, height: 360)
    static let empty = NSSize(width: 420, height: 200)
    static let ready: Duration = .seconds(60)
    static let quiet: Duration = .seconds(3)
    static let poll: Duration = .milliseconds(200)
}

@MainActor
private let fixtures = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures", isDirectory: true)

@MainActor
private func descendant<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
    if let match = view as? T { return match }
    return view.subviews.lazy.compactMap { descendant(type, in: $0) }.first
}

@MainActor
private func descendant(_ type: Button.Type, titled title: String, in view: NSView) -> Button? {
    if let match = view as? Button, match.title == title { return match }
    return view.subviews.lazy.compactMap { descendant(type, titled: title, in: $0) }.first
}

private func note(_ text: String) {
    FileHandle.standardError.write(Data((text + "\n").utf8))
}

@MainActor
private var kept: [NSViewController] = []

@MainActor
private func pane(_ controller: NSViewController, _ size: NSSize) -> NSView {
    kept.append(controller)
    let card = PaneCard()
    card.embed(controller.view)
    return Gallery.sized(card, width: size.width, height: size.height)
}

@MainActor
private final class Fixture {
    let workspace: Workspace
    let service: LanguageService

    init(_ name: String) {
        workspace = Workspace(root: fixtures.appendingPathComponent(name, isDirectory: true))
        service = LanguageService(workspace: workspace, toolchain: Toolchain(workspace: workspace.root))
    }

    func url(_ path: String) -> URL { workspace.root.appendingPathComponent(path) }

    func openAll(_ extensions: Set<String>) -> [URL] {
        let walker = FileManager.default.enumerator(at: workspace.root, includingPropertiesForKeys: nil)
        let urls = (walker?.allObjects ?? []).compactMap { $0 as? URL }
            .filter { extensions.contains($0.pathExtension) && !$0.path.contains("/node_modules/") }
        for url in urls {
            service.open(url, text: (try? String(contentsOf: url, encoding: .utf8)) ?? "")
        }
        return urls
    }

    func waitUntilReady(_ url: URL) async {
        _ = await Wait.until(ToolSize.ready) { self.service.status(for: url)?.state == .ready }
    }

    func waitForDiagnostics() async {
        guard await Wait.until(ToolSize.ready, { !self.service.filesWithDiagnostics.isEmpty }) else { return }
        await Wait.pause(ToolSize.quiet)
    }
}

@MainActor
private var structureState: (go: Fixture, ts: Fixture, views: [StructureViewController])?

@MainActor
let languageStructurePage = GalleryPage(
    name: "language-structure", settle: 0.5,
    prepare: {
        guard let state = structureState else { return }
        let goFile = state.go.url("hub/hub.go")
        let tsFile = state.ts.url("src/hub.ts")
        _ = state.go.openAll(["go"])
        _ = state.ts.openAll(["ts"])
        await state.go.waitUntilReady(goFile)
        await state.ts.waitUntilReady(tsFile)
        let files = [goFile, goFile, tsFile, tsFile]
        for (view, file) in zip(state.views, files) { view.show(file) }
        guard await Wait.pause(ToolSize.quiet) else { return }
        state.views[0].caretDidMove(to: Places.caretInSubmit)
        descendant(SearchField.self, in: state.views[1].view)?.stringValue = "st"
        descendant(ListView.self, in: state.views[1].view)?.focus()
        await state.go.service.shutdown()
        await state.ts.service.shutdown()
    },
    build: {
        let go = Fixture("notifyhub-go")
        let ts = Fixture("notifyhub-ts")
        let views = [
            StructureViewController(intelligence: go.service), StructureViewController(intelligence: go.service),
            StructureViewController(intelligence: ts.service), StructureViewController(intelligence: ts.service),
        ]
        structureState = (go, ts, views)
        return Gallery.page([
            Gallery.section("Structure", note: "gopls and native TypeScript 7.1.0-beta, real answers. The caret sits in Submit.", [
                Gallery.row([
                    Gallery.specimen("hub/hub.go", pane(views[0], ToolSize.sidebar)),
                    Gallery.specimen("hub/hub.go, filtered by st, focused", pane(views[1], ToolSize.sidebar)),
                    Gallery.specimen("src/hub.ts", pane(views[2], ToolSize.sidebar)),
                ]),
                Gallery.specimen("src/hub.ts, narrow: parameters collapse, then the result abbreviates; the name stays",
                                 pane(views[3], ToolSize.narrowSidebar)),
            ]),
        ])
    }
)

@MainActor
private var problemsState: (go: Fixture, ts: Fixture, views: [ProblemsViewController])?

@MainActor
let languageProblemsPage = GalleryPage(
    name: "language-problems", settle: 0.5,
    prepare: {
        guard let state = problemsState else { return }
        for (fixture, view) in zip([state.go, state.ts], state.views) {
            fixture.service.onEvent = { event in
                if case let .diagnostics(url) = event { view.diagnosticsDidChange(for: url) }
            }
        }
        _ = state.go.openAll(["go"])
        _ = state.ts.openAll(["ts"])
        await state.go.waitForDiagnostics()
        await state.ts.waitForDiagnostics()
        state.views[0].view.window?.makeFirstResponder(nil)
        await state.go.service.shutdown()
        await state.ts.service.shutdown()
    },
    build: {
        let go = Fixture("notifyhub-go")
        let ts = Fixture("notifyhub-ts")
        let views = [
            ProblemsViewController(workspace: go.workspace, intelligence: go.service),
            ProblemsViewController(workspace: ts.workspace, intelligence: ts.service),
        ]
        problemsState = (go, ts, views)
        return Gallery.page([
            Gallery.section("Problems", note: "Every file of each fixture open; the rows arrive one file at a time.", [
                Gallery.specimen("notifyhub-go, gopls", pane(views[0], ToolSize.bottom)),
                Gallery.specimen("notifyhub-ts, native TypeScript 7.1.0-beta", pane(views[1], ToolSize.bottom)),
            ]),
        ])
    }
)

@MainActor
private var findState: (go: Fixture, ts: Fixture, views: [FindResultsViewController])?

@MainActor
let languageFindPage = GalleryPage(
    name: "language-find", settle: 0.5,
    prepare: {
        guard let state = findState else { return }
        let goStats = state.go.url("hub/stats.go")
        let tsStats = state.ts.url("src/stats.ts")
        _ = state.go.openAll(["go"])
        _ = state.ts.openAll(["ts"])
        await state.go.waitUntilReady(goStats)
        await state.ts.waitUntilReady(tsStats)
        guard await Wait.pause(ToolSize.quiet) else { return }
        let goCounts = Places.goCounts
        let tsCounts = Places.tsCounts
        state.go.service.change(goStats, range: TextSpan(at: Places.goCountsLineEnd), text: Places.unsavedNote)
        let usages = await state.go.service.locations(.references(includeDeclaration: true), at: goCounts, in: goStats)
        let service = state.go.service
        let mainGo = state.go.url("main.go")
        let stats = await service.classifiedReferences(at: Places.goStatsVariable, in: mainGo)
        for view in [state.views[0], state.views[5], state.views[6]] {
            view.openText = { service.openText(of: $0) }
            view.show(usages: stats, title: "Usages of stats")
        }
        state.views[4].openText = { service.openText(of: $0) }
        state.views[4].show(locations: usages, title: "Usages of Counts")
        guard await Wait.pause(ToolSize.poll) else { return }
        descendant(SearchField.self, in: state.views[4].view)?.stringValue = Places.findFilter
        if case let .success(edit) = await state.go.service.rename(at: goCounts, in: goStats, to: "Totals") {
            state.views[1].show(preview: edit, title: "Rename Counts to Totals")
            state.views[3].show(preview: edit, title: "Rename Counts to Totals")
        }
        if case let .success(edit) = await state.ts.service.rename(at: tsCounts, in: tsStats, to: "Totals") {
            state.views[2].show(preview: edit, title: "Rename Counts to Totals")
        }
        await state.go.service.shutdown()
        await state.ts.service.shutdown()
    },
    build: {
        let go = Fixture("notifyhub-go")
        let ts = Fixture("notifyhub-ts")
        let narrow = FindResultsViewController(workspace: go.workspace)
        let filtered = FindResultsViewController(workspace: go.workspace)
        let views = [
            FindResultsViewController(workspace: go.workspace), FindResultsViewController(workspace: go.workspace),
            FindResultsViewController(workspace: ts.workspace), narrow, filtered,
            FindResultsViewController(workspace: go.workspace), FindResultsViewController(workspace: go.workspace),
        ]
        findState = (go, ts, views)
        return Gallery.page([
            Gallery.section("Find", note: "References and rename edits from the servers; lines come from open buffers first, then disk.", [
                Gallery.specimen("usages of stats, gopls: grouped by kind, the selected one previewed beside the list",
                                 pane(views[0], ToolSize.bottom)),
                Gallery.specimen("the dock at 640 by 260: a stacked preview would leave the list fewer than six rows, so it hides; the header toggle brings it back",
                                 pane(views[5], ToolSize.dock)),
                Gallery.specimen("the dock at 640 by 360: the preview stacks below the list",
                                 pane(views[6], ToolSize.tallDock)),
                Gallery.specimen("usages of Counts filtered by \"\(Places.findFilter)\"; stats.go has an unsaved edit on line 6",
                                 pane(filtered, ToolSize.bottom)),
                Gallery.specimen("rename Counts to Totals, gopls", pane(views[1], ToolSize.bottom)),
                Gallery.specimen("rename Counts to Totals, native TypeScript 7.1.0-beta", pane(views[2], ToolSize.bottom)),
                Gallery.specimen("rename in a narrow pane: long lines slide so the change stays in view", pane(narrow, EmptySize.bottom)),
            ]),
        ])
    }
)

@MainActor
private enum EmptySize {
    static let structure = NSSize(width: Metric.sidebarWidth, height: 240)
    static let bottom = NSSize(width: 520, height: 200)
}

@MainActor
private func outline() -> [DocumentSymbol] {
    func span(_ line: Int) -> TextSpan { TextSpan(start: TextPosition(line: line, column: 0), end: TextPosition(line: line + 1, column: 0)) }
    return [
        DocumentSymbol(name: "Hub", detail: "struct{...}", kind: .struct, range: span(1), selection: span(1)),
        DocumentSymbol(name: "mu", detail: "sync.Mutex", kind: .field, range: span(2), selection: span(2), depth: 1),
        DocumentSymbol(name: "New", detail: "func() *Hub", kind: .function, range: span(Places.newLine), selection: span(Places.newLine)),
    ]
}

@MainActor
private var emptyState: [(FindResultsViewController, Bool)] = []

@MainActor
private func structure(_ url: URL?, _ status: ServerStatus.State?, outline symbols: [DocumentSymbol] = [], query: String = "")
    -> StructureViewController {
    let fake = FakeIntelligence()
    fake.serverStatus = status.map { ServerStatus(name: "gopls", state: $0) }
    fake.outline = symbols
    let view = StructureViewController(intelligence: fake)
    kept.append(view)
    view.show(url)
    if !query.isEmpty {
        Task {
            guard await Wait.pause(ToolSize.poll) else { return }
            descendant(SearchField.self, in: view.view)?.stringValue = query
        }
    }
    return view
}

@MainActor
let languageEmptyPage = GalleryPage(
    name: "language-empty", settle: 0.5,
    prepare: {
        for (view, succeeds) in emptyState {
            let root = view.view
            let edit = WorkspaceEdit(files: [WorkspaceEdit.File(url: fixtures.appendingPathComponent("notifyhub-go/hub/stats.go"), edits: [
                TextEdit(range: TextSpan(start: Places.goCounts, end: Places.goCountsEnd), text: "Totals"),
                TextEdit(range: TextSpan(start: Places.goTotalField, end: Places.goTotalFieldEnd), text: "Totals"),
            ])])
            view.onApply = { _ in succeeds }
            view.show(preview: edit, title: "Rename Counts to Totals")
            guard await Wait.pause(ToolSize.poll) else { return }
            descendant(Button.self, titled: "Refactor", in: root)?.press()
        }
        guard await Wait.pause(ToolSize.poll) else { return }
        emptyState.first?.0.view.window?.makeFirstResponder(nil)
    },
    build: {
        let root = fixtures.appendingPathComponent("notifyhub-go")
        let goFile = root.appendingPathComponent("hub/hub.go")
        let structures: [(caption: String, view: StructureViewController)] = [
            ("no file", structure(nil, nil)),
            ("no server for the file", structure(root.appendingPathComponent("README.md"), nil)),
            ("server not installed", structure(goFile, .missing(hint: "go install golang.org/x/tools/gopls@latest"))),
            ("server starting", structure(goFile, .starting)),
            ("no symbols", structure(goFile, .ready)),
            ("filter matches nothing", structure(goFile, .ready, outline: outline(), query: "zz")),
        ]
        let quiet = ProblemsViewController(workspace: Workspace(root: root), intelligence: FakeIntelligence())
        let filtered = FakeIntelligence()
        filtered.problems = [goFile: [Synthetic.diagnostic(0), Synthetic.diagnostic(1)]]
        let hidden = ProblemsViewController(workspace: Workspace(root: root), intelligence: filtered)
        Task {
            guard await Wait.pause(ToolSize.poll) else { return }
            descendant(SearchField.self, in: hidden.view)?.stringValue = "zz"
        }
        let blank = FindResultsViewController(workspace: Workspace(root: root))
        let done = FindResultsViewController(workspace: Workspace(root: root))
        let failed = FindResultsViewController(workspace: Workspace(root: root))
        emptyState = [(done, true), (failed, false)]
        return Gallery.page([
            Gallery.section("Structure", [
                Gallery.row(structures.prefix(Places.specimensPerRow).map { Gallery.specimen($0.caption, pane($0.view, EmptySize.structure)) }),
                Gallery.row(structures.suffix(Places.specimensPerRow).map { Gallery.specimen($0.caption, pane($0.view, EmptySize.structure)) }),
            ]),
            Gallery.section("Problems", [
                Gallery.row([
                    Gallery.specimen("no problems", pane(quiet, EmptySize.bottom)),
                    Gallery.specimen("filter hides every problem", pane(hidden, EmptySize.bottom)),
                ]),
            ]),
            Gallery.section("Find", [
                Gallery.row([
                    Gallery.specimen("nothing found yet", pane(blank, EmptySize.bottom)),
                    Gallery.specimen("after Refactor", pane(done, EmptySize.bottom)),
                ]),
                Gallery.specimen("Refactor failed; the preview stays", pane(failed, EmptySize.bottom)),
            ]),
        ])
    }
)

@MainActor
private var scaleState: (problems: ProblemsViewController, fake: FakeIntelligence, find: FindResultsViewController, root: URL)?

@MainActor
private func milliseconds(_ duration: Duration) -> String {
    String(format: "%.2f ms", Double(duration.components.attoseconds) / 1e15 + Double(duration.components.seconds) * 1e3)
}

@MainActor
let languageScalePage = GalleryPage(
    name: "language-scale", settle: 0.5,
    prepare: {
        guard let state = scaleState else { return }
        let clock = ContinuousClock()
        let fresh = ProblemsViewController(workspace: Workspace(root: state.root), intelligence: state.fake)
        let load = clock.measure { _ = fresh.view }
        note("problems: first load of every file \(milliseconds(load))")
        let target = Synthetic.url(state.root, Synthetic.files / 2)
        state.fake.problems[target] = (0..<Synthetic.codes).map { Synthetic.diagnostic($0 * Synthetic.files) }
        let before = state.fake.diagnosticsReads
        let update = clock.measure { state.problems.diagnosticsDidChange(for: target) }
        note("problems: one file reloaded in \(milliseconds(update)), \(state.fake.diagnosticsReads - before) file read")
        state.fake.problems[target] = []
        let removal = clock.measure { state.problems.diagnosticsDidChange(for: target) }
        note("problems: one file emptied in \(milliseconds(removal))")
        let full = clock.measure { descendant(SearchField.self, in: state.problems.view)?.stringValue = "" }
        note("problems: full rebuild for comparison \(milliseconds(full)), count \(state.problems.count)")

        let locations = Synthetic.writeSources(in: state.root)
        let started = clock.now
        state.find.show(locations: locations, title: "Usages of Add")
        let shown = clock.now - started
        guard let list = descendant(ListView.self, in: state.find.view) else { return }
        while list.content(1).title.isEmpty {
            guard await Wait.pause(Places.arenaPoll) else { return }
        }
        note("find: show() \(milliseconds(shown)), lines read and rows ready \(milliseconds(clock.now - started))")
        let clip = list.scrollView.contentView
        let steps = 400
        var worst = Duration.zero
        guard let bitmap = list.bitmapImageRepForCachingDisplay(in: list.bounds) else { return }
        let total = clock.measure {
            for step in 0..<steps {
                let frame = clock.measure {
                    clip.scroll(to: NSPoint(x: 0, y: CGFloat(step) * Metric.rowCompact * Places.rowsPerScrollStep))
                    list.scrollView.reflectScrolledClipView(clip)
                    list.cacheDisplay(in: list.bounds, to: bitmap)
                }
                worst = max(worst, frame)
            }
        }
        note("find: \(steps) scroll steps of 3 rows, mean \(milliseconds(total / steps)), worst \(milliseconds(worst))")
        clip.scroll(to: NSPoint(x: 0, y: Metric.rowCompact * Places.rowsPerScrollStep))
        list.scrollView.reflectScrolledClipView(clip)
        if let severity = descendant(FilterGroup.self, in: state.problems.view) {
            severity.filters[2].isOn = false
            severity.onChange?(2, false)
        }
        if let scrolled = descendant(ListView.self, in: state.problems.view)?.scrollView {
            scrolled.contentView.scroll(to: NSPoint(x: 0, y: Metric.rowCompact * Places.rowsPerScrollStep))
            scrolled.reflectScrolledClipView(scrolled.contentView)
        }
        state.problems.view.window?.makeFirstResponder(nil)
    },
    build: {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-language-scale", isDirectory: true)
        let fake = FakeIntelligence()
        fake.problems = Synthetic.problems(in: root)
        let problems = ProblemsViewController(workspace: Workspace(root: root), intelligence: fake)
        let find = FindResultsViewController(workspace: Workspace(root: root))
        scaleState = (problems, fake, find, root)
        return Gallery.page([
            Gallery.section("At scale", note: "5,000 problems in 300 files; 5,000 usages in 300 files. Both scrolled three rows: the file row stays pinned.", [
                Gallery.specimen("problems", pane(problems, ToolSize.bottom)),
                Gallery.specimen("usages", pane(find, ToolSize.bottom)),
            ]),
        ])
    }
)

@MainActor
let languagePages: [GalleryPage] = [
    languageStructurePage, languageProblemsPage, languageFindPage, languageEmptyPage, languageScalePage, languageStatusPage,
]
