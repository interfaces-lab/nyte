import AppKit
import NyteChanges
import NyteCore
@testable import NyteShell

@MainActor
enum AllCheck {
    struct Section {
        let name: String
        let checks: Int
        let failures: [String]
    }

    static func run(_ shell: ShellViewController, preferences: PreferencesCenter) async -> [Section] {
        var sections: [Section] = []
        sections.append(Section(name: "command table", checks: Commands.all.count, failures: CommandCheck.table()))
        progress("switcher")
        sections.append(Section(name: "recent-files switcher", checks: SwitcherCheck.checks, failures: await SwitcherCheck.run(shell)))
        progress("wiring")
        sections.append(Section(name: "navigator, terminal and Changes wiring", checks: WiringCheck.checks,
                                failures: await WiringCheck.run(shell)))
        var validations = 0
        var focusFailures: [String] = []
        for focus in CommandCheck.Focus.allCases {
            progress("focus \(focus.rawValue)")
            let reached = await enter(focus, shell: shell)
            if !reached { focusFailures.append("\(focus.rawValue): focus is \(CommandCheck.focusDescription(shell))") }
            let tally = CommandCheck.validate(in: focus, shell: shell)
            validations += tally.validations
            focusFailures += tally.failures
            if focus == .composer {
                let context = await ContextCheck.run(shell)
                sections.append(Section(name: "context wiring", checks: 7, failures: context))
            }
        }
        sections.append(Section(name: "validation in 6 focuses", checks: validations, failures: focusFailures))
        progress("keys")
        sections.append(Section(name: "key routing", checks: KeyCheck.toTerminal.count + KeyCheck.staysWithApp.count,
                                failures: KeyCheck.run(shell)))
        sections.append(Section(name: "close warnings", checks: CloseCheck.cases.count, failures: CloseCheck.run()))
        sections.append(Section(name: "preferences", checks: 8, failures: PreferencesCheck.run(preferences, shell: shell)))
        progress("layout")
        sections.append(Section(name: "review layout", checks: LayoutCheck.checks, failures: await LayoutCheck.run(shell)))
        progress("window menu")
        sections.append(Section(name: "window menu", checks: 2, failures: await LayoutCheck.windowMenu(preferences)))
        progress("state")
        sections.append(Section(name: "state round trip", checks: 12,
                                failures: await StateCheck.run(stateWorkspace(shell), preferences: preferences)))
        return sections
    }

    static func progress(_ step: String) {
        FileHandle.standardError.write(Data("… \(step)\n".utf8))
    }

    private static func stateWorkspace(_ shell: ShellViewController) -> Workspace {
        Workspace(root: shell.workspace.root)
    }

    private static func enter(_ focus: CommandCheck.Focus, shell: ShellViewController) async -> Bool {
        let window = shell.view.window
        let focused = { (root: NSView) in (window?.firstResponder as? NSView)?.isDescendant(of: root) ?? false }
        switch focus {
        case .editor:
            shell.editor.focus()
            return focused(shell.editor.view)
        case .terminal:
            shell.showToolWindow(.terminal)
            shell.terminal.focusTerminal()
            return focused(shell.terminal.view)
        case .navigator:
            shell.setSidebar(open: true, from: nil)
            shell.sidebar.select(id: "files")
            window?.makeFirstResponder(views(of: NSTableView.self, in: shell.navigator.view).first)
            return focused(shell.navigator.view)
        case .diff:
            let diff = DiffViewController(source: .texts(path: "hub/hub.go", before: DiffText(title: "Before", text: "one\n"),
                                                         after: DiffText(title: "After", text: "two\n")))
            shell.openDiff(diff)
            await Wait.pause(.milliseconds(500))
            diff.focus()
            return focused(diff.view)
        case .composer:
            shell.setAgent(open: true, from: nil)
            shell.agent.focusComposer()
            return focused(shell.agent.view)
        case .noDocument:
            shell.editorPane.documents.map(\.id).forEach(shell.editorPane.closeDocument)
            while let last = shell.editor.tabs.indices.last { shell.editor.close(at: last) }
            window?.makeFirstResponder(nil)
            return shell.editor.tabs.isEmpty && shell.editorPane.documents.isEmpty
        }
    }
}

enum CloseCheck {
    struct Case {
        let risks: [CloseRisk]
        let action: CloseAction
        let asks: Bool
        let detail: String?
    }

    static let cases: [Case] = [
        Case(risks: [CloseRisk(project: "go")], action: .quit, asks: true, detail: nil),
        Case(risks: [CloseRisk(project: "go", program: "server")], action: .quit, asks: false, detail: nil),
        Case(risks: [CloseRisk(project: "go", unsaved: ["hub.go"])], action: .close, asks: true,
             detail: "Closing the window discards changes to \u{201C}hub.go\u{201D}."),
        Case(risks: [CloseRisk(project: "go", unsaved: ["a.go", "b.go", "c.go", "d.go"], program: "hub")], action: .close, asks: true,
             detail: "Closing the window discards changes to \u{201C}a.go\u{201D}, \u{201C}b.go\u{201D}, \u{201C}c.go\u{201D} and 1 other file and stops hub, which is running under the debugger."),
        Case(risks: [CloseRisk(project: "go", unsaved: ["a.go"]), CloseRisk(project: "ts", program: "node")], action: .quit, asks: true,
             detail: "Quitting discards changes to \u{201C}a.go\u{201D} in go and stops node in ts, which is running under the debugger."),
    ]

    static func run() -> [String] {
        cases.enumerated().compactMap { index, item in
            let detail = CloseWarning.decide(item.risks, action: item.action, asksForPrograms: item.asks)?.detail
            return detail == item.detail ? nil : "close case \(index): \(detail ?? "no warning")"
        }
    }
}
