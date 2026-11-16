import AppKit
import NyteCore
import NyteUI

@MainActor
final class WorkspaceWindowController: NSWindowController, NSWindowDelegate {
    let workspace: Workspace
    let services: WorkspaceServices
    var onClose: (() -> Void)?

    static let defaultSize = NSSize(width: 1320, height: 840)
    static let minimumSize = NSSize(width: 760, height: 480)

    private let preferences: PreferencesCenter
    private var preferenceToken: Int?

    init(workspace: Workspace, preferences: PreferencesCenter) {
        self.workspace = workspace
        self.preferences = preferences
        services = WorkspaceServices(workspace: workspace, settings: preferences.value.language)
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.defaultSize),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false
        )
        window.title = workspace.name
        window.subtitle = ""
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.tabbingMode = .disallowed
        window.minSize = Self.minimumSize
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        super.init(window: window)
        let shell = ShellViewController(workspace: workspace, services: services)
        shell.preferences = preferences
        window.contentViewController = shell
        window.toolbar = shell.windowToolbar.toolbar
        window.toolbarStyle = .unifiedCompact
        window.delegate = self
        preferenceToken = preferences.observe { [weak shell] in shell?.preferencesDidChange($0) }
        window.setContentSize(Self.defaultSize)
        window.center()
        if let saved = shell.memory.state.windowFrame.map(NSRectFromString), saved.width >= Self.minimumSize.width,
           saved.height >= Self.minimumSize.height {
            window.setFrame(saved, display: false)
        }
    }

    func windowWillResize(_ sender: NSWindow, to frameSize: NSSize) -> NSSize {
        shell?.fitPanes(toWindowWidth: frameSize.width)
        return frameSize
    }

    func windowDidMove(_ notification: Notification) { rememberFrame() }
    func windowDidEndLiveResize(_ notification: Notification) { rememberFrame() }

    private func rememberFrame() {
        guard let window, !window.styleMask.contains(.fullScreen) else { return }
        shell?.memory.update { $0.windowFrame = NSStringFromRect(window.frame) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    var shell: ShellViewController? { window?.contentViewController as? ShellViewController }

    var risk: CloseRisk {
        guard let shell else { return CloseRisk(project: workspace.name) }
        return CloseRisk(project: workspace.name, unsaved: shell.editor.tabs.filter(\.isDirty).map(\.title),
                         program: shell.isSessionActive ? shell.startedTarget ?? "a program" : nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard let warning = CloseWarning.decide([risk], action: .close,
                                                asksForPrograms: preferences.value.general.confirmsQuitWhileRunning)
        else { return true }
        warning.alert().beginSheetModal(for: sender) { response in
            if response == .alertFirstButtonReturn { sender.close() }
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        shell?.persistViews()
        preferenceToken.map(preferences.stopObserving)
        let services = services
        Task { await services.shutdown() }
        onClose?()
    }
}
