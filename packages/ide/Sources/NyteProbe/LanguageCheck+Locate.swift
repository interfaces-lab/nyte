import Darwin
import Foundation
import NyteCore
@testable import NyteLanguage

@MainActor final class LocateCheck {
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-locate-\(getpid())").resolvingSymlinksInPath()
    let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../..").standardizedFileURL
    var failures = 0

    var bin: URL { temporary.appendingPathComponent("bin") }
    var gobin: URL { temporary.appendingPathComponent("gobin") }
    var pathFile: URL { temporary.appendingPathComponent("path.txt") }
    var native: URL { repository.appendingPathComponent("node_modules/@typescript/native").resolvingSymlinksInPath() }
    var library: URL { repository.appendingPathComponent("node_modules/typescript").resolvingSymlinksInPath() }

    func expect(_ ok: Bool, _ claim: String, _ saw: @autoclosure () -> String) {
        print(ok ? "ok   \(claim)" : "FAIL \(claim)\n     saw: \(saw())")
        if !ok { failures += 1 }
    }

    func run() async -> Int {
        let shell = ProcessInfo.processInfo.environment["SHELL"]
        defer {
            if let shell { setenv("SHELL", shell, 1) } else { unsetenv("SHELL") }
            try? FileManager.default.removeItem(at: temporary)
        }
        prepare()
        if let node = await Toolchain(workspace: repository).resolve("node", from: [.path]) {
            try? FileManager.default.createSymbolicLink(at: bin.appendingPathComponent("node"), withDestinationURL: node.url)
        }
        setenv("SHELL", temporary.appendingPathComponent("shell").path, 1)
        await typeScriptOrder()
        await serverChoice()
        await goOrder()
        await reload()
        await statusSources()
        await removedOptions()
        return failures
    }

