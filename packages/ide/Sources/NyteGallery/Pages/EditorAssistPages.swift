import AppKit
import NyteCore
@testable import NyteEditor
@testable import NyteLanguage
import NyteUI

@MainActor
private var assistSpecimen: EditorSpecimen?

@MainActor
private enum Keys {
    static let returnKey: UInt16 = 36
    static let tab: UInt16 = 48
    static let x: UInt16 = 7
    static let period: UInt16 = 47
    static let c: UInt16 = 8
    static let q: UInt16 = 12
    static let delete: UInt16 = 51
}

@MainActor
private func visibleRows(_ specimen: EditorSpecimen) -> Int {
    let lists = (specimen.editor.view.window?.childWindows ?? []).filter(\.isVisible)
        .compactMap { $0.contentView?.subviews.lazy.compactMap { $0 as? ListView }.first }
    return lists.first?.rowCount() ?? 0
}

@MainActor
private func assistPage(_ name: String, fixture: String = "notifyhub-go", title: String, note: String = "",
                        prepare: @escaping @MainActor (EditorSpecimen) async -> Void) -> GalleryPage {
    GalleryPage(name: name, settle: 0.6, prepare: {
        guard let specimen = assistSpecimen else { return }
        if let window = specimen.editor.view.window, let screen = window.screen ?? NSScreen.main {
            window.setFrameTopLeftPoint(NSPoint(x: screen.visibleFrame.minX, y: screen.visibleFrame.maxY))
        }
        await prepare(specimen)
        await specimen.shutdown()
    }, build: {
        let specimen = EditorSpecimen(fixture: fixture)
        assistSpecimen = specimen
        return Gallery.page([Gallery.section(title, note: note, [specimen.card])])
    })
}

@MainActor
private func panels(_ specimen: EditorSpecimen) -> Int {
    specimen.editor.view.window?.childWindows?.filter(\.isVisible).count ?? 0
}

@MainActor
private func openReady(_ specimen: EditorSpecimen, _ path: String, line: Int) async {
    specimen.open(path, at: line)
    let url = specimen.url(path).standardizedFileURL
    _ = await Wait.until { specimen.editor.url == url }
    _ = await Wait.until {
        if case .ready = specimen.service.status(for: url)?.state { return true }
        return false
    }
}

@MainActor
private func insertLine(_ specimen: EditorSpecimen, after line: Int, _ text: String) {
    let editor = specimen.editor
    guard let end = editor.offset(of: TextPosition(line: line, column: Int.max)) else { return }
    editor.textView.insertText("\n" + text, replacementRange: NSRange(location: end, length: 0))
}

@MainActor
private func place(_ specimen: EditorSpecimen, line: Int, column: Int) {
    specimen.editor.select(TextSpan(at: TextPosition(line: line, column: column)))
}

@MainActor
private func showUntilPanel(_ specimen: EditorSpecimen, _ command: EditorCommand, panels wanted: Int = 1) async {
    for _ in 0..<20 {
        specimen.editor.perform(command)
        if await Wait.until(.seconds(3), { panels(specimen) >= wanted }) { return }
    }
}

@MainActor
private func press(_ editor: EditorViewController, _ characters: String, key: UInt16, modifiers: NSEvent.ModifierFlags = []) {
    guard let event = NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: modifiers, timestamp: 0,
        windowNumber: editor.textView.window?.windowNumber ?? 0, context: nil, characters: characters,
        charactersIgnoringModifiers: characters, isARepeat: false, keyCode: key
    ) else { return }
    editor.textView.keyDown(with: event)
}

@MainActor
private func feature<Feature>(_ editor: EditorViewController, _ type: Feature.Type) -> Feature? {
    editor.features.lazy.compactMap { $0 as? Feature }.first
}

@MainActor
private func lineText(_ editor: EditorViewController, _ line: Int) -> String {
    guard let index = editor.lineIndex else { return "" }
    return editor.shownText.substring(with: index.range(of: line, length: editor.shownText.length))
}

