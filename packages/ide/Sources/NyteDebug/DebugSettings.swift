import Foundation
import NyteCore

public struct DebugSettings: Sendable, Equatable, Codable {
    public static let currentVersion = 1

    public var version = DebugSettings.currentVersion
    public var delvePath: String?
    public var jsDebugServerPath: String?
    public var nodePath: String?

    public init(delvePath: String? = nil, jsDebugServerPath: String? = nil, nodePath: String? = nil) {
        self.delvePath = delvePath
        self.jsDebugServerPath = jsDebugServerPath
        self.nodePath = nodePath
    }

    func path(for tool: DebugTool) -> String? {
        let path = switch tool {
        case .delve: delvePath
        case .jsDebug: jsDebugServerPath
        case .node: nodePath
        }
        return path.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
    }
}

public enum DebugTool: String, Sendable, CaseIterable {
    case delve, jsDebug, node

    public var title: String {
        switch self {
        case .delve: "Delve"
        case .jsDebug: "js-debug"
        case .node: "Node"
        }
    }

    var executable: String {
        switch self {
        case .delve: "dlv"
        case .jsDebug: "dapDebugServer.js"
        case .node: "node"
        }
    }
}

public struct DebugToolStatus: Sendable, Equatable {
    public var tool: DebugTool
    public var path: URL?
    public var version: String?
    public var isOverride: Bool
    public var source: ToolSource?
    public var searched: [String]
    public var problem: String?
    public var install: ToolInstall?
}

enum ToolResolver {
    static let versionTimeout: Duration = .seconds(5)

    static func resolve(_ tool: DebugTool, settings: DebugSettings, toolchain: Toolchain) async throws -> URL {
        let status = await status(tool, settings: settings, toolchain: toolchain, readsVersion: false)
        if let problem = status.problem { throw DebugFailure(problem) }
        guard let path = status.path else { throw DebugFailure(missing(tool)) }
        return path
    }

    static func status(_ tool: DebugTool, settings: DebugSettings, toolchain: Toolchain, readsVersion: Bool) async -> DebugToolStatus {
        if let override = settings.path(for: tool) {
            let url = URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
            let usable = tool == .jsDebug
                ? FileManager.default.fileExists(atPath: url.path)
                : FileManager.default.isExecutableFile(atPath: url.path)
            let problem = usable ? nil : tool == .jsDebug
                ? "js-debug is set to \(url.path) in Settings, but there is no file there."
                : "\(tool.title) is set to \(url.path) in Settings, but there is no program there that can run."
            let version = usable && readsVersion ? await version(of: tool, at: url, toolchain: toolchain) : nil
            return DebugToolStatus(tool: tool, path: usable ? url : nil, version: version, isOverride: true, source: .settings,
                                   searched: [url.path], problem: problem)
        }
        let searched: [String]
        let found: ResolvedTool?
        if tool == .jsDebug {
            searched = [AdapterPlan.jsDebugServer.path]
            found = FileManager.default.fileExists(atPath: AdapterPlan.jsDebugServer.path)
                ? ResolvedTool(url: AdapterPlan.jsDebugServer, source: .bundled) : nil
        } else {
            searched = await toolchain.searchFolders().map { $0 + "/" + tool.executable }
            found = await toolchain.resolve(tool.executable)
        }
        let version = await found.asyncMap { readsVersion ? await version(of: tool, at: $0.url, toolchain: toolchain) : nil } ?? nil
        let offersInstall = tool == .delve && (found == nil || found?.source == .bundled)
        let install = offersInstall ? await toolchain.install(.delve).map { offer in
            var named = offer
            named.title = "Install Delve with your Go"
            return named
        } : nil
        return DebugToolStatus(tool: tool, path: found?.url, version: version, isOverride: false, source: found?.source,
                               searched: searched, problem: found == nil ? missing(tool) : nil, install: install)
    }

    static func missing(_ tool: DebugTool) -> String {
        switch tool {
        case .delve: "Delve (dlv) is not installed. Install it with `go install github.com/go-delve/delve/cmd/dlv@latest`."
        case .jsDebug: "The JavaScript debugger is not installed. Expected \(AdapterPlan.jsDebugServer.path)."
        case .node: "Node is not installed."
        }
    }

    static func version(of tool: DebugTool, at url: URL, toolchain: Toolchain) async -> String? {
        switch tool {
        case .jsDebug:
            return await Task.detached { jsDebugVersion(at: url) }.value
        case .delve, .node:
            let arguments = tool == .delve ? ["version"] : ["--version"]
            let launch = ChildProcess.Launch(executable: url, arguments: arguments, environment: await toolchain.environment())
            guard let result = await ChildProcess.run(launch, timeout: versionTimeout), result.status == 0 else { return nil }
            let words = result.text.split(whereSeparator: \.isWhitespace).map(String.init)
            let numbered = words.first { $0.first == "v" && $0.dropFirst().first?.isNumber == true } ?? words.first { $0.first?.isNumber == true }
            return numbered.map { $0.hasPrefix("v") ? String($0.dropFirst()) : $0 }
        }
    }

    static func jsDebugVersion(at url: URL) -> String? {
        guard let text = try? String(contentsOf: url, encoding: .utf8),
              let match = text.firstMatch(of: /"js-debug",\w+="([0-9][0-9.]*)"/)
        else { return nil }
        return String(match.1)
    }
}

extension Optional {
    func asyncMap<Mapped>(_ transform: (Wrapped) async -> Mapped) async -> Mapped? {
        guard let self else { return nil }
        return await transform(self)
    }
}
