import AppKit
import NyteAgent
import NyteUI

@MainActor
final class WindowToolbar: NSObject, NSToolbarDelegate {
    let toolbar = NSToolbar(identifier: "workspace")
    private weak var shell: ShellViewController?
    private let project = Label(style: .base, color: Palette.contentPrimary, weight: .semibold)
    private let branch = Label(style: .base, color: Palette.contentTertiary)
    private let branchGlyph = NSImageView()
    private lazy var place = makePlace()
    private var placeWidth: NSLayoutConstraint?
    private var symbols: [CommandID: String] = [:]
    private var waiting = 0
    private var groups: [NSToolbarItem.Identifier: [CommandID]] = [:]
    private lazy var target: NSMenuToolbarItem = {
        let item = NSMenuToolbarItem(itemIdentifier: Self.target)
        item.label = "Run Target"
        item.paletteLabel = "Run Target"
        item.toolTip = "Run Target"
        item.showsIndicator = true
        item.title = "No Target"
        item.menu = NSMenu()
        item.menu.delegate = self
        return item
    }()

    static let place = NSToolbarItem.Identifier("place")
    static let target = NSToolbarItem.Identifier("runTarget")
    static let runGroup = NSToolbarItem.Identifier("runGroup")
    static let panelGroup = NSToolbarItem.Identifier("panelGroup")

    private static let buttons: [CommandID: (symbol: String, label: String)] = [
        .toggleSidebar: ("sidebar.leading", "Sidebar"),
        .runWithoutDebugging: ("play", "Run"),
        .startDebugging: ("ladybug", "Debug"),
        .stop: ("stop", "Stop"),
        .openQuickly: ("magnifyingglass", "Search"),
        .toggleBottomPanel: ("rectangle.bottomthird.inset.filled", "Bottom Panel"),
        .toggleAgent: ("sidebar.trailing", "Agent"),
    ]

    private static func button(_ id: CommandID) -> NSToolbarItem.Identifier { NSToolbarItem.Identifier(id.rawValue) }

    private static let order: [NSToolbarItem.Identifier] = [
        button(.toggleSidebar), place, .flexibleSpace,
        target, runGroup, .flexibleSpace,
        button(.openQuickly), panelGroup,
    ]

    init(workspaceName: String, shell: ShellViewController) {
        self.shell = shell
        super.init()
        project.stringValue = workspaceName
        project.lineBreakMode = .byTruncatingTail
        project.setAccessibilityLabel("Project \(workspaceName)")
        branch.lineBreakMode = .byTruncatingTail
        branchGlyph.image = Symbol.image("arrow.triangle.branch", glyph: .sm)
        branchGlyph.contentTintColor = Palette.contentTertiary
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
    }

    func show(branch name: String?) {
        branch.stringValue = name ?? ""
        branch.setAccessibilityLabel(name.map { "Branch \($0)" })
        branch.isHidden = name == nil
        branchGlyph.isHidden = name == nil
    }

    func show(target name: String?) {
        target.title = name ?? "No Target"
        target.toolTip = name.map { "Run target: \($0)" } ?? "No run target"
    }

    func show(waiting sessions: [AgentWaitingSession]) {
        waiting = sessions.count
        guard let agent = item(.toggleAgent) else { return }
        agent.badge = sessions.isEmpty ? nil : .count(sessions.count)
        guard let first = sessions.min(by: { $0.since < $1.since }) else { return }
        let wants = switch first.request {
        case .approval: "approval"
        case .question: "an answer"
        case .other: "you"
        }
        agent.toolTip = sessions.count == 1 ? "\u{201C}\(first.title)\u{201D} is waiting for \(wants)"
            : "\(sessions.count) sessions are waiting; \u{201C}\(first.title)\u{201D} first"
    }

    static let placeTrailing = Space.x3

    func fit(columnEndingAt maxX: CGFloat?) {
        guard place.window != nil else { return }
        let start = place.convert(place.bounds, to: nil).minX
        let available = maxX.map { $0 - start - Self.placeTrailing } ?? ShellViewController.sidebarWidth * 2
        let name = project.intrinsicContentSize.width
        let full = name + Space.x2 + branchGlyph.intrinsicContentSize.width + Space.x1 + branch.intrinsicContentSize.width
        let showsBranch = !branch.stringValue.isEmpty && available >= name + Space.x2 + branchGlyph.intrinsicContentSize.width + Self.branchMinimum
        branch.isHidden = !showsBranch
        branchGlyph.isHidden = !showsBranch
        let width = showsBranch ? min(full, available) : name
        guard width.isFinite, let constraint = placeWidth, abs(constraint.constant - width) >= 1 else { return }
        constraint.constant = width
    }

