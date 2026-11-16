import AppKit

public struct MenuItem {
    public enum Kind { case item, separator, header }

    public var kind: Kind
    public var title: String
    public var subtitle: String
    public var symbol: String?
    // macOS: 27 and later hide menu images unless preferredImageVisibility is .visible
    public var showsIcon: Bool
    public var key: String
    public var modifiers: NSEvent.ModifierFlags
    public var isEnabled: Bool
    public var isChecked: Bool
    public var isDestructive: Bool
    public var submenu: [MenuItem]?
    public var action: (@MainActor () -> Void)?

    public init(_ title: String, symbol: String? = nil, showsIcon: Bool = false, key: String = "",
                modifiers: NSEvent.ModifierFlags = .command, enabled: Bool = true, checked: Bool = false,
                destructive: Bool = false, submenu: [MenuItem]? = nil, subtitle: String = "",
                action: (@MainActor () -> Void)? = nil) {
        self.kind = .item
        self.title = title
        self.subtitle = subtitle
        self.symbol = symbol
        self.showsIcon = showsIcon
        self.key = key
        self.modifiers = modifiers
        self.isEnabled = enabled
        self.isChecked = checked
        self.isDestructive = destructive
        self.submenu = submenu
        self.action = action
    }

    public static var separator: MenuItem {
        var item = MenuItem("")
        item.kind = .separator
        return item
    }

    public static func header(_ title: String) -> MenuItem {
        var item = MenuItem(title)
        item.kind = .header
        return item
    }
}

@MainActor
public enum Menu {
    public static func make(_ items: [MenuItem], title: String = "") -> NSMenu {
        let menu = NSMenu(title: title)
        menu.autoenablesItems = false
        for item in items { menu.addItem(makeItem(item)) }
        return menu
    }

    public static func popUp(_ items: [MenuItem], with event: NSEvent, for view: NSView) {
        NSMenu.popUpContextMenu(make(items), with: event, for: view)
    }

    private static func makeItem(_ item: MenuItem) -> NSMenuItem {
        switch item.kind {
        case .separator: return .separator()
        case .header: return .sectionHeader(title: item.title)
        case .item: break
        }
        let entry = ClosureMenuItem(title: item.title, action: nil, keyEquivalent: item.key)
        entry.keyEquivalentModifierMask = item.modifiers
        entry.isEnabled = item.isEnabled
        entry.state = item.isChecked ? .on : .off
        if !item.subtitle.isEmpty { entry.subtitle = item.subtitle }
        if let action = item.action {
            entry.handler = action
            entry.target = entry
            entry.action = #selector(ClosureMenuItem.fire)
        }
        if let symbol = item.symbol {
            entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            entry.preferredImageVisibility = item.showsIcon ? .visible : .automatic
        }
        // AppKit: NSMenuItem has no destructive role, so the title takes the danger ink
        if item.isDestructive {
            entry.attributedTitle = NSAttributedString(string: item.title, attributes: [
                .foregroundColor: Palette.dangerInk, .font: TextStyle.base.font(),
            ])
        }
        if let submenu = item.submenu { entry.submenu = make(submenu, title: item.title) }
        return entry
    }
}

@MainActor
final class ClosureMenuItem: NSMenuItem {
    var handler: (@MainActor () -> Void)?

    @objc func fire() { handler?() }
}
