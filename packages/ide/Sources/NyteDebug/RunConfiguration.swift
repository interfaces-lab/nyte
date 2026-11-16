import Foundation
import NyteCore
import os

public struct RunConfiguration: Sendable, Hashable, Codable {
    public enum Kind: String, Sendable, Hashable, Codable {
        case goPackage, goTest, node
    }

    public var name: String
    public var kind: Kind
    public var program: String
    public var test: String?
    public var arguments: [String]
    public var runtimeArguments: [String]
    public var environment: [String: String]
    public var directory: String?

    public init(name: String, kind: Kind, program: String, test: String? = nil, arguments: [String] = [],
                runtimeArguments: [String] = [], environment: [String: String] = [:], directory: String? = nil) {
        self.runtimeArguments = runtimeArguments
        self.name = name
        self.kind = kind
        self.program = program
        self.test = test
        self.arguments = arguments
        self.environment = environment
        self.directory = directory
    }

    public init(target: DebugTarget, in workspace: Workspace) {
        let relative = { (url: URL) in RunConfiguration.relative(url, in: workspace) }
        switch target.kind {
        case let .goPackage(folder):
            self.init(name: target.name, kind: .goPackage, program: relative(folder))
        case let .goTest(folder, test):
            self.init(name: target.name, kind: .goTest, program: relative(folder), test: test)
        case let .node(file):
            self.init(name: target.name, kind: .node, program: relative(file))
        }
        arguments = target.arguments
        runtimeArguments = target.runtimeArguments
        environment = target.environment
        let natural = self.target(in: workspace).directory.standardizedFileURL
        directory = target.directory.standardizedFileURL == natural ? nil : relative(target.directory)
    }

    public func target(in workspace: Workspace) -> DebugTarget {
        let program = Self.absolute(program, in: workspace)
        let kind: DebugTarget.Kind = switch kind {
        case .goPackage: .goPackage(program)
        case .goTest: .goTest(program, test: test)
        case .node: .node(program)
        }
        let natural = self.kind == .node ? TargetFinder.nodeFolder(for: program, in: workspace) : program
        return DebugTarget(
            id: "config:" + name, name: name, kind: kind, directory: directory.map { Self.absolute($0, in: workspace) } ?? natural,
            arguments: arguments, environment: environment, runtimeArguments: runtimeArguments
        )
    }

    static func relative(_ url: URL, in workspace: Workspace) -> String {
        url.standardizedFileURL.path == workspace.root.path ? "." : workspace.relativePath(of: url)
    }

    static func absolute(_ path: String, in workspace: Workspace) -> URL {
        if path.hasPrefix("/") { return URL(fileURLWithPath: path).standardizedFileURL }
        return (path == "." ? workspace.root : workspace.root.appendingPathComponent(path)).standardizedFileURL
    }
}

struct RunConfigurationFile: Sendable, Equatable, Codable {
    static let currentVersion = 1

    var version = RunConfigurationFile.currentVersion
    var configurations: [RunConfiguration] = []

    static func url(in workspace: Workspace) -> URL {
        workspace.root.appendingPathComponent(".nyte/run-configurations.json")
    }

    static func read(in workspace: Workspace) -> [RunConfiguration] {
        let url = url(in: workspace)
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch CocoaError.fileReadNoSuchFile {
            return []
        } catch {
            Logger.debugger.error("read \(url.path, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            return []
        }
        do {
            let file = try JSONDecoder().decode(RunConfigurationFile.self, from: data)
            guard file.version == currentVersion else {
                Logger.debugger.error("\(url.path, privacy: .public) has version \(file.version), expected \(currentVersion); ignoring it")
                return []
            }
            return file.configurations
        } catch {
            Logger.debugger.error("decode \(url.path, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            return []
        }
    }

    static func write(_ configurations: [RunConfiguration], in workspace: Workspace) throws {
        let url = url(in: workspace)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(RunConfigurationFile(configurations: configurations)).write(to: url, options: .atomic)
    }
}