    private func prepare() {
        let manager = FileManager.default
        try? manager.removeItem(at: temporary)
        for folder in [bin, gobin, temporary.appendingPathComponent("npm-global")] {
            try? manager.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        try? (bin.path + ":/usr/bin:/bin").write(to: pathFile, atomically: true, encoding: .utf8)
        script("shell", """
            export PATH="$(/bin/cat '\(pathFile.path)')"
            export MISE_GLOBAL_CONFIG_FILE=/nonexistent MISE_CONFIG_DIR='\(temporary.path)/mise'
            unset GOBIN GOPATH GOROOT
            if [ -e '\(temporary.path)/slow' ]; then /bin/sleep 10; fi
            eval "$4"
            """, in: temporary)
        script("go", #"/bin/echo '{"GOBIN": "\#(gobin.path)", "GOPATH": "\#(temporary.path)/gopath"}'"#, in: bin)
        script("npm", "/bin/echo '\(temporary.path)/npm-global'", in: bin)
        project("alias", dependencies: ["@typescript/native": "npm:typescript@7.1.0-beta", "typescript": "6.0.3"], links: [
            "node_modules/typescript": library, "node_modules/@typescript/native": native,
            "packages/core/node_modules/typescript": library,
        ])
        project("alias/packages/core", dependencies: ["typescript": "6.0.3"], links: [:])
        project("library", dependencies: ["typescript": "6.0.3"], links: ["node_modules/typescript": library])
        project("plain", dependencies: [:], links: [:])
        let preview = temporary.appendingPathComponent("preview/node_modules/@typescript")
        try? manager.createDirectory(at: preview.appendingPathComponent("native-preview"), withIntermediateDirectories: true)
        try? manager.createDirectory(at: preview.appendingPathComponent("native-preview-\(TypeScriptLocator.architecture)/lib"),
                                     withIntermediateDirectories: true)
        try? #"{"name": "@typescript/native-preview", "version": "7.0.0-dev.20260101.1", "bin": {"tsgo": "./bin/tsgo.js"}}"#
            .write(to: preview.appendingPathComponent("native-preview/package.json"), atomically: true, encoding: .utf8)
        if let binary = TypeScriptPackage.read(native)?.nativeServer() {
            try? manager.createSymbolicLink(at: preview.appendingPathComponent("native-preview-\(TypeScriptLocator.architecture)/lib/tsgo"),
                                            withDestinationURL: binary)
        }
    }

    private func script(_ name: String, _ body: String, in folder: URL) {
        let url = folder.appendingPathComponent(name)
        try? ("#!/bin/sh\n" + body + "\n").write(to: url, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    }

    private func project(_ name: String, dependencies: [String: String], links: [String: URL]) {
        let folder = temporary.appendingPathComponent(name)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let listed = dependencies.map { "\"\($0.key)\": \"\($0.value)\"" }.sorted().joined(separator: ", ")
        try? #"{"name": "\#(name)", "devDependencies": {\#(listed)}}"#
            .write(to: folder.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        for (path, target) in links {
            let link = folder.appendingPathComponent(path)
            try? FileManager.default.createDirectory(at: link.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        }
    }

    private func plan(_ name: String, settings: LanguageSettings = LanguageSettings(), workspace: String? = nil)
        async -> Result<ServerPlan, PlanFailure> {
        let root = temporary.appendingPathComponent(name)
        let top = temporary.appendingPathComponent(workspace ?? name)
        let request = PlanRequest(root: root, workspace: top, toolchain: Toolchain(workspace: top), settings: settings)
        return await ServerTable.typeScriptPlan(request)
    }

    private func describe(_ result: Result<ServerPlan, PlanFailure>) -> String {
        switch result {
        case let .success(plan): "\(plan.name) \(plan.version) at \(plan.executable.path) from \(plan.source.words), note \(plan.note ?? "none")"
        case let .failure(failure): "\(failure)"
        }
    }

    private func typeScriptOrder() async {
        let alias = await plan("alias/packages/core", workspace: "alias")
        let aliasPlan = try? alias.get()
        expect(aliasPlan?.version == "7.1.0-beta" && aliasPlan?.source == .project && aliasPlan?.note == nil
            && aliasPlan?.executable.path.contains("typescript-\(TypeScriptLocator.architecture)/lib/tsc") == true,
            "automatic picks the @typescript/native 7.1.0-beta alias from a package whose own typescript is 6.0.3", describe(alias))
        let preview = try? await plan("preview").get()
        expect(preview?.version == "7.0.0-dev.20260101.1" && preview?.source == .project && preview?.executable.lastPathComponent == "tsgo",
               "automatic picks @typescript/native-preview's platform tsgo in a project that has only that",
               preview.map { "\($0.version) \($0.executable.path)" } ?? "no plan")
        let bundled = TypeScriptLocator.bundled()
        let alone = try? await plan("plain").get()
        expect(alone?.source == .bundled && alone?.version == bundled?.version && bundled?.version == "7.1.0-beta",
               "automatic falls back to Nyte IDE's copy, 7.1.0-beta, only when nothing else exists",
               alone.map { "\($0.version) from \($0.source.words)" } ?? "no plan")
        let library = try? await plan("library").get()
        expect(library?.source == .bundled && library?.note == "project uses 6.0.3"
            && library?.install?.shown == "npm install --save-dev typescript@7"
            && library?.install?.command.first == bin.appendingPathComponent("npm").path,
            "a project that pins only TypeScript 6 runs a native server, says so, and offers the user's npm install",
            library.map { "\($0.source.words), note \($0.note ?? "none"), install \($0.install?.command ?? [])" } ?? "no plan")
        let tsc = bin.appendingPathComponent("tsc")
        try? FileManager.default.createSymbolicLink(at: tsc, withDestinationURL: native.appendingPathComponent("bin/tsc"))
        let onPath = try? await plan("plain").get()
        try? FileManager.default.removeItem(at: tsc)
        expect(onPath?.source == .path && onPath?.version == "7.1.0-beta",
               "a tsc on the PATH that resolves to TypeScript 7 beats Nyte IDE's copy",
               onPath.map { "\($0.version) from \($0.source.words) at \($0.executable.path)" } ?? "no plan")
    }

    private func serverChoice() async {
        var chosen = LanguageSettings()
        chosen.typeScript.server = .tsserver
        let explicit = try? await plan("library", settings: chosen).get()
        let overridden = LanguageSettings().choosingTSServer(true, in: temporary.appendingPathComponent("library"))
        let workspace = try? await plan("library", settings: overridden).get()
        let other = try? await plan("plain", settings: overridden).get()
        let undone = try? await plan("library", settings: overridden.choosingTSServer(false, in: temporary.appendingPathComponent("library")))
            .get()
        expect(explicit?.name == "typescript-language-server" && workspace?.name == "typescript-language-server"
            && other?.name == "TypeScript" && undone?.name == "TypeScript",
            "tsserver runs only when Settings or this workspace's override choose it",
            [explicit, workspace, other, undone].map { $0?.name ?? "none" }.joined(separator: ", "))
    }

    private func goOrder() async {
        let toolchain = Toolchain(workspace: temporary.appendingPathComponent("plain"))
        let before = await toolchain.resolve("gopls")
        let install = await toolchain.install(.gopls)
        script("gopls", "exit 0", in: gobin)
        let after = await toolchain.resolve("gopls")
        let places = await toolchain.searchPlaces().map(\.source)
        let ordered = [ToolSource.project, .path, .goBin, .local, .bundled].compactMap { places.firstIndex(of: $0) }
        expect(before?.source == .bundled && after?.source == .goBin && after?.url.deletingLastPathComponent().path == gobin.path
            && install?.command == ["/usr/bin/env", "GOBIN=\(gobin.path)", bin.appendingPathComponent("go").path, "install",
                                    "golang.org/x/tools/gopls@latest"]
            && ordered == ordered.sorted(),
            "a gopls in the GOBIN that the user's go reports beats Nyte IDE's copy; the install runs their go into that GOBIN",
            "before \(before?.source.words ?? "none"), after \(after.map { "\($0.url.path) \($0.source.words)" } ?? "none"), "
                + "install \(install?.command ?? [])")
    }

    private func reload() async {
        let toolchain = Toolchain(workspace: temporary.appendingPathComponent("plain"))
        let first = await toolchain.reading()
        let other = temporary.appendingPathComponent("other-bin")
        try? (other.path + ":" + bin.path + ":/usr/bin:/bin").write(to: pathFile, atomically: true, encoding: .utf8)
        let cached = await toolchain.reading()
        let fresh = await toolchain.reload()
        try? FileManager.default.createDirectory(at: temporary.appendingPathComponent("slow"), withIntermediateDirectories: true)
        let slowChain = Toolchain(workspace: temporary.appendingPathComponent("plain"))
        var slow: EnvironmentReading?
        Task { slow = await slowChain.reading() }
        _ = await Patience.pause(.milliseconds(1))
        let pendingWhileMainRan = slow == nil
        _ = await Patience.until(.seconds(30)) { slow != nil }
        try? FileManager.default.removeItem(at: temporary.appendingPathComponent("slow"))
        try? (bin.path + ":/usr/bin:/bin").write(to: pathFile, atomically: true, encoding: .utf8)
        expect(first.values["PATH"] == cached.values["PATH"] && fresh.values["PATH"]?.hasPrefix(other.path) == true
            && first.problem == nil && slow?.problem?.contains("8 seconds") == true && pendingWhileMainRan,
            "Reload Environment rereads the login shell; a shell slower than 8 s gives up with a sentence, the main actor never waiting on it",
            "first \(first.values["PATH"] ?? ""), reloaded \(fresh.values["PATH"] ?? ""), slow \(slow?.problem ?? "no sentence"), main actor ran while the read was pending: \(pendingWhileMainRan)")
    }

    private func statusSources() async {
        let root = temporary.appendingPathComponent("alias")
        let file = root.appendingPathComponent("packages/core/src/index.ts")
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let text = "export const total: number = 1;\n"
        try? text.write(to: file, atomically: true, encoding: .utf8)
        let service = LanguageService(workspace: Workspace(root: root), toolchain: Toolchain(workspace: root))
        var applied: [LanguageSettings] = []
        service.open(file, text: text)
        _ = await Patience.until(.seconds(60)) { service.status(for: file)?.state == .ready }
        let native = service.status(for: file)
        service.useTSServer(true)
        applied.append(service.settings)
        _ = await Patience.until(.seconds(60)) {
            service.status(for: file)?.shortName == "tsserver" && service.status(for: file)?.state == .ready
        }
        let server = service.status(for: file)
        await service.shutdown()
        expect(native?.source == .project && native?.headline == "TypeScript 7.1.0-beta, native" && native?.offer == .useTSServer
            && server?.source == .bundled && server?.offer == .useNative
            && applied.last?.typeScript.tsserverWorkspaces == [root.standardizedFileURL.path],
            "each status names its source; Use tsserver for This Workspace restarts as tsserver and offers the way back",
            "native \(native?.headline ?? "nil") from \(native?.source?.words ?? "nil") offer \(String(describing: native?.offer)); "
                + "then \(server?.shortName ?? "nil") from \(server?.source?.words ?? "nil") offer \(String(describing: server?.offer))")
    }

    private func removedOptions() async {
        let root = temporary.appendingPathComponent("library")
        let config = root.appendingPathComponent("tsconfig.json")
        let file = root.appendingPathComponent("src/index.ts")
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? #"{"compilerOptions": {"baseUrl": ".", "moduleResolution": "node", "strict": true}}"#.write(to: config, atomically: true, encoding: .utf8)
        let text = "export const total: number = 1;\n"
        try? text.write(to: file, atomically: true, encoding: .utf8)
        let service = LanguageService(workspace: Workspace(root: root), toolchain: Toolchain(workspace: root))
        service.open(file, text: text)
        _ = await Patience.until(.seconds(60)) { service.status(for: file)?.state == .ready }
        let status = service.status(for: file)
        let said = await Patience.until(.seconds(20)) { !service.diagnostics(for: config).isEmpty }
        let messages = service.diagnostics(for: config).map(\.message)
        await service.shutdown()
        print("     tsconfig.json says: \(messages.joined(separator: " | "))")
        expect(status?.headline == "TypeScript 7.1.0-beta, native \u{00B7} project uses 6.0.3" && said,
               "a project pinned to TypeScript 6 says so in its status, and the native server flags tsconfig.json's removed options",
               "\(status?.headline ?? "nil"); tsconfig.json: \(messages); files \(service.filesWithDiagnostics.map(\.lastPathComponent))")
    }
}
