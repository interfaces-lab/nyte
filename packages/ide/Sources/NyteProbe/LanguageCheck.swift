import Darwin
import Foundation
import NyteCore
@testable import NyteLanguage

struct Fixture {
    var folder: String
    var server: String
    var problems: [(file: String, line: Int, severity: Diagnostic.Severity, says: String)]
    var hover: (at: String, says: String)
    var completion: (file: String, after: Int, text: String, members: [String], accept: String, yields: String, stops: [String])
    var row: (label: String, tail: String, type: String, invocation: CompletionItem.Invocation)
    var definition: (at: String, goes: [String])
    var implementations: (at: String, goes: [String])
    var references: (at: String, goes: [String])
    var symbols: (file: String, has: [(name: String, kind: SymbolKind, depth: Int)])
    var rename: (at: String, files: [String])
    var breaking: (file: String, after: Int, text: String)
    var misindent: (file: String, line: Int, indent: String, bad: String)
    var annotated: String
    var action: (at: String, title: String)
    var signature: (at: String, says: String, parameter: String)
    var typeDefinition: (at: String, goes: [String])
    var highlights: (at: String, lines: Set<Int>)
    var actionSetup: (file: String, after: Int, text: String)? = nil
}

@MainActor final class LanguageCheck {
    static let go = Fixture(
        folder: "notifyhub-go",
        server: "gopls",
        problems: [
            ("hub/hub.go", 77, .information, "\"describe\" is unused"),
            ("hub/hub.go", 77, .information, "unused parameter: verbose"),
            ("hub/hub.go", 80, .warning, "nil dereference"),
        ],
        hover: ("main.go:32:13", "func (h *hub.Hub) Stats() hub.Stats"),
        completion: ("main.go", 32, "\tstats.", ["Names", "Total", "Channels"], "Names", "\tstats.Names", []),
        row: ("Names", "()", "[]string", .withoutArguments),
        definition: ("main.go:17:11", ["hub/hub.go:36"]),
        implementations: ("hub/hub.go:19:6", ["hub/email.go:10", "hub/webhook.go:10"]),
        references: ("hub/stats.go:55:6", ["hub/stats.go:40", "hub/stats.go:44", "hub/stats.go:55"]),
        symbols: ("hub/stats.go", [
            ("Counts", .struct, 0), ("Submitted", .field, 1), ("Stats", .struct, 0), ("Channels", .field, 1),
            ("newStats", .function, 0), ("(Stats).Names", .method, 0),
        ]),
        rename: ("hub/stats.go:6:6", ["hub/hub_test.go", "hub/stats.go"]),
        breaking: ("hub/hub.go", 36, "\tvar broken int = \"text\""),
        misindent: ("hub/hub.go", 42, "\t", "      "),
        annotated: "main.go",
        action: ("hub/hub.go:77:35", "Remove unused parameter"),
        signature: ("main.go:27:27", "Submit(ctx context.Context, message hub.Message) error", "message hub.Message"),
        typeDefinition: ("main.go:26:9", ["hub/hub.go:12"]),
        highlights: ("main.go:32:2", [32, 33, 34, 35])
    )

