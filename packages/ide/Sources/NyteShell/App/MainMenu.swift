import AppKit
import NyteUI

@MainActor
enum MainMenu {
    static func build(recent: NSMenu) -> NSMenu {
        let main = NSMenu()
        for name in MenuName.allCases {
            let menu = NSMenu(title: name.title)
            let commands = Commands.all.filter { $0.menu == name }
            var section = commands.first?.section
            for command in commands {
                if command.section != section { menu.addItem(.separator()) }
                section = command.section
                let item = item(for: command)
                if command.id == .openRecent {
                    item.action = nil
                    item.submenu = recent
                }
                menu.addItem(item)
            }
            let holder = NSMenuItem(title: name.title, action: nil, keyEquivalent: "")
            holder.submenu = menu
            main.addItem(holder)
            if name == .window { NSApp.windowsMenu = menu }
            if name == .help { NSApp.helpMenu = menu }
        }
        return main
    }

    static func item(for command: Command) -> NSMenuItem {
        let item = NSMenuItem(title: command.title, action: command.selector ?? #selector(ShellViewController.runCommand(_:)),
                              keyEquivalent: command.key?.character ?? "")
        item.keyEquivalentModifierMask = command.key?.modifiers ?? []
        item.tag = command.tag
        item.identifier = NSUserInterfaceItemIdentifier(command.id.rawValue)
        if let symbol = command.symbol {
            item.image = Symbol.image(symbol)
            item.preferredImageVisibility = .visible
        }
        return item
    }
}

extension CommandID {
    @MainActor init?(sender: Any?) {
        let identifier: String? = switch sender {
        case let item as NSMenuItem: item.identifier?.rawValue
        case let item as NSToolbarItem: item.itemIdentifier.rawValue
        case let item as NSUserInterfaceItemIdentification: item.identifier?.rawValue
        default: nil
        }
        guard let identifier else { return nil }
        self.init(rawValue: identifier)
    }
}
