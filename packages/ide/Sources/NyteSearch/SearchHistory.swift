import Foundation
import os

public struct SearchHistory: Codable, Sendable, Equatable {
    public static let currentVersion = 1
    public static let capacity = 50

    public enum Origin: Sendable, Equatable {
        case fresh, stored, unreadable
    }

    public var version = SearchHistory.currentVersion
    public var entries: [String] = []

    public init(entries: [String] = []) {
        self.entries = entries
    }

    public func recording(_ text: String) -> SearchHistory {
        guard !text.isEmpty else { return self }
        var next = self
        next.entries.removeAll { $0 == text }
        next.entries.insert(text, at: 0)
        if next.entries.count > Self.capacity { next.entries.removeLast(next.entries.count - Self.capacity) }
        return next
    }

    public static func decode(_ data: Data?) -> (history: SearchHistory, origin: Origin) {
        guard let data else { return (SearchHistory(), .fresh) }
        do {
            let history = try JSONDecoder().decode(SearchHistory.self, from: data)
            guard history.version == currentVersion else {
                Logger.search.error("search history version \(history.version, privacy: .public) is not \(currentVersion, privacy: .public); starting fresh")
                return (SearchHistory(), .unreadable)
            }
            return (history, .stored)
        } catch {
            Logger.search.error("search history unreadable: \(error.localizedDescription, privacy: .public)")
            return (SearchHistory(), .unreadable)
        }
    }

    public static func key(for root: URL) -> String { "search.history." + root.standardizedFileURL.path }

    public static func load(root: URL, from defaults: UserDefaults = .standard) -> SearchHistory {
        decode(defaults.data(forKey: key(for: root))).history
    }

    public func save(root: URL, to defaults: UserDefaults = .standard) {
        do {
            defaults.set(try JSONEncoder().encode(self), forKey: Self.key(for: root))
        } catch {
            Logger.search.error("search history not saved: \(error.localizedDescription, privacy: .public)")
        }
    }
}

public struct HistoryCursor: Sendable, Equatable {
    public private(set) var position = -1
    public private(set) var draft = ""

    public init() {}

    public mutating func step(_ delta: Int, in history: SearchHistory, current: String) -> String? {
        if position == -1 { draft = current }
        let target = position + (delta < 0 ? 1 : -1)
        guard target >= -1, target < history.entries.count else { return nil }
        position = target
        return target == -1 ? draft : history.entries[target]
    }

    public mutating func reset() {
        position = -1
        draft = ""
    }
}