@MainActor
private func hover(_ specimen: EditorSpecimen, line: Int, column: Int) async {
    let editor = specimen.editor
    guard let offset = editor.offset(of: TextPosition(line: line, column: column)),
          let rect = editor.rects(for: NSRange(location: offset, length: 1)).first,
          let hovering = feature(editor, HoverFeature.self)
    else { return }
    for _ in 0..<20 {
        hovering.pointerMoved(to: NSPoint(x: rect.midX, y: rect.midY), offset: offset, modifiers: [])
        if await Wait.until(.seconds(3), { panels(specimen) >= 1 }) { return }
        hovering.pointerExited()
    }
}

@MainActor
let completionGoPage = assistPage("assist-completion-go", title: "Completion after h.stats. with its documentation") { specimen in
    await openReady(specimen, "hub/hub.go", line: 44)
    insertLine(specimen, after: 44, "\th.stats.")
    place(specimen, line: 45, column: Int.max)
    await showUntilPanel(specimen, .showCompletions)
    await downToDocumentation(specimen)
}

@MainActor
private func downToDocumentation(_ specimen: EditorSpecimen) async {
    for _ in 0..<12 {
        if await Wait.until(.seconds(2), { panels(specimen) >= 2 }) { return }
        press(specimen.editor, "\u{F701}", key: 125)
    }
}

@MainActor
let completionTSPage = assistPage("assist-completion-ts", fixture: "notifyhub-ts",
                                  title: "Completion after hub. in TypeScript") { specimen in
    await openReady(specimen, "src/index.ts", line: 8)
    insertLine(specimen, after: 8, "hub.")
    place(specimen, line: 9, column: Int.max)
    await showUntilPanel(specimen, .showCompletions)
    await downToDocumentation(specimen)
}

@MainActor
let completionFilteredPage = assistPage("assist-completion-filtered", title: "Filtered after two letters: h.st",
                                        note: "Stats is a case-insensitive prefix; Submit matches as a subsequence.") { specimen in
    await openReady(specimen, "main.go", line: 31)
    insertLine(specimen, after: 30, "\th.st")
    place(specimen, line: 31, column: Int.max)
    await showUntilPanel(specimen, .showCompletions)
}

@MainActor
let signaturePage = assistPage("assist-signature", title: "Parameter info on the second argument of Submit") { specimen in
    await openReady(specimen, "main.go", line: 31)
    insertLine(specimen, after: 30, "\th.Submit(ctx, )")
    place(specimen, line: 31, column: 15)
    await showUntilPanel(specimen, .showParameterInfo)
}

@MainActor
let hoverDocumentationPage = assistPage("assist-hover", title: "Documentation on hover over Register") { specimen in
    await openReady(specimen, "main.go", line: 18)
    place(specimen, line: 14, column: 0)
    await hover(specimen, line: 17, column: 4)
}

@MainActor
let hoverProblemPage = assistPage("assist-hover-problem", title: "Hover on the nil dereference in describe",
                                 prepare: hoverOnProblem)

@MainActor
private func hoverOnProblem(_ specimen: EditorSpecimen) async {
    await openReady(specimen, "hub/hub.go", line: 70)
    let editor = specimen.editor
    editor.textView.insertText(String(repeating: "\n", count: 16), replacementRange: NSRange(location: editor.shownText.length, length: 0))
    let url = specimen.url("hub/hub.go")
    var steady = 0
    _ = await Wait.until(.seconds(60)) {
        let found = specimen.service.diagnostics(for: url).contains { $0.range.start.line == 79 && $0.severity == .warning }
        steady = found ? steady + 1 : 0
        return steady >= 30
    }
    place(specimen, line: 79, column: 0)
    await hover(specimen, line: 79, column: 20)
}

@MainActor
let renamePage = assistPage("assist-rename", title: "Rename Submit in place",
                            note: "The box sits on the identifier; the other occurrences follow as you type.", prepare: renameInPlace)

@MainActor
private func renameInPlace(_ specimen: EditorSpecimen) async {
    await openReady(specimen, "hub/hub.go", line: 48)
    place(specimen, line: 48, column: 15)
    await startRename(specimen)
    let editor = specimen.editor
    editor.textView.insertText("Deliver", replacementRange: editor.caretRange)
    await Wait.pause(.milliseconds(300))
}

