import AppKit
import NyteChanges
import NyteCore
@testable import NyteShell

@MainActor
enum LayoutCheck {
    static let idleCases: [(DockIdle.Facts, Bool)] = [
        (DockIdle.Facts(shown: .terminal, hasForegroundJob: false, problemCount: 0, isDebugging: false), true),
        (DockIdle.Facts(shown: .terminal, hasForegroundJob: true, problemCount: 0, isDebugging: false), false),
        (DockIdle.Facts(shown: .folderTerminal, hasForegroundJob: false, problemCount: 3, isDebugging: false), true),
        (DockIdle.Facts(shown: .problems, hasForegroundJob: false, problemCount: 0, isDebugging: false), true),
        (DockIdle.Facts(shown: .problems, hasForegroundJob: false, problemCount: 2, isDebugging: false), false),
        (DockIdle.Facts(shown: .terminal, hasForegroundJob: false, problemCount: 0, isDebugging: true), false),
        (DockIdle.Facts(shown: .debug, hasForegroundJob: false, problemCount: 0, isDebugging: false), false),
        (DockIdle.Facts(shown: .search, hasForegroundJob: false, problemCount: 0, isDebugging: false), false),
        (DockIdle.Facts(shown: .find, hasForegroundJob: false, problemCount: 0, isDebugging: false), false),
    ]

    static var checks: Int { idleCases.count + 7 }

    static func run(_ shell: ShellViewController) async -> [String] {
        var failures = idleCases.enumerated().compactMap { index, item in
            DockIdle.isIdle(item.0) == item.1 ? nil : "idle case \(index) decided \(!item.1)"
        }
        if ForegroundJobs.anyRunning() { failures.append("a foreground job was seen in an idle terminal") }
        shell.editorPane.documents.map(\.id).forEach(shell.editorPane.closeDocument)
        shell.reviewLayout = .normal
        shell.setDock(open: true, from: nil)
        shell.setSidebar(open: true, from: nil)
        shell.showToolWindow(.terminal)
        let diff = DiffViewController(source: .texts(path: "hub/hub.go", before: DiffText(title: "Before", text: "a\n"),
                                                     after: DiffText(title: "After", text: "b\n")))
        shell.openDiff(diff)
        if !shell.dockItem.isCollapsed { failures.append("an idle terminal kept the dock open over a diff") }
        shell.toggleFocusReview()
        if !shell.sidebarItem.isCollapsed { failures.append("Focus Review left the sidebar open") }
        shell.toggleFocusReview()
        if shell.sidebarItem.isCollapsed { failures.append("leaving Focus Review did not bring the sidebar back") }
        shell.editorPane.closeDocument(shell.editorPane.documents.last?.id ?? "")
        if shell.dockItem.isCollapsed { failures.append("closing the diff did not bring the dock back") }
        shell.openDiff(diff)
        shell.setDock(open: true, from: nil)
        shell.setDock(open: false, from: nil)
        shell.editorPane.closeDocument(shell.editorPane.documents.last?.id ?? "")
        if !shell.dockItem.isCollapsed { failures.append("the dock reopened after the user closed it during the review") }
        shell.setDock(open: true, from: nil)
        return failures
    }

    static func windowMenu(_ preferences: PreferencesCenter) async -> [String] {
        NSApp.mainMenu = MainMenu.build(recent: NSMenu())
        let roots = ["Fixtures/notifyhub-go", "Fixtures/notifyhub-ts"].map { URL(fileURLWithPath: $0).standardizedFileURL }
        let controllers = roots.map { WorkspaceWindowController(workspace: Workspace(root: $0), preferences: preferences) }
        controllers.forEach(StateCheck.stage)
        _ = await Wait.pause(.seconds(1))
        let titles = NSApp.windowsMenu?.items.map(\.title) ?? []
        let missing = roots.map(\.lastPathComponent).filter { !titles.contains($0) }
        for controller in controllers {
            controller.window?.orderOut(nil)
            await controller.services.shutdown()
        }
        return missing.map { "the Window menu does not list \($0); it lists \(titles)" }
    }
}
