import Foundation
import NyteCore
@testable import NyteSearch

@MainActor func runSearchProbe(_ arguments: [String]) async {
    switch arguments.first {
    case "check":
        let check = SearchCheck()
        await check.runAll()
        check.cleanUp()
        print(check.failures == 0 ? "search check: all \(check.passes) passed" : "search check: \(check.failures) failed, \(check.passes) passed")
        if check.failures > 0 { exit(1) }
    case "bench":
        await SearchBench.run(Array(arguments.dropFirst()))
    case "run":
        guard arguments.count >= 3 else { fail("usage: NyteProbe search run <folder> <text> [regex]") }
        let engine = SearchEngine(root: URL(fileURLWithPath: arguments[1]))
        let outcome = await SearchProbeRun.collect(engine, SearchQuery(arguments[2], isRegex: arguments.count > 3))
        let results = outcome.results
        for match in 0..<min(results.matchCount, 40) {
            let file = Int(results.matchFile[match])
            print("\(results.paths[file]):\(results.matchLine[match] + 1):\(results.matchColumn[match] + 1): \(results.text(ofSlot: Int(results.matchSlot[match])))")
        }
        let summary = outcome.summary
        print("\(results.matchCount) matches in \(results.fileCount) files, \(summary.progress.filesSearched) searched, \(summary.ending), \(summary.elapsed)")
    default:
        fail("NyteProbe search: check | bench [folder] | run <folder> <text> [regex]")
    }
}

enum SearchProbeRun {
    struct Outcome {
        var results = SearchResults()
        var summary: SearchSummary
        var batches = 0
        var firstBatch: Duration?
        var error: String?
    }

    static let repository = ProcessInfo.processInfo.environment["NYTE_REPOSITORY"].map { URL(fileURLWithPath: $0) }
        ?? URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()

    static let empty = SearchSummary(ending: .cancelled, progress: SearchProgress(), failures: [], binaryFiles: 0, largeFiles: 0,
                                     elapsed: .zero, firstResult: nil)

    static func collect(_ engine: SearchEngine, _ query: SearchQuery, unsaved: [String: String] = [:],
                        cancelAfterFirstBatch: Bool = false) async -> Outcome {
        let started = ContinuousClock.now
        let run: SearchRun
        do {
            run = try engine.start(query, unsaved: unsaved)
        } catch {
            return Outcome(summary: empty, error: error.message)
        }
        var outcome = Outcome(summary: empty)
        for await event in run.events {
            switch event {
            case let .batch(batch, _):
                outcome.batches += 1
                if outcome.firstBatch == nil, !batch.isEmpty { outcome.firstBatch = ContinuousClock.now - started }
                outcome.results.append(batch)
                if cancelAfterFirstBatch { run.cancel() }
            case let .finished(summary):
                outcome.summary = summary
                return outcome
            }
        }
        return outcome
    }

    static func places(_ results: SearchResults) -> [String] {
        (0..<results.matchCount).map { match in
            "\(results.paths[Int(results.matchFile[match])]):\(results.matchLine[match] + 1):\(results.matchColumn[match] + 1)"
        }
    }

    static func offsets(_ results: SearchResults) -> [String] {
        (0..<results.matchCount).map { match in
            "\(results.paths[Int(results.matchFile[match])]):\(results.matchLine[match] + 1):\(results.matchBytes[match].lowerBound)"
        }
    }

    static func shell(_ executable: String, _ arguments: [String], in folder: URL, environment: [String: String]? = nil) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.currentDirectoryURL = folder
        if let environment { process.environment = environment }
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return "" }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(decoding: data, as: UTF8.self)
    }

    static func apply(_ edits: [TextEdit], to text: String) -> String {
        var units = Array(text.utf16)
        var starts = [0]
        for (index, unit) in units.enumerated() where unit == 0x0A { starts.append(index + 1) }
        let offsets = edits.map { edit in
            (starts[edit.range.start.line] + edit.range.start.column, starts[edit.range.end.line] + edit.range.end.column, edit.text)
        }
        for (start, end, replacement) in offsets.sorted(by: { $0.0 > $1.0 }) {
            units.replaceSubrange(start..<end, with: Array(replacement.utf16))
        }
        return String(decoding: units, as: UTF16.self)
    }
}

@MainActor final class SearchCheck {
    var failures = 0
    var passes = 0
    let corpus = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-search-check-\(UUID().uuidString)")
    let repository = SearchProbeRun.repository
    var opened: [(FileLocation, FindInFilesViewController.OpenIntent)] = []

