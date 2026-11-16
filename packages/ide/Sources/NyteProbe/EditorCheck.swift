import AppKit
import NyteCore
@testable import NyteEditor
@testable import NyteLanguage
import NyteUI

@MainActor final class EditorCheck {
    static let randomEdits = 10_000
    static let lexerEdits = 400
    static let fragments = ["/*", "*/", "`", "\"", "'", "\n", "x", "//", "${", "}", " ", "\n\n", "\\"]
    static let goSource = "package main\n\nimport \"fmt\"\n\n/* a block\n   comment */\nfunc main() {\n\ts := `raw\nstring`\n\tfmt.Println(s, \"done\") // tail\n}\n"
    static let typeScriptSource = "const a = `template ${1 + 2}\nnext`\n/* open\n*/\nfunction f(x: string): string {\n  return x + '!' // c\n}\n"
    var failures = 0
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-editor-check", isDirectory: true)
    var kept: [EditorViewController] = []
    let window = OffscreenWindow(contentRect: EditorBench.pane, styleMask: [.borderless], backing: .buffered, defer: true)

    func expect(_ passed: Bool, _ label: String, _ saw: @autoclosure () -> String = "") {
        if passed { return print("ok   \(label)") }
        failures += 1
        print("FAIL \(label)\n     saw: \(saw())")
    }

    func run() async -> Int {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        for check in [lineIndex, fileFormats, lineEditing, completion, inlayLabels, renameMessages, indentGuides, actionMenu] {
            check()
        }
        await lexer(Self.goSource, file: "check.go")
        await lexer(Self.typeScriptSource, file: "check.ts")
        await undo()
        await inputMethod()
        await inlineRename()
        validation()
        await hooks()
        await preferences()
        await carets()
        assistAtCarets()
        foldRegions()
        foldMap()
        await viewFolding()
        await findBar()
        engineModel()
        engineViewChecks()
        await agentContext()
        await shellCalls()
        await tabSwitch()
        await geometry()
        return failures
    }

    func lineIndex() {
        var random = Xorshift(state: 0x9E37_79B9_7F4A_7C15)
        let text = NSMutableString(string: "alpha\nbeta\n\ngamma")
        var lines = indexOf(text)
        for _ in 0..<Self.randomEdits {
            let location = random.next(text.length + 1)
            let removed = random.next(min(8, text.length - location) + 1)
            let inserted = (0..<random.next(6)).map { _ in ["a", "\n", "b", " ", "\n\n"][random.next(5)] }.joined()
            text.replaceCharacters(in: NSRange(location: location, length: removed), with: inserted)
            let units = Array(inserted.utf16)
            _ = units.withUnsafeBufferPointer { lines.replace(location: location, oldLength: removed, inserted: $0) }
        }
        let rebuilt = indexOf(text)
        let same = lines.count == rebuilt.count && (0..<rebuilt.count).allSatisfy { lines.start(of: $0) == rebuilt.start(of: $0) }
        expect(same, "LineIndex after \(Self.randomEdits) random edits equals an index rebuilt from the text",
               "\(lines.count) lines against \(rebuilt.count)")
    }

    func indexOf(_ text: NSString) -> LineIndex { Array((text as String).utf16).withUnsafeBufferPointer { LineIndex($0) } }

    func openEditor(_ text: String, file: String) async -> EditorViewController {
        let url = folder.appendingPathComponent(file)
        try? text.write(to: url, atomically: true, encoding: .utf8)
        let editor = EditorViewController(workspace: Workspace(root: folder))
        window.contentView = editor.view
        editor.view.layoutSubtreeIfNeeded()
        window.makeFirstResponder(editor.textView)
        kept.append(editor)
        editor.open(url, preview: false)
        while editor.shown == nil { await Task.yield() }
        return editor
    }

    func lexer(_ source: String, file: String) async {
        let editor = await openEditor(source, file: file)
        var random = Xorshift(state: UInt64(source.utf16.count) &* 0x2545_F491_4F6C_DD1D)
        for _ in 0..<Self.lexerEdits {
            let length = editor.shownText.length
            let location = random.next(length + 1)
            let removed = random.next(min(3, length - location) + 1)
            editor.replaceUntracked(NSRange(location: location, length: removed), with: Self.fragments[random.next(Self.fragments.count)])
        }
        guard let document = editor.shown else { return expect(false, "\(file): the document stays open") }
        let full = TextStore(editor.shownText.string, language: document.language).lines
        let mismatch = (0..<full.count).first {
            document.lines.start(of: $0) != full.start(of: $0) || document.lines.entryState(of: $0) != full.entryState(of: $0)
        }
        expect(document.lines.count == full.count && mismatch == nil,
               "\(document.language.name): incremental lexer states equal a full relex after \(Self.lexerEdits) random edits",
               "first difference on line \(mismatch ?? -1)")
    }