    static let typescript = Fixture(
        folder: "notifyhub-ts",
        server: "typescript-language-server",
        problems: [
            ("src/channels/webhook.ts", 19, .error, "not assignable to type 'number'"),
            ("src/channels/webhook.ts", 19, .error, "'retries' is declared but its value is never read"),
        ],
        hover: ("src/index.ts:19:16", "Hub.submit(message: Message, signal: AbortSignal): Promise<void>"),
        completion: ("src/index.ts", 8, "hub.", ["register", "submit", "stats"], "register", "hub.register", []),
        row: ("register", "(channel: Channel)", "void", .withArguments),
        definition: ("src/index.ts:6:17", ["src/hub.ts:27"]),
        implementations: ("src/hub.ts:11:18", ["src/channels/email.ts:4", "src/channels/webhook.ts:4"]),
        references: ("src/stats.ts:34:10", ["src/stats.ts:22", "src/stats.ts:24", "src/stats.ts:34"]),
        symbols: ("src/hub.ts", [
            ("Message", .interface, 0), ("channel", .property, 1), ("Hub", .class, 0), ("register", .method, 1),
            ("submit", .method, 1),
        ]),
        rename: ("src/stats.ts:2:18", ["src/stats.ts"]),
        breaking: ("src/hub.ts", 54, "    const broken: number = \"text\";"),
        misindent: ("src/channels/webhook.ts", 14, "    ", "          "),
        annotated: "src/index.ts",
        action: ("src/channels/webhook.ts:19:11", "Remove unused declaration"),
        signature: ("src/index.ts:19:31", "submit(message: Message, signal: AbortSignal): Promise<void>", "signal: AbortSignal"),
        typeDefinition: ("src/index.ts:17:12", ["src/hub.ts:4"]),
        highlights: ("src/index.ts:25:7", [25, 26, 27, 28])
    )

    let fixture: Fixture
    let root: URL
    let service: LanguageService
    var failures = 0
    var applied: [WorkspaceEdit] = []

    init(_ fixture: Fixture, root: URL? = nil) {
        self.fixture = fixture
        self.root = root ?? URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../Fixtures/\(fixture.folder)")
            .standardizedFileURL
        service = LanguageService(workspace: Workspace(root: self.root), toolchain: Toolchain(workspace: self.root))
        if fixture.server == "typescript-language-server" { service.settings.typeScript.server = .tsserver }
        service.applyEdit = { [weak self] edit in
            self?.applied.append(edit)
            return true
        }
    }