    func expect(_ condition: Bool, _ name: String, _ saw: @autoclosure () -> String = "") {
        if condition {
            passes += 1
            return print("ok    \(name)")
        }
        failures += 1
        let detail = saw()
        print("FAIL  \(name)\n      saw: \(detail.isEmpty ? "(nothing)" : detail)")
    }

    func runAll() async {
        makeCorpus()
        await literals()
        await caseFolding()
        await regexes()
        await shapes()
        ignoreRules()
        await skipping()
        await caps()
        await unsavedBuffers()
        await cancellation()
        await replacing()
        historyAndExcerpts()
        await againstGrep()
        await bulkReplace()
        carriedLexing()
        ignoreSources()
        await arrival()
        grouping()
        jumpsStayColoured()
        await window()
        await windowRoundTwo()
    }

    func cleanUp() {
        try? FileManager.default.removeItem(at: corpus)
    }

    func write(_ path: String, _ text: String) {
        write(path, Data(text.utf8))
    }

    func write(_ path: String, _ data: Data) {
        let url = corpus.appendingPathComponent(path)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url)
    }

    func read(_ path: String) -> String {
        (try? String(contentsOf: corpus.appendingPathComponent(path), encoding: .utf8)) ?? ""
    }

    func makeCorpus() {
        write("plain.txt", "needle at the start\nhay needle hay NEEDLE\nNeedle\nneedles and needle_x and xneedle\nend needle")
        write("crlf.txt", "one\r\ntwo needle\r\nthree\r\n")
        write("edges.txt", "needle middle needle")
        write("overlap.txt", "aaaa\nababa\n")
        write("unicode.txt", "Straße STRASSE straße\nÉcole école ÉCOLE ecole\nσίσυφος ΣΊΣΥΦΟΣ\nKelvin \u{212A} k K\nſ s S\n")
        write("emoji.txt", "😀 needle 😀needle\n")
        write("long.txt", String(repeating: "x", count: 500_000) + "needle" + String(repeating: "y", count: 500_000) + "\nneedle\n")
        var binary = Data("needle\n".utf8)
        binary.append(contentsOf: [0, 1, 2, 3])
        binary.append(Data("needle\n".utf8))
        write("binary.dat", binary)
        write("big.txt", String(repeating: "needle filler line\n", count: 4_000))
        write("many.txt", String(repeating: "dense dense dense dense dense\n", count: 20))
        write("mail.txt", "alice@example bob@host\nnobody here\ncarol@site\n")
        write("cases.txt", "foo Foo FOO fOo\n")
        write("words.txt", "id ids _id id_ id2 (id) id-x x.id\n")
        write(".gitignore", "*.log\nbuild/\n!keep.log\n")
        write("x.log", "needle\n")
        write("keep.log", "needle\n")
        write("build/out.txt", "needle\n")
        write("deep/build/z.txt", "needle\n")
        write("sub/.gitignore", "secret.txt\n*.tmp\n")
        write("sub/secret.txt", "needle\n")
        write("sub/open.txt", "needle\n")
        write("sub/inner/.gitignore", "!keep.tmp\n")
        write("sub/inner/keep.tmp", "needle\n")
        write("sub/inner/drop.tmp", "needle\n")
        write("ws.txt", "a  \n  b\n")
        write("glob/a.swift", "needle\n")
        write("glob/b.ts", "needle\n")
        write("glob/node_modules/c.swift", "needle\n")
        _ = SearchProbeRun.shell("/usr/bin/git", ["init", "-q"], in: corpus)
        _ = SearchProbeRun.shell("/usr/bin/git", ["add", "plain.txt", "crlf.txt"], in: corpus)
    }

    func search(_ text: String, _ configure: (inout SearchQuery) -> Void = { _ in }, unsaved: [String: String] = [:],
                engine: SearchEngine? = nil) async -> SearchProbeRun.Outcome {
        var query = SearchQuery(text)
        configure(&query)
        return await SearchProbeRun.collect(engine ?? SearchEngine(root: corpus), query, unsaved: unsaved)
    }

    func places(_ outcome: SearchProbeRun.Outcome, in path: String) -> [String] {
        SearchProbeRun.places(outcome.results).filter { $0.hasPrefix(path + ":") }.map { String($0.dropFirst(path.count + 1)) }
    }
}
