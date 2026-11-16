import AppKit
import NyteCore
import NyteDebug
import NyteEditor
import NyteUI

extension ShellViewController {
    static let saveNoticeTime = Duration.seconds(4)
    static let inlineValueAttempts = 5
    static let inlineValueRetry = Duration.milliseconds(300)

    func wireAssistance() {
        editor.lineNotes = { [weak self] url in
            let key = url.standardizedFileURL
            return (self?.lineNotes[key] ?? []) + (self?.usageNotes[key] ?? [])
        }
        editor.onLineNote = { [weak self] _, note in self?.runLineNote(note) }
        editor.runMarks = { [weak self] url in self?.runMarks[url.standardizedFileURL] ?? [] }
        editor.runMarkMenu = { [weak self] _, mark in self?.runMarkMenu(mark) }
        editor.breakpointMenu = { [weak self] url, line in self?.breakpointMenu(url, line: line) }
        editor.baseText = { [weak self] url in await self?.headText(of: url) }
        editor.beforeSave = { [weak self] url, deadline in await self?.editsBeforeSave(url, deadline: deadline) ?? [] }
        editor.valueHover = { [weak self] url, position, expression in
            await self?.hoverValue(of: expression, at: FileLocation(url: url, range: TextSpan(at: position)))
        }
    }

    func refreshUsages(for url: URL?) {
        usageTask?.cancel()
        guard let url = url?.standardizedFileURL else { return }
        let settings = services.language.settings
        let counts = url.pathExtension == "go" ? settings.go.countsUsages : settings.typeScript.countsUsages
        guard counts else {
            guard usageNotes[url] != nil else { return }
            usageNotes[url] = nil
            return editor.lineNotesDidChange()
        }
        let lines = sourceLines(of: url).count
        let language = services.language
        usageTask = Task {
            let found = await language.usages(in: TextSpan(start: TextPosition(line: 0, column: 0),
                                                           end: TextPosition(line: lines, column: 0)), of: url)
            guard !Task.isCancelled else { return }
            usageActions = usageActions.filter { !$0.key.hasPrefix(url.path + "#") }
            usageNotes[url] = found.flatMap { count -> [LineNote] in
                let place = FileLocation(url: url, range: count.selection)
                let line = count.selection.start.line
                let key = "\(url.path)#\(line):\(count.selection.start.column)"
                var notes: [LineNote] = []
                if let usages = count.usages {
                    usageActions[key + ".usages"] = (place, .findUsages)
                    notes.append(LineNote(zeroBasedLine: line, text: usages == 1 ? "1 usage" : "\(usages) usages", isQuiet: true,
                                          action: key + ".usages", order: 1))
                }
                if let implementations = count.implementations, implementations > 0 {
                    usageActions[key + ".implementations"] = (place, .goToImplementations)
                    notes.append(LineNote(zeroBasedLine: line, text: implementations == 1 ? "1 implementation" : "\(implementations) implementations",
                                          isQuiet: true, action: key + ".implementations", order: 2))
                }
                return notes
            }
            editor.lineNotesDidChange()
        }
    }

    private func runLineNote(_ note: LineNote) {
        guard let action = note.action, let (place, command) = usageActions[action] else { return }
        editor.reveal(place)
        guard command != .findUsages else { return findUsages(at: place) }
        editor.perform(command)
    }

    func refreshRunMarks(for url: URL?) {
        guard let url = url?.standardizedFileURL else { return }
        let language = services.language
        Task {
            let marks = await language.runMarks(in: url)
            guard marks != runMarks[url] else { return }
            runMarks[url] = marks
            editor.runMarksDidChange()
        }
    }

    private func runMarkMenu(_ mark: RunMark) -> NSMenu {
        let target = Self.debugTarget(for: mark.target)
        let run = mark.target
        return Menu.make([
            MenuItem("Debug \(mark.title)") { [weak self] in self?.start(target, debugging: true) },
            MenuItem("Run \(mark.title) Without Debugging") { [weak self] in self?.start(target, debugging: false) },
            MenuItem("Run \(mark.title) in Terminal") { [weak self] in
                self?.runInTerminal(run.command, directory: run.directory, title: run.name)
            },
        ])
    }

    private func breakpointMenu(_ url: URL, line: Int) -> NSMenu? {
        let debugger = services.debugger
        guard let breakpoint = debugger.breakpoint(line: line, in: url) else { return nil }
        return Menu.make([
            MenuItem("Edit Breakpoint…") { [weak self] in self?.editBreakpoint(url, line: line) },
            MenuItem(breakpoint.isEnabled ? "Disable Breakpoint" : "Enable Breakpoint") {
                var changed = breakpoint
                changed.isEnabled.toggle()
                debugger.setBreakpoint(changed, in: url)
            },
            .separator,
            MenuItem("Remove Breakpoint") { debugger.removeBreakpoint(line: line, in: url) },
        ])
    }

    private func editBreakpoint(_ url: URL, line: Int) {
        guard let rect = editor.rectOfBreakpoint(line: line) else { return }
        debugView.editBreakpoint(line: line, in: url, anchoredTo: rect, in: editor.rulerView)
    }

