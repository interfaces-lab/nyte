import Darwin
import Foundation
import os

public enum ToolSource: String, Sendable, Hashable, Codable, CaseIterable {
    case settings, project, path, goBin, npmGlobal, local, homebrew, bundled

    public var words: String {
        switch self {
        case .settings: "Settings"
        case .project: "this project"
        case .path: "your PATH"
        case .goBin: "Go's bin folder"
        case .npmGlobal: "npm's global packages"
        case .local: "~/.local/bin"
        case .homebrew: "Homebrew"
        case .bundled: "Nyte IDE's copy"
        }
    }
}

public struct ResolvedTool: Sendable, Hashable {
    public var url: URL
    public var source: ToolSource

    public init(url: URL, source: ToolSource) {
        self.url = url
        self.source = source
    }
}

public struct SearchFolder: Sendable, Hashable {
    public var path: String
    public var source: ToolSource
}

public struct ToolInstall: Sendable, Hashable {
    public var title: String
    public var command: [String]
    public var directory: URL
    public var shown: String

    public init(title: String, command: [String], directory: URL, shown: String) {
        self.title = title
        self.command = command
        self.directory = directory
        self.shown = shown
    }
}

public enum InstallableTool: Sendable, Hashable {
    case gopls, delve, typeScript(project: URL?)
}

public struct EnvironmentReading: Sendable {
    public var values: [String: String]
    public var goBins: [String]
    public var elapsed: Duration
    public var problem: String?

    public init(values: [String: String], goBins: [String] = [], elapsed: Duration, problem: String? = nil) {
        self.values = values
        self.goBins = goBins
        self.elapsed = elapsed
        self.problem = problem
    }
}