    func run() async -> Int {
        let name = fixture.server
        let files = Probe.sources(in: root)
        let before = files.map { try? Data(contentsOf: $0) }
        let opened = ContinuousClock.now
        var firstDiagnostics: Duration?
        service.onEvent = { event in
            if case .diagnostics = event, firstDiagnostics == nil { firstDiagnostics = ContinuousClock.now - opened }
        }
        for file in files { service.open(file, text: (try? String(contentsOf: file, encoding: .utf8)) ?? "") }
        let first = url(fixture.annotated)
        let ready = await Patience.until(.seconds(60)) { self.service.status(for: first)?.state == .ready }
        expect(ready, "\(name) starts and reports ready", "\(String(describing: service.status(for: first)))")
        let status = service.status(for: first)
        let shortName = ["gopls": "gopls", "typescript-language-server": "tsserver", "TypeScript": "TypeScript"][name]
        expect(status?.version.isEmpty == false && status?.location.map { FileManager.default.isExecutableFile(atPath: $0.path) } == true
            && status?.shortName == shortName,
            "\(name) status names the version found, where, and its short name \(shortName ?? "?")",
            "\(status?.shortName ?? "nil") \(status?.version ?? "nil") at \(status?.location?.path ?? "nil")")

        for problem in fixture.problems {
            let file = url(problem.file)
            let found = await Patience.until(.seconds(30)) {
                self.service.diagnostics(for: file).contains {
                    $0.range.start.line == problem.line - 1 && $0.severity == problem.severity && $0.message.contains(problem.says)
                }
            }
            expect(found, "\(name) diagnostic \(problem.severity) at \(problem.file):\(problem.line) says \(problem.says)",
                   service.diagnostics(for: file).map { "\($0.range.start.line + 1) \($0.severity) \($0.message)" }.joined(separator: "; "))
        }

        print("info \(name) first diagnostics \(firstDiagnostics.map { "\($0)" } ?? "never") after opening \(files.count) files")
        service.onEvent = nil
        if let pid = Probe.processes().first(where: { $0.parent == getpid() })?.pid {
            print("info \(name) resident memory with the fixture open: \(Probe.residentTree(pid))")
        }

        let (hoverFile, hoverAt) = place(fixture.hover.at)
        let hover = await service.hover(at: hoverAt, in: hoverFile)
        expect(hover?.markdown.contains(fixture.hover.says) == true, "\(name) hover shows \(fixture.hover.says)", hover?.markdown ?? "nil")

        await completion()
        await locations(.definition, fixture.definition, "definition")
        await locations(.implementations, fixture.implementations, "implementations of Channel")
        await locations(.references(includeDeclaration: true), fixture.references, "references")
        await locations(.typeDefinition, fixture.typeDefinition, "type definition")
        let (referenceFile, referenceAt) = place(fixture.references.at)
        let classified = await service.classifiedReferences(at: referenceAt, in: referenceFile)
        let declarations = classified.filter { $0.kind == .declaration }.count
        expect(classified.count == fixture.references.goes.count && declarations == 1,
               "\(fixture.server) classified references keep every reference and mark the declaration",
               classified.map { "\($0.kind) \(relative($0.location.url)):\($0.location.range.start.line + 1)" }.joined(separator: ", "))
        await signatureHelp()
        await highlights()

        let symbols = await service.symbols(in: url(fixture.symbols.file))
        for expected in fixture.symbols.has {
            let found = symbols.contains { $0.name == expected.name && $0.kind == expected.kind && $0.depth == expected.depth }
            expect(found, "\(name) symbol \(expected.name) is a \(expected.kind) at depth \(expected.depth)",
                   symbols.map { "\($0.name) \($0.kind) \($0.depth)" }.joined(separator: "; "))
        }
        let ordered = zip(symbols, symbols.dropFirst()).allSatisfy { pair in
            pair.1.depth > pair.0.depth || pair.0.range.start <= pair.1.range.start
        }
        expect(ordered && !symbols.isEmpty, "\(name) document symbols come in document order", "\(symbols.count) symbols")

        await structureRows()
        let hubs = await service.symbols(matching: "Hub")
        expect(hubs.contains { $0.name == "Hub" && ($0.kind == .struct || $0.kind == .class) }, "\(name) workspace symbols find Hub",
               hubs.prefix(5).map(\.name).joined(separator: ", "))

        let (renameFile, renameAt) = place(fixture.rename.at)
        switch await service.rename(at: renameAt, in: renameFile, to: "Totals") {
        case let .success(edit):
            let touched = Set(edit.files.filter { !$0.edits.isEmpty }.map { relative($0.url) })
            expect(touched == Set(fixture.rename.files), "\(name) rename of Counts edits \(fixture.rename.files.joined(separator: ", "))",
                   touched.sorted().joined(separator: ", "))
        case let .failure(failure): expect(false, "\(name) rename of Counts", failure.message)
        }
        expect(files.map { try? Data(contentsOf: $0) } == before, "\(name) rename left the files on disk as they were",
               changedFiles(files, before))

        await breakAndRevert()
        await formatting()
        await annotations()
        await settingsFlip()
        await action()
        if fixture.folder == "notifyhub-ts" { await unusedLocalFix() }
        await restart()
        expect(!service.log(for: name).isEmpty, "\(name) log keeps what the server wrote", "the log is empty")
        await giveUp()

        await service.shutdown()
        let gone = await Patience.until(.seconds(5)) { Probe.descendants(of: getpid()).isEmpty }
        expect(gone, "\(name) shutdown leaves no child process", Probe.descendants(of: getpid()).map(\.command).joined(separator: ", "))
        expect(files.map { try? Data(contentsOf: $0) } == before, "\(name) the fixture files on disk are unchanged",
               changedFiles(files, before))
        return failures
    }

