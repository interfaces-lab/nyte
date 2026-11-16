import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension TextEngineView {
    var carets: SelectionSet? { selections.hasSeveral ? selections : nil }
}

extension EditorCheck {
    func carets() async {
        let editor = await openEditor("let a = item\nlet b = item\nlet c = item\n", file: "carets.txt")
        let original = editor.shownText.string
        let first = editor.shownText.range(of: "item")
        editor.textView.setSelectedRange(NSRange(location: first.location, length: 0))
        editor.textView.selectNextOccurrence(nil)
        editor.textView.selectNextOccurrence(nil)
        editor.textView.selectNextOccurrence(nil)
        expect(editor.textView.carets?.count == 3, "Select Next Occurrence selects the word, then each next match",
               "\(String(describing: editor.textView.carets?.ranges))")
        for character in "ok" { editor.textView.keyDown(with: EditorBench.key(String(character))); Self.finishEvent() }
        expect(editor.shownText.string == "let a = ok\nlet b = ok\nlet c = ok\n" && editor.textView.carets?.count == 3,
               "typing replaces every selection and keeps every caret", editor.shownText.string.debugDescription)
        editor.textView.keyDown(with: EditorBench.key("("))
        Self.finishEvent()
        expect(editor.shownText.string == "let a = ok()\nlet b = ok()\nlet c = ok()\n", "auto-pairing applies at every caret")
        editor.textView.deleteBackward(nil)
        Self.finishEvent()
        expect(editor.shownText.string == "let a = ok\nlet b = ok\nlet c = ok\n", "Backspace inside an empty pair removes it at every caret")
        editor.textView.moveWordLeftAndModifySelection(nil)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("one\ntwo\nthree", forType: .string)
        editor.textView.paste(nil)
        Self.finishEvent()
        expect(editor.shownText.string == "let a = one\nlet b = two\nlet c = three\n", "paste gives each caret one clipboard line",
               editor.shownText.string.debugDescription)
        editor.shown?.undo.undo()
        let afterOneUndo = editor.shownText.string
        expect(afterOneUndo == "let a = ok\nlet b = ok\nlet c = ok\n", "one undo takes back one paste at every caret", afterOneUndo.debugDescription)
        while editor.shownText.string != original, editor.shown?.undo.canUndo == true { editor.shown?.undo.undo() }
        expect(editor.shownText.string == original, "undo restores the text")
        editor.textView.setSelectedRange(NSRange(location: 4, length: 0))
        editor.textView.addCaretBelow(nil)
        editor.textView.addCaretBelow(nil)
        expect(editor.textView.carets?.ranges.map(\.location) == [4, 17, 30], "Add Caret Below stacks carets at the same column")
        editor.textView.cancelOperation(nil)
        expect(editor.textView.carets == nil && editor.textView.selectedRange().location == 30, "Escape returns to the primary caret")
        editor.textView.setSelectedRange(NSRange(location: 0, length: 0))
        expect(editor.textView.carets == nil, "a single caret carries no caret set")
        editor.textView.setSelectedRange(NSRange(location: first.location, length: 0))
        editor.textView.selectAllOccurrences(nil)
        Self.finishEvent()
        for character in "go" { editor.textView.keyDown(with: EditorBench.key(String(character))); Self.finishEvent() }
        editor.shown?.undo.undo()
        expect(editor.shownText.string == original, "one undo takes back a typed word at every caret",
               editor.shownText.string.debugDescription)
        await shiftAtCarets()
        await caretsThroughResponderChain()
    }

    func caretsThroughResponderChain() async {
        for keyed in [true, false] {
            let url = folder.appendingPathComponent("chain.go")
            try? "package main\n\nfunc a() {}\nfunc b() {}\nfunc c() {}\n".write(to: url, atomically: true, encoding: .utf8)
            let editor = EditorViewController(workspace: Workspace(root: folder))
            kept.append(editor)
            let host: NSWindow = keyed ? OffscreenWindow(contentRect: EditorBench.pane, styleMask: [.borderless], backing: .buffered, defer: true)
                : NSWindow(contentRect: EditorBench.pane, styleMask: [.borderless], backing: .buffered, defer: true)
            host.contentView = editor.view
            editor.view.layoutSubtreeIfNeeded()
            host.makeFirstResponder(editor.textView)
            editor.open(url, preview: false)
            while editor.shown == nil { await Task.yield() }
            editor.textView.setSelectedRange(NSRange(location: 16, length: 0))
            let action = #selector(TextEngineView.addCaretBelow(_:))
            let item = NSMenuItem(title: "Add Caret Below", action: action, keyEquivalent: "")
            let reached = (0..<2).allSatisfy { _ in host.firstResponder?.tryToPerform(action, with: item) == true }
            await Task.yield()
            let drawn = editor.textView.selections.selections.allSatisfy { caret in
                abs(editor.textView.caretRect(at: caret.head).midX - (editor.rects(for: NSRange(location: caret.head, length: 0)).first?.minX ?? -1)) <= 1
            }
            expect(reached && editor.textView.carets?.count == 3 && editor.textView.isFocused == keyed && drawn,
                   "Add Caret Below through the responder chain of an offscreen \(keyed ? "key" : "non-key") window adds two carets, "
                       + (keyed ? "shown at their characters" : "hidden like the primary caret until the window is key"),
                   "reached \(reached) carets \(editor.textView.carets?.count ?? 1) focused \(editor.textView.isFocused)")
        }
    }

    func shiftAtCarets() async {
        let source = "    one\n        two\n\tthree\nfour\n"
        let editor = await openEditor(source, file: "shift.txt")
        editor.textView.setSelectedRange(NSRange(location: 6, length: 0))
        editor.textView.addCaretBelow(nil)
        editor.textView.addCaretBelow(nil)
        editor.textView.insertBacktab(nil)
        Self.finishEvent()
        expect(editor.shownText.string == "one\n    two\nthree\nfour\n" && editor.textView.carets?.ranges.map(\.location) == [2, 6, 14],
               "Shift-Tab outdents every caret's line and keeps each caret on its character, carets added at the same visual column",
               editor.shownText.string.debugDescription + " \(String(describing: editor.textView.carets?.ranges))")
        editor.textView.indentLines(nil)
        Self.finishEvent()
        expect(editor.shownText.string == "    one\n        two\n    three\nfour\n" && editor.textView.carets?.count == 3,
               "Indent Lines indents every caret's line", editor.shownText.string.debugDescription)
        editor.shown?.undo.undo()
        editor.shown?.undo.undo()
        expect(editor.shownText.string == source, "each shift undoes in one step", editor.shownText.string.debugDescription)
    }
}
