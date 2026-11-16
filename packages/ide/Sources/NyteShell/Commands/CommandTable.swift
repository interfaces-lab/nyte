import AppKit
import NyteEditor
import NyteChanges
import NyteDebug
import NyteFiles
import NyteSearch
import NyteTerminal

enum Commands {
    static let all: [Command] = [
        place(.app, app), place(.file, file), place(.edit, edit), place(.view, view), place(.navigate, navigate), place(.code, code),
        place(.run, run), place(.window, window),
    ].flatMap(\.self)

    private static let byID: [CommandID: Command] = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })

    static func command(_ id: CommandID) -> Command? { byID[id] }

    private static func place(_ menu: MenuName, _ groups: [[Command]]) -> [Command] {
        groups.enumerated().flatMap { section, group in
            group.map { command in
                var placed = command
                placed.menu = menu
                placed.section = section
                return placed
            }
        }
    }

    private static let app: [[Command]] = [
        [Command(.about, "About Nyte IDE", needs: .nothing, selector: #selector(NSApplication.orderFrontStandardAboutPanel(_:)))],
        [Command(.settings, "Settings…", Key(","), needs: .nothing, selector: #selector(AppDelegate.showSettings(_:)))],
        [
            Command(.hide, "Hide Nyte IDE", Key("h"), needs: .nothing, selector: #selector(NSApplication.hide(_:))),
            Command(.hideOthers, "Hide Others", Key("h", [.command, .option]), needs: .nothing,
                    selector: #selector(NSApplication.hideOtherApplications(_:))),
            Command(.showAll, "Show All", needs: .nothing, selector: #selector(NSApplication.unhideAllApplications(_:))),
        ],
        [Command(.quit, "Quit Nyte IDE", Key("q"), needs: .nothing, selector: #selector(NSApplication.terminate(_:)))],
    ]

    private static let file: [[Command]] = [
        [Command(.newSession, "New Session", Key("n"))],
        [
            Command(.openFolder, "Open Folder…", Key("o"), needs: .nothing, selector: #selector(AppDelegate.openFolder(_:)),
                    symbol: "folder"),
            Command(.openRecent, "Open Recent", needs: .nothing),
        ],
        [Command(.openQuickly, "Open Quickly…", Key("p"))],
        [
            files(.newFile, "New File", #selector(FileNavigatorCommands.newFile(_:))),
            files(.newFolder, "New Folder", #selector(FileNavigatorCommands.newFolder(_:))),
        ],
        [
            Command(.save, "Save", Key("s"), needs: .unsavedFile),
            Command(.saveAll, "Save All", Key("s", [.command, .option]), needs: .unsavedFiles),
            Command(.revertToSaved, "Revert to Saved", needs: .unsavedFile),
        ],
        [
            files(.renameItem, "Rename…", #selector(FileNavigatorCommands.renameItem(_:))),
            files(.duplicateItem, "Duplicate", #selector(FileNavigatorCommands.duplicateItem(_:))),
            files(.moveToTrash, "Move to Trash", #selector(FileNavigatorCommands.moveToTrash(_:))),
        ],
        [
            files(.revealInFinder, "Reveal in Finder", #selector(FileNavigatorCommands.revealInFinder(_:)), symbol: "folder"),
            files(.openInTerminal, "Open in Terminal", #selector(FileNavigatorCommands.openInTerminal(_:)), symbol: "terminal"),
            files(.findInFolder, "Find in Folder…", #selector(FileNavigatorCommands.findInFolder(_:)), symbol: "magnifyingglass"),
        ],
        [
            files(.copyPath, "Copy Path", #selector(FileNavigatorCommands.copyPath(_:))),
            files(.copyRelativePath, "Copy Relative Path", #selector(FileNavigatorCommands.copyRelativePath(_:))),
        ],
        [
            Command(.closeTab, "Close Tab", Key("w"), needs: .file),
            Command(.closeOtherTabs, "Close Other Tabs", needs: .tabs),
            Command(.closeTabsToRight, "Close Tabs to the Right", needs: .tabsToRight),
            Command(.reopenClosedTab, "Reopen Closed Tab", Key("t", [.command, .shift]), needs: .closedTab),
            Command(.closeWindow, "Close Window", Key("w", [.command, .shift]), needs: .nothing,
                    selector: #selector(NSWindow.performClose(_:))),
        ],
    ]

    private static let edit: [[Command]] = [
        [
            Command(.undo, "Undo", Key("z"), needs: .nothing, selector: #selector(UndoCommands.undo(_:))),
            Command(.redo, "Redo", Key("z", [.command, .shift]), needs: .nothing, selector: #selector(UndoCommands.redo(_:))),
        ],
        [
            Command(.cut, "Cut", Key("x"), needs: .nothing, selector: #selector(NSText.cut(_:))),
            Command(.copy, "Copy", Key("c"), needs: .nothing, selector: #selector(NSText.copy(_:))),
            Command(.paste, "Paste", Key("v"), needs: .nothing, selector: #selector(NSText.paste(_:))),
            Command(.selectAll, "Select All", Key("a"), needs: .nothing, selector: #selector(NSText.selectAll(_:))),
        ],
        [
            Command(.toggleLineComment, "Toggle Line Comment", Key("/"), needs: .nothing,
                    selector: #selector(EditorLineCommands.toggleLineComment(_:))),
            Command(.indentLines, "Indent", Key("]"), needs: .nothing, selector: #selector(EditorLineCommands.indentLines(_:))),
            Command(.outdentLines, "Outdent", Key("["), needs: .nothing, selector: #selector(EditorLineCommands.outdentLines(_:))),
        ],
        [
            line(.moveLinesUp, "Move Line Up", Key(Key.up, .option), #selector(EditorLineCommands.moveLinesUp(_:))),
            line(.moveLinesDown, "Move Line Down", Key(Key.down, .option), #selector(EditorLineCommands.moveLinesDown(_:))),
            line(.duplicateLines, "Duplicate Line", Key(Key.down, [.option, .shift]), #selector(EditorLineCommands.duplicateLines(_:))),
            line(.deleteLines, "Delete Line", Key("k", [.command, .shift]), #selector(EditorLineCommands.deleteLines(_:))),
        ],
        [
            line(.expandSelection, "Expand Selection", Key(Key.right, [.control, .shift, .command]),
                 #selector(EditorLineCommands.expandSelection(_:))),
            line(.shrinkSelection, "Shrink Selection", Key(Key.left, [.control, .shift, .command]),
                 #selector(EditorLineCommands.shrinkSelection(_:))),
        ],
        [
            line(.selectNextOccurrence, "Select Next Occurrence", Key("d"), #selector(EditorLineCommands.selectNextOccurrence(_:))),
            line(.selectAllOccurrences, "Select All Occurrences", Key("l", [.command, .shift]),
                 #selector(EditorLineCommands.selectAllOccurrences(_:))),
            line(.addCaretAbove, "Add Caret Above", Key(Key.up, [.option, .command]), #selector(EditorLineCommands.addCaretAbove(_:))),
            line(.addCaretBelow, "Add Caret Below", Key(Key.down, [.option, .command]), #selector(EditorLineCommands.addCaretBelow(_:))),
        ],
        [Command(.openLineNote, "Open Line Note", needs: .nothing, selector: #selector(EditorLineCommands.openLineNote(_:)))],
        [
            finder(.find, "Find…", Key("f"), .showFindInterface),
            finder(.findNext, "Find Next", Key("g"), .nextMatch),
            finder(.findPrevious, "Find Previous", Key("g", [.command, .shift]), .previousMatch),
            finder(.useSelectionForFind, "Use Selection for Find", Key("e"), .setSearchString),
        ],
        [
            Command(.findInFiles, "Find in Files…", Key("f", [.command, .shift])),
            searchToggle(.toggleMatchCase, "Match Case", "c", #selector(FindInFilesViewController.toggleMatchCase(_:))),
            searchToggle(.toggleWholeWord, "Whole Words", "w", #selector(FindInFilesViewController.toggleWholeWord(_:))),
            searchToggle(.toggleRegularExpression, "Regular Expression", "r",
                         #selector(FindInFilesViewController.toggleRegularExpression(_:))),
            searchToggle(.togglePreserveCase, "Preserve Case", "p", #selector(FindInFilesViewController.togglePreserveCase(_:))),
        ],
    ]

    private static let view: [[Command]] = [
        [Command(.commandPalette, "Search…", Key("p", [.command, .shift]))],
        [
            Command(.toggleSidebar, "Hide Sidebar", Key("b")),
            Command(.toggleBottomPanel, "Hide Bottom Panel", Key("j")),
            Command(.toggleAgent, "Hide Agent", Key("b", [.command, .option])),
            Command(.focusReview, "Focus Review", Key("r", [.command, .control]), needs: .review),
        ],
        [
            Command(.showTerminal, "Terminal", Key("`", [.control])),
            Command(.clearTerminal, "Clear Terminal", Key("k"), needs: .nothing,
                    selector: #selector(TerminalCommands.clearTerminal(_:))),
            Command(.showProblems, "Problems", needs: .problems),
        ],
        [Command(.askNyte, "Ask Nyte", Key("l"))],
        [Command(.fullScreen, "Enter Full Screen", Key("f", [.command, .control]), needs: .nothing,
                 selector: #selector(NSWindow.toggleFullScreen(_:)))],
    ]

    private static let navigate: [[Command]] = [
        [
            Command(.back, "Back", Key("-", [.control]), needs: .back),
            Command(.forward, "Forward", Key("-", [.control, .shift]), needs: .forward),
        ],
        [
            Command(.nextTab, "Next Tab", Key("]", [.command, .shift]), needs: .tabs),
            Command(.previousTab, "Previous Tab", Key("[", [.command, .shift]), needs: .tabs),
            Command(.recentFiles, "Recent Files…", Key("\t", [.control]), needs: .tabs),
        ],
        [
            Command(.goToSymbol, "Go to Symbol in Workspace…", Key("t"), needs: .language),
            line(.goToLine, "Go to Line…", Key("g", [.control]), #selector(EditorLineCommands.goToLine(_:))),
        ],
        [
            Command(.goToDefinition, "Go to Definition", Key.f12, needs: .editor(.goToDefinition)),
            Command(.goToTypeDefinition, "Go to Type Definition", needs: .editor(.goToTypeDefinition)),
            Command(.goToImplementations, "Go to Implementations", Key.f12.with(.command),
                    needs: .editor(.goToImplementations)),
            Command(.findUsages, "Find Usages", Key.f12.with(.shift), needs: .editor(.findUsages)),
        ],
        [
            Command(.nextProblem, "Next Problem", Key.f8, needs: .editor(.nextProblem)),
            Command(.previousProblem, "Previous Problem", Key.f8.with(.shift), needs: .editor(.previousProblem)),
        ],
        [
            line(.nextChange, "Next Change", Key.f7, #selector(EditorLineCommands.nextChange(_:))),
            line(.previousChange, "Previous Change", Key.f7.with(.shift), #selector(EditorLineCommands.previousChange(_:))),
        ],
    ]

    private static let code: [[Command]] = [
        [
            Command(.completions, "Completions", Key(" ", [.control]), needs: .editor(.showCompletions)),
            Command(.parameterInfo, "Parameter Info", Key(" ", [.command, .shift]), needs: .editor(.showParameterInfo)),
            Command(.showDocumentation, "Show Documentation", needs: .editor(.showDocumentation)),
        ],
        [
            Command(.contextActions, "Context Actions…", Key("."), needs: .editor(.showContextActions)),
            Command(.rename, "Rename…", Key.f2, needs: .editor(.rename)),
            Command(.formatDocument, "Format Document", Key("f", [.shift, .option]), needs: .editor(.formatDocument)),
        ],
        [
            Command(.addComment, "Add Comment", needs: .nothing, selector: #selector(DiffViewController.addComment(_:))),
            Command(.sendComments, "Send Comments to Nyte", needs: .nothing, selector: #selector(DiffViewController.sendComments(_:))),
        ],
    ]

    private static let run: [[Command]] = [
        [
            Command(.startDebugging, "Start Debugging", Key.f5, needs: .target),
            Command(.runWithoutDebugging, "Run Without Debugging", Key.f5.with(.control), needs: .target),
            Command(.runInTerminal, "Run in Terminal", Key.f5.with([.control, .option]), needs: .target),
        ],
        [
            Command(.stop, "Stop", Key.f5.with(.shift), needs: .session),
            Command(.restart, "Restart", Key.f5.with([.shift, .command]), needs: .session),
        ],
        [
            Command(.stepOver, "Step Over", Key.f10, needs: .paused),
            Command(.stepInto, "Step Into", Key.f11, needs: .paused),
            Command(.stepOut, "Step Out", Key.f11.with(.shift), needs: .paused),
        ],
        [
            Command(.toggleBreakpoint, "Toggle Breakpoint", Key.f9, needs: .editor(.toggleBreakpoint)),
            Command(.viewBreakpoints, "View Breakpoints", Key.f9.with([.shift, .command])),
        ],
        [
            Command(.askAboutStop, "Ask Nyte About This Stop", needs: .nothing,
                    selector: #selector(DebugViewController.askAgentAboutStop(_:))),
            Command(.askToFixLaunch, "Ask Nyte to Fix the Launch", needs: .nothing,
                    selector: #selector(DebugViewController.askAgentToFixLaunch(_:))),
        ],
    ]

    private static let window: [[Command]] = [
        [
            Command(.minimize, "Minimize", Key("m"), needs: .nothing, selector: #selector(NSWindow.performMiniaturize(_:))),
            Command(.zoom, "Zoom", needs: .nothing, selector: #selector(NSWindow.performZoom(_:))),
        ],
        [Command(.bringAllToFront, "Bring All to Front", needs: .nothing,
                 selector: #selector(NSApplication.arrangeInFront(_:)))],
    ]

    private static func line(_ id: CommandID, _ title: String, _ key: Key, _ selector: Selector) -> Command {
        Command(id, title, key, needs: .nothing, selector: selector)
    }

    private static func files(_ id: CommandID, _ title: String, _ selector: Selector, symbol: String? = nil) -> Command {
        Command(id, title, needs: .nothing, selector: selector, symbol: symbol)
    }

    private static func searchToggle(_ id: CommandID, _ title: String, _ character: String, _ selector: Selector) -> Command {
        Command(id, title, Key(character, [.command, .option]), needs: .nothing, selector: selector)
    }

    private static func finder(_ id: CommandID, _ title: String, _ key: Key, _ action: NSTextFinder.Action) -> Command {
        Command(id, title, key, needs: .nothing, selector: #selector(NSResponder.performTextFinderAction(_:)),
                tag: action.rawValue)
    }
}