    func fileFormats() {
        let cases: [(String, [UInt8], [UInt8], (TextFormat) -> Bool)] = [
            ("UTF-8", Array("héllo\nworld\n".utf8), Array("héllo\nworld\n".utf8), { $0.encoding == .utf8 && !$0.hasBOM }),
            ("UTF-8 with BOM", [0xEF, 0xBB, 0xBF] + Array("a\nb".utf8), [0xEF, 0xBB, 0xBF] + Array("a\nb".utf8), { $0.hasBOM }),
            ("UTF-16", [0xFF, 0xFE] + Array("hi\n".utf16).flatMap { [UInt8($0 & 0xFF), UInt8($0 >> 8)] },
             [0xFF, 0xFE] + Array("hi\n".utf16).flatMap { [UInt8($0 & 0xFF), UInt8($0 >> 8)] }, { _ in true }),
            ("CRLF", Array("a\r\nb\r\n".utf8), Array("a\r\nb\r\n".utf8), { $0.lineEnding == .crlf }),
            ("mixed endings, CRLF in the majority", Array("a\r\nb\nc\r\n".utf8), Array("a\r\nb\r\nc\r\n".utf8), { $0.lineEnding == .crlf }),
        ]
        for (name, bytes, expected, format) in cases {
            let url = folder.appendingPathComponent("format.txt")
            try? Data(bytes).write(to: url)
            guard case .text(let decoded) = FileIO.load(url, language: .plain).content else {
                expect(false, "FileIO decodes \(name)", "not text")
                continue
            }
            let saved = FileIO.save(decoded.text, format: decoded.format, to: url)
            let written = (try? Data(contentsOf: url)).map(Array.init) ?? []
            let lone = decoded.text.contains("\r")
            expect(format(decoded.format) && !lone && written == expected && (try? saved.get()) != nil,
                   "FileIO round trips \(name)", "\(decoded.format) wrote \(written)")
        }
        let large = folder.appendingPathComponent("large.txt")
        FileManager.default.createFile(atPath: large.path, contents: nil)
        let handle = try? FileHandle(forWritingTo: large)
        try? handle?.truncate(atOffset: UInt64(FileIO.largestOpenableBytes + 1))
        try? handle?.close()
        let refused = if case .tooLarge(let limit) = FileIO.load(large, language: .plain).content { limit } else { 0 }
        expect(refused == FileIO.largestOpenableBytes, "FileIO refuses a file one byte over the limit and names the limit")
        let binary = folder.appendingPathComponent("binary.bin")
        try? Data([0x50, 0x00, 0x01]).write(to: binary)
        let isBinary = if case .binary = FileIO.load(binary, language: .plain).content { true } else { false }
        expect(isBinary, "FileIO shows a file with NUL bytes as binary")
    }

    func lineEditing() {
        let detect = { (text: String) in FileIO.indent(TextStore(text)) ?? Indent(usesTabs: false, width: 4) }
        expect(detect("a {\n\tb\n\t\tc\n}\n").usesTabs, "indentation: tabs are detected")
        expect(detect("a:\n  b:\n    c\n  d\n") == Indent(usesTabs: false, width: 2), "indentation: two-space steps are detected",
               "\(detect("a:\n  b:\n    c\n  d\n"))")
        let tabbed = TextCommands.tab(SelectionSet(caret: 3), in: TextStore("  ab"), context: EditContext())
        expect(tabbed.replacements.map(\.text) == [Array(" ".utf16)], "Tab at column 3 inserts one space")
        expect(Indentation.leadingWhitespace(before: 5, in: "\tx\n  y" as NSString) == "  ", "Return keeps the line's leading whitespace")
    }

