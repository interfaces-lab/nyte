import Foundation
import os

public struct LanguageSettings: Codable, Sendable, Hashable {
    public static let currentVersion = 1
    public static let megabyte = 1 << 20

    public struct GoInlayHints: Codable, Sendable, Hashable {
        public var parameterNames = true
        public var constantValues = true
        public var assignVariableTypes = false
        public var rangeVariableTypes = false
        public var compositeLiteralTypes = false
        public var compositeLiteralFields = false
        public var functionTypeParameters = false

        public init() {}
    }

    public struct Go: Codable, Sendable, Hashable {
        public var inlayHints = GoInlayHints()
        public var countsUsages = false
        public var serverPath: String?
        public var memoryCeilingMegabytes = 3_072

        public init() {}
    }

    public enum ParameterNames: String, Codable, Sendable, Hashable, CaseIterable {
        case none, literals, all
    }

    public struct TypeScriptInlayHints: Codable, Sendable, Hashable {
        public var parameterNames = ParameterNames.literals
        public var parameterNamesWhenArgumentMatches = false
        public var functionParameterTypes = true
        public var variableTypes = false
        public var propertyDeclarationTypes = false
        public var functionLikeReturnTypes = false
        public var enumMemberValues = true

        public init() {}
    }

    public enum TypeScriptServer: String, Codable, Sendable, Hashable, CaseIterable {
        case automatic, tsserver

        public init(from decoder: any Decoder) throws {
            self = try Self(rawValue: decoder.singleValueContainer().decode(String.self)) ?? .automatic
        }

        public var title: String {
            switch self {
            case .automatic: "Native (TypeScript 7)"
            case .tsserver: "tsserver (Node)"
            }
        }
    }

    public struct TypeScript: Codable, Sendable, Hashable {
        public var inlayHints = TypeScriptInlayHints()
        public var countsUsages = true
        public var server = TypeScriptServer.automatic
        public var nativeServerPath: String?
        public var languageServerPath: String?
        public var tsserverWorkspaces: [String] = []
        public var memoryCeilingMegabytes = 3_072

        public init() {}
    }

    public var version = currentVersion
    public var go = Go()
    public var typeScript = TypeScript()

    public init() {}

    public func usesTSServer(in workspace: URL) -> Bool {
        typeScript.server == .tsserver || typeScript.tsserverWorkspaces.contains(workspace.standardizedFileURL.path)
    }

    public func choosingTSServer(_ on: Bool, in workspace: URL) -> LanguageSettings {
        var changed = self
        let path = workspace.standardizedFileURL.path
        changed.typeScript.tsserverWorkspaces.removeAll { $0 == path }
        if on { changed.typeScript.tsserverWorkspaces.append(path) }
        return changed
    }

    public static func decoded(from data: Data) -> LanguageSettings {
        let defaults = LanguageSettings()
        guard let stored = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let base = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(defaults)) as? [String: Any],
              let merged = try? JSONSerialization.data(withJSONObject: merging(stored, over: base)),
              var settings = try? JSONDecoder().decode(LanguageSettings.self, from: merged)
        else {
            Logger.core.error("decode language settings failed: \(data.count) bytes; using the defaults")
            return defaults
        }
        settings.version = currentVersion
        return settings
    }

    private static func merging(_ stored: [String: Any], over base: [String: Any]) -> [String: Any] {
        var result = base
        for (key, value) in stored {
            if let inner = value as? [String: Any], let below = base[key] as? [String: Any] {
                result[key] = merging(inner, over: below)
            } else if base[key] != nil {
                result[key] = value
            } else if key.hasSuffix("Path") {
                result[key] = value
            }
        }
        return result
    }
}