    private func completion() async {
        let spec = fixture.completion
        let file = url(spec.file)
        service.change(file, range: TextSpan(at: .init(line: spec.after, column: 0)), text: spec.text + "\n")
        let at = TextPosition(line: spec.after, column: spec.text.utf16.count)
        let asked = ContinuousClock.now
        let list = await service.completions(at: at, in: file, trigger: .character("."))
        print("info \(fixture.server) completion with row details answered in \(ContinuousClock.now - asked)")
        let labels = Set(list.items.map(\.label))
        expect(spec.members.allSatisfy(labels.contains), "\(fixture.server) completion after \(spec.text.trimmingCharacters(in: .whitespaces)) lists \(spec.members.joined(separator: ", "))",
               labels.sorted().prefix(12).joined(separator: ", "))
        if let item = list.items.first(where: { $0.label == spec.accept }) {
            let resolved = await service.resolve(item)
            let line = spec.text as NSString
            let replace = resolved.replace.map { NSRange(location: $0.start.column, length: $0.end.column - $0.start.column) }
                ?? NSRange(location: line.length, length: 0)
            let accepted = line.replacingCharacters(in: replace, with: resolved.text)
            let text = resolved.text as NSString
            let stops = resolved.stops.map { stop in
                stop.utf16Offset + stop.utf16Length <= text.length
                    ? text.substring(with: NSRange(location: stop.utf16Offset, length: stop.utf16Length)) : "out of range"
            }
            expect(accepted == spec.yields && stops == spec.stops,
                   "\(fixture.server) accepting \(spec.accept) makes the line \(spec.yields.debugDescription) with stops \(spec.stops)",
                   "line \(accepted.debugDescription) stops \(stops)")
        } else {
            expect(false, "\(fixture.server) completion has \(spec.accept)", labels.sorted().prefix(12).joined(separator: ", "))
        }
        let shape = fixture.row
        let row = list.items.first { $0.label == shape.label }
        expect(row?.tail == shape.tail && row?.type == shape.type && row?.invocation == shape.invocation,
               "\(fixture.server) the unresolved row for \(shape.label) reads \(shape.label)\(shape.tail) \(shape.type) and is \(shape.invocation)",
               row.map { "tail \($0.tail.debugDescription) type \($0.type.debugDescription) \($0.invocation)" } ?? "no row")
        let older = Task { await self.service.completions(at: at, in: file, trigger: .invoked) }
        let newer = Task { await self.service.completions(at: at, in: file, trigger: .invoked) }
        let (olderCount, newerCount) = (await older.value.items.count, await newer.value.items.count)
        expect(olderCount == 0 && newerCount > 0, "\(fixture.server) a newer completion for the document cancels the older one",
               "older \(olderCount) items, newer \(newerCount)")
        service.change(file, range: TextSpan(start: .init(line: spec.after, column: 0), end: .init(line: spec.after + 1, column: 0)), text: "")
    }

    private func locations(_ query: LocationQuery, _ spec: (at: String, goes: [String]), _ label: String) async {
        let (file, at) = place(spec.at)
        let found = await service.locations(query, at: at, in: file)
        let places = Set(found.map { "\(relative($0.url)):\($0.range.start.line + 1)" })
        expect(places == Set(spec.goes), "\(fixture.server) \(label) go to \(spec.goes.joined(separator: ", "))",
               places.sorted().joined(separator: ", "))
    }

    private func breakAndRevert() async {
        let spec = fixture.breaking
        let file = url(spec.file)
        service.change(file, range: TextSpan(at: .init(line: spec.after, column: 0)), text: spec.text + "\n")
        let broke = await Patience.until(.seconds(20)) {
            self.service.diagnostics(for: file).contains { $0.severity == .error && $0.range.start.line == spec.after }
        }
        expect(broke, "\(fixture.server) an incremental change that breaks \(spec.file):\(spec.after + 1) brings an error there",
               service.diagnostics(for: file).map { "\($0.range.start.line + 1) \($0.severity) \($0.message)" }.joined(separator: "; "))
        service.change(file, range: TextSpan(start: .init(line: spec.after, column: 0), end: .init(line: spec.after + 1, column: 0)), text: "")
        let cleared = await Patience.until(.seconds(20)) {
            !self.service.diagnostics(for: file).contains { $0.severity == .error && $0.range.start.line == spec.after }
        }
        expect(cleared, "\(fixture.server) reverting the change clears that error",
               service.diagnostics(for: file).map(\.message).joined(separator: "; "))
    }

