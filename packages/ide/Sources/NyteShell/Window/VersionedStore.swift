import Foundation
import os

protocol VersionedValue: Codable, Equatable, Sendable {
    static var currentVersion: Int { get }
    var version: Int { get }
    init()
}

enum VersionedStore {
    static func load<Value: VersionedValue>(_ type: Value.Type, key: String, from store: UserDefaults = .standard) -> Value? {
        guard let data = store.data(forKey: key) else { return nil }
        do {
            let value = try JSONDecoder().decode(Value.self, from: data)
            guard value.version == Value.currentVersion else {
                Logger.shell.notice("\(key) is version \(value.version), not \(Value.currentVersion); starting fresh")
                return Value()
            }
            return value
        } catch {
            Logger.shell.error("\(key) did not decode, starting fresh: \(error.localizedDescription)")
            return Value()
        }
    }

    static func save<Value: VersionedValue>(_ value: Value, key: String, to store: UserDefaults = .standard) {
        do {
            store.set(try JSONEncoder().encode(value), forKey: key)
        } catch {
            Logger.shell.error("\(key) did not encode: \(error.localizedDescription)")
        }
    }
}
