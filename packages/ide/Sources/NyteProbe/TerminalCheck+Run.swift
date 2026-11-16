import AppKit
import NyteCore
@testable import NyteTerminal

extension TerminalCheck {
    func runInTerminal() async {
        let table: [([String], String)] = [
            (["ls", "-la"], "ls -la"),
            (["echo", "a b"], "echo 'a b'"),
            (["echo", "it's"], "echo 'it'\\''s'"),
            (["echo", "say \"hi\""], "echo 'say \"hi\"'"),
            (["echo", ""], "echo ''"),
            (["echo", "$HOME", "*", "a;b", "`x`"], "echo '$HOME' '*' 'a;b' '`x`'"),
            (["echo", "tab\there"], "echo 'tab\there'"),
        ]
        for (arguments, want) in table {
            let got = TerminalViewController.commandLine(arguments)
            expect(got == want, "run in terminal: \(arguments) is typed as \(want)", got)
        }

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-run-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let argument = "it's a \"quoted\" arg"
        let command = ["printf", "<%s>\\n", argument]
        let controller = TerminalViewController(workspace: Workspace(root: folder), command: command,
                                                preferences: TerminalPreferences(shellPath: "/bin/zsh"))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 400), styleMask: [.titled], backing: .buffered,
                              defer: true)
        window.contentView = controller.view
        window.contentView?.layoutSubtreeIfNeeded()
        let view = controller.terminalView
        func settle(_ seconds: Double = 15, _ condition: () -> Bool) async -> Bool {
            await until(seconds) {
                view.session?.enqueue { $0.produceFrame() }
                return condition()
            }
        }
        let lines = { view.screenText.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) } }
        let ran = await settle { lines().contains("<\(argument)>") }
        expect(ran, "run in terminal: an argument with spaces and both quotes reaches the program unchanged", view.screenText)
        let typed = TerminalViewController.commandLine(command)
        expect(view.screenText.contains(typed), "run in terminal: the command shows at the prompt as typed", typed)
        let echoes = view.screenText.components(separatedBy: typed).count - 1
        expect(echoes == 1, "run in terminal: the command is typed once", "\(echoes) times")
        view.session?.enqueue { $0.text("echo still-$((1+1))\r") }
        let stays = await settle { lines().contains("still-2") }
        expect(stays, "run in terminal: the shell stays at a prompt afterwards", view.screenText)
        window.contentView = nil
        view.session?.enqueue { $0.shutdown() }
        _ = await until(2) { false }
    }
}
