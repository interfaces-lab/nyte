import Foundation
import NyteCore
import NyteEditor

struct WorkspaceState: VersionedValue {
    struct Panes: Codable, Equatable, Sendable {
        var sidebarWidth: Double?
        var agentWidth: Double?
        var dockHeight: Double?
        var isSidebarOpen = true
        var isAgentOpen = false
        var isDockOpen = true
    }

    static let currentVersion = 4

    var version = WorkspaceState.currentVersion
    var openTabs: [String] = []
    var selectedTab: Int?
    var views: [String: EditorViewState] = [:]
    var navigator: String?
    var dockWindow: String?
    var runTarget: String?
    var panes = Panes()
    var windowFrame: String?

    static func key(for workspace: Workspace) -> String { "workspace.state:" + workspace.root.path }

    static func load(_ workspace: Workspace, from store: UserDefaults = .standard) -> WorkspaceState {
        VersionedStore.load(WorkspaceState.self, key: key(for: workspace), from: store) ?? WorkspaceState()
    }

    func save(_ workspace: Workspace, to store: UserDefaults = .standard) {
        VersionedStore.save(self, key: Self.key(for: workspace), to: store)
    }

    static func forget(_ workspace: Workspace, in store: UserDefaults = .standard) {
        store.removeObject(forKey: key(for: workspace))
    }
}

@MainActor
final class WorkspaceMemory {
    let workspace: Workspace
    private(set) var state: WorkspaceState

    init(_ workspace: Workspace) {
        self.workspace = workspace
        state = WorkspaceState.load(workspace)
    }

    func update(_ change: (inout WorkspaceState) -> Void) {
        var next = state
        change(&next)
        guard next != state else { return }
        state = next
        state.save(workspace)
    }
}
