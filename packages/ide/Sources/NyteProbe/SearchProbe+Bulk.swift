import Foundation
import NyteCore
import NyteUI
@testable import NyteSearch

extension SearchCheck {
    func bulkReplace() async {
        for index in 0..<3 { write("bulk/part\(index).txt", String(repeating: "zap zip zap\n", count: 750)) }
        let engine = SearchEngine(root: corpus)
        var capped = SearchQuery("zap", caseMode: .sensitive, scope: .folder("bulk"))
        capped.limits = SearchQuery.Limits(matchesPerFile: 1_000, matches: 2_000)
        let shown = await SearchProbeRun.collect(engine, capped)
        let grep = SearchProbeRun.shell("/usr/bin/grep", ["-o", "-r", "zap", "bulk"], in: corpus).split(separator: "\n").count
        expect(shown.summary.ending == .capped && shown.results.matchCount == 2_000 && grep == 4_500,
               "replace all: the shown list is capped at 2,000 of \(grep.formatted())", "\(shown.results.matchCount) \(shown.summary.ending)")
        let replacer = Replacer(query: capped, replacement: "ZIP", preservesCase: false)
        guard case let .ready(plan) = await replacer.planAll(engine: engine, unsaved: [:]) else {
            return expect(false, "replace all: re-runs the query without the display cap")
        }
        expect(plan.count == grep && plan.edit.files.count == 3, "replace all: re-runs the query without the display cap and finds every one",
               "\(plan.count) in \(plan.edit.files.count)")
        expect(FindInFilesViewController.confirmation(plan, file: nil) == "Replace 4,500 occurrences in 3 files?",
               "replace all: the confirmation tells the truth", FindInFilesViewController.confirmation(plan, file: nil))
        let all = (0..<3).allSatisfy { index in
            applied(plan.edit, "bulk/part\(index).txt") == sed(["s/zap/ZIP/g"], "bulk/part\(index).txt")
        }
        expect(all, "replace all: every file matches sed after the uncapped edit")
        guard case let .refused(reason) = await replacer.planAll(engine: engine, unsaved: [:], limit: 4_000) else {
            return expect(false, "replace all: refuses past the hard limit")
        }
        expect(reason == Replacer.tooMany(4_000) && reason.contains("4,000"), "replace all: refuses past the limit and says why", reason)
        expect(Replacer.hardLimit == 100_000, "replace all: the hard limit is 100,000 occurrences")
        let skipped = MatchKey(path: "bulk/part1.txt", byte: 0)
        if case let .ready(fewer) = await replacer.planAll(engine: engine, unsaved: [:], excluding: [skipped]) {
            expect(fewer.count == grep - 1, "replace all: dismissed results stay out", "\(fewer.count)")
        } else {
            expect(false, "replace all: dismissed results stay out")
        }
        var oneFile = capped
        oneFile.scope = .files(["bulk/part2.txt"])
        if case let .ready(filePlan) = await Replacer(query: oneFile, replacement: "ZIP", preservesCase: false).planAll(engine: engine, unsaved: [:]) {
            expect(filePlan.count == 1_500 && FindInFilesViewController.confirmation(filePlan, file: "bulk/part2.txt") == "Replace 1,500 occurrences in part2.txt?",
                   "replace all in file: uncapped for the one file, with its own count", "\(filePlan.count)")
        } else {
            expect(false, "replace all in file: uncapped for the one file")
        }
    }