    func completion() {
        let names = ["Submit", "submitAll", "Stats", "stats", "isSubmitted", "SubmitBatch", "summit", "subscribeTo"]
        var ranking = CompletionRanking(filters: names, sorts: names)
        ranking.rank(Array("sub".utf16))
        let shown = ranking.visible.map { names[Int($0)] }
        expect(shown.prefix(2) == ["submitAll", "subscribeTo"] && shown.dropFirst(2).prefix(2) == ["Submit", "SubmitBatch"],
               "completion: exact-case prefixes rank before folded prefixes", "\(shown)")
        expect(!shown.contains("Stats") && shown.contains("isSubmitted"), "completion: filtering keeps word starts and drops non-matches",
               "\(shown)")
        let snippet = Snippet(parsing: "Submit(${1:ctx}, ${2:message})$0")
        expect(snippet.text == "Submit(ctx, message)" && snippet.stops.map(\.utf16Offset) == [7, 12, 20],
               "snippet parsing yields the text and its stops", "\(snippet.text) \(snippet.stops)")
        let method = CompletionItem(label: "Submit", kind: .method, tail: "(ctx context.Context)", text: snippet.text,
                                    stops: snippet.stops, commitCharacters: ["."])
        expect(CompletionCommit.decide(method, typed: ".") == .acceptAsTextThenType, "a snippet item accepts on its commit character")
        expect(CompletionInsert.decide(method, committing: false) == .call(name: "Submit", takesArguments: true),
               "accepting a method inserts the name and parentheses, caret inside")
        expect(CompletionInsert.decide(method, committing: true) == .plain("Submit"), "committing a method inserts only its name")
        let stats = CompletionItem(label: "Stats", kind: .method, tail: "()", text: "Stats()")
        expect(CompletionInsert.decide(stats, committing: false) == .call(name: "Stats", takesArguments: false),
               "a callable with no parameters puts the caret after the parentheses")
        let loop = Snippet(parsing: "for ${1:i} := range ${2:items} {\n\t$0\n}")
        let template = CompletionItem(label: "forr", kind: .snippet, text: loop.text, stops: loop.stops)
        expect(CompletionInsert.decide(template, committing: false) == .snippet, "a keyword template keeps its stops")
        let indented = SnippetIndent.indented(loop.text, stops: loop.stops, by: "\t")
        expect(indented.text.hasSuffix("{\n\t\t\n\t}") && indented.stops.last?.utf16Offset == (indented.text as NSString).length - 3,
               "a multi-line template is indented to the line it is accepted on", indented.text.debugDescription)
    }

    func inlayLabels() {
        let text: NSString = "record(name, true)"
        let name = InlayHint(position: TextPosition(line: 0, column: 7), label: "name:", kind: .parameter)
        let flag = InlayHint(position: TextPosition(line: 0, column: 13), label: "delivered:", kind: .parameter)
        expect(InlayLabel.shown(name, argumentAt: 7, in: text) == nil, "a parameter chip naming its own argument is dropped")
        expect(InlayLabel.shown(flag, argumentAt: 13, in: text) == "delivered:", "a parameter chip for a literal stays")
        let long = InlayLabel.elided("map[string][]notify.Message", limit: InlayLabel.longestLabel)
        expect(long.count == InlayLabel.longestLabel && long.contains("…") && long.hasPrefix("map[") && long.hasSuffix("Message"),
               "a chip past 24 characters is elided in the middle", long)
    }

    func renameMessages() {
        let keyword = RenameMessage.plain("invalid identifier to rename: \"func\"", name: "func", language: "Go", keywords: ["func"])
        expect(keyword == "“func” is a Go keyword. Choose another name.", "rename: a keyword gets a plain sentence", keyword)
        expect(RenameMessage.plain("odd", name: "x", language: "Go", keywords: []) == "odd", "rename: an unknown error falls back to the server's message")
        expect(RenameMessage.plain("You cannot rename this element.", name: "x", language: "TypeScript", keywords: [])
            == "This symbol can’t be renamed.", "rename: tsserver's refusal reads plainly")
    }

    func indentGuides() {
        var depths = [0, 4, IndentGuides.blank, 8, 4, 0]
        IndentGuides.fillBlanks(&depths)
        expect(depths == [0, 4, 4, 8, 4, 0], "indent guides run through blank lines at the shallower neighbour", "\(depths)")
        let scope = IndentGuides.scope(of: 3, depths: depths, step: 4)
        expect(scope?.column == 4 && scope?.lines == 3...3, "the caret's scope guide is its own block", "\(String(describing: scope))")
    }

    func actionMenu() {
        let go = [CodeAction(title: "Extract function", kind: .extract), CodeAction(title: "Remove unused variable", kind: .quickFix),
                  CodeAction(title: "Organize Imports", kind: .organizeImports), CodeAction(title: "Fill struct", kind: .rewrite, isPreferred: true)]
        let titles = ActionsFeature.items(for: go) { _ in }.map { $0.kind == .separator ? "—" : $0.title }
        expect(titles == ["Remove unused variable", "—", "Fill struct", "Extract function", "—", "Organize Imports"],
               "Go actions: fixes, then refactorings with the preferred first, then source actions", "\(titles)")
        let ts = [CodeAction(title: "Move to a new file", kind: .refactor, disabledReason: "Selection is not a declaration"),
                  CodeAction(title: "Add missing import", kind: .quickFix, isPreferred: true)]
        let items = ActionsFeature.items(for: ts) { _ in }
        expect(items.map(\.title) == ["Add missing import", "", "Move to a new file"] && items.last?.isEnabled == false,
               "TypeScript actions: a disabled refactoring stays listed, dimmed", "\(items.map(\.title))")
    }

