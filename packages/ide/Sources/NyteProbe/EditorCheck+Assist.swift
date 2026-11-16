import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension EditorCheck {
    func assistAtCarets() {
        let text = NSMutableString(string: "a.pri\nb.pri\nc.pri\n")
        let carets = [5, 11, 17].map { NSRange(location: $0, length: 0) }
        let ranges = CaretCompletion.replacements(of: NSRange(location: 2, length: 3), caret: 5, carets: carets, in: text)
        expect(ranges == [NSRange(location: 2, length: 3), NSRange(location: 8, length: 3), NSRange(location: 14, length: 3)],
               "a completion applies at every caret when each has the primary's prefix", "\(String(describing: ranges))")
        let item = CompletionItem(label: "Println", kind: .function, tail: "(a ...any)", text: "Println",
                                  additionalEdits: [TextEdit(range: TextSpan(at: TextPosition(line: 0, column: 0)), text: "import \"fmt\"\n")])
        let insert = CompletionInsert.decide(item, committing: false)
        let importEdit = (range: NSRange(location: 0, length: 0), delta: 13)
        let plan = CaretCompletion.plan(item, insert: insert, at: ranges ?? [], shiftedBy: [importEdit], in: text)
        for (range, inserted) in zip(ranges ?? [], plan.texts).reversed() { text.replaceCharacters(in: range, with: inserted) }
        text.insert("import \"fmt\"\n", at: 0)
        let inside = plan.after.allSatisfy { $0.length == 0 && $0.location > 0 && text.character(at: $0.location - 1) == UInt16(UInt8(ascii: "(")) }
        expect(text as String == "import \"fmt\"\na.Println()\nb.Println()\nc.Println()\n" && inside,
               "accepting a call at several carets inserts it once per caret, the import once, and leaves each caret inside its parentheses",
               (text as String).debugDescription + " \(plan.after)")
        let differing = NSString(string: "a.pri\nb.pra\n")
        let mismatch = CaretCompletion.replacements(of: NSRange(location: 2, length: 3), caret: 5,
                                                    carets: [NSRange(location: 5, length: 0), NSRange(location: 11, length: 0)], in: differing)
        let longer = NSString(string: "a.pri\nxpri\n")
        let overrun = CaretCompletion.replacements(of: NSRange(location: 2, length: 3), caret: 5,
                                                   carets: [NSRange(location: 5, length: 0), NSRange(location: 10, length: 0)], in: longer)
        expect(mismatch == nil && overrun == nil, "carets whose prefixes differ, or whose word runs further left, get no completion")
    }

    func agentContext() async {
        let editor = await openEditor("line one\nline two\nline three\n", file: "context.go")
        editor.textView.setSelectedRange(NSRange(location: 10, length: 0))
        let caretLine = editor.selectionContext()
        expect(caretLine?.text == "line two" && caretLine?.range == TextSpan(start: TextPosition(line: 1, column: 0), end: TextPosition(line: 1, column: 8)),
               "with no selection the context is the caret's whole line", "\(String(describing: caretLine))")
        editor.textView.setSelectedRange(NSRange(location: 5, length: 7))
        expect(editor.selectionContext()?.text == "one\nlin", "with a selection the context is exactly the selection")
        var received: AgentContext?
        editor.onAskAgent = { received = $0 }
        editor.textMenu = { Menu.make([MenuItem("Copy") {}]) }
        let point = editor.textView.convert(editor.rects(for: NSRange(location: 6, length: 0)).first?.origin ?? .zero, to: nil)
        let click = NSEvent.mouseEvent(with: .rightMouseDown, location: point, modifierFlags: [], timestamp: 0,
                                       windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        let menu = click.flatMap { editor.textView.menu(for: $0) }
        let ask = menu?.items.firstIndex { $0.title == "Ask Nyte" }
        if let ask { menu?.performActionForItem(at: ask) }
        let lines = AgentContext.Lines(file: editor.url ?? folder, range: AgentContext.LineRange(first: 1, last: 2), text: "one\nlin")
        expect(ask == 0 && menu?.items.last?.title == "Copy" && received == .lines(lines),
               "Ask Nyte heads the text menu and reports the selection with one-based lines",
               "\(menu?.items.map(\.title) ?? []) \(String(describing: received))")
        editor.askAgent(about: Diagnostic(range: TextSpan(start: TextPosition(line: 2, column: 5), end: TextPosition(line: 2, column: 10)),
                                          severity: .warning, message: "unused", source: "vet"))
        guard case .diagnostic(let problem)? = received else { return expect(false, "Ask Nyte on a problem reports the diagnostic") }
        expect(problem.start == AgentContext.Position(line: 3, column: 6) && problem.severity == .warning && problem.message == "unused",
               "Ask Nyte on a problem reports the diagnostic with one-based positions")
        let long = await openEditor(String(repeating: "xxxxxxxxx\n", count: 5_000), file: "long.go")
        long.textView.selectAll(nil)
        let capped = long.selectionContext()
        expect(capped?.text.utf16.count == 32_760 && capped?.range.end == TextPosition(line: 3_276, column: 0),
               "a selection past \(EditorViewController.selectionContextLimit) characters is cut at the last whole line inside the limit",
               "\(capped?.text.utf16.count ?? 0) \(String(describing: capped?.range))")
    }
}