    static let branchMinimum: CGFloat = 40

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { Self.order }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { Self.order }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        switch identifier {
        case Self.place: return plain(identifier, label: "Project", view: place)
        case Self.target: return target
        case Self.runGroup: return group(identifier, label: "Run", [.runWithoutDebugging, .startDebugging, .stop])
        case Self.panelGroup: return group(identifier, label: "Panels", [.toggleBottomPanel, .toggleAgent])
        default: break
        }
        guard let id = CommandID(rawValue: identifier.rawValue), let made = commandItem(id) else { return nil }
        made.isBordered = false
        made.isNavigational = id == .toggleSidebar
        return made
    }

    private func commandItem(_ id: CommandID) -> NSToolbarItem? {
        guard let button = Self.buttons[id] else { return nil }
        let item = NSToolbarItem(itemIdentifier: Self.button(id))
        item.image = NSImage(systemSymbolName: button.symbol, accessibilityDescription: button.label)
        symbols[id] = button.symbol
        item.label = button.label
        item.paletteLabel = button.label
        item.toolTip = Commands.command(id).map { tip($0) } ?? button.label
        item.target = shell
        item.action = #selector(ShellViewController.runCommand(_:))
        return item
    }

    private func group(_ identifier: NSToolbarItem.Identifier, label: String, _ ids: [CommandID]) -> NSToolbarItem {
        let buttons = ids.compactMap { id in Self.buttons[id].map { (id, $0) } }
        let images = buttons.compactMap { NSImage(systemSymbolName: $0.1.symbol, accessibilityDescription: $0.1.label) }
        let group = NSToolbarItemGroup(itemIdentifier: identifier, images: images, selectionMode: .momentary,
                                       labels: buttons.map(\.1.label), target: self, action: #selector(pressGroup(_:)))
        group.label = label
        group.paletteLabel = label
        group.controlRepresentation = .expanded
        groups[identifier] = buttons.map(\.0)
        for (subitem, (id, button)) in zip(group.subitems, buttons) {
            symbols[id] = button.symbol
            subitem.toolTip = Commands.command(id).map { tip($0) } ?? button.label
            subitem.autovalidates = false
        }
        return group
    }

    @objc private func pressGroup(_ sender: NSToolbarItemGroup) {
        guard let id = groups[sender.itemIdentifier]?[safe: sender.selectedIndex] else { return }
        shell?.run(id, from: sender)
    }

    func validateGroups(_ isEnabled: (CommandID) -> Bool) {
        for group in toolbar.items.compactMap({ $0 as? NSToolbarItemGroup }) {
            for (subitem, id) in zip(group.subitems, groups[group.itemIdentifier] ?? []) where subitem.isEnabled != isEnabled(id) {
                subitem.isEnabled = isEnabled(id)
            }
        }
    }

    private func item(_ id: CommandID) -> NSToolbarItem? {
        if let plain = toolbar.items.first(where: { $0.itemIdentifier.rawValue == id.rawValue }) { return plain }
        for group in toolbar.items.compactMap({ $0 as? NSToolbarItemGroup }) {
            if let index = groups[group.itemIdentifier]?.firstIndex(of: id) { return group.subitems[safe: index] }
        }
        return nil
    }

    private func tip(_ command: Command) -> String {
        command.key.map { "\(command.title) (\($0.display))" } ?? command.title
    }

    func retitle(_ identifier: CommandID, title: String, label: String? = nil, symbol: String? = nil) {
        guard let item = item(identifier) else { return }
        let key = Commands.command(identifier)?.key.map { " (\($0.display))" } ?? ""
        if item.toolTip != title + key, identifier != .toggleAgent || waiting == 0 { item.toolTip = title + key }
        if let label, item.label != label { item.label = label }
        if let symbol, symbols[identifier] != symbol {
            symbols[identifier] = symbol
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label ?? title)
        }
    }

    private func plain(_ identifier: NSToolbarItem.Identifier, label: String, view: NSView) -> NSToolbarItem {
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.view = view
        item.label = label
        item.paletteLabel = label
        item.isBordered = false
        return item
    }

    private func makePlace() -> NSView {
        let row = NSStackView(views: [project, branchGlyph, branch])
        row.orientation = .horizontal
        row.spacing = Space.x1
        row.setCustomSpacing(Space.x2, after: project)
        row.detachesHiddenViews = true
        project.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
        branchGlyph.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        branch.setContentCompressionResistancePriority(.defaultLow - 1, for: .horizontal)
        row.setHuggingPriority(.defaultHigh, for: .horizontal)
        let width = row.widthAnchor.constraint(equalToConstant: ShellViewController.sidebarWidth)
        width.isActive = true
        placeWidth = width
        row.setAccessibilityElement(false)
        return row
    }
}

extension WindowToolbar: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        shell?.runTargetMenu().items.forEach { item in
            item.menu?.removeItem(item)
            menu.addItem(item)
        }
    }
}
