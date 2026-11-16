import AppKit
import NyteCore
import NyteUI

extension FindInFilesViewController: NSMenuItemValidation {
    func configureBar() {
        bar.field.onChange = { [weak self] _ in
            self?.list.showsFocusAlways = true
            self?.historyCursor.reset()
            self?.startSearch()
        }
        bar.field.onEndEditing = { [weak self] _ in self?.list.showsFocusAlways = false }
        bar.field.onMove = { [weak self] in self?.stepHistory($0) }
        bar.field.onSubmit = { [weak self] _ in self?.enterResults() }
        bar.field.field.nextKeyView = list.scrollView.documentView
        bar.onToggle = { [weak self] in self?.flip($0) }
        bar.onDisclose = { [weak self] _ in
            self?.list.reload()
            self?.view.needsLayout = true
        }
        bar.stop.onPress = { [weak self] in self?.stopSearch() }
        bar.replace.onChange = { [weak self] _ in self?.replaceChanged() }
        bar.replace.onSubmit = { [weak self] _ in self?.confirmReplaceAll() }
        bar.replaceAll.onPress = { [weak self] in self?.confirmReplaceAll() }
        for input in [bar.include, bar.exclude] { input.onChange = { [weak self] _ in self?.startSearch() } }
        bar.ignored.onChange = { [weak self] in self?.setIncludesIgnored($0 == .on) }
        configureScope()
    }

    @objc public func toggleMatchCase(_ sender: Any?) { flip(.matchCase) }
    @objc public func toggleWholeWord(_ sender: Any?) { flip(.wholeWord) }
    @objc public func toggleRegularExpression(_ sender: Any?) { flip(.regex) }
    @objc public func togglePreserveCase(_ sender: Any?) { flip(.preserveCase) }

    public func validateMenuItem(_ item: NSMenuItem) -> Bool {
        let state: Bool? = switch item.action {
        case #selector(toggleMatchCase(_:)): caseSensitive
        case #selector(toggleWholeWord(_:)): wholeWord
        case #selector(toggleRegularExpression(_:)): isRegex
        case #selector(togglePreserveCase(_:)): preservesCase
        default: nil
        }
        guard let state else { return true }
        item.state = state ? .on : .off
        return true
    }

    override public func cancelOperation(_ sender: Any?) {
        if case .searching = phase { return stopSearch() }
        view.window?.makeFirstResponder(bar.field.field)
    }

    func flip(_ toggle: QueryBar.Toggle) {
        switch toggle {
        case .matchCase: caseSensitive.toggle()
        case .wholeWord: wholeWord.toggle()
        case .regex: isRegex.toggle()
        case .preserveCase: preservesCase.toggle()
        }
        let on = switch toggle {
        case .matchCase: caseSensitive
        case .wholeWord: wholeWord
        case .regex: isRegex
        case .preserveCase: preservesCase
        }
        bar.setOn(toggle, on)
        guard toggle == .preserveCase else { return startSearch() }
        replaceChanged()
    }

    func setIncludesIgnored(_ include: Bool) {
        includesIgnored = include
        bar.ignored.state = include ? .on : .off
        startSearch()
    }

    func handleKey(_ event: NSEvent) -> Bool {
        noteInteraction()
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        guard let key = event.specialKey, key == .carriageReturn || key == .enter else { return false }
        switch modifiers {
        case .command:
            guard let row = list.selectedRow else { return false }
            open(row: row, intent: .keepFocus)
            return true
        case .option:
            return askAgent(about: list.selectedRows)
        case [.command, .option]:
            confirmReplaceAll()
            return true
        default:
            return false
        }
    }

    func enterResults() {
        recordHistory()
        guard !rowKind.isEmpty else { return }
        if list.selectedRow == nil, let first = rowKind.firstIndex(of: .match) { list.selectedRows = IndexSet(integer: first) }
        list.focus()
        selectionChanged()
    }

    func open(row: Int, intent: OpenIntent) {
        guard rowKind.indices.contains(row) else { return }
        switch rowKind[row] {
        case .match:
            recordHistory()
            onOpen?(location(of: Int(rowIndex[row])), intent)
        case .failure:
            let path = failures[Int(rowIndex[row])].path
            onOpen?(FileLocation(url: workspace.root.appendingPathComponent(path), range: TextSpan(at: TextPosition(line: 0, column: 0))),
                    intent)
        case .file, .folder, .failures:
            toggleGroup(at: row)
        }
    }

    func location(of match: Int) -> FileLocation {
        let span = results.span(of: match)
        return FileLocation(url: workspace.root.appendingPathComponent(results.paths[Int(results.matchFile[match])]),
                            range: TextSpan(start: TextPosition(line: span.start.line, column: span.start.column),
                                            end: TextPosition(line: span.end.line, column: span.end.column)))
    }

    func dismiss(_ rows: IndexSet) {
        guard let first = rows.first else { return }
        noteInteraction()
        matches(in: rows).forEach { hide(match: $0) }
        rebuildRows()
        list.reload()
        let next = min(first, rowKind.count - 1)
        let landing = next >= 0 && rowKind[next] != .match ? rowKind[next...].firstIndex(of: .match) ?? next : next
        list.selectedRows = landing >= 0 ? IndexSet(integer: landing) : []
        selectionChanged()
        render()
    }