@MainActor
private func startRename(_ specimen: EditorSpecimen) async {
    for _ in 0..<20 where !specimen.editor.isEditingInPlace {
        specimen.editor.perform(.rename)
        _ = await Wait.until(.seconds(3)) { specimen.editor.isEditingInPlace }
    }
}

@MainActor
let renameErrorPage = assistPage("assist-rename-error", title: "Rename to a keyword: a plain sentence, the name still editable",
                                 prepare: renameToKeyword)

@MainActor
private func renameToKeyword(_ specimen: EditorSpecimen) async {
    await openReady(specimen, "hub/hub.go", line: 48)
    place(specimen, line: 48, column: 15)
    await startRename(specimen)
    let editor = specimen.editor
    editor.textView.insertText("func", replacementRange: editor.caretRange)
    press(editor, "\r", key: Keys.returnKey)
    await Wait.pause(.seconds(3))
}

@MainActor
let snippetPage = assistPage("assist-snippet", title: "Accepting a for-range template selects its first stop",
                             note: "Tab walks to the collection, then into the body.") { specimen in
    let fake = ScriptedIntelligence()
    let loop = Snippet(parsing: "for ${1:_}, ${2:message} := range ${3:messages} {\n\t$0\n}")
    fake.items = [CompletionItem(label: "forr", kind: .snippet, tail: " for range", text: loop.text, stops: loop.stops, )]
    await openReady(specimen, "main.go", line: 31)
    specimen.editor.intelligence = fake
    insertLine(specimen, after: 30, "\tforr")
    place(specimen, line: 31, column: Int.max)
    await showUntilPanel(specimen, .showCompletions)
    press(specimen.editor, "\r", key: Keys.returnKey)
    press(specimen.editor, "\t", key: Keys.tab)
    print("snippet:", lineText(specimen.editor, 31), "selected:",
          specimen.editor.shownText.substring(with: specimen.editor.caretRange))
}

@MainActor
let callPage = assistPage("assist-call", title: "Accepting Submit inserts h.Submit() with the caret inside",
                          note: "Parameter info opens at once; no placeholders are typed for the arguments.") { specimen in
    await openReady(specimen, "main.go", line: 31)
    insertLine(specimen, after: 30, "\th.Sub")
    place(specimen, line: 31, column: Int.max)
    await showUntilPanel(specimen, .showCompletions)
    press(specimen.editor, "\r", key: Keys.returnKey)
    _ = await Wait.until(.seconds(10)) { panels(specimen) >= 1 }
    print("call:", lineText(specimen.editor, 31), "caret column:",
          specimen.editor.position(at: specimen.editor.caretRange.location)?.column ?? -1)
}

@MainActor private var actionLogs: [NSTextField] = []

@MainActor
let actionsPage = GalleryPage(name: "assist-actions", settle: 0.6, prepare: {
    guard actionSpecimens.count == 2 else { return }
    let go = actionSpecimens[0]
    await openReady(go, "main.go", line: 31)
    insertLine(go, after: 30, "\tfmt.Println(strings.ToUpper(\"x\"))")
    place(go, line: 31, column: 6)
    let ts = actionSpecimens[1]
    await openReady(ts, "src/channels/webhook.ts", line: 18)
    place(ts, line: 18, column: 10)
    for (index, specimen) in actionSpecimens.enumerated() {
        await showActions(specimen, into: actionLogs[index])
    }
    for specimen in actionSpecimens { await specimen.shutdown() }
}, build: {
    actionSpecimens = [EditorSpecimen(fixture: "notifyhub-go"), EditorSpecimen(fixture: "notifyhub-ts")]
    actionLogs = actionSpecimens.map { _ in
        let label = NSTextField(wrappingLabelWithString: "")
        label.font = TextStyle.code.font()
        label.textColor = Palette.contentPrimary
        return label
    }
    return Gallery.page([
        Gallery.section("Go: a lightbulb on a line with a quick fix", [actionSpecimens[0].card, Gallery.sized(actionLogs[0], width: 860, height: 150)]),
        Gallery.section("TypeScript", [actionSpecimens[1].card, Gallery.sized(actionLogs[1], width: 860, height: 150)]),
    ])
})

