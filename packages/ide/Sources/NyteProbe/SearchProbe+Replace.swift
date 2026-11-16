import Foundation
import NyteCore
@testable import NyteSearch

extension SearchCheck {
    func planned(_ text: String, _ replacement: String, preservesCase: Bool = false, configure: (inout SearchQuery) -> Void = { _ in },
                 chosen: ((SearchResults) -> [Int])? = nil) async -> (ReplacePlan, SearchResults) {
        var query = SearchQuery(text)
        configure(&query)
        let results = await SearchProbeRun.collect(SearchEngine(root: corpus), query).results
        let replacer = Replacer(query: query, replacement: replacement, preservesCase: preservesCase)
        let matches = chosen?(results) ?? Array(0..<results.matchCount)
        return (replacer.plan(results, matches: matches, root: corpus, unsaved: [:]), results)
    }

    func applied(_ plan: WorkspaceEdit, _ path: String) -> String {
        let edits = plan.files.first { $0.url.lastPathComponent == (path as NSString).lastPathComponent && $0.url.path.hasSuffix(path) }?.edits ?? []
        return SearchProbeRun.apply(edits, to: read(path))
    }

    func sed(_ script: [String], _ path: String) -> String {
        SearchProbeRun.shell("/usr/bin/sed", script + [path], in: corpus, environment: ["LC_ALL": "C"])
    }

    func replacing() async {
        let (literal, _) = await planned("needle", "pin", configure: {
            $0.caseMode = .sensitive
            $0.limits = SearchQuery.Limits(matchesPerFile: 1_000_000, matches: 10_000_000)
        })
        for path in ["plain.txt", "crlf.txt", "edges.txt", "emoji.txt", "big.txt", "long.txt"] {
            let mine = applied(literal.edit, path)
            let theirs = sed(["s/needle/pin/g"], path)
            expect(mine == theirs, "replace: literal edits match sed in \(path)", "\(mine.prefix(80)) vs \(theirs.prefix(80))")
        }
        let (groups, _) = await planned("(\\w+)@(\\w+)", "$2 at $1", configure: { $0.isRegex = true })
        let mine = applied(groups.edit, "mail.txt")
        let theirs = sed(["-E", "s/([A-Za-z0-9_]+)@([A-Za-z0-9_]+)/\\2 at \\1/g"], "mail.txt")
        expect(mine == theirs, "replace: capture groups match sed -E", "\(mine) vs \(theirs)")
        expect(SearchProbeRun.apply(groups.inverse.files.first?.edits ?? [], to: mine) == read("mail.txt"),
               "replace: the inverse edit restores the text")
        let (split, _) = await planned("(\\w+)@", "$1\\n@", configure: { $0.isRegex = true })
        let broken = applied(split.edit, "mail.txt")
        expect(broken == "alice\n@example bob\n@host\nnobody here\ncarol\n@site\n", "replace: \\n in a regex replacement breaks the line",
               broken.debugDescription)
        expect(SearchProbeRun.apply(split.inverse.files.first?.edits ?? [], to: broken) == read("mail.txt"),
               "replace: the inverse of a line-breaking edit restores the text")
        let (cased, _) = await planned("foo", "bar", preservesCase: true)
        expect(applied(cased.edit, "cases.txt") == "bar Bar BAR bar\n", "replace: case preservation for lower, capital, upper and mixed",
               applied(cased.edit, "cases.txt"))
        let (subset, results) = await planned("needle", "pin", configure: { $0.caseMode = .sensitive; $0.scope = .files(["plain.txt"]) },
                                              chosen: { _ in [0, 2] })
        let kept = applied(subset.edit, "plain.txt")
        expect(subset.count == 2 && results.matchCount == 6 && kept.hasPrefix("pin at the start\nhay needle hay NEEDLE\nNeedle\npins"),
               "replace: a chosen subset only", kept.prefix(70).debugDescription)
        let (fresh, freshResults) = await planned("needle", "pin", configure: { $0.scope = .files(["sub/open.txt"]) })
        write("sub/open.txt", "changed\n")
        let replacer = Replacer(query: SearchQuery("needle", scope: .files(["sub/open.txt"])), replacement: "pin", preservesCase: false)
        let stale = replacer.plan(freshResults, matches: [0], root: corpus, unsaved: [:])
        expect(fresh.count == 1 && stale.stale == ["sub/open.txt"] && stale.count == 0, "replace: a file changed since the search is left alone",
               "\(stale.stale)")
        write("sub/open.txt", "needle\n")
        let edit = literal.edit.files.first { $0.url.lastPathComponent == "plain.txt" }?.edits.first
        expect(edit?.range == TextSpan(start: TextPosition(line: 0, column: 0), end: TextPosition(line: 0, column: 6)),
               "replace: edits carry zero-based lines and UTF-16 columns", "\(String(describing: edit?.range))")
    }

