import Darwin
import Foundation
import NyteCore
@testable import NyteLanguage

extension LanguageCheck {
    static let goMarksFile = """
    package hub

    import "testing"

    func TestMain(m *testing.M) { m.Run() }

    func TestRoutes(t *testing.T) {
    \tt.Run("email first", func(t *testing.T) {
    \t\tt.Run("with (retry)", func(t *testing.T) {})
    \t})
    \tt.Run("pager", func(t *testing.T) {})
    }

    func Testhelper(t *testing.T) {}

    func BenchmarkSubmit(b *testing.B) {}

    func FuzzSubject(f *testing.F) {}

    func ExampleNew() {}

    """

    static let scriptTestFile = """
    import { describe, it } from "node:test";

    describe("Hub", () => {
      it("counts a delivery", () => {});
      describe("when a channel fails", () => {
        it.skip("records it", () => {});
      });
    });

    it('stands alone (top)', () => {});

    """

    static let farGo = "package hub\n\n" + String(repeating: "// filler\n", count: 260) + "func Far() {}\n"
    static let sloppyGo = "package hub\n\nfunc   Shout(text string) string {\nreturn strings.ToUpper( text )\n}\n"
    static let tidyGo = "package hub\n\nimport \"strings\"\n\nfunc Shout(text string) string {\n\treturn strings.ToUpper(text)\n}\n"
    static let sloppyScript = "import { emptyStats, record } from \"./stats.ts\";\nexport   const  fresh = emptyStats( );\n"
    static let tidyScript = "import { emptyStats } from \"./stats.ts\";\nexport const fresh = emptyStats();\n"

    static func assistance() async -> Int {
        var failures = 0
        guard let go = fixtureCopy("notifyhub-go", named: "nyte-assist-go"),
              let script = fixtureCopy("notifyhub-ts", named: "nyte-assist-ts")
        else {
            print("FAIL assistance: copy the fixtures")
            return 1
        }
        defer {
            try? FileManager.default.removeItem(at: go)
            try? FileManager.default.removeItem(at: script)
        }
        try? goMarksFile.write(to: go.appendingPathComponent("hub/marks_test.go"), atomically: true, encoding: .utf8)
        try? sloppyGo.write(to: go.appendingPathComponent("hub/shout.go"), atomically: true, encoding: .utf8)
        try? farGo.write(to: go.appendingPathComponent("hub/far.go"), atomically: true, encoding: .utf8)
        try? scriptTestFile.write(to: script.appendingPathComponent("src/hub.test.ts"), atomically: true, encoding: .utf8)
        try? sloppyScript.write(to: script.appendingPathComponent("src/fresh.ts"), atomically: true, encoding: .utf8)

        let goCheck = LanguageCheck(LanguageCheck.go, root: go)
        await goCheck.goRunMarks()
        await goCheck.saveFormatting("hub/shout.go", sloppy: sloppyGo, tidy: tidyGo)
        await goCheck.usageGuard()
        await goCheck.usageCounts("hub/hub.go", interface: "Channel", implementations: 2, type: "Hub")
        await goCheck.service.shutdown()
        failures += goCheck.failures

        let scriptCheck = LanguageCheck(native, root: script)
        await scriptCheck.scriptRunMarks()
        await scriptCheck.saveFormatting("src/fresh.ts", sloppy: sloppyScript, tidy: tidyScript)
        await scriptCheck.usageCounts("src/hub.ts", interface: "Channel", implementations: 2, type: "Hub")
        await scriptCheck.service.shutdown()
        failures += scriptCheck.failures

        let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../Fixtures").standardizedFileURL
        let mixed = LanguageCheck(LanguageCheck.go, root: fixtures)
        await mixed.mixedSearch()
        await mixed.serverChoiceRestart()
        await mixed.service.shutdown()
        let gone = await Patience.until(.seconds(10)) { Probe.descendants(of: getpid()).isEmpty }
        mixed.expect(gone, "assistance shutdown leaves no child process", Probe.descendants(of: getpid()).map(\.command).joined(separator: ", "))
        return failures + mixed.failures
    }

    func openReady(_ path: String) async -> URL {
        let file = url(path)
        service.open(file, text: (try? String(contentsOf: file, encoding: .utf8)) ?? "")
        _ = await Patience.until(.seconds(60)) { self.service.status(for: file)?.state == .ready }
        return file
    }