@MainActor private var actionSpecimens: [EditorSpecimen] = []

@MainActor
private func showActions(_ specimen: EditorSpecimen, into log: NSTextField) async {
    let editor = specimen.editor
    guard let ruler = editor.scrollView.verticalRulerView as? LineNumberRuler, let url = editor.url,
          let line = editor.lineIndex?.line(at: editor.caretRange.location)
    else { return }
    _ = await Wait.until(.seconds(30)) { !specimen.service.diagnostics(for: url).isEmpty }
    await Wait.pause(.seconds(1))
    editor.textView.setSelectedRange(NSRange(location: editor.caretRange.location + 1, length: 0))
    editor.textView.setSelectedRange(NSRange(location: editor.caretRange.location - 1, length: 0))
    _ = await Wait.until(.seconds(15)) { ruler.lightbulb()?.line == line }
    guard let index = editor.lineIndex, let range = editor.span(of: index.range(of: line, length: editor.shownText.length)) else { return }
    let actions = await specimen.service.actions(in: range, of: url)
    let titles = ActionsFeature.items(for: actions) { _ in }.map { $0.kind == .separator ? "———" : $0.title }
    var lines = ["lightbulb on line \(line + 1): \(ruler.lightbulb() != nil)", "menu: " + titles.joined(separator: " | ")]
    if let fix = actions.first(where: { $0.kind == .quickFix && $0.disabledReason.isEmpty }) {
        let result = await specimen.service.perform(fix)
        _ = await Wait.until(.seconds(5)) { editor.revision > 0 }
        await Wait.pause(.seconds(1))
        lines.append("applied “\(fix.title)”: \(String(describing: result)); the file now imports strings: \(editor.shownText.range(of: "\"strings\"").location != NSNotFound)")
    }
    for line in lines { print(line) }
    log.stringValue = lines.joined(separator: "\n")
}

@MainActor
let navigationPage = assistPage("assist-navigation", title: "Command over Submit, and Find Usages on main, which has none",
                                prepare: commandHover)

@MainActor
private func commandHover(_ specimen: EditorSpecimen) async {
    await openReady(specimen, "main.go", line: 12)
    place(specimen, line: 12, column: 6)
    await Wait.pause(.seconds(1))
    await showUntilPanel(specimen, .findUsages)
    let editor = specimen.editor
    guard let offset = editor.offset(of: TextPosition(line: 26, column: 14)),
          let navigation = feature(editor, NavigationFeature.self),
          let rect = editor.rects(for: NSRange(location: offset, length: 1)).first
    else { return }
    let point = NSPoint(x: rect.midX, y: rect.midY)
    for _ in 0..<60 where navigation.underlined == nil {
        navigation.pointerMoved(to: point, offset: offset, modifiers: [.command])
        await Wait.pause(.milliseconds(300))
    }
}

@MainActor
let assistLogicPage = GalleryPage(name: "assist-logic", settle: 0.2, prepare: {
    guard let specimen = assistSpecimen else { return }
    var lines = AssistChecks.ranking() + AssistChecks.stops()
    lines += await AssistChecks.accepting(specimen)
    await specimen.shutdown()
    for line in lines { print(line) }
    logicView?.stringValue = lines.joined(separator: "\n")
}, build: {
    let specimen = EditorSpecimen(fixture: "notifyhub-go")
    assistSpecimen = specimen
    let label = NSTextField(wrappingLabelWithString: "")
    label.font = TextStyle.code.font()
    label.textColor = Palette.contentPrimary
    logicView = label
    return Gallery.page([
        Gallery.section("Ranking, stops and commit characters", [Gallery.sized(label, width: 1000, height: 760)]),
        Gallery.section("Editor under a fake service", [specimen.card]),
    ])
})