    private func formatting() async {
        let spec = fixture.misindent
        let file = url(spec.file)
        let line = spec.line - 1
        service.change(file, range: TextSpan(start: .init(line: line, column: 0), end: .init(line: line, column: spec.indent.utf16.count)), text: spec.bad)
        let edits = await service.formatting(for: file, indent: 2, usesTabs: false)
        expect(edits.contains { $0.range.start.line <= line && line <= $0.range.end.line }, "\(fixture.server) formatting fixes the indent of \(spec.file):\(spec.line)",
               edits.map { "\(Probe.show($0.range)) \($0.text.debugDescription)" }.prefix(4).joined(separator: "; "))
        service.change(file, range: TextSpan(start: .init(line: line, column: 0), end: .init(line: line, column: spec.bad.utf16.count)), text: spec.indent)
    }

    private func annotations() async {
        let file = url(fixture.annotated)
        let lines = Probe.lines((try? String(contentsOf: file, encoding: .utf8)) ?? "")
        let fits = { (line: Int, column: Int) in line >= 0 && line < lines.count && column >= 0 && column <= lines[line].utf16.count }
        guard let tokens = await service.semanticTokens(for: file) else {
            return expect(false, "\(fixture.server) semantic tokens", "no answer; log: \(service.log(for: fixture.server).suffix(300))")
        }
        let ascending = (1..<max(tokens.count, 1)).allSatisfy { index in
            index >= tokens.count || (tokens.lines[index - 1], tokens.columns[index - 1]) < (tokens.lines[index], tokens.columns[index])
        }
        let inside = (0..<tokens.count).allSatisfy { fits(Int(tokens.lines[$0]), Int(tokens.columns[$0] + tokens.lengths[$0])) }
        let kinds = Set(tokens.kinds).count
        expect(tokens.count > 0 && ascending && inside && kinds > 2, "\(fixture.server) semantic tokens are non-empty, ascending and in range",
               "\(tokens.count) tokens, \(kinds) kinds, ascending \(ascending), inside \(inside)")
        let everything = TextSpan(start: .init(line: 0, column: 0), end: .init(line: lines.count, column: 0))
        let hints = await service.inlayHints(in: everything, of: file)
        let ordered = zip(hints, hints.dropFirst()).allSatisfy { $0.position <= $1.position }
        let placed = hints.allSatisfy { fits($0.position.line, $0.position.column) && !$0.label.isEmpty }
        expect(!hints.isEmpty && ordered && placed, "\(fixture.server) inlay hints are non-empty, ascending and in range",
               hints.prefix(4).map { "\(Probe.show(TextSpan(at: $0.position))) \($0.label)" }.joined(separator: "; "))
    }

    private func action() async {
        let (file, at) = place(fixture.action.at)
        if let setup = fixture.actionSetup {
            service.change(url(setup.file), range: TextSpan(at: .init(line: setup.after, column: 0)), text: setup.text + "\n")
            _ = await Patience.until(.seconds(20)) { self.service.diagnostics(for: file).contains { $0.range.start.line == at.line } }
        }
        defer {
            if let setup = fixture.actionSetup {
                service.change(url(setup.file), range: TextSpan(start: .init(line: setup.after, column: 0), end: .init(line: setup.after + 1, column: 0)), text: "")
            }
        }
        let actions = await service.actions(in: TextSpan(at: at), of: file)
        guard let chosen = actions.first(where: { $0.title.contains(fixture.action.title) }) else {
            return expect(false, "\(fixture.server) code action \(fixture.action.title)", actions.map(\.title).joined(separator: "; "))
        }
        expect(true, "\(fixture.server) code action \(chosen.title.debugDescription) is offered", "")
        applied = []
        let result = await service.perform(chosen)
        let routed = await Patience.until(.seconds(10)) { !self.applied.isEmpty }
        let touches = applied.contains { edit in edit.files.contains { $0.url == file && !$0.edits.isEmpty } }
        if case let .failure(failure) = result { return expect(false, "\(fixture.server) performing the action", failure.message) }
        expect(routed && touches, "\(fixture.server) performing it routes an edit to \(relative(file)) through applyEdit", "\(applied.count) edits")
    }

