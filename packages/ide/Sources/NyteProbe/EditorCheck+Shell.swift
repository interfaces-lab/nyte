import AppKit
@testable import NyteEditor
import NyteCore

extension EditorCheck {
    static let shellLines = 400

    func shellCalls() async {
        let source = (0..<Self.shellLines).map { "line \($0) of the shell check" }.joined(separator: "\n") + "\n"
        let editor = await openEditor(source, file: "shell.txt")
        guard let url = editor.url else { return expect(false, "the shell check opens its file") }
        let view = editor.textView
        expect(editor.text(of: url) == source && editor.text(of: folder.appendingPathComponent("never-open.txt")) == nil,
               "text(of:) is the open buffer, nil for a file that is not open")

        var changes: [URL] = []
        editor.onTextChange = { changes.append($0) }
        view.setSelectedRange(NSRange(location: 0, length: 0))
        view.insertText("x", replacementRange: NSRange(location: NSNotFound, length: 0))
        let edits = (0..<3).map { TextEdit(range: TextSpan(at: TextPosition(line: $0 * 10, column: 0)), text: "y") }
        _ = await editor.apply(WorkspaceEdit(files: [WorkspaceEdit.File(url: url, edits: edits)]))
        expect(changes == [url, url], "onTextChange fires once per transaction, a three-edit workspace edit included", "\(changes.count) calls")

        await revertCheck(editor, url: url, source: source)
        await diskCheck(editor, url: url)
        await stateCheck(editor, url: url)
        await saveAllCheck(editor, url: url)
        editor.onTextChange = nil
    }

    private func revertCheck(_ editor: EditorViewController, url: URL, source: String) async {
        let view = editor.textView
        EditorCheck.scroll(editor, to: view.top(ofLine: 200) + 3)
        let origin = editor.scrollView.contentView.bounds.origin
        let edited = editor.text(of: url)
        let reverted = await editor.revert(url)
        expect(reverted && editor.text(of: url) == source && editor.tabs.first?.isDirty == false
               && editor.scrollView.contentView.bounds.origin == origin,
               "revert reloads the file, is clean and keeps the viewport", "\(reverted) \(editor.scrollView.contentView.bounds.origin) \(origin)")
        editor.currentUndoManager.undo()
        expect(editor.text(of: url) == edited && editor.tabs.first?.isDirty == true, "revert is one undoable step back to the edited text")
        _ = await editor.revert(url)
    }

    private func diskCheck(_ editor: EditorViewController, url: URL) async {
        let view = editor.textView
        let target = view.store.lineRange(300).location + 5
        view.setSelectedRange(NSRange(location: target, length: 0))
        EditorCheck.scroll(editor, to: view.top(ofLine: 250))
        let origin = editor.scrollView.contentView.bounds.origin
        let changed = "added at the top\n" + (editor.text(of: url) ?? "")
        try? changed.write(to: url, atomically: true, encoding: .utf8)
        editor.filesDidChange([url])
        await settle { editor.text(of: url) == changed }
        let caret = view.selectedRange().location
        expect(editor.text(of: url) == changed && editor.tabs.first?.isDirty == false && caret == target + 17
               && editor.scrollView.contentView.bounds.origin == origin,
               "a clean document reloads when its file changes, keeping the viewport and the caret on its text", "caret \(caret) for \(target + 17)")

        var reported: [URL] = []
        editor.onDiskChange = { reported.append($0) }
        view.insertText("z", replacementRange: NSRange(location: 0, length: 0))
        let dirty = editor.text(of: url)
        try? "replaced on disk\n".write(to: url, atomically: true, encoding: .utf8)
        editor.filesDidChange([url])
        await settle { false }
        expect(reported == [url] && editor.text(of: url) == dirty, "a dirty document reports the change on disk and keeps its text")
        editor.onDiskChange = nil
        try? changed.write(to: url, atomically: true, encoding: .utf8)
        _ = await editor.revert(url)
    }

    private func stateCheck(_ editor: EditorViewController, url: URL) async {
        let view = editor.textView
        view.select(SelectionSet([Selection(anchor: view.store.lineRange(120).location + 2, head: view.store.lineRange(121).location + 4),
                                  Selection(caret: view.store.lineRange(140).location + 1)], primary: 1))
        view.setFolds([30...40])
        EditorCheck.scroll(editor, to: view.top(ofLine: 100) + 5)
        let saved = editor.viewState(of: url)
        let decoded = (try? JSONEncoder().encode(saved)).flatMap { try? JSONDecoder().decode(EditorViewState.self, from: $0) }
        let origin = editor.scrollView.contentView.bounds.origin
        let selections = view.selections
        editor.close(at: 0)
        editor.open(url, preview: false)
        if let decoded { editor.restore(decoded, for: url) }
        await settle { editor.textView.store.length > 0 }
        expect(decoded == saved && saved?.folds == [30...40] && view.selections == selections && view.foldedRanges == [30...40]
               && editor.scrollView.contentView.bounds.origin == origin,
               "a view state restores the exact viewport, selections and folds through Codable, given before the file loads",
               "\(editor.scrollView.contentView.bounds.origin) against \(origin), folds \(view.foldedRanges)")
    }

    private func saveAllCheck(_ editor: EditorViewController, url: URL) async {
        let locked = folder.appendingPathComponent("locked", isDirectory: true)
        try? FileManager.default.createDirectory(at: locked, withIntermediateDirectories: true)
        let stuck = locked.appendingPathComponent("stuck.txt")
        try? "stuck\n".write(to: stuck, atomically: true, encoding: .utf8)
        editor.open(stuck, preview: false)
        await settle { editor.text(of: stuck) != nil }
        editor.textView.insertText("a", replacementRange: NSRange(location: 0, length: 0))
        editor.select(at: 0)
        editor.textView.insertText("b", replacementRange: NSRange(location: 0, length: 0))
        try? FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: locked.path)
        let failed = await editor.saveAll()
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: locked.path)
        let disk = try? String(contentsOf: url, encoding: .utf8)
        expect(failed == [stuck.standardizedFileURL] && disk == editor.text(of: url) && editor.tabs.first?.isDirty == false,
               "saveAll saves every dirty file and returns the ones that failed", "\(failed)")
        editor.close(at: 1)
    }
}