@MainActor private var logicView: NSTextField?

@MainActor
private enum AssistChecks {
    static let candidates = ["Submit", "submitAll", "Stats", "stats", "isSubmitted", "SubmitBatch", "summit", "toString",
                             "setTimeout", "subscribeTo", "StatusText", "newStats"]

    static func ranking() -> [String] {
        var ranking = CompletionRanking(filters: candidates, sorts: candidates)
        return ["sub", "Sub", "sT", "st", "smt", "nS", ""].map { query in
            ranking.rank(Array(query.utf16))
            let shown = ranking.visible.map { item -> String in
                let name = candidates[Int(item)]
                let match = ranking.match(ofItem: Int(item)).map { "\($0)" } ?? "?"
                let marks = CompletionRanking.matchedRanges(of: query, in: name).map { "\($0.location)+\($0.length)" }
                return "\(name)[\(match.prefix(1))\(marks.isEmpty ? "" : " " + marks.joined(separator: ","))]"
            }
            return "rank \"\(query)\": " + shown.joined(separator: "  ")
        }
    }

    static func stops() -> [String] {
        let stops = [CompletionItem.Stop(utf16Offset: 7, utf16Length: 4), CompletionItem.Stop(utf16Offset: 13, utf16Length: 9)]
        guard var session = SnippetStops(base: 100, length: 23, stops: stops) else { return ["stops: none"] }
        var out = ["stops at start: \(describe(session)) selection \(session.selection)"]
        let typed = session.follow(edit: NSRange(location: 107, length: 1), delta: -3)
        out.append("typed x over stop 1: alive \(typed) \(describe(session))")
        _ = session.move(by: 1)
        out.append("tab: selection \(session.selection) last \(session.isAtLast)")
        _ = session.move(by: 1)
        out.append("tab: selection \(session.selection) last \(session.isAtLast)")
        out.append("shift-tab past the first: \(session.move(by: -5).map { "\($0)" } ?? "stays")")
        var outside = session
        out.append("edit outside the current stop ends it: \(!outside.follow(edit: NSRange(location: 90, length: 1), delta: 1))")
        out.append("format follows the caret: \(ActionsFeature.follow(20, through: [(NSRange(location: 0, length: 4), 1), (NSRange(location: 18, length: 4), 2)]))")
        return out
    }

    private static func describe(_ session: SnippetStops) -> String {
        session.ranges.map { "\($0.location)+\($0.length)" }.joined(separator: " ")
    }

    static func accepting(_ specimen: EditorSpecimen) async -> [String] {
        let fake = ScriptedIntelligence()
        let editor = specimen.editor
        editor.intelligence = fake
        specimen.open("main.go", at: 31)
        let url = specimen.url("main.go").standardizedFileURL
        _ = await Wait.until { editor.url == url }
        var out: [String] = []
        insertLine(specimen, after: 30, "\tre")
        place(specimen, line: 31, column: Int.max)
        editor.perform(.showCompletions)
        _ = await Wait.until(.seconds(5)) { panels(specimen) >= 1 }
        out.append("list for \"re\": \(visibleRows(specimen)) rows")
        press(editor, "c", key: Keys.c)
        out.append("typed c, list for \"rec\": \(visibleRows(specimen)) rows, \(fake.asked.count) requests so far")
        press(editor, "\u{7F}", key: Keys.delete)
        out.append("backspace, list for \"re\": \(visibleRows(specimen)) rows")
        press(editor, "\r", key: Keys.returnKey)
        out.append("accept record: \"\(lineText(editor, 31))\" selected \"\(editor.shownText.substring(with: editor.caretRange))\"")
        press(editor, "x", key: Keys.x)
        out.append("type x: \"\(lineText(editor, 31))\" caret column \(editor.position(at: editor.caretRange.location)?.column ?? -1)")
        press(editor, "\t", key: Keys.tab)
        out.append("tab: selected \"\(editor.shownText.substring(with: editor.caretRange))\"")
        press(editor, "\u{19}", key: Keys.tab, modifiers: .shift)
        out.append("shift-tab: selected \"\(editor.shownText.substring(with: editor.caretRange))\"")
        press(editor, "\t", key: Keys.tab)
        press(editor, "\t", key: Keys.tab)
        out.append("tab, tab: caret column \(editor.position(at: editor.caretRange.location)?.column ?? -1) of \"\(lineText(editor, 31))\"")
        press(editor, "\t", key: Keys.tab)
        out.append("tab after the last stop types a tab: \"\(lineText(editor, 31).replacingOccurrences(of: "\t", with: "→"))\"")
        insertLine(specimen, after: 31, "\tres")
        place(specimen, line: 32, column: Int.max)
        _ = await Wait.until(.seconds(5)) { panels(specimen) == 0 }
        editor.perform(.showCompletions)
        _ = await Wait.until(.seconds(5)) { panels(specimen) >= 1 }
        press(editor, "q", key: Keys.q)
        out.append("typed q, nothing matches \"resq\": list shown \(visibleRows(specimen) > 0)")
        press(editor, "\u{7F}", key: Keys.delete)
        editor.perform(.showCompletions)
        _ = await Wait.until(.seconds(5)) { visibleRows(specimen) > 0 }
        let before = fake.asked.count
        press(editor, ".", key: Keys.period)
        out.append("commit with .: \"\(lineText(editor, 32))\"")
        _ = await Wait.until(.seconds(2)) { fake.asked.count > before }
        out.append("asked after .: \(fake.asked.last.map { "\($0)" } ?? "no")")
        for child in editor.view.window?.childWindows ?? [] { child.orderOut(nil) }
        return out
    }
}

