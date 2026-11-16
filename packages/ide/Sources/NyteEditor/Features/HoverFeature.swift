import AppKit
import NyteCore
import NyteUI

@MainActor
final class HoverFeature: EditorFeature {
    static let rest = Duration.milliseconds(350)
    static let grace = Duration.milliseconds(200)
    static let actionGap = Space.x2

    private unowned let editor: EditorViewController
    private let panel = FloatingPanel(radius: Radius.card, presentation: .hover)
    private let view = DocumentationView()
    private let note = QuietNote()
    private let actions = NSStackView()
    private var askedProblem: Diagnostic?
    private lazy var viewHeight = view.heightAnchor.constraint(equalToConstant: 0)
    private var restingOn: Int?
    private var shownRange: NSRange?
    private var isPointerInPanel = false
    private var isAtCaret = false
    private var waiting: Task<Void, Never>?
    private var hiding: Task<Void, Never>?

    init(editor: EditorViewController) {
        self.editor = editor
        actions.setViews([Button("Ask Nyte", variant: .ghost, size: .sm) { [weak self] in self?.askAboutProblem() }], in: .leading)
        actions.edgeInsets = NSEdgeInsets(top: 0, left: DocumentationView.inset - Size.sm.padding, bottom: Self.actionGap,
                                          right: DocumentationView.inset)
        let stack = NSStackView(views: [view, actions])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 0
        viewHeight.isActive = true
        panel.content = stack
        panel.onDismiss = { [weak self] in self?.panelDismissed() }
        view.onHover = { [weak self] inside in self?.pointerInPanel(inside) }
    }

    func pointerMoved(to point: NSPoint, offset: Int?, modifiers: NSEvent.ModifierFlags) {
        guard editor.isAssisted || editor.valueHover != nil, !modifiers.contains(.command) else { return stopWaiting() }
        if let shownRange, panel.isShown, !isAtCaret {
            if let offset, Self.covers(shownRange, offset) { return cancelHiding() }
            scheduleHiding()
        }
        let shown = editor.shownText
        guard let offset, offset < shown.length, !Self.isBlank(shown.character(at: offset)) else { return stopWaiting() }
        guard offset != restingOn else { return }
        restingOn = offset
        waiting?.cancel()
        waiting = Task { [weak self] in
            try? await Task.sleep(for: Self.rest)
            guard !Task.isCancelled else { return }
            self?.ask(at: offset, atCaret: false)
        }
    }

    func pointerExited() {
        stopWaiting()
        if panel.isShown, !isAtCaret { scheduleHiding() }
    }

    private func pointerInPanel(_ inside: Bool) {
        isPointerInPanel = inside
        if inside { cancelHiding() } else if !isAtCaret { scheduleHiding() }
    }

    private func stopWaiting() {
        waiting?.cancel()
        waiting = nil
        restingOn = nil
    }

    private func scheduleHiding() {
        guard hiding == nil else { return }
        hiding = Task { [weak self] in
            try? await Task.sleep(for: Self.grace)
            guard let self, !Task.isCancelled else { return }
            hiding = nil
            if !isPointerInPanel { hide() }
        }
    }

    private func cancelHiding() {
        hiding?.cancel()
        hiding = nil
    }

    func documentDidChange() { hide() }
    func textDidChange(in range: NSRange, delta: Int) { hide() }
    func viewportDidChange() { hide() }
    func focusDidLeave() { if !isPointerInPanel { hide() } }

    func selectionDidChange() {
        if isAtCaret { hide() }
    }

    func handleClick(at offset: Int, event: NSEvent) -> Bool {
        hide()
        return false
    }

    func canPerform(_ command: EditorCommand) -> Bool {
        command == .showDocumentation && (editor.isAssisted || editor.valueHover != nil)
    }

    func perform(_ command: EditorCommand) -> Bool {
        guard canPerform(command) else { return false }
        ask(at: editor.caretRange.location, atCaret: true)
        return true
    }

    private func ask(at offset: Int, atCaret: Bool) {
        guard let url = editor.url, let position = editor.position(at: offset) else { return }
        let revision = editor.revision
        let word = Identifier.range(at: offset, in: editor.shownText) ?? NSRange(location: offset, length: 1)
        let intelligence = editor.isAssisted ? editor.intelligence : nil
        let problems = (intelligence?.diagnostics(for: url) ?? [])
            .filter { problem in
                guard let range = editor.range(of: problem.range) else { return false }
                if range.length > 0 { return NSLocationInRange(offset, range) }
                return range.location >= word.location && range.location <= NSMaxRange(word)
            }
            .sorted { $0.severity.isMoreSevere(than: $1.severity) }
        let expression = ValueExpression.range(at: offset, selection: editor.caretRange, in: editor.shownText)
        let valueHover = editor.valueHover
        waiting = Task { [weak self] in
            if let valueHover, let expression, let self {
                let text = editor.shownText.substring(with: expression)
                let answer = await valueHover(url, position, text)
                guard !Task.isCancelled, editor.revision == revision, editor.url == url, atCaret || restingOn == offset else { return }
                if let answer { return showValue(answer, of: text, over: expression, atCaret: atCaret) }
            }
            guard let intelligence else { return }
            let hover = await intelligence.hover(at: position, in: url)
            guard let self, !Task.isCancelled, editor.revision == revision, editor.url == url else { return }
            guard atCaret || restingOn == offset else { return }
            show(hover, problems: problems, at: offset, atCaret: atCaret)
        }
    }

