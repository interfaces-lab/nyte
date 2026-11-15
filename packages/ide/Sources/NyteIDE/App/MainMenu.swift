import AppKit
import NyteDesign

/// The menu bar. Shell actions travel the responder chain to the key window's `ShellViewController`.
@MainActor
enum MainMenu {
    static func build() -> NSMenu {
        let main = NSMenu()
        main.addItem(submenu("Nyte IDE", [
            item("About Nyte IDE", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("Hide Nyte IDE", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit Nyte IDE", #selector(NSApplication.terminate(_:)), "q"),
        ]))
        main.addItem(submenu("File", [
            item("Open Folder…", #selector(AppDelegate.openFolder(_:)), "o", symbol: "folder"),
            .separator(),
            item("Save", #selector(ShellViewController.saveDocument(_:)), "s", symbol: "square.and.arrow.down"),
            .separator(),
            item("Close Tab", #selector(ShellViewController.closeTab(_:)), "w", symbol: "xmark"),
            item("Close Window", #selector(NSWindow.performClose(_:)), "w", [.command, .shift]),
        ]))
        main.addItem(submenu("Edit", [
            item("Undo", Selector(("undo:")), "z", symbol: "arrow.uturn.backward"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift], symbol: "arrow.uturn.forward"),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x", symbol: "scissors"),
            item("Copy", #selector(NSText.copy(_:)), "c", symbol: "document.on.document"),
            item("Paste", #selector(NSText.paste(_:)), "v", symbol: "clipboard"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
            .separator(),
            finder("Find…", .showFindInterface, "f", symbol: "magnifyingglass"),
            finder("Find Next", .nextMatch, "g"),
            finder("Find Previous", .previousMatch, "g", [.command, .shift]),
            finder("Use Selection for Find", .setSearchString, "e"),
        ]))
        main.addItem(submenu("View", [
            item("Show Sidebar", #selector(ShellViewController.toggleSidebar(_:)), "s", [.command, .control],
                 symbol: "sidebar.leading"),
            item("Show Terminal", #selector(ShellViewController.toggleTerminal(_:)), "`", [.control],
                 symbol: "apple.terminal"),
            item("Show Agent", #selector(ShellViewController.toggleAgent(_:)), "0", [.command, .option],
                 symbol: "sidebar.trailing"),
            .separator(),
            item("Ask Nyte", #selector(ShellViewController.askNyte(_:)), "l", symbol: "paperplane"),
            .separator(),
            item("Show Next Tab", #selector(ShellViewController.selectNextTab(_:)), "\t", [.control]),
            item("Show Previous Tab", #selector(ShellViewController.selectPreviousTab(_:)), "\t", [.control, .shift]),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ]))
        let window = submenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
            .separator(),
            item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
        ])
        main.addItem(window)
        NSApp.windowsMenu = window.submenu
        return main
    }

    private static func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let menu = NSMenu(title: title)
        items.forEach(menu.addItem)
        let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        holder.submenu = menu
        return holder
    }

    private static func item(_ title: String, _ action: Selector, _ key: String = "",
                             _ modifiers: NSEvent.ModifierFlags = [.command], symbol: String? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.image = symbol.flatMap { Symbol.image($0) }
        return item
    }

    private static func finder(_ title: String, _ action: NSTextFinder.Action, _ key: String,
                               _ modifiers: NSEvent.ModifierFlags = [.command], symbol: String? = nil) -> NSMenuItem {
        let item = item(title, #selector(NSResponder.performTextFinderAction(_:)), key, modifiers, symbol: symbol)
        item.tag = action.rawValue
        return item
    }
}