@MainActor
private final class ScriptedIntelligence: LanguageIntelligence {
    var onEvent: ((IntelligenceEvent) -> Void)?
    var applyEdit: ((WorkspaceEdit) async -> Bool)?
    var asked: [CompletionTrigger] = []
    var items = [
        CompletionItem(label: "record", kind: .method, tail: "(name string, delivered bool)", text: "record(name, delivered)",
                       stops: [.init(utf16Offset: 7, utf16Length: 4), .init(utf16Offset: 13, utf16Length: 9)]),
        CompletionItem(label: "result", kind: .variable, type: "Stats", commitCharacters: ["."]),
        CompletionItem(label: "Register", kind: .method, tail: "(channel Channel)"),
    ]

    func handles(_ url: URL) -> Bool { true }
    func status(for url: URL) -> ServerStatus? { ServerStatus(name: "fake", state: .ready) }
    func triggers(for url: URL) -> (completion: Set<String>, signature: Set<String>) { (["."], ["(", ","]) }
    func open(_ url: URL, text: String) {}
    func change(_ url: URL, range: TextSpan, text: String) {}
    func save(_ url: URL) {}
    func close(_ url: URL) {}
    func filesDidChange(_ urls: [URL]) {}
    func diagnostics(for url: URL) -> [Diagnostic] { [] }
    var filesWithDiagnostics: [URL] { [] }

    func completions(at position: TextPosition, in url: URL, trigger: CompletionTrigger) async -> CompletionList {
        asked.append(trigger)
        return CompletionList(items: items)
    }

    func resolve(_ item: CompletionItem) async -> CompletionItem { item }
    func hover(at position: TextPosition, in url: URL) async -> Hover? { nil }
    func signatureHelp(at position: TextPosition, in url: URL) async -> SignatureHelp? { nil }
    func locations(_ query: LocationQuery, at position: TextPosition, in url: URL) async -> [FileLocation] { [] }
    func highlights(at position: TextPosition, in url: URL) async -> [TextSpan] { [] }
    func symbols(in url: URL) async -> [DocumentSymbol] { [] }
    func symbols(matching query: String) async -> [WorkspaceSymbol] { [] }
    func inlayHints(in range: TextSpan, of url: URL) async -> [InlayHint] { [] }
    func semanticTokens(for url: URL) async -> SemanticTokens? { nil }
    func renameTarget(at position: TextPosition, in url: URL) async -> RenameTarget? { nil }
    func rename(at position: TextPosition, in url: URL, to name: String) async -> Result<WorkspaceEdit, IntelligenceFailure> {
        .failure(IntelligenceFailure("fake"))
    }
    func actions(in range: TextSpan, of url: URL) async -> [CodeAction] { [] }
    func perform(_ action: CodeAction) async -> Result<Void, IntelligenceFailure> { .success(()) }
    func formatting(for url: URL, indent: Int, usesTabs: Bool) async -> [TextEdit] { [] }
}

