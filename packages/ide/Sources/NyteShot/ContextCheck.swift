import AppKit
import NyteAgent
import NyteChanges
import NyteCore
@testable import NyteShell

@MainActor
enum ContextCheck {
    static func draft(of agent: AgentViewController) -> [AgentContext]? {
        agent.draftContext
    }

    static func run(_ shell: ShellViewController) async -> [String] {
        let root = shell.workspace.root
        let file = root.appendingPathComponent("hub/hub.go").standardizedFileURL
        let source = ((try? String(contentsOf: file, encoding: .utf8)) ?? "").components(separatedBy: "\n")
        let excerpt = source[11..<16].joined(separator: "\n")
        let lines = AgentContext.Lines(file: file, range: AgentContext.LineRange(first: 12, last: 16), text: excerpt)
        let start = TextPosition(line: 24, column: 4), end = TextPosition(line: 24, column: 22)
        let problem = Diagnostic(range: TextSpan(start: start, end: end), severity: .warning, message: "unused variable", source: "gopls",
                                 code: "unusedvar")
        let diagnostic = AgentContext.Diagnostic(file: file, start: AgentContext.Position(line: 25, column: 5),
                                                 end: AgentContext.Position(line: 25, column: 23), severity: .warning,
                                                 message: "unused variable", source: "gopls", code: "unusedvar")
        let review = AgentContext.Review(file: file, side: .new, range: AgentContext.LineRange(first: 3, last: 4), lines: "import (\n",
                                         comment: "Why a new import?")
        let terminal = AgentContext.Terminal(text: "--- FAIL: TestHub (0.00s)", directory: root)
        let stop = AgentContext.Stop(file: file, line: 40, function: "hub.(*Hub).Send",
                                     locals: [AgentContext.Stop.Local(name: "message", type: "hub.Message", value: "{Channel: \"mail\"}")])
        let diff = DiffViewController(source: .texts(path: "hub/hub.go", before: DiffText(title: "Before", text: "a\n"),
                                                     after: DiffText(title: "After", text: "b\n")))
        shell.openDiff(diff)
        let changes = AgentChangeSet(session: "s", scope: .run(turn: "t"), title: "Context check", root: root, files: [
            .init(path: "hub/hub.go", status: .modified, content: .texts(before: "a\n", after: "b\n"), added: 1, removed: 1),
        ])
        shell.openReview(changes)
        let review2 = shell.editorPane.documents.compactMap { $0.controller as? ReviewViewController }.last
        let sources: [(String, AgentContext, () -> Void)] = [
            ("editor Ask Nyte item", .lines(lines), { shell.editor.onAskAgent?(.lines(lines)) }),
            ("Problems Ask Nyte", .diagnostic(diagnostic), { shell.problems.onAskAgent?(file, problem) }),
            ("diff Send Comments", .review(review), { diff.onSendComments?([.review(review)]) }),
            ("review Send Comments", .terminal(terminal), { review2?.onSendComments?([.terminal(terminal)]) }),
            ("Find in Files Ask Nyte", .lines(lines), { shell.search.onAskAgent?([.lines(lines)]) }),
            ("debugger Ask Nyte", .stop(stop), { shell.debugView.onAskAgent?(.stop(stop)) }),
        ]
        var failures: [String] = []
        for (name, expected, fire) in sources {
            shell.setAgent(open: false, from: nil)
            shell.view.window?.makeFirstResponder(views(of: NSTableView.self, in: shell.navigator.view).first)
            fire()
            failures += verify(name, expected: expected, shell: shell)
        }
        shell.editorPane.documents.map(\.id).forEach(shell.editorPane.closeDocument)
        shell.editor.open(file, preview: false)
        _ = await Wait.until(.seconds(5)) { shell.editor.selectionContext()?.url == file }
        shell.editor.reveal(FileLocation(url: file, range: TextSpan(at: TextPosition(line: 11, column: 0))), asJump: false)
        shell.editor.focus()
        for _ in 0..<5 { _ = shell.view.window?.firstResponder?.tryToPerform(#selector(NSResponder.moveDownAndModifySelection(_:)), with: nil) }
        _ = await Wait.until(.seconds(5)) { (shell.lastPosition?.selected ?? 0) > 0 }
        shell.setAgent(open: false, from: nil)
        shell.editor.focus()
        shell.run(.askNyte, from: nil)
        failures += verify("⌘L with a selection", expected: .lines(AgentContext.Lines(file: file, range: lines.range, text: lines.text + "\n")),
                           shell: shell)
        return failures
    }

    private static func verify(_ name: String, expected: AgentContext, shell: ShellViewController) -> [String] {
        var failures: [String] = []
        if shell.agentItem.isCollapsed { failures.append("\(name): the agent pane stayed collapsed") }
        guard let draft = draft(of: shell.agent) else { return failures + ["\(name): the agent's draft could not be read"] }
        if !draft.contains(expected) { failures.append("\(name): draft lacks \(expected); last is \(String(describing: draft.last))") }
        let focused = (shell.view.window?.firstResponder as? NSView)?.isDescendant(of: shell.agent.view) ?? false
        if !focused { failures.append("\(name): focus is \(CommandCheck.focusDescription(shell)), not the composer") }
        return failures
    }
}
