import Foundation

struct NavigatorState: Codable, Equatable {
    static let currentVersion = 1

    enum Origin: Equatable {
        case stored, migrated, fresh, unreadable(String)
    }

    var version = NavigatorState.currentVersion
    var expanded: [String] = []

    static func key(for root: String) -> String { "FileNavigator.state:" + root }
    static func legacyKey(for root: String) -> String { "FileNavigator.expanded:" + root }

    static func decode(_ data: Data?, legacy: [String]?) -> (state: NavigatorState, origin: Origin) {
        guard let data else {
            guard let legacy else { return (NavigatorState(), .fresh) }
            return (NavigatorState(expanded: legacy), .migrated)
        }
        do {
            let state = try JSONDecoder().decode(NavigatorState.self, from: data)
            guard state.version <= currentVersion else {
                return (NavigatorState(), .unreadable("version \(state.version) is newer than \(currentVersion)"))
            }
            return (state, .stored)
        } catch {
            return (NavigatorState(), .unreadable(error.localizedDescription))
        }
    }

    static func load(root: String, from defaults: UserDefaults) -> NavigatorState {
        let decoded = decode(defaults.data(forKey: key(for: root)), legacy: defaults.stringArray(forKey: legacyKey(for: root)))
        switch decoded.origin {
        case .stored, .fresh:
            break
        case .migrated:
            decoded.state.save(root: root, to: defaults)
            defaults.removeObject(forKey: legacyKey(for: root))
        case let .unreadable(reason):
            FilesLog.logger.error("Saved navigator state for \(root, privacy: .public) is unreadable, starting fresh: \(reason, privacy: .public)")
        }
        return decoded.state
    }

    func save(root: String, to defaults: UserDefaults) {
        do {
            defaults.set(try JSONEncoder().encode(self), forKey: Self.key(for: root))
        } catch {
            FilesLog.logger.error("Could not save navigator state: \(error.localizedDescription, privacy: .public)")
        }
    }
}
