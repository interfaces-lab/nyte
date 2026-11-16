import AppKit
@testable import NyteShell

@MainActor
enum KeyCheck {
    static let toTerminal: [CommandID] = [.completions, .back, .forward, .recentFiles, .goToLine, .moveLinesUp,
                                          .moveLinesDown, .duplicateLines]
    static let staysWithApp: [CommandID] = [.showTerminal, .goToSymbol, .openQuickly, .commandPalette, .stop, .clearTerminal,
                                            .deleteLines, .expandSelection, .nextChange]

    static func run(_ shell: ShellViewController) -> [String] {
        var failures: [String] = []
        for id in toTerminal + staysWithApp {
            guard let key = Commands.command(id)?.key else { continue }
            let expected: KeyRouting.Owner = toTerminal.contains(id) ? .terminal : .command
            let owner = KeyRouting.owner(of: key, focus: .terminal)
            if owner != expected { failures.append("decision \(id.rawValue) \(key.display): \(owner)") }
            if KeyRouting.owner(of: key, focus: .other) != .command { failures.append("decision \(id.rawValue) outside the terminal") }
        }
        shell.terminal.focusTerminal()
        if shell.keyFocus != .terminal { failures.append("terminal focus not seen") }
        for id in toTerminal where validates(id, in: shell) { failures.append("menu \(id.rawValue) still takes its key in the terminal") }
        if !validates(.showTerminal, in: shell) { failures.append("menu showTerminal lost its key in the terminal") }
        shell.view.window?.makeFirstResponder(shell.editor.view)
        if shell.keyFocus != .other { failures.append("editor focus read as terminal") }
        return failures
    }

    private static func validates(_ id: CommandID, in shell: ShellViewController) -> Bool {
        guard let command = Commands.command(id) else { return false }
        return shell.validateMenuItem(MainMenu.item(for: command))
    }
}
