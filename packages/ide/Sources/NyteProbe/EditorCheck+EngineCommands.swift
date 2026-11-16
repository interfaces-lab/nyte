import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension EditorCheck {
    static let caretTrialsPerCommand = 60
    static let caretSpacing = 4

    typealias EngineCommand = (TextStore, SelectionSet, EditContext) -> TextTransaction?

    static let engineCommands: [(String, EngineCommand)] = {
        var commands: [(String, EngineCommand)] = [
            ("typing a letter", { TextCommands.typing("x", $1, in: $0, context: $2) }),
            ("typing an opening bracket", { TextCommands.typing("(", $1, in: $0, context: $2) }),
            ("typing a quote", { TextCommands.typing("\"", $1, in: $0, context: $2) }),
            ("typing a closing bracket", { TextCommands.typing(")", $1, in: $0, context: $2) }),
            ("Return with indentation", { TextCommands.newline($1, in: $0, context: $2) }),
            ("Tab", { TextCommands.tab($1, in: $0, context: $2) }),
            ("Transpose", { store, set, _ in TextCommands.transposing(set, in: store) }),
            ("Indent", { TextCommands.shiftingLines($1, right: true, in: $0, context: $2) }),
            ("Outdent", { TextCommands.shiftingLines($1, right: false, in: $0, context: $2) }),
            ("Move Line Up", { store, set, _ in TextCommands.movingLines(set, up: true, in: store) }),
            ("Move Line Down", { store, set, _ in TextCommands.movingLines(set, up: false, in: store) }),
            ("Duplicate Lines", { store, set, _ in TextCommands.duplicatingLines(set, in: store) }),
            ("Delete Lines", { store, set, _ in TextCommands.deletingLines(set, in: store) }),
            ("Toggle Comment", { TextCommands.togglingComment($1, in: $0, context: $2) }),
            ("paste", { store, set, _ in TextCommands.pasting("pasted", set, in: store) }),
        ]
        for deletion in TextCommands.Deletion.allCases {
            commands.append(("delete \(deletion)", { TextCommands.deleting($1, deletion, in: $0, context: $2) }))
        }
        return commands
    }()

    func engineSeveralCarets() {
        let language = Language.detect(URL(fileURLWithPath: "carets.go"))
        var random = Xorshift(state: 0x2545_F491_4F6C_DD1D)
        var failed: [String] = []
        for (name, command) in Self.engineCommands {
            var mismatch: String?
            for _ in 0..<Self.caretTrialsPerCommand where mismatch == nil {
                let store = TextStore(Self.randomCode(&random), language: language)
                let set = Self.spacedSelections(&random, in: store)
                let context = EditContext(language: language)
                mismatch = compareWithSingles(command, store: store, set: set, context: context)
            }
            if let mismatch { failed.append("\(name): \(mismatch)") }
        }
        expect(failed.isEmpty, "\(Self.engineCommands.count) editing commands at several carets equal the command applied to each range alone",
               failed.joined(separator: "\n     "))
        var motionFailures: [String] = []
        for motion in TextCommands.Motion.allCases {
            for extending in [false, true] {
                let store = TextStore(Self.randomCode(&random), language: language)
                let set = Self.spacedSelections(&random, in: store)
                let context = EditContext(language: language)
                let measure = ColumnMeasure.monospace(store, tabWidth: 4, pageRows: 3)
                let together = TextCommands.moved(set, motion, extending: extending, in: store, context: context, measure: measure)
                let alone = set.selections.map {
                    TextCommands.moved(SelectionSet([$0]), motion, extending: extending, in: store, context: context, measure: measure).selections[0]
                }
                if together != SelectionSet(alone, primary: set.primary) { motionFailures.append("\(motion) extending \(extending)") }
            }
        }
        expect(motionFailures.isEmpty, "every motion over several carets equals moving each alone, merged",
               motionFailures.joined(separator: ", "))
    }

    func compareWithSingles(_ command: EngineCommand, store: TextStore, set: SelectionSet, context: EditContext) -> String? {
        guard let together = command(store, set, context) else {
            return set.selections.allSatisfy({ command(store, SelectionSet([$0]), context) == nil }) ? nil : "all at once did nothing"
        }
        var multiple = store
        together.apply(to: &multiple)
        var single = store
        var results: [Selection] = []
        for selection in set.selections.reversed() {
            guard let alone = command(single, SelectionSet([selection]), context) else {
                results.insert(selection, at: 0)
                continue
            }
            alone.apply(to: &single)
            results = results.map { Selection(anchor: alone.mapped($0.anchor), head: alone.mapped($0.head)) }
            results.insert(contentsOf: alone.after.selections, at: 0)
        }
        if multiple.string != single.string {
            return "\(store.string.debugDescription) at \(set.ranges): \(multiple.string.debugDescription) vs \(single.string.debugDescription)"
        }
        let expected = SelectionSet(results).selections.map { [$0.anchor, $0.head] }
        let actual = together.after.selections.map { [$0.anchor, $0.head] }
        return expected == actual ? nil : "\(store.string.debugDescription) at \(set.ranges): selections \(actual) vs \(expected)"
    }

    static func randomCode(_ random: inout Xorshift) -> String {
        (0..<(12 + random.next(20))).map { _ in
            let indent = ["", "  ", "\t", "    "][random.next(4)]
            let words = (0..<(1 + random.next(4))).map { _ in identifiers[random.next(identifiers.count)] + punctuation[random.next(punctuation.count)] }
            return indent + words.joined()
        }.joined(separator: "\n")
    }

    static func spacedSelections(_ random: inout Xorshift, in store: TextStore) -> SelectionSet {
        var selections: [Selection] = []
        var line = 1 + random.next(2)
        while line < store.lineCount - 2 {
            let span = store.lineRange(line)
            let a = span.location + random.next(span.length + 1)
            let b = random.next(3) == 0 ? span.location + random.next(span.length + 1) : a
            selections.append(Selection(anchor: a, head: b))
            line += caretSpacing + random.next(3)
        }
        return SelectionSet(selections, primary: random.next(max(1, selections.count)))
    }

    func engineCommandTables() {
        let code = EditContext(language: Language.detect(URL(fileURLWithPath: "t.go")))
        let prose = EditContext(language: .plain)
        let measure = { (store: TextStore) in ColumnMeasure.monospace(store, tabWidth: 4) }
        let motions: [(String, Int, TextCommands.Motion, EditContext, Int)] = [
            ("foo.barBaz qux", 0, .wordRight, code, 3), ("foo.barBaz qux", 3, .wordRight, code, 10),
            ("foo.barBaz qux", 14, .wordLeft, code, 11), ("fooBarBaz", 0, .subwordRight, code, 3),
            ("fooBarBaz", 3, .subwordRight, code, 6), ("HTTPServer", 0, .subwordRight, code, 4),
            ("snake_case", 5, .subwordRight, code, 10), ("fooBarBaz", 9, .subwordLeft, code, 6),
            ("Hello, wörld.", 0, .wordRight, prose, 5), ("Hello, wörld.", 5, .wordRight, prose, 12),
            ("Hello, wörld.", 13, .wordLeft, prose, 7), ("e\u{301}x", 0, .right, code, 2), ("a👍b", 3, .left, code, 1),
            ("ab\ncd", 1, .paragraphForward, code, 2), ("ab\ncd", 2, .paragraphForward, code, 5),
            ("ab\ncd", 4, .lineStart, code, 3), ("ab\ncd", 0, .documentEnd, code, 5),
        ]
        for (text, from, motion, context, expected) in motions {
            let store = TextStore(text)
            let moved = TextCommands.moved(SelectionSet(caret: from), motion, extending: false, in: store, context: context, measure: measure(store))
            expect(moved.primarySelection.head == expected, "\(motion) from \(from) in \(text.debugDescription) lands at \(expected)",
                   "\(moved.primarySelection.head)")
        }
        let edits: [(String, Int, String, EngineCommand, String, Int)] = [
            ("tab at column 3", 3, "  ab", { TextCommands.tab($1, in: $0, context: $2) }, "  a b", 4),
            ("Return keeps indentation", 6, "\tx\n  y", { TextCommands.newline($1, in: $0, context: $2) }, "\tx\n  y\n  ", 9),
            ("Return between braces opens a block", 6, "\tf() {}", { TextCommands.newline($1, in: $0, context: $2) },
             "\tf() {\n\t    \n\t}", 12),
            ("Backspace inside an empty pair removes both", 1, "()", { TextCommands.deleting($1, .backward, in: $0, context: $2) }, "", 0),
            ("Transpose swaps around the caret", 2, "abc", { store, set, _ in TextCommands.transposing(set, in: store) }, "acb", 3),
            ("Transpose at the line end swaps the last two", 3, "abc", { store, set, _ in TextCommands.transposing(set, in: store) }, "acb", 3),
            ("Move Line Down", 1, "ab\ncd\nef", { store, set, _ in TextCommands.movingLines(set, up: false, in: store) }, "cd\nab\nef", 4),
            ("Move Line Up from the last line", 7, "ab\ncd\nef", { store, set, _ in TextCommands.movingLines(set, up: true, in: store) },
             "ab\nef\ncd", 4),
            ("Duplicate Lines puts the caret on the copy", 1, "ab\ncd", { store, set, _ in TextCommands.duplicatingLines(set, in: store) },
             "ab\nab\ncd", 4),
            ("Delete Lines on the last line takes the newline before it", 4, "ab\ncd",
             { store, set, _ in TextCommands.deletingLines(set, in: store) }, "ab", 2),
            ("delete to the line end at the end joins the next line", 2, "ab\ncd",
             { TextCommands.deleting($1, .toLineEnd, in: $0, context: $2) }, "abcd", 2),
        ]
        for (name, caret, text, command, expectedText, expectedCaret) in edits {
            var store = TextStore(text)
            let transaction = command(store, SelectionSet(caret: caret), code)
            transaction?.apply(to: &store)
            expect(store.string == expectedText && transaction?.after.primarySelection.head == expectedCaret, name,
                   "\(store.string.debugDescription) caret \(transaction?.after.primarySelection.head ?? -1)")
        }
        engineCommentTables(code)
        enginePairingTable()
        engineKillRing(code)
    }

    func engineCommentTables(_ code: EditContext) {
        let source = "a\n  b\n\nc\n"
        var store = TextStore(source)
        let all = SelectionSet([Selection(anchor: 0, head: store.length)])
        let commented = TextCommands.togglingComment(all, in: store, context: code)
        commented?.apply(to: &store)
        expect(store.string == "// a\n//   b\n\n// c\n", "comment toggling comments a block at its shallowest column", store.string.debugDescription)
        let back = TextCommands.togglingComment(SelectionSet([Selection(anchor: 0, head: store.length)]), in: store, context: code)
        back?.apply(to: &store)
        expect(store.string == source, "comment toggling twice restores the text", store.string.debugDescription)
        var css = EditContext()
        css.blockComment = ("/*", "*/")
        var block = TextStore("  a\n")
        TextCommands.togglingComment(SelectionSet(caret: 2), in: block, context: css)?.apply(to: &block)
        let wrapped = block.string
        TextCommands.togglingComment(SelectionSet(caret: 2), in: block, context: css)?.apply(to: &block)
        expect(wrapped == "  /* a */\n" && block.string == "  a\n", "a block comment wraps a line and unwraps it", wrapped.debugDescription)
    }

    func enginePairingTable() {
        let cases: [(String, String, Int, TextCommands.Pairing)] = [
            ("(", "", 0, .insertPair(close: 0x29)), ("(", "x", 0, .insert), ("(", ")", 0, .insertPair(close: 0x29)),
            (")", ")", 0, .stepOver), ("\"", "", 0, .insertPair(close: 0x22)), ("\"", "a", 1, .insert),
            ("\"", "\"", 0, .stepOver), ("'", "it", 2, .insert), ("{", " ", 0, .insertPair(close: 0x7D)), ("x", "", 0, .insert),
            ("ab", "", 0, .insert),
        ]
        for (typed, text, caret, expected) in cases {
            let decision = TextCommands.pairing(typed: Array(typed.utf16), at: Selection(caret: caret), in: TextStore(text))
            expect(decision == expected, "auto-pairing: \(typed.debugDescription) before \(text.debugDescription) at \(caret)", "\(decision)")
        }
    }

    func engineKillRing(_ code: EditContext) {
        var session = EditSession(TextStore("one two\nthree"), context: code)
        _ = session.kill(.toParagraphEnd)
        _ = session.kill(.toParagraphEnd)
        let killed = session.store.string
        if let yank = session.kills.yanking(session.selections, in: session.store) { session.apply(yank) }
        expect(killed == "three" && session.store.string == "one two\nthree", "two kills in a row append, and Yank puts them back",
               "\(killed.debugDescription) then \(session.store.string.debugDescription)")
    }
}