    private func unusedLocalFix() async {
        let file = url("src/channels/webhook.ts")
        _ = await Patience.until(.seconds(20)) { self.service.diagnostics(for: file).contains { $0.range.start.line == 18 } }
        let onLine = service.diagnostics(for: file).filter { $0.range.start.line <= 18 && 18 <= $0.range.end.line }
        guard let first = onLine.first else { return expect(false, "\(fixture.server) diagnostics on webhook.ts:19", "none") }
        let range = onLine.dropFirst().reduce(first.range) { TextSpan(start: min($0.start, $1.range.start), end: max($0.end, $1.range.end)) }
        let actions = await service.actions(in: range, of: file)
        guard let fix = actions.first(where: { $0.kind == .quickFix && $0.title.contains("Remove unused declaration") }) else {
            return expect(false, "\(fixture.server) a quick fix for the unused, mistyped local at webhook.ts:19",
                          actions.map(\.title).joined(separator: "; "))
        }
        applied = []
        let result = await service.perform(fix)
        let removed = applied.flatMap(\.files).flatMap(\.edits).contains { $0.range.start.line == 18 && $0.text.isEmpty }
        let performed = if case .success = result { true } else { false }
        expect(performed && removed, "\(fixture.server) a quick fix for the unused, mistyped local at webhook.ts:19 removes it: \(fix.title)",
               "\(applied.count) edits")
    }

    private func restart() async {
        guard let server = Probe.processes().first(where: { $0.parent == getpid() }) else {
            return expect(false, "\(fixture.server) has a child process to kill", "\(String(describing: service.status(for: url(fixture.annotated))))")
        }
        kill(server.pid, SIGKILL)
        let file = url(fixture.annotated)
        let back = await Patience.until(.seconds(60)) {
            Probe.processes().contains { $0.parent == getpid() && $0.pid != server.pid } && self.service.status(for: file)?.state == .ready
        }
        let (hoverFile, hoverAt) = place(fixture.hover.at)
        var hover = await service.hover(at: hoverAt, in: hoverFile)
        let deadline = ContinuousClock.now + .seconds(20)
        while hover?.markdown.contains(fixture.hover.says) != true, ContinuousClock.now < deadline, await Patience.pause(.milliseconds(500)) {
            hover = await service.hover(at: hoverAt, in: hoverFile)
        }
        expect(back && hover?.markdown.contains(fixture.hover.says) == true, "\(fixture.server) killed with SIGKILL restarts and answers again",
               "back \(back), \(String(describing: service.status(for: file))), hover \(hover?.markdown.prefix(80) ?? "nil")")
    }

    private func giveUp() async {
        let file = url(fixture.annotated)
        let limit = LanguageService.restartLimit
        for _ in 0..<limit.restarts {
            _ = await Patience.until(.seconds(30)) { self.service.status(for: file)?.state == .ready }
            guard let server = Probe.processes().first(where: { $0.parent == getpid() }) else { break }
            kill(server.pid, SIGKILL)
            _ = await Patience.until(.seconds(10)) { !Probe.processes().contains { $0.pid == server.pid } && self.service.status(for: file)?.state != .ready }
        }
        let failed = await Patience.until(.seconds(10)) {
            if case .failed = self.service.status(for: file)?.state { return true }
            return false
        }
        let hover = await service.hover(at: place(fixture.hover.at).1, in: file)
        expect(failed && hover == nil,
               "\(fixture.server) death \(limit.restarts + 1) within \(limit.window) leaves it failed and answering empty",
               "\(String(describing: service.status(for: file)))")
    }