    func matches(in rows: IndexSet) -> [Int] {
        var found: [Int] = []
        for row in rows where rowKind.indices.contains(row) {
            let index = Int(rowIndex[row])
            switch rowKind[row] {
            case .match: found.append(index)
            case .file: found += results.fileMatches[index].map(Int.init)
            case .folder:
                let prefix = folderRows[index].path
                for file in displayFiles where results.paths[Int(file)].hasPrefix(prefix) {
                    found += results.fileMatches[Int(file)].map(Int.init)
                }
            case .failures, .failure: break
            }
        }
        return Array(Set(found.filter { !dismissed[$0] })).sorted()
    }

    private func hide(match: Int) {
        guard !dismissed[match] else { return }
        dismissed[match] = true
        fileShown[Int(results.matchFile[match])] -= 1
    }

    func selectionChanged() {
        guard let row = list.selectedRows.last, rowKind.indices.contains(row) else { return }
        switch rowKind[row] {
        case .match:
            showPreview(of: Int(rowIndex[row]))
        case .file, .folder:
            guard let match = matches(in: IndexSet(integer: row)).first else { return }
            showPreview(of: match)
        case .failures, .failure:
            break
        }
    }

    func showPreview(of match: Int) {
        let file = Int(results.matchFile[match])
        let path = results.paths[file]
        let line = results.matchLine[match]
        if let key = previewKey, key.path == path, shownPreview.lineCount > 0, Int(line) >= shownPreview.firstLine,
           Int(line) <= shownPreview.lastLine {
            previewKey = (path, line)
            let marks = previewMarks(file: file, selected: match, in: shownPreview)
            preview.marks = marks
            if let current = marks.first(where: \.isCurrent) { preview.reveal(current) }
            return
        }
        previewKey = (path, line)
        previewTask?.cancel()
        let root = workspace.root, text = unsaved[path], checkpoints = lexCheckpoints, swaps = swaps
        let byte = Int(results.matchBytes[match].lowerBound), column = Int(results.matchColumn[match])
        previewTask = Task { [weak self] in
            let window = await Task.detached(priority: .userInitiated) {
                PreviewText.read(root: root, path: path, unsaved: text, line: Int(line), byte: byte, column: column, checkpoints: checkpoints)
            }.value
            guard let self, !Task.isCancelled, swaps == self.swaps, previewKey?.path == path, previewKey?.line == line else { return }
            shownPreview = window
            let source = CodeViewSource(name: path, language: Language.detect(fileName: (path as NSString).lastPathComponent),
                                        firstLine: window.firstLine, lines: window.lines, entryState: window.entryState)
            let marks = previewMarks(file: file, selected: match, in: window)
            preview.show(source, marks: marks, revealing: marks.first(where: \.isCurrent))
        }
    }

    func previewMarks(file: Int, selected: Int, in window: PreviewText) -> [CodeMark] {
        results.fileMatches[file].compactMap { value -> CodeMark? in
            let match = Int(value)
            let line = Int(results.matchLine[match])
            guard !dismissed[match] || match == selected, line >= window.firstLine, line <= window.lastLine else { return nil }
            let offset = window.columnOffsets[line - window.firstLine]
            let width = window.lines[line - window.firstLine].utf16.count
            let end = results.matchEndLine[match] == results.matchLine[match] ? Int(results.matchEndColumn[match]) - offset : width
            return CodeMark(line: line, start: max(0, Int(results.matchColumn[match]) - offset), end: min(max(0, end), width),
                            isCurrent: match == selected)
        }
    }

    func menu(for rows: IndexSet) -> NSMenu? {
        guard let row = rows.first, rowKind.indices.contains(row) else { return nil }
        noteInteraction()
        let kind = rowKind[row]
        var items: [MenuItem] = []
        if kind == .match {
            items += [
                MenuItem("Open", key: "\r", modifiers: []) { [weak self] in self?.open(row: row, intent: .focusEditor) },
                MenuItem("Open in Background", key: "\r") { [weak self] in self?.open(row: row, intent: .keepFocus) },
                .separator,
            ]
        }
        guard kind != .failures, kind != .failure else { return nil }
        items.append(.separator)
        items.append(MenuItem(Self.askAgentTitle, key: "\r", modifiers: .option, enabled: onAskAgent != nil) { [weak self] in
            _ = self?.askAgent(about: rows)
        })
        let path: String? = switch kind {
        case .file: results.paths[Int(rowIndex[row])]
        case .match: results.paths[Int(results.matchFile[Int(rowIndex[row])])]
        case .folder: folderRows[Int(rowIndex[row])].path
        case .failures, .failure: nil
        }
        if let path {
            items.append(MenuItem("Copy Path") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(path, forType: .string)
            })
        }
        return Menu.make(items)
    }

    func stepHistory(_ delta: Int) {
        guard let text = historyCursor.step(delta, in: history, current: bar.field.stringValue) else { return }
        bar.field.field.stringValue = text
        bar.field.field.currentEditor()?.selectedRange = NSRange(location: (text as NSString).length, length: 0)
        startSearch()
    }

    func recordHistory() {
        let text = bar.field.stringValue
        guard !text.isEmpty, history.entries.first != text else { return }
        history = history.recording(text)
        history.save(root: workspace.root)
    }
}
