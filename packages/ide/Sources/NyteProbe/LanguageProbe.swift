import Foundation
import NyteCore
@testable import NyteLanguage

@MainActor func runLanguageProbe(_ arguments: [String]) async {
    if arguments.first == "check" {
        var failures = await LanguageCheck.freshViews()
        failures += await LanguageCheck.findColours()
        for fixture in [LanguageCheck.go, LanguageCheck.typescript] {
            failures += await LanguageCheck(fixture).run()
        }
        failures += await LanguageCheck.nativeTypeScript()
        failures += await LocateCheck().run()
        failures += await LanguageCheck.assistance()
        failures += await LanguageCheck.watchedFiles()
        failures += await LanguageCheck.contracts()
        print(failures == 0 ? "lsp check: all passed" : "lsp check: \(failures) failed")
        exit(failures == 0 ? 0 : 1)
    }
    if arguments.first == "missing", arguments.count >= 3 { return await LanguageQuery.missing(arguments) }
    if arguments.first == "bench" { return await LanguageBench.run(Array(arguments.dropFirst())) }
    if arguments.first == "locate" { exit(await LocateCheck().run() == 0 ? 0 : 1) }
    if arguments.first == "env", arguments.count >= 2 { return await LanguageQuery.environment(arguments) }
    guard arguments.count >= 3 else { fail("NyteProbe lsp needs a folder, a file and a query; see NyteProbe --help") }
    await LanguageQuery.run(arguments)
}

@MainActor private enum LanguageQuery {
    static func environment(_ arguments: [String]) async {
        let folder = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        let root = arguments.count > 2 ? folder.appendingPathComponent(arguments[2]) : folder
        for round in 1...2 {
            let toolchain = Toolchain(workspace: folder)
            let reading = await toolchain.reading()
            print("environment \(round): \(reading.elapsed), \(reading.values.count) values, Go bins \(reading.goBins), problem \(reading.problem ?? "none")")
        }
        let toolchain = Toolchain(workspace: folder)
        for name in ["gopls", "dlv", "go", "node", "npm", "tsc", "tsgo", "typescript-language-server"] {
            let found = await toolchain.resolve(name)
            print("\(name): \(found.map { "\($0.url.path) (\($0.source.words))" } ?? "missing")")
        }
        for tool in [InstallableTool.gopls, .delve, .typeScript(project: root)] {
            print("install \(tool): \(await toolchain.install(tool).map { "\($0.shown) as \($0.command)" } ?? "none")")
        }
        let request = PlanRequest(root: root, workspace: folder, toolchain: toolchain, settings: LanguageSettings())
        switch await ServerTable.typeScriptPlan(request) {
        case let .success(plan): print("TypeScript plan: \(plan.name) \(plan.version) at \(plan.executable.path) from \(plan.source.words), note \(plan.note ?? "none")")
        case let .failure(failure): print("TypeScript plan failed: \(failure)")
        }
    }

