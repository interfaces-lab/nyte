import AppKit
import NyteCore
import NyteDesign

@MainActor
final class WorkspaceWindowController: NSWindowController, NSWindowDelegate {
    let workspace: Workspace
    var onClose: (() -> Void)?

    init(workspace: Workspace) {
        self.workspace = workspace
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 840),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false
        )
        window.title = workspace.name
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        // An empty compact toolbar makes the titlebar 40pt, Nyte's bar height, and lets the
        // system centre the traffic lights in it. The row's contents are the shell's own views.
        window.toolbar = NSToolbar(identifier: "shell")
        window.toolbarStyle = .unifiedCompact
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 760, height: 480)
        window.isReleasedWhenClosed = false
        window.backgroundColor = .clear
        window.isOpaque = false
        super.init(window: window)
        window.contentViewController = ShellViewController(workspace: workspace)
        window.delegate = self
        // A content view controller resizes the window to its fitting size; put the default back
        // before the saved frame, if there is one, replaces it.
        window.setContentSize(NSSize(width: 1320, height: 840))
        window.center()
        window.setFrameAutosaveName("workspace:" + workspace.root.path)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func windowWillClose(_ notification: Notification) { onClose?() }
}