    static func debugTarget(for target: RunTarget) -> DebugTarget {
        let kind: DebugTarget.Kind = switch target.program {
        case .goPackage: .goPackage(target.directory)
        case .goTest: .goTest(target.directory, test: nil)
        case let .node(script): .node(script)
        }
        return DebugTarget(id: "mark:" + target.name, name: target.name, kind: kind, directory: target.directory,
                           arguments: target.arguments, runtimeArguments: target.runtimeArguments)
    }

    private func headText(of url: URL) async -> String? {
        if repository == nil { repository = await GitRepository.locate(workspace.root) }
        guard case let .repository(git)? = repository else { return nil }
        let prefix = git.root.standardizedFileURL.path + "/"
        let path = url.standardizedFileURL.path
        guard path.hasPrefix(prefix) else { return nil }
        let data = try? await git.blob(String(path.dropFirst(prefix.count)), at: .index)
        return data.map { String(decoding: $0, as: UTF8.self) }
    }

    func gitMetadataDidChange(_ paths: [URL]) {
        let moved = paths.contains { url in
            let path = url.path
            return path.hasSuffix("/.git/HEAD") || path.hasSuffix("/.git/index") || path.contains("/.git/refs/")
        }
        guard moved else { return }
        editor.baseTextDidChange()
        windowToolbar.show(branch: GitHead.branch(in: workspace.root))
    }

    private func editsBeforeSave(_ url: URL, deadline: Duration) async -> [TextEdit] {
        guard let preferences = appliedPreferences, preferences.editor.formatsOnSave || preferences.editor.organizesImportsOnSave
        else { return [] }
        let indent = lastPosition?.indentWidth ?? preferences.editor.tabWidth
        let usesTabs = lastPosition?.usesTabs ?? preferences.editor.usesTabs
        let preparation = await services.language.editsBeforeSave(url, indent: indent, usesTabs: usesTabs, deadline: deadline)
        switch preparation.outcome {
        case .changed: return preparation.edits
        case let .timedOut(sentence), let .failed(sentence): showSaveNotice(sentence)
        case .unchanged, .outdated: break
        }
        return []
    }

    func showNotice(_ sentence: String, severity: Diagnostic.Severity) {
        let key = "notice:" + sentence
        guard !dismissedBanners.contains(key) else { return }
        editorPane.showBanner(key: key, title: sentence)
    }

    private func showSaveNotice(_ sentence: String) {
        let key = "save.notice"
        editorPane.showBanner(key: key, title: sentence)
        Task {
            try? await Task.sleep(for: Self.saveNoticeTime)
            guard !Task.isCancelled else { return }
            editorPane.clearBanner(key: key)
        }
    }

    private func hoverValue(of expression: String, at location: FileLocation) async -> HoverValue? {
        guard isPaused, case let .success(variable)? = await services.debugger.hoverValue(of: expression, at: location) else {
            return nil
        }
        return HoverValue(value: variable.value, type: variable.type)
    }

    func refreshInlineValues() {
        inlineValuesTask?.cancel()
        let debugger = services.debugger
        guard isPaused, let url = debugger.selectedFrame?.url?.standardizedFileURL else {
            guard !lineNotes.isEmpty else { return }
            lineNotes = [:]
            return editor.lineNotesDidChange()
        }
        let lines = sourceLines(of: url)
        inlineValuesTask = Task {
            var values: [InlineValue] = []
            for _ in 0..<Self.inlineValueAttempts {
                values = await debugger.inlineValues(in: url) { lines.indices.contains($0) ? lines[$0] : nil }
                guard values.isEmpty, isPaused else { break }
                try? await Task.sleep(for: Self.inlineValueRetry)
                guard !Task.isCancelled else { return }
            }
            guard !Task.isCancelled else { return }
            let byLine = Dictionary(grouping: values, by: \.line)
            let language = url.pathExtension
            lineNotes = [url: byLine.keys.sorted().map { line in
                let notes = byLine[line] ?? []
                let named = notes.filter { note in notes.first { $0.name == note.name } == note }
                return Self.inlineNote(named, line: line, language: language, isChanged: notes.contains(where: \.isChanged))
            }]
            editor.lineNotesDidChange()
        }
    }

    static let inlineGap = "   "

    static func inlineNote(_ values: [InlineValue], line: Int, language: String, isChanged: Bool) -> LineNote {
        var text = ""
        var syntax: [(range: NSRange, color: SyntaxColor)] = []
        for value in values {
            if !text.isEmpty { text += inlineGap }
            var shown = value.text
            while shown.hasPrefix(value.name + ": ") { shown.removeFirst(value.name.count + 2) }
            text += value.name + ": "
            let start = (text as NSString).length
            text += shown
            syntax += CodeColors.ranges(in: shown, language: language).map { item in
                (NSRange(location: item.range.location + start, length: item.range.length), item.color)
            }
        }
        return LineNote(zeroBasedLine: line, text: text, isChanged: isChanged, syntax: syntax)
    }

    func sourceLines(of url: URL) -> [String] {
        let text = editor.text(of: url) ?? (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        return text.components(separatedBy: "\n")
    }
}