    static func watchedFiles() async -> Int {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../Fixtures/notifyhub-go").standardizedFileURL
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-lsp-\(getpid())").standardizedFileURL
        try? FileManager.default.removeItem(at: copy)
        defer { try? FileManager.default.removeItem(at: copy) }
        guard (try? FileManager.default.copyItem(at: source, to: copy)) != nil else {
            print("FAIL gopls watched files: copy the fixture\n     saw: cannot copy \(source.path)")
            return 1
        }
        let check = LanguageCheck(go, root: copy)
        await check.filesChangedOnDisk()
        return check.failures
    }

    private func filesChangedOnDisk() async {
        let main = url("main.go")
        service.open(main, text: (try? String(contentsOf: main, encoding: .utf8)) ?? "")
        _ = await Patience.until(.seconds(60)) { self.service.status(for: main)?.state == .ready }
        let stats = url("hub/stats.go")
        let text = (try? String(contentsOf: stats, encoding: .utf8)) ?? ""
        try? text.replacingOccurrences(of: "func (s Stats) Names()", with: "func (s Stats) Labels()").write(to: stats, atomically: true, encoding: .utf8)
        service.filesDidChange([stats])
        let followed = await Patience.until(.seconds(30)) {
            self.service.diagnostics(for: main).contains { $0.severity == .error && $0.range.start.line == 33 }
        }
        expect(followed, "gopls a file changed on disk and reported through filesDidChange brings diagnostics in an open file",
               service.diagnostics(for: main).map(\.message).joined(separator: "; "))
        await service.shutdown()
    }

    func expect(_ passed: Bool, _ label: String, _ saw: @autoclosure () -> String) {
        if passed { return print("ok   \(label)") }
        failures += 1
        let detail = saw()
        print("FAIL \(label)\n     saw: \(detail.isEmpty ? "(nothing)" : detail)")
    }

    private func changedFiles(_ files: [URL], _ before: [Data?]) -> String {
        zip(files, before).filter { (try? Data(contentsOf: $0.0)) != $0.1 }.map { relative($0.0) }.joined(separator: ", ")
    }

    private func signatureHelp() async {
        let spec = fixture.signature
        let (file, at) = place(spec.at)
        let help = await service.signatureHelp(at: at, in: file)
        let signature = help.map { $0.signatures[min($0.activeSignature, $0.signatures.count - 1)] }
        let parameter = help?.activeParameter.flatMap { index in
            signature.flatMap { signature in
                signature.parameterUTF16Ranges.indices.contains(index)
                    ? (signature.label as NSString).substring(with: NSRange(signature.parameterUTF16Ranges[index])) : nil
            }
        }
        expect(signature?.label.contains(spec.says) == true && parameter == spec.parameter,
               "\(fixture.server) signature help shows \(spec.says) with \(spec.parameter) active",
               "label \(signature?.label ?? "nil"), active parameter \(parameter ?? "nil")")
    }

    private func highlights() async {
        let spec = fixture.highlights
        let (file, at) = place(spec.at)
        let spans = await service.highlights(at: at, in: file)
        let lines = Set(spans.map { $0.start.line + 1 })
        expect(lines == spec.lines, "\(fixture.server) highlights mark every use on lines \(spec.lines.sorted())",
               spans.map(Probe.show).joined(separator: ", "))
    }

    func url(_ path: String) -> URL { root.appendingPathComponent(path) }

    func relative(_ url: URL) -> String { Workspace(root: root).relativePath(of: url) }

    func place(_ text: String) -> (URL, TextPosition) {
        let parts = text.split(separator: ":")
        return (url(String(parts[0])), Probe.position(parts.dropFirst().joined(separator: ":")))
    }
}

