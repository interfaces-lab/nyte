import AppKit
import NyteCore
@testable import NyteShell

@MainActor
enum StateCheck {
    static let sidebarWidth = 300.0
    static let runTarget = "config:state-check"

    static func stage(_ controller: WorkspaceWindowController) {
        guard let window = controller.window else { return }
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.orderBack(nil)
        window.layoutIfNeeded()
    }

    static func run(_ workspace: Workspace, preferences: PreferencesCenter) async -> [String] {
        WorkspaceState.forget(workspace)
        let first = WorkspaceWindowController(workspace: workspace, preferences: preferences)
        stage(first)
        guard let shell = first.shell else { return ["the first window has no shell"] }
        let files = ["hub/hub.go", "main.go", "hub/stats.go"].map { workspace.root.appendingPathComponent($0).standardizedFileURL }
        files.forEach { shell.editor.open($0, preview: false) }
        shell.editor.select(at: 1)
        let caret = TextPosition(line: 9, column: 3)
        shell.editor.reveal(FileLocation(url: files[1], range: TextSpan(at: caret)), asJump: false)
        _ = await Wait.until(.seconds(5)) { shell.lastPosition?.line == caret.line + 1 }
        shell.setAgent(open: false, from: nil)
        shell.setDock(open: true, from: nil)
        shell.sidebar.select(id: "structure")
        shell.showToolWindow(.problems)
        shell.memory.update { state in
            state.runTarget = runTarget
            state.panes.sidebarWidth = sidebarWidth
        }
        AllCheck.progress("state: closing the first window")
        first.window?.close()
        await Wait.pause(.seconds(1))
        AllCheck.progress("state: closed")
        let written = WorkspaceState.load(workspace)

        let second = WorkspaceWindowController(workspace: workspace, preferences: preferences)
        stage(second)
        AllCheck.progress("state: rebuilt")
        guard let again = second.shell else { return ["the rebuilt window has no shell"] }
        _ = await Wait.until(.seconds(5)) { again.lastPosition != nil }
        second.window?.layoutIfNeeded()
        var failures: [String] = []
        let expect = { (ok: Bool, what: String) in if !ok { failures.append(what) } }
        expect(written.openTabs == ["hub/hub.go", "main.go", "hub/stats.go"], "saved tabs are \(written.openTabs)")
        let saved = written.views["main.go"].flatMap { $0.selections[safe: $0.primarySelection] }
        expect(saved?.headLine == caret.line && saved?.headColumn == caret.column, "saved caret is \(String(describing: saved))")
        expect(again.editor.tabs.map(\.url) == files, "rebuilt tabs are \(again.editor.tabs.map(\.title))")
        expect(again.editor.selectedURL == files[1], "rebuilt selection is \(again.editor.selectedURL?.lastPathComponent ?? "none")")
        expect(again.lastPosition?.line == caret.line + 1 && again.lastPosition?.column == caret.column + 1,
               "rebuilt caret is \(again.lastPosition.map { "\($0.line):\($0.column)" } ?? "none")")
        expect(again.agentItem.isCollapsed, "the agent pane reopened")
        expect(!again.dockItem.isCollapsed, "the dock stayed collapsed")
        expect(again.sidebar.navigators[again.sidebar.selected].id == "structure", "the sidebar shows another navigator")
        expect(again.dock.selected == .problems, "the dock shows \(String(describing: again.dock.selected))")
        expect(again.memory.state.runTarget == runTarget, "the run target is \(again.memory.state.runTarget ?? "none")")
        expect(abs(again.sidebar.view.frame.width - sidebarWidth) < 1, "the sidebar is \(again.sidebar.view.frame.width) wide")
        expect(again.memory.state == written, "the rebuilt window rewrote its state")
        second.window?.close()
        WorkspaceState.forget(workspace)
        await first.services.shutdown()
        await second.services.shutdown()
        return failures
    }
}
