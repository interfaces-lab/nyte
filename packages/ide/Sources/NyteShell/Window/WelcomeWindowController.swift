import AppKit
import NyteUI

@MainActor
final class WelcomeWindowController: NSWindowController {
    var recents: () -> [URL] = { [] }
    var onOpen: ((URL) -> Void)?
    var onChooseFolder: (() -> Void)?
    var onForget: ((URL) -> Void)?

    static let size = NSSize(width: 480, height: 440)
    static let iconSide: CGFloat = 64
    static let inset = Space.x6

    private let list = ListView()
    private let empty = Label("No recent folders", style: .base, color: Palette.contentTertiary)
    private lazy var open = Button("Open Folder…", variant: .solid, tone: .primary, size: .md) { [weak self] in
        self?.onChooseFolder?()
    }
    private var shown: [URL] = []

    init() {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.size),
                              styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: true)
        window.title = "Welcome to Nyte IDE"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        window.tabbingMode = .disallowed
        window.isMovableByWindowBackground = true
        super.init(window: window)
        window.contentView = makeContent()
        window.center()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func showWindow(_ sender: Any?) {
        reload()
        super.showWindow(sender)
        window?.makeFirstResponder(shown.isEmpty ? open : list)
    }

    func reload() {
        shown = recents()
        list.reload()
        list.selectedRow = shown.isEmpty ? nil : 0
        list.isHidden = shown.isEmpty
        empty.isHidden = !shown.isEmpty
    }

    private func makeContent() -> NSView {
        let root = ChromeBackground()
        let icon = NSImageView(image: NSApp.applicationIconImage ?? NSImage())
        icon.imageScaling = .scaleProportionallyUpOrDown
        let name = Label("Nyte IDE", style: .xl, color: Palette.contentPrimary, weight: .semibold)
        let line = Label("Open a folder to direct agents and read their work.", style: .base, color: Palette.contentSecondary)
        let heading = Label("Recent", style: .sm, color: Palette.contentTertiary, weight: .medium)
        let rule = Hairline()
        list.rowCount = { [weak self] in self?.shown.count ?? 0 }
        list.content = { [weak self] row in self?.row(row) ?? RowContent() }
        list.onActivate = { [weak self] row in self?.activate(row) }
        list.onReturn = { [weak self] row in self?.activate(row) }
        list.menuForRow = { [weak self] row in self?.menu(row) }
        list.setAccessibilityLabel("Recent folders")
        for view in [icon, name, line, open, rule, heading, list, empty] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(view)
        }
        NSLayoutConstraint.activate([
            icon.topAnchor.constraint(equalTo: root.topAnchor, constant: Self.inset + Space.x6),
            icon.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            icon.widthAnchor.constraint(equalToConstant: Self.iconSide),
            icon.heightAnchor.constraint(equalToConstant: Self.iconSide),
            name.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: Space.x3),
            name.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            line.topAnchor.constraint(equalTo: name.bottomAnchor, constant: Space.x1),
            line.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            open.topAnchor.constraint(equalTo: line.bottomAnchor, constant: Space.x5),
            open.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            rule.topAnchor.constraint(equalTo: open.bottomAnchor, constant: Self.inset),
            rule.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            heading.topAnchor.constraint(equalTo: rule.bottomAnchor, constant: Space.x3),
            heading.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Self.inset),
            list.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: Space.x1),
            list.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Space.x2),
            list.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Space.x2),
            list.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Space.x2),
            empty.leadingAnchor.constraint(equalTo: heading.leadingAnchor),
            empty.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: Space.x2),
        ])
        return root
    }

    private func row(_ index: Int) -> RowContent {
        guard let url = shown[safe: index] else { return RowContent() }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let parent = url.deletingLastPathComponent().path
        let place = parent.hasPrefix(home) ? "~" + parent.dropFirst(home.count) : parent
        return RowContent(title: url.lastPathComponent, detail: place, leading: .symbol("folder", .secondary))
    }

    private func activate(_ row: Int) {
        shown[safe: row].map { onOpen?($0) }
    }

    private func menu(_ row: Int) -> NSMenu? {
        guard let url = shown[safe: row] else { return nil }
        return Menu.make([
            MenuItem("Open") { [weak self] in self?.onOpen?(url) },
            MenuItem("Reveal in Finder", symbol: "folder", showsIcon: true) { NSWorkspace.shared.activateFileViewerSelecting([url]) },
            .separator,
            MenuItem("Remove from Recent") { [weak self] in
                self?.onForget?(url)
                self?.reload()
            },
        ])
    }
}
