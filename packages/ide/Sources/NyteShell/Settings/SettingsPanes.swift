import AppKit
import NyteUI

enum SettingsPane: String, CaseIterable, Sendable {
    case general, appearance, editor, languages, debugger, terminal, agent, keys, tools

    var title: String {
        switch self {
        case .general: "General"
        case .appearance: "Appearance"
        case .editor: "Editor"
        case .languages: "Languages"
        case .debugger: "Debugger"
        case .terminal: "Terminal"
        case .agent: "Agent"
        case .keys: "Keys"
        case .tools: "Tools"
        }
    }

    var symbol: String {
        switch self {
        case .general: "gearshape"
        case .appearance: "circle.lefthalf.filled"
        case .editor: "text.cursor"
        case .languages: "curlybraces"
        case .debugger: "ladybug"
        case .terminal: "apple.terminal"
        case .agent: "bubble.left.and.text.bubble.right"
        case .keys: "keyboard"
        case .tools: "wrench.and.screwdriver"
        }
    }

    var hue: Hue {
        switch self {
        case .general, .keys, .tools: .gray
        case .appearance: .blue
        case .editor, .languages: .purple
        case .debugger: .red
        case .terminal: .gray
        case .agent: .green
        }
    }
}

@MainActor
enum GeneralPane {
    static func build(_ center: PreferencesCenter) -> SettingsForm {
        let form = SettingsForm()
        let general = center.value.general
        form.heading("Opening")
        form.row("On launch", [SettingsForm.checkbox("Reopen the last folder", general.restoresLastWorkspace) { on in
            center.update { $0.general.restoresLastWorkspace = on }
        }])
        form.heading("Closing")
        form.row("When closing", [SettingsForm.checkbox("Ask first while a program is running", general.confirmsQuitWhileRunning) { on in
            center.update { $0.general.confirmsQuitWhileRunning = on }
        }])
        form.footnote("Unsaved files are always named before anything closes.")
        return form
    }
}

@MainActor
enum AppearancePane {
    static func build(_ center: PreferencesCenter) -> SettingsForm {
        let form = SettingsForm()
        let general = center.value.general
        let appearances = Preferences.Appearance.allCases
        form.heading("Window")
        form.row("Theme", [Segmented(appearances.map { Segmented.Segment(title(of: $0)) },
                                     selectedIndex: appearances.firstIndex(of: general.appearance) ?? 0, label: "Theme") { index in
            center.update { $0.general.appearance = appearances[index] }
        }])
        let densities = Preferences.Density.allCases
        form.row("Density", [Segmented(densities.map { Segmented.Segment($0 == .compact ? "Compact" : "Standard") },
                                       selectedIndex: densities.firstIndex(of: general.density) ?? 0, label: "Density") { index in
            center.update { $0.general.density = densities[index] }
        }])
        form.note("Compact fits more rows; Standard gives every control more room.")
        form.heading("Editor text")
        EditorPane.fontRows(form, center)
        return form
    }

    private static func title(of appearance: Preferences.Appearance) -> String {
        switch appearance {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}

@MainActor
enum AgentPane {
    static func build(_ center: PreferencesCenter) -> SettingsForm {
        let form = SettingsForm()
        form.heading("Host")
        form.row("Connection", [Label("The Nyte host on this Mac", style: .base, color: Palette.contentPrimary)])
        form.note("Sessions run in the host, so they keep working after Nyte IDE quits.")
        form.heading("Model")
        form.row("New sessions", [Label("Chosen in each session\u{2019}s composer", style: .base, color: Palette.contentSecondary)])
        return form
    }
}

@MainActor
enum TerminalPane {
    static let fontSizes = [10.0, 11.0, 12.0, 13.0, 14.0, 16.0, 18.0]
    static let lineHeights = [1.0, 1.1, 1.2, 1.3, 1.5]
    static let scrollback = [1_000, 10_000, 100_000, 1_000_000]

    static func build(_ center: PreferencesCenter) -> SettingsForm {
        let form = SettingsForm()
        let terminal = center.value.terminal
        let loginShell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let shell = Input(terminal.shellPath ?? "", placeholder: "Login shell (\(loginShell))", size: .sm)
        shell.onEndEditing = { text in center.update { $0.terminal.shellPath = text.isEmpty ? nil : text } }
        shell.widthAnchor.constraint(equalToConstant: EditorPane.fieldWidth).isActive = true
        form.row("Shell", [shell])
        form.note("A new shell starts with it; running ones keep theirs.")
        let sizes = [("Default", Optional<Double>.none)] + fontSizes.map { ("\(Int($0)) pt", Optional($0)) }
        form.row("Font size", [SettingsForm.picker("Font size", sizes, selected: terminal.fontSize) { size in
            center.update { $0.terminal.fontSize = size }
        }])
        form.row("Line height", [SettingsForm.picker("Line height", lineHeights.map { ($0.formatted(), $0) },
                                                     selected: terminal.lineHeight) { height in
            center.update { $0.terminal.lineHeight = height }
        }])
        form.row("Scrollback", [SettingsForm.picker("Scrollback", scrollback.map { ("\($0.formatted()) lines", $0) },
                                                    selected: terminal.scrollbackLines) { lines in
            center.update { $0.terminal.scrollbackLines = lines }
        }])
        form.row("Cursor", [
            SettingsForm.picker("Cursor shape", Preferences.Terminal.Cursor.allCases.map { (cursorTitle($0), $0) },
                                selected: terminal.cursor) { cursor in center.update { $0.terminal.cursor = cursor } },
            SettingsForm.checkbox("Blink", terminal.cursorBlinks) { on in center.update { $0.terminal.cursorBlinks = on } },
        ])
        form.row("Option key", [SettingsForm.picker("Option as Meta", Preferences.Terminal.OptionKey.allCases.map { (optionTitle($0), $0) },
                                                    selected: terminal.optionAsMeta) { key in
            center.update { $0.terminal.optionAsMeta = key }
        }])
        form.row("Selection", [SettingsForm.checkbox("Copy text when selected", terminal.copiesOnSelect) { on in
            center.update { $0.terminal.copiesOnSelect = on }
        }])
        return form
    }

    private static func cursorTitle(_ cursor: Preferences.Terminal.Cursor) -> String {
        switch cursor {
        case .block: "Block"
        case .bar: "Bar"
        case .underline: "Underline"
        }
    }

    private static func optionTitle(_ key: Preferences.Terminal.OptionKey) -> String {
        switch key {
        case .none: "Types special characters"
        case .left: "Left Option is Meta"
        case .right: "Right Option is Meta"
        case .both: "Both Options are Meta"
        }
    }
}