    static func run(_ arguments: [String]) async {
        let folder = URL(fileURLWithPath: arguments[0]).standardizedFileURL
        let file = folder.appendingPathComponent(arguments[1])
        let position = arguments.count > 3 ? Probe.position(arguments[3]) : TextPosition(line: 0, column: 0)
        let text = arguments.count > 4 ? arguments[4] : ""
        let service = LanguageService(workspace: Workspace(root: folder), toolchain: Toolchain(workspace: folder))
        guard let source = try? String(contentsOf: file, encoding: .utf8) else { fail("lsp: cannot read \(file.path)") }
        service.open(file, text: source)
        guard await Patience.until(.seconds(60), { service.status(for: file)?.state == .ready }) else {
            fail("lsp: server not ready: \(String(describing: service.status(for: file)))")
        }
        guard await Patience.pause(.seconds(1)) else { return }
        let everything = TextSpan(start: .init(line: 0, column: 0), end: .init(line: Probe.lines(source).count, column: 0))
        switch arguments[2] {
        case "diagnostics":
            _ = await Patience.until(.seconds(20)) { !service.diagnostics(for: file).isEmpty }
            for item in service.diagnostics(for: file) {
                print("\(Probe.show(item.range)) \(item.severity) [\(item.source) \(item.code)] \(item.message)")
            }
        case "hover": print(await service.hover(at: position, in: file)?.markdown ?? "nil")
        case "signature": print(String(describing: await service.signatureHelp(at: position, in: file)))
        case "complete":
            for item in await service.completions(at: position, in: file, trigger: .invoked).items.prefix(40) {
                let resolved = await service.resolve(item)
                let stops = resolved.stops.map { "\($0.utf16Offset)+\($0.utf16Length)" }
                print("\(item.label) \(item.kind) tail=\(item.tail.debugDescription) type=\(item.type.debugDescription) text=\(resolved.text.debugDescription) stops=\(stops) replace=\(resolved.replace.map(Probe.show) ?? "-")")
            }
        case "definition": printLocations(await service.locations(.definition, at: position, in: file), folder)
        case "typedef": printLocations(await service.locations(.typeDefinition, at: position, in: file), folder)
        case "impl": printLocations(await service.locations(.implementations, at: position, in: file), folder)
        case "refs": printLocations(await service.locations(.references(includeDeclaration: true), at: position, in: file), folder)
        case "highlights": for range in await service.highlights(at: position, in: file) { print(Probe.show(range)) }
        case "kinds":
            for usage in await service.classifiedReferences(at: position, in: file) { print("\(usage.kind) \(Probe.place(usage.location, folder))") }
        case "symbols":
            for symbol in await service.symbols(in: file) {
                print(String(repeating: "  ", count: symbol.depth) + "\(symbol.name) \(symbol.kind) \(Probe.show(symbol.selection)) \(symbol.detail)")
            }
        case "workspace":
            for symbol in await service.symbols(matching: text) {
                print("\(symbol.name) \(symbol.kind) \(symbol.container) \(Probe.place(symbol.location, folder))")
            }
        case "prepare": print(String(describing: await service.renameTarget(at: position, in: file)))
        case "rename":
            switch await service.rename(at: position, in: file, to: text) {
            case let .success(edit): for item in edit.files { print("\(item.url.path) \(item.edits.map { Probe.show($0.range) })") }
            case let .failure(failure): print("failure: \(failure.message)")
            }
        case "actions":
            _ = await Patience.until(.seconds(20)) { !service.diagnostics(for: file).isEmpty }
            let ends = arguments[3].split(separator: "-").map { Probe.position(String($0)) }
            let range = TextSpan(start: ends[0], end: ends.last ?? ends[0])
            for (index, action) in await service.actions(in: range, of: file).enumerated() {
                print("\(action.kind) \(action.title)\(service.actionRaw.items[index] == .null ? " (Nyte IDE's local fix)" : "")")
            }
        case "format":
            for edit in await service.formatting(for: file, indent: 4, usesTabs: false) { print("\(Probe.show(edit.range)) \(edit.text.debugDescription)") }
        case "hints":
            for hint in await service.inlayHints(in: everything, of: file) { print("\(Probe.show(TextSpan(at: hint.position))) \(hint.kind) \(hint.label)") }
        case "tokens":
            guard let tokens = await service.semanticTokens(for: file) else { return print("nil") }
            for index in 0..<min(tokens.count, 60) {
                print("\(tokens.lines[index] + 1):\(tokens.columns[index] + 1) len \(tokens.lengths[index]) \(tokens.kinds[index]) \(tokens.modifiers[index].rawValue)")
            }
        case "log": print(service.log(for: service.status(for: file)?.name ?? ""))
        default: fail("lsp: unknown query \(arguments[2])")
        }
        await service.shutdown()
    }

    static func missing(_ arguments: [String]) async {
        let folder = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        let file = folder.appendingPathComponent(arguments[2])
        let service = LanguageService(workspace: Workspace(root: folder), toolchain: Toolchain(workspace: folder))
        service.open(file, text: "")
        _ = await Patience.until(.seconds(30)) {
            if case .starting = service.status(for: file)?.state { return false }
            return true
        }
        print(String(describing: service.status(for: file)?.state))
        await service.shutdown()
    }

    static func printLocations(_ locations: [FileLocation], _ folder: URL) {
        for location in locations { print(Probe.place(location, folder)) }
    }
}

