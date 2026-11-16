import Foundation
import NyteCore
@testable import NyteLanguage

@MainActor final class LanguageBench {
    let folder: URL
    let file: URL
    let service: LanguageService
    var diagnosed: ContinuousClock.Instant?

    init(folder: URL, file: URL, choice: LanguageSettings.TypeScriptServer) {
        self.folder = folder
        self.file = file
        service = LanguageService(workspace: Workspace(root: folder), toolchain: Toolchain(workspace: folder))
        service.settings.typeScript.server = choice
    }

    static func run(_ arguments: [String]) async {
        guard arguments.count >= 2 else { fail("lsp bench needs a folder and a file; see NyteProbe --help") }
        let folder = URL(fileURLWithPath: arguments[0]).standardizedFileURL
        let choice: LanguageSettings.TypeScriptServer = switch arguments.dropFirst(2).first {
        case "tsserver": .tsserver
        default: .automatic
        }
        await LanguageBench(folder: folder, file: folder.appendingPathComponent(arguments[1]), choice: choice).measure()
    }

    func measure() async {
        guard let source = try? String(contentsOf: file, encoding: .utf8) else { fail("lsp bench: cannot read \(file.path)") }
        let target = Wire.canonical(file)
        service.onEvent = { [weak self] event in
            guard let self, case let .diagnostics(url) = event, url == target, diagnosed == nil else { return }
            diagnosed = ContinuousClock.now
        }
        let opened = ContinuousClock.now
        service.open(file, text: source)
        _ = await Patience.until(.seconds(180)) { self.service.status(for: self.file)?.state == .ready }
        let ready = ContinuousClock.now - opened
        _ = await Patience.until(.seconds(180)) { self.diagnosed != nil }
        let status = service.status(for: file)
        print("server \(status?.name ?? "?") \(status?.version ?? "") at \(status?.location?.path ?? "?")")
        print("ready after \(ready.formatted(.units(allowed: [.milliseconds]))), first diagnostics for the file after "
            + (diagnosed.map { ($0 - opened).formatted(.units(allowed: [.milliseconds])) } ?? "never")
            + " (\(service.diagnostics(for: file).count) problems)")
        print("watching outside the workspace for the server: \(service.externalRoots.isEmpty ? "nothing" : service.externalRoots.joined(separator: ", "))")
        print("resident after diagnostics: \(megabytes(await service.sampleMemory().first?.residentBytes))")

        let lines = Probe.lines(source)
        let go = file.pathExtension == "go"
        let probe = go ? "var _ = strings." : "console."
        let line = lines.count
        service.change(file, range: TextSpan(at: .init(line: line - 1, column: lines[line - 1].utf16.count)), text: "\n" + probe)
        var timings: [Duration] = []
        var items = 0
        for _ in 0..<7 {
            let asked = ContinuousClock.now
            items = await service.completions(at: .init(line: line, column: probe.utf16.count), in: file, trigger: .character(".")).items.count
            timings.append(ContinuousClock.now - asked)
        }
        let rest = timings.dropFirst().sorted()
        print("completion after \(probe.debugDescription): first \(show(timings[0])), median of the next six \(show(rest[rest.count / 2])), \(items) items")

        let asked = ContinuousClock.now
        let symbols = await service.symbols(matching: "Server")
        print("workspace symbols for \"Server\": \(symbols.count) in \(show(ContinuousClock.now - asked))")

        let all = TextSpan(start: .init(line: 0, column: 0), end: .init(line: line + 1, column: 0))
        let counting = ContinuousClock.now
        let counts = await service.usages(in: all, of: file)
        let counted = counts.filter { $0.usages != nil }.count
        let elapsed = ContinuousClock.now - counting
        print("usages for the whole file: \(counted) of \(counts.count) declarations in \(show(elapsed)), "
            + "\(counts.isEmpty ? "-" : show(elapsed / max(counts.count, 1))) each")
        let screen = TextSpan(start: .init(line: 0, column: 0), end: .init(line: min(line, 60), column: 0))
        service.change(file, range: TextSpan(at: .init(line: line, column: 0)), text: "")
        let firstScreen = ContinuousClock.now
        let visible = await service.usages(in: screen, of: file)
        print("usages for the first 60 lines: \(visible.count) declarations in \(show(ContinuousClock.now - firstScreen))")
        print("resident after usages: \(megabytes(await service.sampleMemory().first?.residentBytes))")

        service.change(file, range: TextSpan(at: .init(line: line, column: 0)), text: "")
        let background = Task { await self.service.usages(in: all, of: self.file) }
        _ = await Patience.pause(.milliseconds(20))
        let during = ContinuousClock.now
        _ = await service.completions(at: .init(line: line, column: probe.utf16.count), in: file, trigger: .character("."))
        print("completion while usages count in the background: \(show(ContinuousClock.now - during))")
        background.cancel()
        _ = await background.value
        await service.shutdown()
    }

    private func show(_ duration: Duration) -> String { duration.formatted(.units(allowed: [.milliseconds], fractionalPart: .show(length: 1))) }

    private func megabytes(_ bytes: Int?) -> String {
        bytes.map { "\($0 / (1 << 20)) MB" } ?? "unknown"
    }
}
