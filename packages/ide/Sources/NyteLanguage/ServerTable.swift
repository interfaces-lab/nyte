import Foundation
import NyteCore

struct ServerPlan: Sendable {
    var name: String
    var shortName: String
    var version: String
    var executable: URL
    var arguments: [String]
    var options: JSON
    var settings: JSON
    var source: ToolSource
    var note: String?
    var install: ToolInstall?
}

enum PlanFailure: Error, Sendable, Equatable {
    case missing(hint: String, install: ToolInstall?)
    case failed(String)
}

struct PlanRequest: Sendable {
    var root: URL
    var workspace: URL
    var toolchain: Toolchain
    var settings: LanguageSettings
}

struct ServerSpec: Sendable {
    var name: String
    var languages: [String: String]
    var rootMarkers: [String]
    var plan: @Sendable (PlanRequest) async -> Result<ServerPlan, PlanFailure>

    func languageId(for url: URL) -> String? {
        languages[url.pathExtension.lowercased()]
    }

    func root(for url: URL, in workspace: Workspace) -> URL {
        let top = workspace.root.path
        var folder = url.deletingLastPathComponent().standardizedFileURL
        while folder.path.hasPrefix(top) {
            if rootMarkers.contains(where: { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0).path) }) {
                return folder
            }
            if folder.path == top { break }
            folder = folder.deletingLastPathComponent().standardizedFileURL
        }
        return workspace.root
    }
}

enum ServerTable {
    static let all: [ServerSpec] = [gopls, typescript]

    static let goplsHint = "go install golang.org/x/tools/gopls@latest"
    static let typeScriptHint = "TypeScript 7 is not installed: npm install --save-dev \(Toolchain.typeScriptRelease), "
        + "or choose tsserver (Node) in Settings."
    static let typeScriptServerHint = "npm install -g typescript-language-server"

    static let gopls = ServerSpec(
        name: "gopls",
        languages: ["go": "go"],
        rootMarkers: ["go.work", "go.mod"],
        plan: { request in
            let program: ResolvedTool? = if let path = request.settings.go.serverPath {
                ResolvedTool(url: URL(fileURLWithPath: path), source: .settings)
            } else {
                await request.toolchain.resolve("gopls")
            }
            let install = program == nil || program?.source == .bundled ? await request.toolchain.install(.gopls) : nil
            guard let program, FileManager.default.isExecutableFile(atPath: program.url.path) else {
                return .failure(.missing(hint: goplsHint, install: install))
            }
            let options = GoSettings.options(request.settings.go)
            return .success(ServerPlan(
                name: "gopls", shortName: "gopls", version: "", executable: program.url, arguments: [], options: options,
                settings: ["gopls": options], source: program.source, install: install
            ))
        }
    )

    static let typescript = ServerSpec(
        name: "TypeScript",
        languages: [
            "ts": "typescript", "mts": "typescript", "cts": "typescript", "tsx": "typescriptreact",
            "js": "javascript", "mjs": "javascript", "cjs": "javascript", "jsx": "javascriptreact",
        ],
        rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
        plan: { request in await typeScriptPlan(request) }
    )

    @concurrent
    static func typeScriptPlan(_ request: PlanRequest) async -> Result<ServerPlan, PlanFailure> {
        let typeScript = request.settings.typeScript
        guard request.settings.usesTSServer(in: request.workspace) else { return await nativeTypeScriptPlan(request) }
        guard let package = TypeScriptPackage.applying(to: request.root) else { return .failure(.missing(hint: typeScriptHint, install: nil)) }
        let library = package.folder.appendingPathComponent("lib")
        guard FileManager.default.fileExists(atPath: library.appendingPathComponent("tsserver.js").path) else {
            return .failure(.failed(
                "typescript-language-server needs TypeScript's tsserver.js, and TypeScript \(package.version) in "
                    + "\(package.folder.path) has none. Run `npm install --save-dev typescript@6` in \(request.root.path), then reopen the file."
            ))
        }
        let located: ResolvedTool? = if let path = typeScript.languageServerPath {
            ResolvedTool(url: URL(fileURLWithPath: path), source: .settings)
        } else {
            await request.toolchain.resolve("typescript-language-server")
        }
        guard let program = located, FileManager.default.isExecutableFile(atPath: program.url.path) else {
            return .failure(.missing(hint: typeScriptServerHint, install: nil))
        }
        return .success(ServerPlan(
            name: "typescript-language-server", shortName: "tsserver", version: package.version, executable: program.url,
            arguments: ["--stdio"],
            options: ["preferences": TypeScriptSettings.preferences(typeScript), "tsserver": ["path": .string(library.path)]],
            settings: typeScriptLanguageServerSettings(typeScript), source: program.source
        ))
    }

