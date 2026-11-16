import AppKit
@testable import NyteShell

@MainActor
enum PreferencesCheck {
    static let changedFontSize = 16.0

    static func run(_ preferences: PreferencesCenter, shell: ShellViewController) -> [String] {
        var failures: [String] = []
        preferences.update { $0.general.appearance = .dark }
        if NSApp.appearance?.name != .darkAqua { failures.append("appearance dark did not reach the app") }
        preferences.update { $0.general.appearance = .light }
        if NSApp.appearance?.name != .aqua { failures.append("appearance light did not reach the app") }
        preferences.update { $0.general.appearance = .system }
        if NSApp.appearance != nil { failures.append("appearance system did not clear the override") }
        preferences.update { $0.editor.fontSize = changedFontSize }
        if shell.appliedPreferences?.editor.fontSize != changedFontSize { failures.append("editor font size did not reach the shell") }
        preferences.update { $0.language.go.inlayHints.assignVariableTypes = true }
        if shell.services.language.settings.go.inlayHints.assignVariableTypes != true {
            failures.append("inlay switch did not reach the language service")
        }
        preferences.update { $0.terminal.scrollbackLines = 100_000 }
        if shell.terminal.preferences.scrollbackLines != 100_000 { failures.append("terminal scrollback did not reach the terminal") }
        preferences.update { $0.tools.debuggerPaths["dlv"] = "/opt/dlv" }
        if shell.services.debugger.settings.delvePath != "/opt/dlv" { failures.append("the Delve path did not reach the debugger") }
        preferences.update { $0.tools.debuggerPaths["dlv"] = nil }
        let saved = Preferences.load()
        if saved != preferences.value { failures.append("preferences did not round-trip through the store") }
        return failures
    }
}