    private func goRunMarks() async {
        let main = await openReady("main.go")
        let program = await service.runMarks(in: main)
        expect(program.count == 1 && program.first?.kind == .program && program.first?.line == 12
            && program.first?.target.program == .goPackage(importPath: "example.com/notifyhub"),
            "gopls run marks: func main in package main runs the package", describe(program))
        let tests = await openReady("hub/marks_test.go")
        let marks = await service.runMarks(in: tests)
        let expected: [(Int, RunMark.Kind, [String])] = [
            (0, .suite, ["-test.run", "^(TestRoutes|FuzzSubject|ExampleNew)$"]),
            (6, .test, ["-test.run", "^TestRoutes$"]),
            (7, .test, ["-test.run", "^TestRoutes$/^email_first$"]),
            (8, .test, ["-test.run", "^TestRoutes$/^email_first$/^with_\\(retry\\)$"]),
            (10, .test, ["-test.run", "^TestRoutes$/^pager$"]),
            (15, .test, ["-test.run", "^$", "-test.bench", "^BenchmarkSubmit$"]),
            (17, .test, ["-test.run", "^FuzzSubject$"]),
            (19, .test, ["-test.run", "^ExampleNew$"]),
        ]
        let seen = marks.map { ($0.line, $0.kind, $0.target.arguments) }
        expect(seen.count == expected.count && zip(seen, expected).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 && $0.2 == $1.2 }
            && marks.allSatisfy { $0.target.program == .goTest(importPath: "example.com/notifyhub/hub") },
            "gopls test marks: the file, each TestXxx, its t.Run subtests, a benchmark, a fuzz target and an example; not TestMain or Testhelper",
            describe(marks))
        let command = marks.first { $0.line == 7 }?.target.command ?? []
        expect(command == ["go", "test", "example.com/notifyhub/hub", "-run", "^TestRoutes$/^email_first$"],
               "gopls a subtest's command is go test with the package path and its -run pattern", command.joined(separator: " "))
        let again = await service.runMarks(in: tests)
        expect(again == marks, "gopls run marks for an unchanged version come from the cache", "\(again.count) marks")
    }

    private func scriptRunMarks() async {
        let index = await openReady("src/index.ts")
        let entry = await service.runMarks(in: index)
        expect(entry.count == 1 && entry.first?.kind == .program && entry.first?.target.command == ["npm", "run", "start"]
            && entry.first?.target.program == .node(script: index),
            "TypeScript run marks: the file package.json's start script names runs with node", describe(entry))
        let tests = await openReady("src/hub.test.ts")
        let marks = await service.runMarks(in: tests)
        let expected: [(Int, RunMark.Kind, String)] = [
            (0, .suite, "node --test src/hub.test.ts"),
            (2, .suite, "node --test --test-name-pattern=^Hub( |$) src/hub.test.ts"),
            (3, .test, "node --test --test-name-pattern=^Hub counts a delivery$ src/hub.test.ts"),
            (4, .suite, "node --test --test-name-pattern=^Hub when a channel fails( |$) src/hub.test.ts"),
            (5, .test, "node --test --test-name-pattern=^Hub when a channel fails records it$ src/hub.test.ts"),
            (9, .test, "node --test --test-name-pattern=^stands alone \\(top\\)$ src/hub.test.ts"),
        ]
        let seen = marks.map { ($0.line, $0.kind, $0.target.command.joined(separator: " ")) }
        expect(seen.count == expected.count && zip(seen, expected).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 && $0.2 == $1.2 },
               "TypeScript test marks: describe and it calls for node's test runner, nested names joined", describe(marks))
    }

    private func saveFormatting(_ path: String, sloppy: String, tidy: String) async {
        let file = await openReady(path)
        _ = await Patience.until(.seconds(20)) { !self.service.diagnostics(for: file).isEmpty }
        let late = await service.editsBeforeSave(file, indent: 2, usesTabs: fixture.server == "gopls", deadline: .nanoseconds(1))
        let timedOut = if case .timedOut = late.outcome { true } else { false }
        expect(timedOut && late.edits.isEmpty, "\(fixture.server) a save past its deadline goes ahead unformatted and says so",
               "\(late.outcome)")
        let prepared = await service.editsBeforeSave(file, indent: 2, usesTabs: fixture.server == "gopls", deadline: .seconds(10))
        let result = LineDiff.applying(prepared.edits, to: sloppy)
        expect(prepared.outcome == .changed && prepared.steps == [.format, .organizeImports] && result == tidy,
               "\(fixture.server) before a save, \(path) comes back formatted with its imports organised",
               "\(prepared.outcome) \(prepared.steps) \(result.debugDescription)")
        for edit in prepared.edits.sorted(by: { $1.range.start < $0.range.start }) { service.change(file, range: edit.range, text: edit.text) }
        let again = await service.editsBeforeSave(file, indent: 2, usesTabs: fixture.server == "gopls", deadline: .seconds(10))
        expect(again.outcome == .unchanged && service.openText(of: file) == tidy,
               "\(fixture.server) after the editor applies those edits the server and the buffer agree and nothing is left to do",
               "\(again.outcome) \(again.edits.count) edits")
    }

    private func usageGuard() async {
        let file = await openReady("hub/hub.go")
        let whole = TextSpan(start: .init(line: 0, column: 0), end: .init(line: 200, column: 0))
        let off = await service.usages(in: whole, of: file)
        expect(off.isEmpty && !service.settings.go.countsUsages, "gopls usage counts are off for Go by default", "\(off.count) counts")
        service.settings.go.countsUsages = true
        service.settings.go.memoryCeilingMegabytes = 1
        let paused = await service.usages(in: whole, of: file)
        let resident = service.status(for: file)?.residentBytes ?? 0
        expect(!paused.isEmpty && paused.allSatisfy { $0.usages == nil } && resident > (1 << 19),
               "gopls usage counting pauses while the server's memory is above half its ceiling",
               "\(paused.filter { $0.usages != nil }.count) of \(paused.count) counted at \(resident / (1 << 20)) MB against a 1 MB ceiling")
        service.settings.go.memoryCeilingMegabytes = LanguageSettings.Go().memoryCeilingMegabytes
        let resumed = await service.usages(in: whole, of: file)
        expect(!resumed.isEmpty && resumed.allSatisfy { $0.usages != nil }, "gopls usage counting resumes once memory is below half the ceiling",
               "\(resumed.filter { $0.usages != nil }.count) of \(resumed.count) counted")
        let far = await openReady("hub/far.go")
        let everything = await service.usages(in: TextSpan(start: .init(line: 0, column: 0), end: .init(line: 400, column: 0)), of: far)
        let visible = await service.usages(in: TextSpan(start: .init(line: 250, column: 0), end: .init(line: 290, column: 0)), of: far)
        expect(everything.isEmpty && visible.map(\.name) == ["Far"],
               "gopls usage counting covers at most \(LanguageService.visibleLineLimit) lines from the start of the range asked, never a whole file",
               "whole file \(everything.map(\.name)), lines 251–291 \(visible.map(\.name))")
    }

    private func usageCounts(_ path: String, interface: String, implementations: Int, type: String) async {
        let file = await openReady(path)
        let lines = Probe.lines((try? String(contentsOf: file, encoding: .utf8)) ?? "").count
        let started = ContinuousClock.now
        let counts = await service.usages(in: TextSpan(start: .init(line: 0, column: 0), end: .init(line: lines, column: 0)), of: file)
        let elapsed = ContinuousClock.now - started
        print("info \(fixture.server) usages for \(counts.count) declarations in \(path) took \(elapsed)")
        let channel = counts.first { $0.name == interface }
        let hub = counts.first { $0.name == type }
        expect(channel?.implementations == implementations && (channel?.usages ?? 0) > 0 && (hub?.usages ?? 0) > 0,
               "\(fixture.server) usages at the declaration: \(interface) has \(implementations) implementations and usages, \(type) has usages",
               counts.map { "\($0.name) \($0.usages.map(String.init) ?? "-")/\($0.implementations.map(String.init) ?? "-")" }.joined(separator: ", "))
        let cached = ContinuousClock.now
        let again = await service.usages(in: TextSpan(start: .init(line: 0, column: 0), end: .init(line: lines, column: 0)), of: file)
        expect(again == counts && ContinuousClock.now - cached < .milliseconds(50),
               "\(fixture.server) usages for an unchanged version come from the cache", "\(ContinuousClock.now - cached)")
        let scrolled = Task { await self.service.usages(in: TextSpan(start: .init(line: 0, column: 0), end: .init(line: lines, column: 0)), of: file) }
        service.change(file, range: TextSpan(at: .init(line: lines - 1, column: 0)), text: "\n")
        scrolled.cancel()
        let partial = await scrolled.value
        expect(partial.allSatisfy { $0.usages == nil } || partial.contains { $0.usages == nil },
               "\(fixture.server) a usages request cancelled by a scroll stops counting", "\(partial.filter { $0.usages != nil }.count) counted")
    }

    private func mixedSearch() async {
        let goStats = await openReady("notifyhub-go/hub/stats.go")
        _ = await openReady("notifyhub-ts/src/stats.ts")
        var batches: [SymbolResults] = []
        for await results in service.symbolSearch("Stats", near: goStats) { batches.append(results) }
        let final = batches.last?.matches ?? []
        let keys = final.map { match in
            (match.quality.rawValue, SymbolRanking.kindRank(match.symbol.kind),
             SymbolRanking.proximity(of: match.symbol.location.url, to: goStats, nearFolder: goStats.deletingLastPathComponent().pathComponents,
                                     root: root))
        }
        let ordered = zip(keys, keys.dropFirst()).allSatisfy { $0 <= $1 }
        let languages = Set(final.map { $0.symbol.location.url.pathExtension })
        expect(batches.count >= 2 && batches.last?.isComplete == true && languages == ["go", "ts"],
               "workspace symbols in a mixed workspace stream one batch per server and finish with both languages",
               "\(batches.count) batches, languages \(languages.sorted())")
        expect(ordered && final.first?.symbol.name == "Stats" && final.first?.symbol.location.url == goStats,
               "workspace symbols rank by match quality, then kind, then nearness to the current file",
               final.prefix(6).map { "\($0.symbol.name) \($0.quality) \($0.symbol.kind) \($0.file)" }.joined(separator: "; "))

        let race = SearchRace()
        let olderStream = service.symbolSearch("Sta", near: goStats)
        let reading = Task { for await results in olderStream { race.older.append(results) } }
        var newer: [SymbolResults] = []
        for await results in service.symbolSearch("Stats", near: goStats) { newer.append(results) }
        await reading.value
        expect(race.older.isEmpty && newer.last?.isComplete == true && newer.last?.query == "Stats",
               "workspace symbols a newer query cancels an older one that has not answered, which then yields nothing",
               "older yielded \(race.older.count), newer \(newer.count)")

        let late = SearchRace()
        var newerStream: AsyncStream<SymbolResults>?
        for await results in service.symbolSearch("Sta", near: goStats) {
            late.older.append(results)
            if newerStream == nil { newerStream = service.symbolSearch("Counts", near: goStats) } else { late.afterNewer += 1 }
        }
        var after: [SymbolResults] = []
        if let newerStream { for await results in newerStream { after.append(results) } }
        let complete = late.older.first?.isComplete == true
        print("info workspace symbols the older query was \(complete ? "already complete" : "halfway") when the newer one started")
        expect(late.afterNewer == 0 && after.last?.query == "Counts" && after.last?.isComplete == true,
               "workspace symbols an older query that has started answering never paints over a newer one",
               "older batches \(late.older.count), \(late.afterNewer) after the newer started")
    }

    private func serverChoiceRestart() async {
        let file = url("notifyhub-ts/src/stats.ts")
        service.settings.typeScript.server = .tsserver
        _ = await Patience.until(.seconds(60)) {
            self.service.status(for: file)?.shortName == "tsserver" && self.service.status(for: file)?.state == .ready
        }
        let before = service.status(for: file)?.shortName
        service.settings.typeScript.server = .automatic
        let switched = await Patience.until(.seconds(60)) {
            self.service.status(for: file)?.shortName == "TypeScript" && self.service.status(for: file)?.state == .ready
        }
        let hover = await service.hover(at: TextPosition(line: 1, column: 18), in: file)
        expect(before == "tsserver" && switched && hover != nil,
               "settings choosing the native TypeScript server restarts the running tsserver as the native one",
               "\(before ?? "nil") → \(service.status(for: file)?.shortName ?? "nil"), hover \(hover != nil)")
    }

    private func describe(_ marks: [RunMark]) -> String {
        marks.map { "\($0.line) \($0.kind) \($0.title) [\($0.target.arguments.joined(separator: " "))] (\($0.target.command.joined(separator: " ")))" }
            .joined(separator: "; ")
    }
}

@MainActor final class SearchRace {
    var older: [SymbolResults] = []
    var afterNewer = 0
}
