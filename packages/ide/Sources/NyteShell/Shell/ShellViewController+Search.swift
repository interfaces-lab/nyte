import AppKit
import NyteCore
import NyteSearch

extension ShellViewController {
    func wireSearch() {
        search.onOpen = { [weak self] location, intent in
            self?.editor.reveal(location)
            if intent == .focusEditor { self?.editor.focus() }
        }
        search.unsavedText = { [weak self] in self?.unsavedTexts() ?? [:] }
        search.openFiles = { [weak self] in self?.editor.tabs.map(\.url) ?? [] }
        search.changedFiles = { [weak self] in self?.changedFiles ?? [] }
        search.onApply = { [weak self] edit in await self?.editor.apply(edit) ?? false }
        search.onAskAgent = { [weak self] items in self?.ask(items) }
        search.warmFiles()
    }

    func unsavedTexts() -> [URL: String] {
        let pairs = editor.tabs.filter(\.isDirty).compactMap { tab in editor.text(of: tab.url).map { (tab.url, $0) } }
        return Dictionary(pairs) { first, _ in first }
    }

    func findInFiles() {
        let seed = isEditorFocused ? wordAtCaret() : nil
        showSearch()
        search.find(seed)
    }

    func find(inFolder url: URL) {
        showSearch()
        search.find(inFolder: url)
    }

    private func showSearch() {
        if !dock.contains(.search) {
            dock.add(ToolWindow(id: .search, title: "Find in Files", isClosable: true, controller: search))
        }
        showToolWindow(.search)
    }

    var isEditorFocused: Bool {
        (view.window?.firstResponder as? NSView)?.isDescendant(of: editor.view) ?? false
    }

    func wordAtCaret() -> String? {
        guard let context = editor.selectionContext() else { return nil }
        if let position = lastPosition, position.selected > 0 { return context.text }
        let line = Array(context.text.utf16)
        let caret = min(max((lastPosition?.column ?? 1) - 1, 0), line.count)
        let isWord = { (unit: UInt16) in Unicode.Scalar(unit).map { $0 == "_" || CharacterSet.alphanumerics.contains($0) } ?? false }
        var start = caret
        while start > 0, isWord(line[start - 1]) { start -= 1 }
        var end = caret
        while end < line.count, isWord(line[end]) { end += 1 }
        guard end > start else { return nil }
        return String(decoding: line[start..<end], as: UTF16.self)
    }

    func quickText(_ text: String, limit: Int) async -> [Palettes.TextHit] {
        let query = SearchQuery(text, limits: SearchQuery.Limits(matchesPerFile: limit, matches: limit))
        let unsaved = Dictionary(unsavedTexts().map { (workspace.relativePath(of: $0.key), $0.value) }) { first, _ in first }
        guard let run = try? searchEngine.start(query, unsaved: unsaved) else { return [] }
        var results = SearchResults()
        for await event in run.events {
            guard case let .batch(batch, _) = event else { break }
            results.append(batch)
            if results.matchCount >= limit {
                run.cancel()
                break
            }
        }
        let root = workspace.root
        return (0..<min(results.matchCount, limit)).map { match in
            let path = results.paths[Int(results.matchFile[match])]
            let span = results.span(of: match)
            let location = FileLocation(url: root.appendingPathComponent(path),
                                        range: TextSpan(start: TextPosition(line: span.start.line, column: span.start.column),
                                                        end: TextPosition(line: span.end.line, column: span.end.column)))
            return Palettes.TextHit(location: location, path: path, line: results.text(ofSlot: Int(results.matchSlot[match])))
        }
    }
}