public actor Toolchain {
    public static let managedRoot = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Nyte IDE/tools", isDirectory: true)

    public nonisolated let workspace: URL
    private var cached: Task<EnvironmentReading, Never>?
    private var npmRoot: Task<URL?, Never>?

    static let shellTimeout: Duration = .seconds(8)
    private static let mark = "__nyte_environment__"
    private static let goPackages: [InstallableTool: (name: String, package: String)] = [
        .gopls: ("gopls", "golang.org/x/tools/gopls@latest"), .delve: ("dlv", "github.com/go-delve/delve/cmd/dlv@latest"),
    ]
    public static let typeScriptRelease = "typescript@7"

    public init(workspace: URL) {
        self.workspace = workspace
    }

    public func environment() async -> [String: String] {
        await reading().values
    }

    public func reading() async -> EnvironmentReading {
        if let cached { return await cached.value }
        let workspace = workspace
        let task = Task { await Self.read(in: workspace) }
        cached = task
        return await task.value
    }

    public func reload() async -> EnvironmentReading {
        cached = nil
        npmRoot = nil
        return await reading()
    }

    public func locate(_ name: String) async -> URL? {
        await resolve(name)?.url
    }

    public func resolve(_ name: String, from sources: Set<ToolSource> = Set(ToolSource.allCases)) async -> ResolvedTool? {
        await searchPlaces().lazy
            .filter { sources.contains($0.source) }
            .map { ResolvedTool(url: URL(fileURLWithPath: $0.path).appendingPathComponent(name), source: $0.source) }
            .first { FileManager.default.isExecutableFile(atPath: $0.url.path) }
    }

    public func searchFolders() async -> [String] {
        await searchPlaces().map(\.path)
    }

    public func searchPlaces() async -> [SearchFolder] {
        let reading = await reading()
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let places = [SearchFolder(path: workspace.appendingPathComponent("node_modules/.bin").path, source: .project)]
            + (reading.values["PATH"] ?? "").split(separator: ":").map { SearchFolder(path: String($0), source: .path) }
            + reading.goBins.map { SearchFolder(path: $0, source: .goBin) }
            + [
                SearchFolder(path: home + "/.local/bin", source: .local),
                SearchFolder(path: "/opt/homebrew/bin", source: .homebrew), SearchFolder(path: "/usr/local/bin", source: .homebrew),
                SearchFolder(path: Self.managedRoot.appendingPathComponent("go/bin").path, source: .bundled),
                SearchFolder(path: Self.managedRoot.appendingPathComponent("node/node_modules/.bin").path, source: .bundled),
            ]
        var seen: Set<String> = []
        return places.filter { !$0.path.isEmpty && seen.insert($0.path).inserted }
    }

    public func npmGlobalRoot() async -> URL? {
        if let npmRoot { return await npmRoot.value }
        let task = Task { await self.readNpmRoot() }
        npmRoot = task
        return await task.value
    }

    private func readNpmRoot() async -> URL? {
        guard let npm = await resolve("npm", from: [.path, .local, .homebrew]) else { return nil }
        let launch = ChildProcess.Launch(executable: npm.url, arguments: ["root", "--global"], environment: await environment(),
                                         directory: workspace)
        guard let result = await ChildProcess.run(launch, timeout: Self.shellTimeout), result.status == 0 else { return nil }
        let path = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : URL(fileURLWithPath: path, isDirectory: true)
    }

    public func install(_ tool: InstallableTool) async -> ToolInstall? {
        let users: Set<ToolSource> = [.path, .goBin, .local, .homebrew]
        if case let .typeScript(project) = tool {
            guard let npm = await resolve("npm", from: users) else { return nil }
            if let project, FileManager.default.fileExists(atPath: project.appendingPathComponent("package.json").path) {
                return ToolInstall(title: "Install TypeScript 7 in This Project",
                                   command: [npm.url.path, "install", "--save-dev", Self.typeScriptRelease], directory: project,
                                   shown: "npm install --save-dev \(Self.typeScriptRelease)")
            }
            return ToolInstall(title: "Install TypeScript 7", command: [npm.url.path, "install", "--global", Self.typeScriptRelease],
                               directory: workspace, shown: "npm install --global \(Self.typeScriptRelease)")
        }
        guard let entry = Self.goPackages[tool], let go = await resolve("go", from: users) else { return nil }
        let reading = await reading()
        let target = reading.goBins.first.map { ["/usr/bin/env", "GOBIN=\($0)"] } ?? []
        return ToolInstall(title: "Install \(entry.name)", command: target + [go.url.path, "install", entry.package], directory: workspace,
                           shown: "go install \(entry.package)")
    }

    private static func read(in workspace: URL) async -> EnvironmentReading {
        let clock = ContinuousClock()
        let started = clock.now
        var environment = ProcessInfo.processInfo.environment
        let shell = await shellEnvironment(base: environment, in: workspace)
        if let values = shell.values { environment = values }
        if let managed = await miseEnvironment(base: environment, in: workspace) { environment.merge(managed) { _, new in new } }
        let goBins = await goBins(environment, in: workspace)
        return EnvironmentReading(values: environment, goBins: goBins, elapsed: clock.now - started, problem: shell.problem)
    }

    private static func shellEnvironment(base: [String: String], in workspace: URL) async -> (values: [String: String]?, problem: String?) {
        let shell = base["SHELL"] ?? String(cString: getpwuid(getuid()).pointee.pw_shell)
        let command = "/usr/bin/printf %s \(mark); /usr/bin/env -0; /usr/bin/printf %s \(mark)"
        let launch = ChildProcess.Launch(
            executable: URL(fileURLWithPath: shell), arguments: ["-l", "-i", "-c", command], environment: base, directory: workspace
        )
        let clock = ContinuousClock()
        let started = clock.now
        guard let result = await ChildProcess.run(launch, timeout: shellTimeout) else {
            guard clock.now - started >= shellTimeout else {
                Logger.core.error("start the login shell \(shell, privacy: .public) failed; using the app's own environment")
                return (nil, nil)
            }
            Logger.core.error("read the login shell environment from \(shell, privacy: .public) timed out; using the app's own")
            let name = (shell as NSString).lastPathComponent
            return (nil, "Your login shell (\(name)) took longer than \(shellTimeout.components.seconds) seconds to start, so language "
                + "servers use Nyte IDE's own environment. Look for a slow step in its startup files, then choose Reload Environment.")
        }
        guard result.status == 0 else {
            Logger.core.error("read the login shell environment from \(shell, privacy: .public) failed; using the app's own")
            return (nil, nil)
        }
        return (parse(result.output), nil)
    }

    private static func parse(_ output: Data) -> [String: String]? {
        let marker = Data(mark.utf8)
        guard let open = output.range(of: marker), let close = output.range(of: marker, in: open.upperBound..<output.endIndex) else {
            return nil
        }
        var environment: [String: String] = [:]
        for entry in output[open.upperBound..<close.lowerBound].split(separator: 0) {
            guard let equals = entry.firstIndex(of: UInt8(ascii: "=")) else { continue }
            let name = String(decoding: entry[entry.startIndex..<equals], as: UTF8.self)
            environment[name] = String(decoding: entry[entry.index(after: equals)...], as: UTF8.self)
        }
        return environment.isEmpty ? nil : environment
    }

    private static func miseEnvironment(base: [String: String], in workspace: URL) async -> [String: String]? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let folders = (base["PATH"] ?? "").split(separator: ":").map(String.init)
            + ["/opt/homebrew/bin", "/usr/local/bin", home + "/.local/bin"]
        guard let mise = folders.map({ $0 + "/mise" }).first(where: FileManager.default.isExecutableFile(atPath:)) else {
            return nil
        }
        let launch = ChildProcess.Launch(
            executable: URL(fileURLWithPath: mise), arguments: ["env", "--json"], environment: base, directory: workspace
        )
        guard let result = await ChildProcess.run(launch, timeout: shellTimeout), result.status == 0,
              let values = JSON.parse(result.output)?.object
        else {
            Logger.core.error("mise env --json in \(workspace.path, privacy: .public) failed; using the shell environment")
            return nil
        }
        return values.compactMapValues(\.string)
    }

    private static func goBins(_ environment: [String: String], in workspace: URL) async -> [String] {
        let folders = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
        guard let go = folders.map({ $0 + "/go" }).first(where: FileManager.default.isExecutableFile(atPath:)) else { return [] }
        let launch = ChildProcess.Launch(executable: URL(fileURLWithPath: go), arguments: ["env", "-json", "GOBIN", "GOPATH"],
                                         environment: environment, directory: workspace)
        guard let result = await ChildProcess.run(launch, timeout: shellTimeout), result.status == 0,
              let values = JSON.parse(result.output)
        else {
            Logger.core.error("go env GOBIN GOPATH in \(workspace.path, privacy: .public) failed; Go's bin folder is unknown")
            return []
        }
        let gobin = values["GOBIN"]?.string ?? ""
        let gopath = (values["GOPATH"]?.string ?? "").split(separator: ":").map { String($0) + "/bin" }
        return ([gobin] + gopath).filter { !$0.isEmpty }
    }
}
