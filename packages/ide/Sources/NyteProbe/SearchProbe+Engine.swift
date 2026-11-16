import Foundation
import NyteCore
@testable import NyteSearch

extension SearchCheck {
    func literals() async {
        let cases: [(String, String, (inout SearchQuery) -> Void, String, [String])] = [
            ("smart case folds a lowercase literal", "needle", { _ in }, "plain.txt",
             ["1:1", "2:5", "2:16", "3:1", "4:1", "4:13", "4:27", "5:5"]),
            ("match case keeps only exact bytes", "needle", { $0.caseMode = .sensitive }, "plain.txt", ["1:1", "2:5", "4:1", "4:13", "4:27", "5:5"]),
            ("an uppercase letter turns smart case sensitive", "Needle", { _ in }, "plain.txt", ["3:1"]),
            ("whole word rejects letters, digits and underscores beside it", "needle", { $0.wholeWord = true }, "plain.txt",
             ["1:1", "2:5", "2:16", "3:1", "5:5"]),
            ("whole word accepts punctuation beside it", "id", { $0.wholeWord = true }, "words.txt", ["1:1", "1:21", "1:25", "1:32"]),
            ("ASCII folding covers every case pattern", "foo", { _ in }, "cases.txt", ["1:1", "1:5", "1:9", "1:13"]),
            ("overlapping candidates match left to right without overlap", "aa", { _ in }, "overlap.txt", ["1:1", "1:3"]),
            ("a rejected overlap does not hide the next", "aba", { _ in }, "overlap.txt", ["2:1"]),
            ("columns count UTF-16 units after an emoji", "needle", { _ in }, "emoji.txt", ["1:4", "1:13"]),
            ("a CRLF line keeps its column", "needle", { _ in }, "crlf.txt", ["2:5"]),
            ("a match at the first and the last byte", "needle", { _ in }, "edges.txt", ["1:1", "1:15"]),
            ("a line of one megabyte", "needle", { _ in }, "long.txt", ["1:500001", "2:1"]),
        ]
        for (name, text, configure, path, want) in cases {
            let got = places(await search(text, configure), in: path)
            expect(got == want, "literal: \(name)", got.joined(separator: " "))
        }
    }

    func caseFolding() async {
        let cases: [(String, String, (inout SearchQuery) -> Void, [String])] = [
            ("ß folds with ẞ but not with SS", "straße", { _ in }, ["1:1", "1:16"]),
            ("é folds with É, not with e", "école", { _ in }, ["2:1", "2:7", "2:13"]),
            ("final sigma folds with sigma and capital sigma", "σίσυφος", { _ in }, ["3:1", "3:9"]),
            ("an ASCII query folds ASCII only, so the Kelvin sign stays apart", "k", { _ in }, ["4:1", "4:10", "4:12"]),
            ("a non-ASCII query folds the Kelvin sign with k", "\u{212A}elvin", { $0.caseMode = .insensitive }, ["4:1"]),
        ]
        for (name, text, configure, want) in cases {
            let got = places(await search(text, configure), in: "unicode.txt")
            expect(got == want, "folding: \(name)", got.joined(separator: " "))
        }
        var mismatched: [String] = []
        var groups: [Unicode.Scalar: [Unicode.Scalar]] = [:]
        for value in UInt32(0)...0x10FFFF {
            guard let scalar = Unicode.Scalar(value) else { continue }
            groups[CaseFolding.key(scalar), default: []].append(scalar)
        }
        var checked = 0
        for group in groups.values where group.count > 1 {
            for scalar in group {
                checked += 1
                let found = CaseFolding.equivalents(scalar)
                if found != group.sorted(by: { $0.value < $1.value }) {
                    mismatched.append(String(format: "U+%04X", scalar.value))
                }
            }
        }
        expect(mismatched.isEmpty, "folding: every one of \(checked) cased scalars finds its whole class",
               mismatched.prefix(12).joined(separator: " "))
    }