    func historyAndExcerpts() {
        let current = try? JSONEncoder().encode(SearchHistory(entries: ["a", "b"]))
        var newer = SearchHistory(entries: ["x"])
        newer.version = SearchHistory.currentVersion + 1
        let cases: [(String, Data?, SearchHistory, SearchHistory.Origin)] = [
            ("nothing saved starts fresh", nil, SearchHistory(), .fresh),
            ("a stored value reads back", current, SearchHistory(entries: ["a", "b"]), .stored),
            ("a newer version falls back", try? JSONEncoder().encode(newer), SearchHistory(), .unreadable),
            ("garbage falls back", Data("{".utf8), SearchHistory(), .unreadable),
        ]
        for (name, data, want, origin) in cases {
            let got = SearchHistory.decode(data)
            expect(got.history == want && got.origin == origin, "history: \(name)", "\(got)")
        }
        var history = SearchHistory()
        for text in ["one", "two", "one"] { history = history.recording(text) }
        expect(history.entries == ["one", "two"], "history: a repeat moves to the front", "\(history.entries)")
        for index in 0..<(SearchHistory.capacity + 5) { history = history.recording("q\(index)") }
        expect(history.entries.count == SearchHistory.capacity, "history: keeps \(SearchHistory.capacity)")
        var cursor = HistoryCursor()
        let small = SearchHistory(entries: ["newest", "older"])
        let walk = [cursor.step(-1, in: small, current: "draft"), cursor.step(-1, in: small, current: "newest"),
                    cursor.step(-1, in: small, current: "older"), cursor.step(1, in: small, current: "older"),
                    cursor.step(1, in: small, current: "newest")]
        expect(walk == ["newest", "older", nil, "newest", "draft"], "history: up walks back, down returns to the draft",
               walk.map { $0 ?? "nil" }.joined(separator: " "))
        let excerpts: [(NSRange, Int, Bool)] = [
            (NSRange(location: 5, length: 3), 80, false), (NSRange(location: 200, length: 6), 80, true), (NSRange(location: 70, length: 20), 80, true),
        ]
        for (range, columns, cuts) in excerpts {
            let shift = Excerpt.shift(for: range, columns: columns)
            expect((shift > 0) == cuts && range.location - shift >= 1 && NSMaxRange(range) - shift <= columns,
                   "excerpt: a match at \(range.location) in \(columns) columns stays visible", "shift \(shift)")
        }
        let templates: [(String, String)] = [("$1\\n", "$1\n"), ("a\\tb", "a\tb"), ("\\\\", "\\\\"), ("\\$1", "\\$1")]
        for (input, want) in templates {
            expect(Replacer.template(input) == want, "replace: template \(input.debugDescription)", Replacer.template(input).debugDescription)
        }
        let casing: [(String, String, String)] = [("foo", "bar", "bar"), ("Foo", "bar", "Bar"), ("FOO", "bar", "BAR"), ("fOo", "bar", "bar"),
                                                  ("ÉTÉ", "hiver", "HIVER")]
        for (matched, replacement, want) in casing {
            expect(Replacer.preservingCase(replacement, like: matched) == want, "replace: \(matched) preserves into \(want)")
        }
    }