@MainActor
private var askEditors: [EditorViewController] = []

@MainActor
let hoverAskPage = GalleryPage(name: "assist-hover-ask") {
    let root = EditorSpecimen.fixtures.appendingPathComponent("notifyhub-go", isDirectory: true)
    let url = root.appendingPathComponent("hub/hub.go")
    let editor = EditorViewController(workspace: Workspace(root: root))
    askEditors.append(editor)
    editor.onAskAgent = { _ in }
    editor.view.frame = NSRect(origin: .zero, size: EditorSpecimen.size)
    editor.open(url, preview: false)
    editor.fill(editor.nextID - 1, with: FileIO.load(url, language: Language.detect(url)))
    guard let hover = feature(editor, HoverFeature.self) else { return NSView() }
    let problem = Diagnostic(range: TextSpan(start: TextPosition(line: 79, column: 9), end: TextPosition(line: 79, column: 14)),
                             severity: .warning, message: "possible nil pointer dereference", source: "staticcheck", code: "SA5011")
    let size = hover.fill(markdown: "```\nfunc (h *Hub) describe(c *Client) string\n```\ndescribe returns a one-line summary of a client.",
                          problems: [problem])
    let surface = FloatingSurface(radius: Radius.card)
    guard let content = hover.content else { return NSView() }
    content.translatesAutoresizingMaskIntoConstraints = false
    surface.addSubview(content)
    NSLayoutConstraint.activate([
        content.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
        content.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
        content.topAnchor.constraint(equalTo: surface.topAnchor),
        content.bottomAnchor.constraint(equalTo: surface.bottomAnchor),
    ])
    return Gallery.page([Gallery.section("Problem hover with Ask Nyte", note: "Ask Nyte hands the problem to the agent as context.",
                                         [Gallery.sized(surface, width: size.width, height: size.height)])])
}

@MainActor
private var catchingUp: EditorViewController?

@MainActor
let catchingUpPage = GalleryPage(name: "editor-large", settle: 0.1, prepare: {
    guard let editor = catchingUp, let url = catchingUpFile() else { return }
    editor.open(url, preview: false)
    _ = await Wait.until { editor.shown != nil }
    editor.textView.moveToEndOfDocument(nil)
}, build: {
    let editor = EditorViewController(workspace: Workspace(root: FileManager.default.temporaryDirectory))
    catchingUp = editor
    let card = PaneCard()
    card.embed(editor.view)
    card.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
        card.widthAnchor.constraint(equalToConstant: EditorSpecimen.size.width),
        card.heightAnchor.constraint(equalToConstant: EditorSpecimen.size.height),
    ])
    return Gallery.page([Gallery.section("Move to End right after opening 300,000 lines",
                                         note: "The last lines are drawn at their rows at once; there is no layout to wait for.",
                                         [card])])
})

@MainActor
private func catchingUpFile() -> URL? {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-gallery-catching-up.go")
    let unit = "func build(name string, count int) string {\n\treturn fmt.Sprintf(\"%s-%d\", name, count)\n}\n\n"
    let text = "package main\n\nimport \"fmt\"\n\n" + String(repeating: unit, count: 75_000)
    guard (try? text.write(to: url, atomically: true, encoding: .utf8)) != nil else { return nil }
    return url
}

@MainActor
let editorAssistPages: [GalleryPage] = [
    completionGoPage, completionTSPage, completionFilteredPage, signaturePage, hoverDocumentationPage, hoverProblemPage, hoverAskPage,
    catchingUpPage,
    renamePage, renameErrorPage, snippetPage, callPage, actionsPage, navigationPage, assistLogicPage,
]