    func regexes() async {
        let cases: [(String, String, (inout SearchQuery) -> Void, String, [String])] = [
            ("a quantified literal", "ne+dle", { _ in }, "plain.txt", ["1:1", "2:5", "2:16", "3:1", "4:1", "4:13", "4:27", "5:5"]),
            ("capture groups", "(\\w+)@(\\w+)", { _ in }, "mail.txt", ["1:1", "1:15", "3:1"]),
            ("digits", "\\d+", { _ in }, "words.txt", ["1:18"]),
            ("line anchors", "^needle", { _ in }, "plain.txt", ["1:1", "3:1", "4:1"]),
            ("end anchors", "needle$", { _ in }, "plain.txt", ["2:16", "3:1", "4:27", "5:5"]),
            ("whitespace never runs across a line break", "\\s+", { _ in }, "ws.txt", ["1:2", "2:1"]),
            ("whole word wraps the pattern", "i[a-z]", { $0.wholeWord = true }, "words.txt", ["1:1", "1:21", "1:25", "1:32"]),
            ("smart case reads the literal letters", "Needle", { _ in }, "plain.txt", ["3:1"]),
            ("a pattern with \\n spans lines", "two needle\\r?\\nthree", { _ in }, "crlf.txt", ["2:1"]),
        ]
        for (name, text, configure, path, want) in cases {
            let got = places(await search(text, { $0.isRegex = true; configure(&$0) }), in: path)
            expect(got == want, "regex: \(name)", got.joined(separator: " "))
        }
        let spanning = await search("two needle\\r?\\nthree", { $0.isRegex = true })
        let ends = (0..<spanning.results.matchCount).map { "\(spanning.results.matchEndLine[$0] + 1):\(spanning.results.matchEndColumn[$0] + 1)" }
        expect(ends == ["3:6"], "regex: a spanning match ends on the next line", ends.joined(separator: " "))
        let required: [(String, String?)] = [
            ("ne+dle", "dle"), ("foo(bar)?bazz", "bazz"), ("a|b", nil), ("\\bWidget\\w*", "Widget"), ("x?yz", "yz"), ("[abc]def", "def"),
            ("(?i)abc", nil), ("a\\.b", "a.b"),
        ]
        for (pattern, want) in required {
            let got = RegexLiteral.required(in: pattern)
            expect(got == want, "regex: the required literal of \(pattern) is \(want ?? "none")", got ?? "none")
        }
        let invalid = await search("(", { $0.isRegex = true })
        expect(!(invalid.error ?? "").isEmpty, "regex: an invalid pattern reports why", invalid.error ?? "")
    }

    func shapes() async {
        let outcome = await search("needle", { $0.caseMode = .sensitive })
        let results = outcome.results
        func slot(_ path: String, line: Int) -> String {
            guard let match = (0..<results.matchCount).first(where: {
                results.paths[Int(results.matchFile[$0])] == path && Int(results.matchLine[$0]) == line - 1
            }) else { return "(none)" }
            return results.text(ofSlot: Int(results.matchSlot[match]))
        }
        expect(slot("crlf.txt", line: 2) == "two needle", "shape: a CRLF line's text drops the carriage return", slot("crlf.txt", line: 2))
        expect(slot("plain.txt", line: 5) == "end needle", "shape: a last line with no newline keeps its text", slot("plain.txt", line: 5))
        let long = slot("long.txt", line: 1)
        expect(long.contains("needle") && long.utf8.count < 1_000, "shape: a long line keeps a window around the match",
               "\(long.utf8.count) bytes")
        let edges = (0..<results.matchCount).filter { results.paths[Int(results.matchFile[$0])] == "edges.txt" }
        expect(edges.map { results.matchBytes[$0] } == [0..<6, 14..<20], "shape: byte ranges reach the file's last byte",
               edges.map { "\(results.matchBytes[$0])" }.joined(separator: " "))
        let emoji = (0..<results.matchCount).filter { results.paths[Int(results.matchFile[$0])] == "emoji.txt" }
        expect(emoji.map { results.matchBytes[$0].lowerBound } == [5, 16], "shape: byte offsets differ from UTF-16 columns",
               emoji.map { "\(results.matchBytes[$0])" }.joined(separator: " "))
        let ranked = results.fileOrder.indices.sorted { results.fileOrder[$0] < results.fileOrder[$1] }.map { results.paths[$0] }
        expect(ranked == ranked.sorted { SearchFiles.precedes(Array($0.utf8)[...], Array($1.utf8)[...]) } && Set(results.fileOrder).count == results.fileCount,
               "shape: every file carries its rank in path order", ranked.joined(separator: " "))
        let batches = await search("e", { $0.caseMode = .sensitive })
        expect(batches.batches > 1, "shape: results stream in several batches", "\(batches.batches) batches")
    }

    func ignoreRules() {
        let listed = Set(SearchFiles.load(root: corpus, includingIgnored: false).paths)
        let ignored = ["x.log", "build/out.txt", "deep/build/z.txt", "sub/secret.txt", "sub/inner/drop.tmp"]
        let kept = ["keep.log", "sub/open.txt", "sub/inner/keep.tmp", "plain.txt", ".gitignore", "glob/node_modules/c.swift"]
        expect(ignored.allSatisfy { !listed.contains($0) }, "ignore: a pattern, a directory rule at any depth, a nested file and a nested glob",
               ignored.filter(listed.contains).joined(separator: " "))
        expect(kept.allSatisfy(listed.contains), "ignore: negation at the root and in a nested folder re-includes",
               kept.filter { !listed.contains($0) }.joined(separator: " "))
        let walked = SearchFiles.walk(root: corpus.standardizedFileURL.path, includingIgnored: false).map { String(decoding: $0, as: UTF8.self) }
        expect(Set(walked) == listed, "ignore: the walker for folders without git agrees with git",
               Set(walked).symmetricDifference(listed).sorted().joined(separator: " "))
        let everything = Set(SearchFiles.load(root: corpus, includingIgnored: true).paths)
        expect(ignored.allSatisfy(everything.contains), "ignore: including ignored files lists them",
               ignored.filter { !everything.contains($0) }.joined(separator: " "))
        let globs: [(String, String, Bool)] = [
            ("src/**/*.ts", "src/a/b/c.ts", true), ("src/**/*.ts", "src/c.ts", true), ("**/x", "a/b/x", true), ("a?c", "abc", true),
            ("a?c", "a/c", false), ("[a-c]x", "bx", true), ("[!a-c]x", "dx", true), ("[!a-c]x", "bx", false), ("foo/**", "foo/a/b", true),
            ("foo/**", "foo", false), ("\\*x", "*x", true), ("*.swift", "a.swift", true), ("*.swift", "a/b.swift", false),
        ]
        for (pattern, path, want) in globs {
            expect(Glob.matches(pattern, path) == want, "glob: \(pattern) \(want ? "matches" : "does not match") \(path)")
        }
    }

