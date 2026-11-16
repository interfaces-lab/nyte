import AppKit
import NyteEditor

enum CommandID: String, CaseIterable, Sendable {
    case about, settings, hide, hideOthers, showAll, quit
    case newSession, openFolder, openRecent, openQuickly, save, saveAll, revertToSaved, closeTab, closeOtherTabs, closeTabsToRight, reopenClosedTab, closeWindow
    case newFile, newFolder, renameItem, duplicateItem, moveToTrash, revealInFinder, openInTerminal, findInFolder, copyPath, copyRelativePath
    case clearTerminal
    case undo, redo, cut, copy, paste, selectAll, toggleLineComment, indentLines, outdentLines,
        moveLinesUp, moveLinesDown, duplicateLines, deleteLines, expandSelection, shrinkSelection,
        selectNextOccurrence, selectAllOccurrences, addCaretAbove, addCaretBelow, openLineNote, find, findNext, findPrevious, useSelectionForFind,
        findInFiles, toggleMatchCase, toggleWholeWord, toggleRegularExpression, togglePreserveCase
    case commandPalette, toggleSidebar, toggleBottomPanel, toggleAgent, focusReview, showTerminal, showProblems, askNyte, fullScreen
    case back, forward, nextTab, previousTab, recentFiles, goToSymbol, goToLine, nextChange, previousChange, viewBreakpoints
    case goToDefinition, goToTypeDefinition, goToImplementations, findUsages, nextProblem, previousProblem
    case rename, contextActions, formatDocument, completions, parameterInfo, showDocumentation
    case addComment, sendComments
    case startDebugging, runWithoutDebugging, runInTerminal, stop, restart, stepOver, stepInto, stepOut, toggleBreakpoint, askAboutStop, askToFixLaunch
    case minimize, zoom, bringAllToFront
}

enum MenuName: CaseIterable, Sendable {
    case app, file, edit, view, navigate, code, run, window, help

    var title: String {
        switch self {
        case .app: "Nyte IDE"
        case .file: "File"
        case .edit: "Edit"
        case .view: "View"
        case .navigate: "Navigate"
        case .code: "Code"
        case .run: "Run"
        case .window: "Window"
        case .help: "Help"
        }
    }
}

enum Need: Sendable {
    case nothing
    case workspace
    case file
    case unsavedFile
    case unsavedFiles
    case tabs
    case tabsToRight
    case closedTab
    case review
    case editor(EditorCommand)
    case back
    case forward
    case language
    case target
    case session
    case paused
    case problems
}

struct Key: Sendable {
    let character: String
    let modifiers: NSEvent.ModifierFlags

    init(_ character: String, _ modifiers: NSEvent.ModifierFlags = .command) {
        self.character = character
        self.modifiers = modifiers
    }

    static let f2 = function(2), f5 = function(5), f8 = function(8), f9 = function(9)
    static let f7 = function(7), f10 = function(10), f11 = function(11), f12 = function(12)
    static let up = scalar(NSUpArrowFunctionKey), down = scalar(NSDownArrowFunctionKey)
    static let left = scalar(NSLeftArrowFunctionKey), right = scalar(NSRightArrowFunctionKey)

    private static func scalar(_ code: Int) -> String { Unicode.Scalar(code).map(String.init) ?? "" }

    private static func function(_ number: Int) -> Key {
        Key(Unicode.Scalar(NSF1FunctionKey + number - 1).map(String.init) ?? "", [])
    }

    func with(_ added: NSEvent.ModifierFlags) -> Key { Key(character, modifiers.union(added)) }

    var isFunctionKey: Bool {
        guard let scalar = character.unicodeScalars.first else { return false }
        return (NSF1FunctionKey...NSF35FunctionKey).contains(Int(scalar.value))
    }

    var display: String {
        let glyphs: [(NSEvent.ModifierFlags, String)] = [(.control, "⌃"), (.option, "⌥"), (.shift, "⇧"), (.command, "⌘")]
        let prefix = glyphs.filter { modifiers.contains($0.0) }.map(\.1).joined()
        return prefix + Self.name(of: character)
    }

    private static func name(of character: String) -> String {
        switch character {
        case "\t": return "⇥"
        case " ": return "Space"
        case "\r": return "↩"
        case up: return "↑"
        case down: return "↓"
        case left: return "←"
        case right: return "→"
        default: break
        }
        guard let scalar = character.unicodeScalars.first else { return "" }
        let number = Int(scalar.value) - NSF1FunctionKey + 1
        if number >= 1, number <= NSF35FunctionKey - NSF1FunctionKey + 1 { return "F\(number)" }
        return character.uppercased()
    }
}

struct Command: Sendable {
    let id: CommandID
    let title: String
    let key: Key?
    var menu = MenuName.app
    var section = 0
    let needs: Need
    var selector: Selector?
    var tag = 0
    var symbol: String?

    init(_ id: CommandID, _ title: String, _ key: Key? = nil, needs: Need = .workspace,
         selector: Selector? = nil, tag: Int = 0, symbol: String? = nil) {
        self.id = id
        self.title = title
        self.key = key
        self.needs = needs
        self.selector = selector
        self.tag = tag
        self.symbol = symbol
    }

    var isStandard: Bool { selector != nil }
}
