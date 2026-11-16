import AppKit
import NyteCore
import NyteUI

@MainActor
final class ActionsFeature: EditorFeature {
    static let bulbRest = Duration.milliseconds(300)

    private unowned let editor: EditorViewController
    private let note = QuietNote()
    private var request: Task<Void, Never>?
    private var bulbRequest: Task<Void, Never>?
    private var bulb: (line: Int, revision: Int, kind: Lightbulb)?

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func documentDidChange() {
        request?.cancel()
        note.dismiss()
        if let ruler = editor.scrollView.verticalRulerView as? LineNumberRuler, ruler.onClickLightbulb == nil {
            ruler.lightbulb = { [weak self] in self?.shownBulb }
            ruler.onClickLightbulb = { [weak self] _ in self?.showActions() }
        }
        setBulb(nil)
        askForBulb()
    }

    func selectionDidChange() { askForBulb() }
    func textDidChange(in range: NSRange, delta: Int) { setBulb(nil) }
    func intelligenceDidReport(_ event: IntelligenceEvent) {
        if case let .diagnostics(url) = event, url.standardizedFileURL == editor.url { askForBulb() }
    }

    private var shownBulb: (line: Int, kind: Lightbulb)? {
        guard let bulb, bulb.revision == editor.revision else { return nil }
        return (bulb.line, bulb.kind)
    }

    private func setBulb(_ new: (line: Int, revision: Int, kind: Lightbulb)?) {
        guard new?.line != bulb?.line || new?.kind != bulb?.kind || new?.revision != bulb?.revision else { return }
        bulb = new
        editor.scrollView.verticalRulerView?.needsDisplay = true
    }

    private func askForBulb() {
        bulbRequest?.cancel()
        guard editor.isAssisted, let url = editor.url, let intelligence = editor.intelligence,
              let lines = editor.lineIndex, let range = actionRange(in: url, intelligence)
        else { return setBulb(nil) }
        let line = lines.line(at: editor.caretRange.location)
        if bulb?.line != line { setBulb(nil) }
        let revision = editor.revision
        bulbRequest = Task { [weak self] in
            try? await Task.sleep(for: Self.bulbRest)
            guard !Task.isCancelled else { return }
            let actions = await intelligence.actions(in: range, of: url)
            guard let self, !Task.isCancelled, editor.revision == revision, editor.url == url else { return }
            let usable = actions.filter { $0.disabledReason.isEmpty }
            guard !usable.isEmpty else { return setBulb(nil) }
            let fixes = usable.contains { Self.group($0.kind) == 0 }
            let severities = intelligence.diagnostics(for: url).filter { $0.range.start.line <= line && line <= $0.range.end.line }.map(\.severity)
            let kind: Lightbulb = !fixes ? .intention : severities.contains(.error) ? .fixesError : .fixesWarning
            setBulb((line, revision, kind))
        }
    }

    func canPerform(_ command: EditorCommand) -> Bool {
        (command == .showContextActions || command == .formatDocument) && editor.isAssisted
    }

    func perform(_ command: EditorCommand) -> Bool {
        guard editor.isAssisted else { return false }
        switch command {
        case .showContextActions: showActions()
        case .formatDocument: format()
        default: return false
        }
        return true
    }

    func showActions() {
        guard let url = editor.url, let intelligence = editor.intelligence, let range = actionRange(in: url, intelligence) else { return }
        let revision = editor.revision
        let caret = editor.caretRange
        request?.cancel()
        request = Task { [weak self] in
            let actions = await intelligence.actions(in: range, of: url)
            guard let self, !Task.isCancelled, editor.revision == revision, editor.caretRange == caret else { return }
            present(actions, at: caret.location)
        }
    }

    private func actionRange(in url: URL, _ intelligence: any LanguageIntelligence) -> TextSpan? {
        let selection = editor.caretRange
        if selection.length > 0 { return editor.span(of: selection) }
        guard let position = editor.position(at: selection.location) else { return nil }
        let problems = intelligence.diagnostics(for: url).filter { $0.range.start.line <= position.line && position.line <= $0.range.end.line }
        guard let first = problems.first else { return TextSpan(at: position) }
        return problems.dropFirst().reduce(first.range) { span, problem in
            TextSpan(start: min(span.start, problem.range.start), end: max(span.end, problem.range.end))
        }
    }

    private func present(_ actions: [CodeAction], at caret: Int) {
        guard let rect = editor.caretRect(at: caret) else { return }
        guard !actions.isEmpty else { return note.show("No actions here", at: rect, in: editor.textView) }
        let menu = Menu.make(Self.items(for: actions) { [weak self] action in self?.run(action) })
        menu.popUp(positioning: nil, at: NSPoint(x: rect.minX, y: rect.maxY), in: editor.textView)
    }

    static func items(for actions: [CodeAction], run: @escaping @MainActor (CodeAction) -> Void) -> [MenuItem] {
        let groups = actions.enumerated()
            .sorted { left, right in
                let a = group(left.element.kind), b = group(right.element.kind)
                if a != b { return a < b }
                if left.element.isPreferred != right.element.isPreferred { return left.element.isPreferred }
                return left.offset < right.offset
            }
            .map(\.element)
        var items: [MenuItem] = []
        var last: Int?
        for action in groups {
            let group = group(action.kind)
            if let last, last != group { items.append(.separator) }
            last = group
            items.append(MenuItem(action.title, enabled: action.disabledReason.isEmpty, subtitle: action.disabledReason) {
                run(action)
            })
        }
        return items
    }

    private static let groups: [[CodeAction.Kind]] = [
        [.quickFix, .fixAll], [.refactor, .extract, .inline, .rewrite], [.source, .organizeImports], [.other],
    ]

    private static func group(_ kind: CodeAction.Kind) -> Int {
        groups.firstIndex { $0.contains(kind) } ?? groups.count
    }

    private func run(_ action: CodeAction) {
        guard let intelligence = editor.intelligence else { return }
        let caret = editor.caretRange.location
        Task { [weak self] in
            guard case .failure(let failure) = await intelligence.perform(action), let self,
                  let rect = editor.caretRect(at: min(caret, editor.shownText.length))
            else { return }
            note.show(failure.message, at: rect, in: editor.textView)
        }
    }

    private func format() {
        guard let url = editor.url, let intelligence = editor.intelligence else { return }
        let indent = editor.textView.indent
        let revision = editor.revision
        request?.cancel()
        request = Task { [weak self] in
            let edits = await intelligence.formatting(for: url, indent: indent.width, usesTabs: indent.usesTabs)
            guard let self, !Task.isCancelled, editor.revision == revision, editor.url == url, !edits.isEmpty else { return }
            let caret = editor.caretRange
            let ranges = edits.compactMap { edit in editor.range(of: edit.range).map { ($0, (edit.text as NSString).length) } }
            guard ranges.count == edits.count, editor.edit(edits) else { return }
            let location = Self.follow(caret.location, through: ranges)
            let end = Self.follow(NSMaxRange(caret), through: ranges)
            editor.textView.setSelectedRange(NSRange(location: location, length: max(0, end - location)))
        }
    }

    static func follow(_ offset: Int, through edits: [(range: NSRange, inserted: Int)]) -> Int {
        var shift = 0
        for edit in edits.sorted(by: { $0.range.location < $1.range.location }) {
            if NSMaxRange(edit.range) <= offset {
                shift += edit.inserted - edit.range.length
            } else if edit.range.location < offset {
                return edit.range.location + shift + min(offset - edit.range.location, edit.inserted)
            } else {
                break
            }
        }
        return offset + shift
    }
}