    func settle(_ condition: () -> Bool) async {
        let deadline = ContinuousClock.now + .seconds(2)
        while !condition(), ContinuousClock.now < deadline { await Task.yield() }
    }

    static func finishEvent() {
        RunLoop.current.run(until: Date())
    }

    func undo() async {
        let editor = await openEditor("package main\n\nfunc main() {\n\tSub\n}\n", file: "undo.go")
        let quiet = QuietIntelligence()
        editor.intelligence = quiet
        guard let undo = editor.shown?.undo else { return expect(false, "undo: the document opens") }
        let event = { (body: () -> Void) in
            body()
            Self.finishEvent()
        }
        let original = editor.shownText.string
        let caret = NSRange(location: 14, length: 0)
        editor.textView.setSelectedRange(caret)
        for character in "hello" { event { editor.textView.keyDown(with: EditorBench.key(String(character))) } }
        let typed = editor.shownText.substring(with: NSRange(location: 14, length: 5))
        undo.undo()
        expect(typed == "hello" && editor.shownText.string == original, "undo removes a typed word in one step",
               "typed \(typed.debugDescription), after undo \(editor.shownText.string.debugDescription)")
        let line = editor.shownText.range(of: "Sub")
        editor.textView.setSelectedRange(NSRange(location: NSMaxRange(line), length: 0))
        let before = editor.textView.selectedRange()
        guard let span = editor.span(of: line) else { return expect(false, "undo: the word has a span") }
        event {
            editor.edit([TextEdit(range: span, text: "Submit()")])
            editor.textView.setSelectedRange(NSRange(location: line.location + 7, length: 0))
        }
        undo.undo()
        expect(editor.shownText.string == original && editor.textView.selectedRange() == before,
               "undo after an accepted completion restores text and caret in one step",
               "\(editor.shownText.string.debugDescription) \(editor.textView.selectedRange())")
        let url = editor.url ?? folder
        let rename = WorkspaceEdit(files: [WorkspaceEdit.File(url: url, edits: [
            TextEdit(range: TextSpan(start: TextPosition(line: 2, column: 5), end: TextPosition(line: 2, column: 9)), text: "start"),
            TextEdit(range: TextSpan(start: TextPosition(line: 3, column: 1), end: TextPosition(line: 3, column: 4)), text: "Send"),
        ])])
        editor.textView.setSelectedRange(before)
        _ = await editor.apply(rename)
        Self.finishEvent()
        let renamed = editor.shownText.string
        undo.undo()
        expect(renamed.contains("func start()") && editor.shownText.string == original && editor.textView.selectedRange() == before,
               "undo after a rename restores text and caret in one step", editor.shownText.string.debugDescription + " \(editor.textView.selectedRange())")
    }

    static func lineText(_ editor: EditorViewController, at offset: Int) -> String {
        let store = editor.textView.store
        let line = store.line(at: offset)
        let end = line + 1 < store.lineCount ? store.lineRange(line + 1).location : store.length
        return store.string(NSRange(location: store.lineRange(line).location, length: end - store.lineRange(line).location))
    }

