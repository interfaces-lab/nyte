import Foundation
import NyteCore
import NyteDebug
import NyteTerminal

struct Preferences: VersionedValue {
    enum Appearance: String, Codable, CaseIterable, Sendable {
        case system, light, dark
    }

    enum Density: String, Codable, CaseIterable, Sendable {
        case compact, standard
    }

    struct General: Codable, Equatable, Sendable {
        var appearance = Appearance.system
        var density = Density.compact
        var restoresLastWorkspace = true
        var confirmsQuitWhileRunning = true
    }

    struct Editor: Codable, Equatable, Sendable {
        var fontFamily: String?
        var fontSize = 12.0
        var lineHeight = 1.5
        var tabWidth = 4
        var usesTabs = false
        var trimsTrailingWhitespace = true
        var formatsOnSave = false
        var organizesImportsOnSave = false
        var showsIndentGuides = true
        var showsStickyDeclarations = true
        var showsInlayHints = true
        var showsChangeBars = true
        var ensuresFinalNewline = false
    }

    struct Terminal: Codable, Equatable, Sendable {
        enum OptionKey: String, Codable, CaseIterable, Sendable { case none, left, right, both }
        enum Cursor: String, Codable, CaseIterable, Sendable { case block, bar, underline }

        var shellPath: String?
        var fontSize: Double?
        var lineHeight = 1.0
        var scrollbackLines = 10_000
        var optionAsMeta = OptionKey.left
        var cursor = Cursor.block
        var cursorBlinks = false
        var copiesOnSelect = false

        var terminalPreferences: TerminalPreferences {
            let option: TerminalPreferences.OptionKey = switch optionAsMeta {
            case .none: .none
            case .left: .left
            case .right: .right
            case .both: .both
            }
            let style: TerminalPreferences.CursorStyle = switch cursor {
            case .block: .block
            case .bar: .bar
            case .underline: .underline
            }
            return TerminalPreferences(shellPath: shellPath, fontSize: fontSize, lineHeight: lineHeight, scrollbackLines: scrollbackLines,
                                       optionAsMeta: option, cursorStyle: style, cursorBlinks: cursorBlinks, copiesOnSelect: copiesOnSelect)
        }
    }

    struct Tools: Codable, Equatable, Sendable {
        var debuggerPaths: [String: String] = [:]

        var debugSettings: DebugSettings {
            DebugSettings(delvePath: debuggerPaths["dlv"], jsDebugServerPath: debuggerPaths["js-debug"], nodePath: debuggerPaths["node"])
        }
    }

    static let currentVersion = 4
    static let key = "app.preferences"

    var version = Preferences.currentVersion
    var general = General()
    var editor = Editor()
    var terminal = Terminal()
    var tools = Tools()
    var language = LanguageSettings()

    static func load(from store: UserDefaults = .standard) -> Preferences {
        if let saved = VersionedStore.load(Preferences.self, key: key, from: store) { return saved }
        var migrated = Preferences()
        migrated.general.appearance = store.string(forKey: "appearance").flatMap(Appearance.init(rawValue:)) ?? .system
        store.removeObject(forKey: "appearance")
        VersionedStore.save(migrated, key: key, to: store)
        return migrated
    }

    func save(to store: UserDefaults = .standard) { VersionedStore.save(self, key: Self.key, to: store) }
}

@MainActor
final class PreferencesCenter {
    private(set) var value: Preferences
    private var observers: [Int: (Preferences) -> Void] = [:]
    private var nextToken = 0

    init(_ value: Preferences = Preferences.load()) {
        self.value = value
    }

    func update(_ change: (inout Preferences) -> Void) {
        var next = value
        change(&next)
        guard next != value else { return }
        value = next
        value.save()
        observers.values.forEach { $0(next) }
    }

    @discardableResult
    func observe(_ handler: @escaping (Preferences) -> Void) -> Int {
        nextToken += 1
        observers[nextToken] = handler
        handler(value)
        return nextToken
    }

    func stopObserving(_ token: Int) { observers[token] = nil }
}