    func againstGrep() async {
        let folder = "packages/ide/Sources"
        let engine = SearchEngine(root: repository)
        let files = engine.files(includingIgnored: false).paths.filter { $0.hasPrefix(folder + "/") && $0.hasSuffix(".swift") }
        guard files.count > 100 else { return expect(false, "grep: the repository's Swift sources are listed", "\(files.count) files") }
        let cases: [(String, [String], (inout SearchQuery) -> Void)] = [
            ("Palette", ["-F"], { $0.caseMode = .sensitive }),
            ("guard let", ["-F"], { $0.caseMode = .sensitive }),
            ("NSRect(", ["-F"], { $0.caseMode = .sensitive }),
            ("palette", ["-F", "-i"], { $0.caseMode = .insensitive }),
            ("row", ["-F", "-w"], { $0.caseMode = .sensitive; $0.wholeWord = true }),
            ("Row", ["-F", "-w", "-i"], { $0.caseMode = .insensitive; $0.wholeWord = true }),
            ("func [a-zA-Z]+\\(", ["-E"], { $0.caseMode = .sensitive; $0.isRegex = true }),
            ("[0-9]+", ["-E"], { $0.caseMode = .sensitive; $0.isRegex = true }),
            ("let [a-z][A-Za-z]* =", ["-E"], { $0.caseMode = .sensitive; $0.isRegex = true }),
            ("Palette\\.[a-z]+", ["-E"], { $0.caseMode = .sensitive; $0.isRegex = true }),
            ("\"[^\"]*\"", ["-E"], { $0.caseMode = .sensitive; $0.isRegex = true }),
            ("^import [A-Za-z]+$", ["-E"], { $0.caseMode = .sensitive; $0.isRegex = true }),
            ("[A-Z][a-z]+View", ["-E", "-i"], { $0.caseMode = .insensitive; $0.isRegex = true }),
        ]
        for (pattern, flags, configure) in cases {
            var query = SearchQuery(pattern, scope: .files(files), limits: SearchQuery.Limits(matchesPerFile: 1_000_000, matches: 10_000_000))
            configure(&query)
            let found = await SearchProbeRun.collect(engine, query).results
            let wholeWord = flags.contains("-w")
            let mine = Set(wholeWord ? SearchProbeRun.offsets(found).map { String($0[..<($0.lastIndex(of: ":") ?? $0.endIndex)]) }
                : SearchProbeRun.offsets(found))
            let options = wholeWord ? ["-n", "-H"] : ["-o", "-n", "-b", "-H"]
            let output = SearchProbeRun.shell("/usr/bin/grep", options + flags + ["-e", pattern, "--"] + files, in: repository,
                                              environment: ["LC_ALL": "C"])
            let theirs = Set(output.split(separator: "\n").compactMap { line -> String? in
                let parts = line.split(separator: ":", maxSplits: wholeWord ? 2 : 3, omittingEmptySubsequences: false)
                guard parts.count == (wholeWord ? 3 : 4) else { return nil }
                return wholeWord ? "\(parts[0]):\(parts[1])" : "\(parts[0]):\(parts[1]):\(parts[2])"
            })
            let difference = mine.symmetricDifference(theirs)
            let unit = wholeWord ? "lines" : "matches"
            expect(difference.isEmpty && !mine.isEmpty, "grep: \(pattern) \(flags.joined(separator: " ")) agrees on \(mine.count) \(unit) in \(files.count) files",
                   "\(mine.count) vs \(theirs.count): " + difference.sorted().prefix(4).joined(separator: " "))
            guard wholeWord, FileManager.default.isExecutableFile(atPath: SearchBench.ripgrep) else { continue }
            let ripgrep = SearchProbeRun.shell(SearchBench.ripgrep, ["--no-config", "-o", "-n", "-b", "-H", "-w", "-F"]
                                               + (flags.contains("-i") ? ["-i"] : ["-s"]) + ["-e", pattern, "--"] + files, in: repository)
            let offsets = Set(ripgrep.split(separator: "\n").compactMap { line -> String? in
                let parts = line.split(separator: ":", maxSplits: 3, omittingEmptySubsequences: false)
                return parts.count == 4 ? "\(parts[0]):\(parts[1]):\(parts[2])" : nil
            })
            let exact = Set(SearchProbeRun.offsets(found))
            expect(exact == offsets, "ripgrep: \(pattern) -w agrees on every one of \(exact.count) offsets",
                   "\(exact.count) vs \(offsets.count): " + exact.symmetricDifference(offsets).sorted().prefix(4).joined(separator: " "))
        }
    }
}
