import AppKit
import NyteCore

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windows: [WorkspaceWindowController] = []
    private let lastWorkspaceKey = "lastWorkspace"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = MainMenu.build()
        applyAppearance()
        guard windows.isEmpty else { return }
        let argument = CommandLine.arguments.dropFirst().first { !$0.hasPrefix("-") }
        let remembered = UserDefaults.standard.string(forKey: lastWorkspaceKey)
        guard let path = argument ?? remembered, isDirectory(path) else { return openFolder(nil) }
        open(URL(fileURLWithPath: path))
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        urls.filter { isDirectory($0.path) }.forEach(open)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { openFolder(nil) }
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

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

    private func open(_ url: URL) {
        let workspace = Workspace(root: url)
        if let existing = windows.first(where: { $0.workspace == workspace }) {
            return existing.window?.makeKeyAndOrderFront(nil) ?? ()
        }
        let controller = WorkspaceWindowController(workspace: workspace)
        controller.onClose = { [weak self, weak controller] in
            self?.windows.removeAll { $0 === controller }
        }
        windows.append(controller)
        UserDefaults.standard.set(workspace.root.path, forKey: lastWorkspaceKey)
        NSDocumentController.shared.noteNewRecentDocumentURL(workspace.root)
        controller.showWindow(nil)
        NSApp.activate()
    }

    /// The `appearance` default is `light`, `dark`, or absent to follow the system.
    private func applyAppearance() {
        switch UserDefaults.standard.string(forKey: "appearance") {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: NSApp.appearance = nil
        }
    }

    private func isDirectory(_ path: String) -> Bool {
        var directory: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &directory) && directory.boolValue
    }
}