    private func showValue(_ value: HoverValue, of expression: String, over range: NSRange, atCaret: Bool) {
        let type = value.type.isEmpty ? "" : "\n\n`" + value.type + "`"
        view.language = editor.fenceLanguage
        askedProblem = nil
        actions.isHidden = true
        let markdown = "```\n" + expression + " = " + value.value + "\n```" + type
        view.show(notes: [], markdown: markdown)
        let size = view.fittingSize(maxWidth: Self.width(of: markdown, notes: []))
        viewHeight.constant = size.height
        guard let anchor = editor.rects(for: range).first else { return }
        isAtCaret = atCaret
        shownRange = range
        cancelHiding()
        panel.show(size: size, anchoredTo: NSRect(x: anchor.minX - DocumentationView.inset, y: anchor.minY,
                                                                width: anchor.width, height: anchor.height),
                   in: editor.textView)
    }

    private func show(_ hover: Hover?, problems: [Diagnostic], at offset: Int, atCaret: Bool) {
        let markdown = hover?.markdown ?? ""
        let range = hover?.range.flatMap(editor.range(of:)).flatMap { $0.length > 0 ? $0 : nil }
            ?? Identifier.range(at: offset, in: editor.shownText)
            ?? NSRange(location: offset, length: 1)
        guard !markdown.isEmpty || !problems.isEmpty else {
            if atCaret, let rect = editor.caretRect(at: offset) {
                note.show("No documentation", at: rect, in: editor.textView)
            }
            return
        }
        let size = fill(markdown: markdown, problems: problems)
        guard let anchor = editor.rects(for: range).first else { return }
        isAtCaret = atCaret
        shownRange = range
        cancelHiding()
        panel.show(size: size, anchoredTo: NSRect(x: anchor.minX - DocumentationView.inset, y: anchor.minY,
                                                                width: anchor.width, height: anchor.height),
                   in: editor.textView)
    }

    var content: NSView? { panel.content }

    func fill(markdown: String, problems: [Diagnostic]) -> NSSize {
        view.language = editor.fenceLanguage
        view.show(notes: problems.map(Self.note), markdown: markdown)
        askedProblem = editor.onAskAgent == nil ? nil : problems.first
        actions.isHidden = askedProblem == nil
        let fitted = view.fittingSize(maxWidth: Self.width(of: markdown, notes: problems.map(\.message)))
        viewHeight.constant = fitted.height
        return actions.isHidden ? fitted : NSSize(width: fitted.width, height: fitted.height + Size.sm.height + Self.actionGap)
    }

    private func askAboutProblem() {
        guard let problem = askedProblem else { return }
        hide()
        editor.askAgent(about: problem)
    }

    static func width(of markdown: String, notes: [String]) -> CGFloat {
        guard markdown.contains("```"), !markdown.contains("|") else { return DocumentationView.maxWidth }
        var isCode = false
        var widest = notes.map { Draw.width(of: $0) + Glyph.md.rawValue + Space.x2 }.max() ?? 0
        for line in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("```") {
                isCode.toggle()
                continue
            }
            let width = isCode ? Draw.width(of: String(line), style: .code) + Self.codeChrome : Draw.width(of: String(line))
            widest = max(widest, width)
        }
        return min(max(widest.rounded(.up) + DocumentationView.inset * 2, DocumentationView.minWidth), DocumentationView.maxWidth)
    }

    private static let codeChrome = CodePanel.inset * 2 + CodePanel.header + Metric.hairline * 2

    private static func note(_ problem: Diagnostic) -> DocumentationNote {
        let detail = [problem.source, problem.code].filter { !$0.isEmpty && $0 != "default" }.joined(separator: " · ")
        return switch problem.severity {
        case .error: DocumentationNote(symbol: "xmark.octagon.fill", tone: .danger, message: problem.message, detail: detail)
        case .warning: DocumentationNote(symbol: "exclamationmark.triangle.fill", tone: .warning, message: problem.message, detail: detail)
        case .information: DocumentationNote(symbol: "info.circle.fill", tone: .primary, message: problem.message, detail: detail)
        case .hint: DocumentationNote(symbol: "lightbulb", tone: .neutral, message: problem.message, detail: detail)
        }
    }

    private func hide() {
        stopWaiting()
        cancelHiding()
        note.dismiss()
        shownRange = nil
        isAtCaret = false
        isPointerInPanel = false
        if panel.isShown { panel.dismiss() }
    }

    private func panelDismissed() {
        guard !panel.isShown else { return }
        shownRange = nil
        isAtCaret = false
    }

    private static func covers(_ range: NSRange, _ offset: Int) -> Bool {
        offset >= range.location && offset < NSMaxRange(range)
    }

    private static func isBlank(_ unit: UInt16) -> Bool {
        unit == UInt16(UInt8(ascii: " ")) || unit == UInt16(UInt8(ascii: "\t")) || unit == UInt16(UInt8(ascii: "\n")) || unit == UInt16(UInt8(ascii: "\r"))
    }
}

public struct HoverValue: Sendable, Equatable {
    public var value: String
    public var type: String

    public init(value: String, type: String = "") {
        self.value = value
        self.type = type
    }
}

enum ValueExpression {
    static let dot = UInt16(UInt8(ascii: "."))

    static func range(at offset: Int, selection: NSRange, in text: some UnitString) -> NSRange? {
        if selection.length > 0, NSLocationInRange(offset, selection) { return selection }
        guard let word = Identifier.range(at: offset, in: text) else { return nil }
        var start = word.location
        while start > 1, text.character(at: start - 1) == dot, Identifier.isPart(text.character(at: start - 2)) {
            start = Identifier.start(before: start - 1, in: text)
        }
        return NSRange(location: start, length: NSMaxRange(word) - start)
    }
}
