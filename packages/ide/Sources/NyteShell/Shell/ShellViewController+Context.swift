import AppKit
import NyteChanges
import NyteCore
import NyteTerminal

extension ShellViewController {
    static let diffRefreshDelay = Duration.milliseconds(400)

    func wireContext() {
        editor.onAskAgent = { [weak self] context in self?.ask([context]) }
        problems.onAskAgent = { [weak self] url, diagnostic in self?.ask([Self.context(of: diagnostic, in: url)]) }
        debugView.onAskAgent = { [weak self] context in self?.ask([context]) }
    }

    func ask(_ items: [AgentContext]) {
        setAgent(open: true, from: nil)
        agent.addContext(items)
        agent.focusComposer()
    }

    func askNyte() {
        let selector = #selector(TerminalCommands.askNyte(_:))
        if let responder = firstResponder(handling: selector), responder !== self {
            NSApp.sendAction(selector, to: responder, from: nil)
            return
        }
        guard isEditorFocused, let selected = lastPosition?.selected, selected > 0, let context = editor.selectionContext() else {
            return ask([])
        }
        ask([.lines(Self.lines(context))])
    }

    private func firstResponder(handling selector: Selector) -> NSResponder? {
        var responder = view.window?.firstResponder
        while let current = responder {
            if current.responds(to: selector) {
                let item = NSMenuItem(title: "", action: selector, keyEquivalent: "")
                let enabled = (current as? NSMenuItemValidation)?.validateMenuItem(item)
                    ?? (current as? NSUserInterfaceValidations)?.validateUserInterfaceItem(item) ?? true
                return enabled ? current : nil
            }
            responder = current.nextResponder
        }
        return nil
    }

    static func lines(_ context: (url: URL, range: TextSpan, text: String)) -> AgentContext.Lines {
        let start = context.range.start.line
        let end = context.range.end.column == 0 && context.range.end.line > start ? context.range.end.line - 1 : context.range.end.line
        return AgentContext.Lines(file: context.url, range: AgentContext.LineRange(first: start + 1, last: end + 1), text: context.text)
    }

    static func context(of diagnostic: Diagnostic, in url: URL) -> AgentContext {
        let severity: AgentContext.Diagnostic.Severity = switch diagnostic.severity {
        case .error: .error
        case .warning: .warning
        case .information: .information
        case .hint: .hint
        }
        let range = diagnostic.range
        return .diagnostic(AgentContext.Diagnostic(
            file: url, start: AgentContext.Position(line: range.start.line + 1, column: range.start.column + 1),
            end: AgentContext.Position(line: range.end.line + 1, column: range.end.column + 1), severity: severity,
            message: diagnostic.message, source: diagnostic.source, code: diagnostic.code
        ))
    }

    func bufferDidChange(_ url: URL) {
        let url = url.standardizedFileURL
        guard openDiffs.contains(where: { Self.file(of: $0.source) == url }) else { return }
        diffRefresh?.cancel()
        diffRefresh = Task { [weak self] in
            try? await Task.sleep(for: Self.diffRefreshDelay)
            guard !Task.isCancelled, let self else { return }
            for diff in openDiffs where Self.file(of: diff.source) == url { diff.refresh() }
        }
    }

    var openDiffs: [DiffViewController] {
        editorPane.documents.compactMap { $0.controller as? DiffViewController }
    }

    private static func file(of source: DiffSource) -> URL? {
        switch source {
        case let .repository(git, path, _), let .revisions(git, path, _, _): git.url(of: path).standardizedFileURL
        case .texts: nil
        }
    }
}