    func skipping() async {
        let outcome = await search("needle", { $0.caseMode = .sensitive })
        expect(!outcome.results.paths.contains("binary.dat") && outcome.summary.binaryFiles == 1,
               "skip: a NUL in the first block marks a file binary", "\(outcome.summary.binaryFiles) binary")
        let small = await search("needle", { $0.limits.fileBytes = 64 << 10 })
        expect(!small.results.paths.contains("big.txt") && !small.results.paths.contains("long.txt") && small.summary.largeFiles == 2,
               "skip: files over the size limit", "\(small.summary.largeFiles) large")
        let globbed: [(String, (inout SearchQuery) -> Void, [String])] = [
            ("an include glob matches names anywhere", { $0.include = ["*.swift"] }, ["glob/a.swift", "glob/node_modules/c.swift"]),
            ("an exclude names a folder at any depth", { $0.include = ["*.swift"]; $0.exclude = ["node_modules"] }, ["glob/a.swift"]),
            ("a folder scope", { $0.scope = .folder("glob") }, ["glob/a.swift", "glob/b.ts", "glob/node_modules/c.swift"]),
            ("a file scope", { $0.scope = .files(["sub/open.txt", "x.log"]) }, ["sub/open.txt", "x.log"]),
            ("ignored files on request", { $0.includesIgnored = true; $0.scope = .folder("build") }, ["build/out.txt"]),
        ]
        for (name, configure, want) in globbed {
            let got = await search("needle", configure).results.paths
            expect(got == want, "scope: \(name)", got.joined(separator: " "))
        }
    }

    func caps() async {
        let perFile = await search("dense", { $0.limits.matchesPerFile = 10 })
        expect(perFile.results.matchCount == 10 && perFile.results.fileTruncated == [true], "cap: per file, with the file marked",
               "\(perFile.results.matchCount) \(perFile.results.fileTruncated)")
        let overall = await search("needle", { $0.limits.matches = 5 })
        expect(overall.results.matchCount == 5 && overall.summary.ending == .capped, "cap: overall, ending as capped",
               "\(overall.results.matchCount) \(overall.summary.ending)")
        let total = await search("needle").results.matchCount
        let exact = await search("needle", { $0.limits.matches = total })
        let under = await search("needle", { $0.limits.matches = total - 1 })
        expect(exact.summary.ending == .complete && under.summary.ending == .capped,
               "cap: reaching the cap exactly is complete, one more is capped", "\(total) total, \(exact.summary.ending), \(under.summary.ending)")
        expect(Tally.results(10_000, files: 3, capped: true) == "More than 10,000 results in 3 files"
               && Tally.results(1, files: 1, capped: false) == "1 result in 1 file", "cap: the summary says more than N")
    }

    func unsavedBuffers() async {
        let outcome = await search("needle", unsaved: ["plain.txt": "nothing\nfresh needle here\n", "draft.txt": "needle"])
        expect(places(outcome, in: "plain.txt") == ["2:7"], "unsaved: a modified buffer replaces the disk text",
               places(outcome, in: "plain.txt").joined(separator: " "))
        expect(places(outcome, in: "draft.txt") == ["1:1"], "unsaved: a buffer not yet on disk is searched")
    }

    func cancellation() async {
        let engine = SearchEngine(root: repository)
        _ = engine.files(includingIgnored: true)
        var latencies: [Duration] = []
        for _ in 0..<5 {
            guard let run = try? engine.start(SearchQuery("zq9xQ7 never appears", includesIgnored: true)) else { continue }
            var cancelledAt: ContinuousClock.Instant?
            var ending = SearchSummary.Ending.complete
            for await event in run.events {
                switch event {
                case .batch:
                    if cancelledAt == nil {
                        cancelledAt = .now
                        run.cancel()
                    }
                case let .finished(summary):
                    ending = summary.ending
                    if let cancelledAt { latencies.append(.now - cancelledAt) }
                }
            }
            expect(ending == .cancelled, "cancel: the run ends as cancelled", "\(ending)")
        }
        let worst = latencies.max() ?? .seconds(1)
        #if DEBUG
        let bound = 20
        #else
        let bound = 10
        #endif
        expect(latencies.count == 5 && worst < .milliseconds(bound),
               "cancel: every worker stops within \(bound) ms of cancel (10 optimised, 20 unoptimised)", "worst \(worst), all \(latencies)")
    }
}