    func inputMethod() async {
        let editor = await openEditor("package main\n\nfunc main() {\n\t\n}\n", file: "ime.go")
        let quiet = QuietIntelligence()
        editor.intelligence = quiet
        let recorder = RecordingFeature()
        editor.install(recorder)
        let caret = NSRange(location: 28, length: 0)
        editor.textView.setSelectedRange(caret)
        editor.textView.keyDown(with: EditorBench.key("("))
        let paired = Self.lineText(editor, at: caret.location)
        expect(paired == "()\t\n" && recorder.typed == ["("], "an ordinary key pairs and reaches didType", paired.debugDescription)
        recorder.typed.removeAll()
        for _ in 0..<4 { await Task.yield() }
        let asked = (quiet.completionRequests, quiet.signatureRequests)
        editor.textView.setSelectedRange(NSRange(location: 29, length: 0))
        editor.textView.setMarkedText("ka", selectedRange: NSRange(location: 2, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        for _ in 0..<4 { await Task.yield() }
        expect(editor.textView.hasMarkedText() && recorder.typed.isEmpty && quiet.completionRequests == asked.0,
               "marked text is shown and does not reach didType or completion", "\(recorder.typed) \(quiet.completionRequests)")
        editor.textView.insertText("[", replacementRange: NSRange(location: NSNotFound, length: 0))
        for _ in 0..<4 { await Task.yield() }
        let line = Self.lineText(editor, at: caret.location)
        expect(!editor.textView.hasMarkedText() && line == "([)\t\n" && recorder.typed.isEmpty
            && quiet.completionRequests == asked.0 && quiet.signatureRequests == asked.1,
               "committing a composition inserts once, with no pairing, completion or signature help",
               "\(line.debugDescription) typed \(recorder.typed)")
        expect(!TypingDecision.reachesFeatures(isKeyPress: true, commitsComposition: true)
            && !TypingDecision.reachesFeatures(isKeyPress: false, commitsComposition: false)
            && TypingDecision.reachesFeatures(isKeyPress: true, commitsComposition: false),
               "only a key press that does not commit a composition reaches the features")
    }

    func inlineRename() async {
        let source = "package main\n\nfunc run() {}\n\nfunc main() {\n\trun()\n\trun()\n}\n"
        let editor = await openEditor(source, file: "rename.go")
        let quiet = QuietIntelligence()
        quiet.occurrences = [(2, 5), (5, 1), (6, 1)].map { TextSpan(start: TextPosition(line: $0.0, column: $0.1),
                                                                    end: TextPosition(line: $0.0, column: $0.1 + 3)) }
        editor.intelligence = quiet
        let caret = NSRange(location: 21, length: 0)
        editor.textView.setSelectedRange(caret)
        editor.perform(.rename)
        await settle { editor.isEditingInPlace }
        for character in "go" { editor.textView.keyDown(with: EditorBench.key(String(character))); Self.finishEvent() }
        await settle { editor.shownText.string.components(separatedBy: "go").count == 4 }
        let live = editor.shownText.string
        editor.textView.keyDown(with: EditorBench.key("\u{1B}"))
        expect(live == source.replacingOccurrences(of: "run", with: "go") && editor.shownText.string == source
            && editor.textView.selectedRange() == caret && editor.shown?.undo.canUndo == false,
               "inline rename mirrors typing into the occurrences, and Escape restores the text and caret with nothing to undo",
               live.debugDescription)
        editor.perform(.rename)
        await settle { editor.isEditingInPlace }
        editor.textView.setMarkedText("s", selectedRange: NSRange(location: 1, length: 0),
                                      replacementRange: NSRange(location: NSNotFound, length: 0))
        editor.textView.keyDown(with: EditorBench.key("\r"))
        expect(editor.isEditingInPlace, "Return during a composition in the rename box goes to the input method, not to rename")
        editor.textView.unmarkText()
        editor.textView.keyDown(with: EditorBench.key("\u{1B}"))
        editor.textView.setSelectedRange(caret)
        editor.perform(.rename)
        await settle { editor.isEditingInPlace }
        for character in "start" { editor.textView.keyDown(with: EditorBench.key(String(character))); Self.finishEvent() }
        editor.textView.keyDown(with: EditorBench.key("\r"))
        await settle { !editor.isEditingInPlace }
        Self.finishEvent()
        let renamed = editor.shownText.string
        editor.shown?.undo.undo()
        expect(renamed == source.replacingOccurrences(of: "run", with: "start") && editor.shownText.string == source
            && editor.textView.selectedRange() == caret, "Return renames through the server, and one undo restores text and caret",
               renamed.debugDescription)
    }

    func validation() {
        let editor = kept.last
        let item = NSMenuItem(title: "Toggle Comment", action: #selector(TextEngineView.toggleLineComment(_:)), keyEquivalent: "/")
        expect(editor?.textView.validateUserInterfaceItem(item) == true, "Toggle Comment is enabled in a Go file")
        let indent = NSMenuItem(title: "Indent", action: #selector(TextEngineView.indentLines(_:)), keyEquivalent: "]")
        editor?.textView.isEditable = false
        expect(editor?.textView.validateUserInterfaceItem(indent) == false, "Indent is disabled when the text is not editable")
        editor?.textView.isEditable = true
        let selector = #selector(NSResponder.performKeyEquivalent(with:))
        expect(class_getMethodImplementation(TextEngineView.self, selector) == class_getMethodImplementation(NSView.self, selector),
               "the text view leaves performKeyEquivalent to the menu")
    }
}
