import AppKit
import NyteCore
import NyteDiagrams
import NyteUI

@MainActor
public final class AppDelegate: NSObject, NSApplicationDelegate {
    private(set) var windows: [WorkspaceWindowController] = []
    private(set) var state = AppState.load()
    let preferences: PreferencesCenter
    private let store: UserDefaults
    private lazy var settings: SettingsWindowController = {
        let controller = SettingsWindowController(center: preferences) { [weak self] in
            self?.frontWorkspace?.workspace.root ?? FileManager.default.homeDirectoryForCurrentUser
        }
        controller.currentFolder = { [weak self] in self?.frontWorkspace?.workspace.root }
        controller.onInstall = { [weak self] install in
            guard let front = self?.frontWorkspace else { return }
            front.window?.makeKeyAndOrderFront(nil)
            front.shell?.runInTerminal(install.command, directory: install.directory, title: install.title)
        }
        return controller
    }()

    private var frontWorkspace: WorkspaceWindowController? {
        windows.first { $0.window?.isMainWindow == true } ?? windows.last
    }
    private(set) lazy var welcome: WelcomeWindowController = {
        let controller = WelcomeWindowController()
        controller.recents = { [weak self] in self?.recentFolders ?? [] }
        controller.onOpen = { [weak self] url in self?.open(url) }
        controller.onChooseFolder = { [weak self] in self?.openFolder(nil) }
        controller.onForget = { [weak self] url in self?.forget(url) }
        return controller
    }()
    private let recentMenu = NSMenu(title: "Open Recent")

    override public convenience init() { self.init(preferences: PreferencesCenter(), store: .standard) }

    init(preferences: PreferencesCenter, store: UserDefaults) {
        self.preferences = preferences
        self.store = store
        state = AppState.load(from: store)
        super.init()
        recentMenu.delegate = self
    }

    static func installRenderers() {
        Diagrams.install()
    }

    public func applicationDidFinishLaunching(_ notification: Notification) {
        Self.installRenderers()
        NSApp.mainMenu = MainMenu.build(recent: recentMenu)
        Self.wire(preferences)
        guard windows.isEmpty else { return }
        let argument = CommandLine.arguments.dropFirst().first(where: Self.isDirectory)
        let remembered = preferences.value.general.restoresLastWorkspace ? state.lastWorkspace : nil
        guard let path = argument ?? remembered, Self.isDirectory(path) else { return showWelcome() }
        open(URL(fileURLWithPath: path))
    }

    public func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            guard !Self.isDirectory(url.path) else {
                open(url)
                continue
            }
            let file = url.standardizedFileURL
            let owner = windows.first { file.path.hasPrefix($0.workspace.root.standardizedFileURL.path + "/") }
            let controller = owner ?? open(url.deletingLastPathComponent())
            controller?.shell?.openFile(file)
        }
    }

    public func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWelcome() }
        return true
    }

    public func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        recentItems().forEach(menu.addItem)
        return menu
    }

    public func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let asks = preferences.value.general.confirmsQuitWhileRunning
        if let warning = CloseWarning.decide(windows.map(\.risk), action: .quit, asksForPrograms: asks) {
            guard warning.alert().runModal() == .alertFirstButtonReturn else { return .terminateCancel }
        }
        windows.forEach { $0.shell?.persistViews() }
        let services = windows.map(\.services)
        guard !services.isEmpty else { return .terminateNow }
        Task {
            for service in services { await service.shutdown() }
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    @objc func showSettings(_ sender: Any?) {
        settings.showWindow(sender)
    }

    func showWelcome() {
        welcome.showWindow(nil)
        NSApp.activate()
    }

    @objc func openFolder(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Open"
        panel.message = "Choose a folder to work in"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        open(url)
    }

    @objc func openRecentFolder(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        open(url)
    }

    @objc func clearRecentFolders(_ sender: Any?) {
        state = state.clearingRecents()
        state.save(to: store)
        NSDocumentController.shared.clearRecentDocuments(sender)
        welcome.reload()
    }

    var recentFolders: [URL] { state.recentFolders.map { URL(fileURLWithPath: $0, isDirectory: true) } }

    @discardableResult
    func open(_ url: URL) -> WorkspaceWindowController? {
        guard Self.isDirectory(url.path) else {
            missing(url)
            return nil
        }
        let workspace = Workspace(root: url)
        if let existing = windows.first(where: { $0.workspace == workspace }) {
            existing.window?.makeKeyAndOrderFront(nil)
            return existing
        }
        let controller = WorkspaceWindowController(workspace: workspace, preferences: preferences)
        controller.onClose = { [weak self, weak controller] in
            self?.windows.removeAll { $0 === controller }
        }
        windows.append(controller)
        remember(workspace.root)
        welcome.close()
        controller.showWindow(nil)
        NSApp.activate()
        return controller
    }

    private func remember(_ root: URL) {
        state = state.opening(root.standardizedFileURL.path)
        state.save(to: store)
        NSDocumentController.shared.noteNewRecentDocumentURL(root)
    }

    private func forget(_ url: URL) {
        var next = state
        next.recentFolders.removeAll { $0 == url.standardizedFileURL.path }
        if next.lastWorkspace == url.standardizedFileURL.path { next.lastWorkspace = nil }
        state = next
        state.save(to: store)
    }

    private func missing(_ url: URL) {
        let alert = NSAlert()
        alert.messageText = "\u{201C}\(url.lastPathComponent)\u{201D} can\u{2019}t be opened."
        alert.informativeText = "There is no folder at \(url.path). It may have been moved, renamed or deleted."
        alert.addButton(withTitle: "OK")
        forget(url)
        welcome.reload()
        alert.runModal()
    }

    func recentItems() -> [NSMenuItem] {
        recentFolders.map { url in
            let item = NSMenuItem(title: url.lastPathComponent, action: #selector(openRecentFolder(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = url
            item.toolTip = url.path
            item.image = NSWorkspace.shared.icon(forFile: url.path)
            item.image?.size = NSSize(width: Glyph.md.rawValue, height: Glyph.md.rawValue)
            item.preferredImageVisibility = .visible
            return item
        }
    }

    static func wire(_ preferences: PreferencesCenter) {
        preferences.observe { value in
            apply(value.general.appearance)
            NyteUI.Density.apply(value.general.density == .compact ? .compact : .standard)
        }
    }

    static func apply(_ appearance: Preferences.Appearance) {
        switch appearance {
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        case .system: NSApp.appearance = nil
        }
    }

    static func isDirectory(_ path: String) -> Bool {
        var directory: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &directory) && directory.boolValue
    }
}

extension AppDelegate: NSMenuDelegate, NSMenuItemValidation {
    public func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        recentItems().forEach(menu.addItem)
        if !menu.items.isEmpty { menu.addItem(.separator()) }
        let clear = NSMenuItem(title: "Clear Menu", action: #selector(clearRecentFolders(_:)), keyEquivalent: "")
        clear.target = self
        menu.addItem(clear)
    }

    public func validateMenuItem(_ item: NSMenuItem) -> Bool {
        item.action == #selector(clearRecentFolders(_:)) ? !state.recentFolders.isEmpty : true
    }
}