    func carriedLexing() {
        let comment = (0..<3_000).map { "comment line \($0) with let and if" }.joined(separator: "\n")
        let code = (0..<600).map { _ in "let value = 1" }.joined(separator: "\n")
        write("lex.swift", "/*\n" + comment + "\n*/\n" + code + "\n")
        func kinds(_ line: Int, _ checkpoints: LexCheckpoints) -> (Set<SyntaxColor>, Bool) {
            let source = read("lex.swift")
            let lines = source.split(separator: "\n", omittingEmptySubsequences: false)
            let byte = lines.prefix(line).reduce(0) { $0 + $1.utf8.count + 1 }
            let preview = PreviewText.read(root: corpus, path: "lex.swift", unsaved: nil, line: line, byte: byte, column: 0, checkpoints: checkpoints)
            let index = line - preview.firstLine
            guard index >= 0, index < preview.lineCount else { return ([], preview.lexedFromTop) }
            let language = Language.detect(fileName: "lex.swift")
            let entry = CodeViewSource.state(after: preview.lines.prefix(index), language: language, from: preview.entryState)
            var tokens: [UInt64] = []
            let units = Array(preview.lines[index].utf16)
            units.withUnsafeBufferPointer { _ = Lexer.line($0, state: entry, language: language, offset: 0, tokens: &tokens, emit: true) }
            return (Set(tokens.map(Token.kind)), preview.lexedFromTop)
        }
        let checkpoints = LexCheckpoints()
        let inside = kinds(2_000, checkpoints)
        expect(inside.0 == [.comment] && inside.1, "preview colour: line 2,000 of a 3,000-line block comment is a comment",
               "\(inside.0) from top \(inside.1)")
        let after = kinds(3_300, checkpoints)
        expect(after.0.contains(.keyword) && !after.0.contains(.comment), "preview colour: code after the long comment is code again",
               "\(after.0)")
        let small = LexCheckpoints(bound: 4_096)
        let fallback = kinds(2_000, small)
        expect(!fallback.1 && !fallback.0.contains(.comment), "preview colour: past the bound it falls back to a clean state and says so",
               "\(fallback.0) from top \(fallback.1)")
        expect(LexCheckpoints.bound == 8 << 20 && LexCheckpoints.interval == 256, "preview colour: states are cached every 256 lines up to 8 MB")
    }

    func ignoreSources() {
        let outside = corpus.deletingLastPathComponent().appendingPathComponent(corpus.lastPathComponent + "-plain")
        defer { try? FileManager.default.removeItem(at: outside) }
        let folder = outside.appendingPathComponent("plainfolder")
        let home = outside.appendingPathComponent("home")
        let files: [(String, String)] = [
            ("plainfolder/a.txt", "x"), ("plainfolder/b.info", "x"), ("plainfolder/c.global", "x"), ("plainfolder/sub/d.global", "x"),
            ("plainfolder/.git/info/exclude", "*.info\n"), ("home/.gitconfig", "[user]\n\tname = x\n[core]\n\texcludesFile = ~/global-ignore\n"),
            ("home/global-ignore", "*.global\n"),
        ]
        for (path, text) in files {
            let url = outside.appendingPathComponent(path)
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? Data(text.utf8).write(to: url)
        }
        let sources = IgnoreSources(home: home, environment: [:])
        let listed = Set(SearchFiles.load(root: folder, includingIgnored: false, sources: sources).paths)
        expect(listed == ["a.txt"], "ignore: .git/info/exclude and core.excludesFile apply to a folder without a working repository",
               listed.sorted().joined(separator: " "))
        let xdg = outside.appendingPathComponent("xdg")
        try? FileManager.default.createDirectory(at: xdg.appendingPathComponent("git"), withIntermediateDirectories: true)
        try? Data("*.txt\n".utf8).write(to: xdg.appendingPathComponent("git/ignore"))
        let defaulted = IgnoreSources(home: outside.appendingPathComponent("nohome"), environment: ["XDG_CONFIG_HOME": xdg.path])
        let fallback = Set(SearchFiles.load(root: folder, includingIgnored: false, sources: defaulted).paths)
        expect(!fallback.contains("a.txt") && fallback.contains("c.global"), "ignore: without a setting the default is $XDG_CONFIG_HOME/git/ignore",
               fallback.sorted().joined(separator: " "))
        let configs: [(String, String?)] = [
            ("[core]\n  excludesfile = /a/b\n", "/a/b"), ("[Core]\nExcludesFile = \"~/x y\"\n", "~/x y"), ("[user]\nexcludesfile = /no\n", nil),
        ]
        for (config, want) in configs {
            expect(IgnoreSources.excludesFile(in: config) == want, "ignore: reads core.excludesFile from \(config.debugDescription)")
        }
    }
}
