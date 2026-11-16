import AppKit
import NyteCore
import NyteUI

@MainActor
enum EditorPane {
    static let fieldWidth: CGFloat = 240
    static let fontSizes = [10.0, 11.0, 12.0, 13.0, 14.0, 16.0, 18.0, 20.0]
    static let lineHeights = [1.2, 1.4, 1.5, 1.6, 1.8]
    static let tabWidths = [2, 4, 8]

    typealias Hint = (title: String, path: WritableKeyPath<LanguageSettings, Bool>)

    static let goHints: [Hint] = [
        ("Parameter names", \.go.inlayHints.parameterNames), ("Constant values", \.go.inlayHints.constantValues),
        ("Types in assignments", \.go.inlayHints.assignVariableTypes), ("Range variable types", \.go.inlayHints.rangeVariableTypes),
        ("Composite literal types", \.go.inlayHints.compositeLiteralTypes),
        ("Composite literal fields", \.go.inlayHints.compositeLiteralFields),
        ("Function type parameters", \.go.inlayHints.functionTypeParameters),
        ("Usage counts above declarations", \.go.countsUsages),
    ]

    static let typeScriptHints: [Hint] = [
        ("Parameter types", \.typeScript.inlayHints.functionParameterTypes), ("Variable types", \.typeScript.inlayHints.variableTypes),
        ("Property types", \.typeScript.inlayHints.propertyDeclarationTypes),
        ("Return types", \.typeScript.inlayHints.functionLikeReturnTypes),
        ("Enum member values", \.typeScript.inlayHints.enumMemberValues),
        ("Usage counts above declarations", \.typeScript.countsUsages),
    ]

    static func build(_ center: PreferencesCenter) -> SettingsForm {
        let form = SettingsForm()
        let editor = center.value.editor
        let indents = Segmented([.init("Spaces"), .init("Tabs")], selectedIndex: editor.usesTabs ? 1 : 0, label: "Indent with") { index in
            center.update { $0.editor.usesTabs = index == 1 }
        }
        form.heading("Indentation")
        form.row("Indent with", [indents, SettingsForm.picker("Indent width", tabWidths.map { ("\($0) wide", $0) },
                                                              selected: editor.tabWidth) { width in
            center.update { $0.editor.tabWidth = width }
        }])
        form.note("A file that already has an indent keeps it.")
        form.heading("Show")
        form.row("Show", [
            SettingsForm.checkbox("Indent guides", editor.showsIndentGuides) { on in center.update { $0.editor.showsIndentGuides = on } },
            SettingsForm.checkbox("Sticky declarations", editor.showsStickyDeclarations) { on in
                center.update { $0.editor.showsStickyDeclarations = on }
            },
            SettingsForm.checkbox("Inlay hints", editor.showsInlayHints) { on in center.update { $0.editor.showsInlayHints = on } },
            SettingsForm.checkbox("Change bars", editor.showsChangeBars) { on in center.update { $0.editor.showsChangeBars = on } },
        ])
        form.heading("Saving")
        form.row("On save", [
            SettingsForm.checkbox("Format", editor.formatsOnSave) { on in center.update { $0.editor.formatsOnSave = on } },
            SettingsForm.checkbox("Organize imports", editor.organizesImportsOnSave) { on in
                center.update { $0.editor.organizesImportsOnSave = on }
            },
            SettingsForm.checkbox("Trim trailing whitespace", editor.trimsTrailingWhitespace) { on in
                center.update { $0.editor.trimsTrailingWhitespace = on }
            },
            SettingsForm.checkbox("End with a newline", editor.ensuresFinalNewline) { on in
                center.update { $0.editor.ensuresFinalNewline = on }
            },
        ])
        return form
    }

    static func fontRows(_ form: SettingsForm, _ center: PreferencesCenter) {
        let editor = center.value.editor
        let fonts = [("System Monospaced", Optional<String>.none)] + monospacedFamilies().map { ($0, Optional($0)) }
        form.row("Font", [
            SettingsForm.picker("Font", fonts, selected: editor.fontFamily) { family in center.update { $0.editor.fontFamily = family } },
            SettingsForm.picker("Font size", fontSizes.map { ("\(Int($0)) pt", $0) }, selected: editor.fontSize) { size in
                center.update { $0.editor.fontSize = size }
            },
        ])
        form.row("Line height", [SettingsForm.picker("Line height", lineHeights.map { ($0.formatted(), $0) },
                                                     selected: editor.lineHeight) { height in
            center.update { $0.editor.lineHeight = height }
        }])
    }

    static func hintRows(_ form: SettingsForm, _ center: PreferencesCenter) {
        let language = center.value.language
        form.heading("Go inlay hints")
        form.row("Show", hintBoxes(goHints, language, center))
        form.heading("TypeScript inlay hints")
        let names = LanguageSettings.ParameterNames.allCases
        form.row("Parameters", [SettingsForm.picker("Parameter names", names.map { (parameterNameTitle($0), $0) },
                                                    selected: language.typeScript.inlayHints.parameterNames) { choice in
            center.update { $0.language.typeScript.inlayHints.parameterNames = choice }
        }])
        form.row("Show", hintBoxes(typeScriptHints, language, center))
    }

    private static func hintBoxes(_ hints: [Hint], _ language: LanguageSettings, _ center: PreferencesCenter) -> [NSView] {
        hints.map { hint in
            SettingsForm.checkbox(hint.title, language[keyPath: hint.path]) { on in center.update { $0.language[keyPath: hint.path] = on } }
        }
    }

    private static func parameterNameTitle(_ choice: LanguageSettings.ParameterNames) -> String {
        switch choice {
        case .none: "No parameter names"
        case .literals: "Parameter names for literals"
        case .all: "All parameter names"
        }
    }

    static func monospacedFamilies() -> [String] {
        NSFontManager.shared.availableFontFamilies.filter { family in
            NSFontManager.shared.availableMembers(ofFontFamily: family)?.first.flatMap { member in
                (member.first as? String).flatMap { NSFont(name: $0, size: TextStyle.code.size) }
            }?.isFixedPitch ?? false
        }
    }
}