    static func nativeTypeScriptPlan(_ request: PlanRequest) async -> Result<ServerPlan, PlanFailure> {
        let typeScript = request.settings.typeScript
        if let path = typeScript.nativeServerPath {
            guard FileManager.default.isExecutableFile(atPath: path) else {
                return .failure(.failed("The native TypeScript server set in Settings, \(path), is not an executable file."))
            }
            return .success(nativePlan(NativeTypeScript(executable: URL(fileURLWithPath: path), version: "", source: .settings, package: ""),
                                       typeScript: typeScript))
        }
        let project = TypeScriptLocator.project(from: request.root)
        let found = await TypeScriptLocator.find(from: request.root, toolchain: request.toolchain)
        let install = found == nil || found?.source == .bundled ? await request.toolchain.install(.typeScript(project: request.root)) : nil
        guard let found else { return .failure(.missing(hint: typeScriptHint, install: install)) }
        var plan = nativePlan(found, typeScript: typeScript)
        plan.install = install
        if project == nil, let library = TypeScriptLocator.libraryVersion(from: request.root),
           TypeScriptPackage(folder: request.root, version: library).major < 7 {
            plan.note = "project uses \(library)"
        }
        return .success(plan)
    }

    static func nativePlan(_ found: NativeTypeScript, typeScript: LanguageSettings.TypeScript) -> ServerPlan {
        ServerPlan(
            name: "TypeScript", shortName: "TypeScript", version: found.version, executable: found.executable,
            arguments: ["--lsp", "-stdio"], options: [:], settings: nativeSettings(typeScript), source: found.source
        )
    }

    static func nativeSettings(_ typeScript: LanguageSettings.TypeScript) -> JSON {
        let language = TypeScriptSettings.language(typeScript)
        return ["js/ts": language, "typescript": language, "javascript": language]
    }

    static func typeScriptLanguageServerSettings(_ typeScript: LanguageSettings.TypeScript) -> JSON {
        let language = TypeScriptSettings.language(typeScript)
        return [
            "typescript": language, "javascript": language,
            "completions": ["completeFunctionCalls": .bool(TypeScriptSettings.completesFunctionCalls)],
        ]
    }

    static func settings(for plan: ServerPlan, _ settings: LanguageSettings) -> (options: JSON, settings: JSON) {
        switch plan.shortName {
        case "gopls": (GoSettings.options(settings.go), ["gopls": GoSettings.options(settings.go)])
        case "tsserver":
            (["preferences": TypeScriptSettings.preferences(settings.typeScript), "tsserver": plan.options["tsserver"] ?? .null],
             typeScriptLanguageServerSettings(settings.typeScript))
        default: (plan.options, nativeSettings(settings.typeScript))
        }
    }

    static func memoryCeiling(of spec: ServerSpec, _ settings: LanguageSettings) -> Int {
        (spec.name == gopls.name ? settings.go.memoryCeilingMegabytes : settings.typeScript.memoryCeilingMegabytes) * LanguageSettings.megabyte
    }

    static func countsUsages(_ spec: ServerSpec, _ settings: LanguageSettings) -> Bool {
        spec.name == gopls.name ? settings.go.countsUsages : settings.typeScript.countsUsages
    }

    static func needsRestart(_ spec: ServerSpec, from old: LanguageSettings, to new: LanguageSettings, in workspace: URL) -> Bool {
        guard spec.name == gopls.name else {
            return old.usesTSServer(in: workspace) != new.usesTSServer(in: workspace)
                || old.typeScript.nativeServerPath != new.typeScript.nativeServerPath
                || old.typeScript.languageServerPath != new.typeScript.languageServerPath
        }
        return old.go.serverPath != new.go.serverPath
    }
}

struct TypeScriptPackage: Sendable, Equatable {
    var folder: URL
    var version: String

    var major: Int { Int(version.prefix { $0.isNumber }) ?? 0 }

    static func applying(to root: URL) -> TypeScriptPackage? {
        var folder = root.standardizedFileURL
        while folder.path != "/" {
            if let found = read(folder.appendingPathComponent("node_modules/typescript")) { return found }
            folder = folder.deletingLastPathComponent()
        }
        return managed()
    }

    static func managed() -> TypeScriptPackage? {
        read(Toolchain.managedRoot.appendingPathComponent("node/node_modules/typescript"))
    }

    static func read(_ folder: URL) -> TypeScriptPackage? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("package.json")),
              let version = JSON.parse(data)?["version"]?.string
        else { return nil }
        return TypeScriptPackage(folder: folder, version: version)
    }

    func nativeServer() -> URL? {
        TypeScriptLocator.platformBinary(of: folder, base: "typescript", program: "tsc")
    }
}
