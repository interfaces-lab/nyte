import AppKit
import NyteCore
import NyteUI

extension EditorViewController {
    public static let selectionContextLimit = 32_768

    public func selectionContext() -> (url: URL, range: TextSpan, text: String)? {
        guard let document = shown, let lines = lineIndex else { return nil }
        let text = document.text
        let selection = textView.selectedRange()
        let range = selection.length == 0
            ? lines.range(of: lines.line(at: selection.location), length: text.length)
            : Self.capped(selection, in: document.store)
        guard let span = span(of: range) else { return nil }
        return (document.url, span, text.substring(with: range))
    }

    func askAgentAboutSelection() {
        guard let onAskAgent, let context = selectionContext(), let lines = lineIndex else { return }
        let whole = textView.selectedRange()
        let total = whole.length == 0 ? 1 : lines.line(at: max(whole.location, NSMaxRange(whole) - 1)) - lines.line(at: whole.location) + 1
        let range = AgentContext.LineRange(first: context.range.start.line + 1, last: max(context.range.start.line, context.range.end.line) + 1)
        var shared = AgentContext.Lines(file: context.url, range: range, text: context.text)
        if range.count < total { shared.clip = AgentContext.Clip(kept: range.count, total: total) }
        onAskAgent(.lines(shared))
    }

    func askAgent(about problem: Diagnostic) {
        guard let onAskAgent, let url else { return }
        let severity: AgentContext.Diagnostic.Severity = switch problem.severity {
        case .error: .error
        case .warning: .warning
        case .information: .information
        case .hint: .hint
        }
        onAskAgent(.diagnostic(AgentContext.Diagnostic(
            file: url,
            start: AgentContext.Position(line: problem.range.start.line + 1, column: problem.range.start.column + 1),
            end: AgentContext.Position(line: problem.range.end.line + 1, column: problem.range.end.column + 1),
            severity: severity, message: problem.message, source: problem.source, code: problem.code
        )))
    }

    func addingAskItem(to menu: NSMenu?) -> NSMenu? {
        guard let menu, onAskAgent != nil, shown != nil else { return menu }
        let ask = Menu.make([MenuItem("Ask Nyte") { [weak self] in self?.askAgentAboutSelection() }, .separator])
        for item in ask.items.reversed() {
            ask.removeItem(item)
            menu.insertItem(item, at: 0)
        }
        return menu
    }

    private static func capped(_ selection: NSRange, in store: TextStore) -> NSRange {
        guard selection.length > selectionContextLimit else { return selection }
        let limit = selection.location + selectionContextLimit
        let lineStart = store.lineStart(at: limit)
        let end = lineStart > selection.location ? lineStart : TextUnits.clusterStart(before: limit + 1, in: store)
        return NSRange(location: selection.location, length: max(end, selection.location) - selection.location)
    }
}
