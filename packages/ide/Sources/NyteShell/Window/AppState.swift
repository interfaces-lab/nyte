import Foundation

struct AppState: VersionedValue {
    static let currentVersion = 2
    static let key = "app.state"
    static let recentLimit = 10

    var version = AppState.currentVersion
    var lastWorkspace: String?
    var recentFolders: [String] = []

    static func load(from store: UserDefaults = .standard) -> AppState {
        VersionedStore.load(AppState.self, key: key, from: store) ?? AppState()
    }

    func save(to store: UserDefaults = .standard) { VersionedStore.save(self, key: Self.key, to: store) }

    func opening(_ path: String) -> AppState {
        var next = self
        next.lastWorkspace = path
        next.recentFolders = Array(([path] + recentFolders.filter { $0 != path }).prefix(Self.recentLimit))
        return next
    }

    func clearingRecents() -> AppState {
        var next = self
        next.recentFolders = []
        return next
    }
}
