import AppKit
import Foundation
@testable import NyteCore

@MainActor func runChangesProbe(_ arguments: [String]) async {
    switch arguments.first {
    case "check":
        let check = ChangesCheck()
        await check.run()
        print(check.failures == 0 ? "changes check: all \(check.passes) passed"
            : "changes check: \(check.failures) failed, \(check.passes) passed")
        exit(check.failures == 0 ? 0 : 1)
    case "bench":
        ChangesCheck.bench()
        exit(0)
    default:
        fail("usage: NyteProbe changes check | bench")
    }
}

struct SeededRandom: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

@MainActor final class ChangesCheck {
    var failures = 0, passes = 0
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-changes-\(getpid())", isDirectory: true)
    static let repository = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().appendingPathComponent("../../../..")
        .standardizedFileURL
    static let isolated: [String: String] = {
        var environment = ProcessInfo.processInfo.environment
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
        environment["GIT_AUTHOR_NAME"] = "Probe"
        environment["GIT_AUTHOR_EMAIL"] = "probe@nyte.sh"
        environment["GIT_COMMITTER_NAME"] = "Probe"
        environment["GIT_COMMITTER_EMAIL"] = "probe@nyte.sh"
        return environment
    }()

    func expect(_ label: String, _ condition: Bool, _ got: @autoclosure () -> String = "") {
        if condition { passes += 1; return print("ok   \(label)") }
        failures += 1
        let detail = got()
        print("FAIL \(label)" + (detail.isEmpty ? "" : "\n     got: \(detail)"))
    }

    func run() async {
        setvbuf(stdout, nil, _IOLBF, 0)
        try? FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        await diffEdges()
        await diffCorpus()
        spans()
        await statusStates()
        await writes()
        await lineWrites()
        await interface()
    }

    @discardableResult
    func shell(_ arguments: [String], in folder: URL, input: Data? = nil) async -> ChildProcess.Output {
        let launch = ChildProcess.Launch(executable: GitRepository.systemGit, arguments: arguments, environment: Self.isolated,
                                         directory: folder)
        return await ChildProcess.run(launch, input: input) ?? ChildProcess.Output(status: -1, output: Data(), diagnostics: Data())
    }

    func gitHunks(_ old: [UInt8], _ new: [UInt8], name: String) async -> [DiffHunk]? {
        let left = scratch.appendingPathComponent(name + ".a"), right = scratch.appendingPathComponent(name + ".b")
        try? Data(old).write(to: left)
        try? Data(new).write(to: right)
        let result = await shell(["diff", "--no-index", "--no-color", "-U0", "--minimal", "--no-indent-heuristic",
                                  "--diff-algorithm=myers", "--text", left.path, right.path], in: scratch)
        guard result.status == 0 || result.status == 1 else { return nil }
        return Self.hunks(fromPatch: result.text)
    }

    static func hunks(fromPatch text: String) -> [DiffHunk] {
        text.split(separator: "\n").filter { $0.hasPrefix("@@ ") }.compactMap { header in
            let parts = header.split(separator: " ")
            guard parts.count >= 3 else { return nil }
            func range(_ field: Substring) -> Range<Int> {
                let numbers = field.dropFirst().split(separator: ",").compactMap { Int($0) }
                let start = numbers.first ?? 0, count = numbers.count > 1 ? numbers[1] : 1
                let first = count == 0 ? start : start - 1
                return first..<first + count
            }
            return DiffHunk(old: range(parts[1]), new: range(parts[2]))
        }
    }

    func diffEdges() async {
        let cases: [(String, String, String)] = [
            ("empty to text", "", "one\ntwo\n"),
            ("text to empty", "one\ntwo\n", ""),
            ("both empty", "", ""),
            ("trailing newline added", "one\ntwo", "one\ntwo\n"),
            ("trailing newline removed", "one\ntwo\n", "one\ntwo"),
            ("no trailing newline, last line edited", "a\nb\nc", "a\nb\nC"),
            ("CRLF lines", "one\r\ntwo\r\nthree\r\n", "one\r\nTWO\r\nthree\r\n"),
            ("CRLF to LF", "one\r\ntwo\r\n", "one\ntwo\n"),
            ("one long line", String(repeating: "word ", count: 5_000), String(repeating: "word ", count: 4_999) + "sentence "),
            ("duplicate braces", "a\n}\n}\nb\n", "a\n}\n}\n}\nb\n"),
            ("block moved", "1\n2\n3\n4\n5\n6\n", "4\n5\n6\n1\n2\n3\n"),
        ]
        for (name, old, new) in cases {
            let ours = Diff(from: old, to: new, effort: .minimal)
            let theirs = await gitHunks(Array(old.utf8), Array(new.utf8), name: "edge")
            expect("diff \(name): hunks equal git's", ours.hunks == theirs, "\(ours.hunks) vs \(theirs.map(\.description) ?? "nil")")
            let rebuilt = DiffSelection(hunks: ours.hunks).apply(from: TextLines(old), toward: TextLines(new), hunks: ours.hunks)
            expect("diff \(name): applying every hunk rebuilds the new text", rebuilt == Array(new.utf8))
        }
        let binary: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 13, 10]
        expect("diff binary: a NUL in the first 8,000 bytes reads as binary", TextLines(bytes: binary).isBinary
            && !TextLines("plain\n").isBinary)
    }

    func diffCorpus() async {
        let sources = Self.corpusFiles()
        var random = SeededRandom(state: 0x5EED)
        var matched = 0, total = 0, rebuilt = 0, minimal = 0
        var mismatches: [String] = []
        for (index, url) in sources.enumerated() {
            guard let data = try? Data(contentsOf: url) else { continue }
            let old = [UInt8](data)
            let new = Self.edit(old, random: &random)
            let ours = Diff(from: TextLines(bytes: old), to: TextLines(bytes: new), effort: .minimal)
            guard let theirs = await gitHunks(old, new, name: "corpus\(index % 4)") else { continue }
            total += 1
            let trimmed = Self.trimCommonTail(old, new)
            let sameInput = Diff(from: TextLines(bytes: trimmed.old), to: TextLines(bytes: trimmed.new), effort: .minimal)
            if sameInput.hunks == theirs { matched += 1 } else if mismatches.count < 3 { mismatches.append(url.lastPathComponent) }
            let size = { (hunks: [DiffHunk]) in hunks.reduce(0) { $0 + $1.old.count + $1.new.count } }
            if size(ours.hunks) == size(theirs) { minimal += 1 }
            let result = DiffSelection(hunks: ours.hunks).apply(from: TextLines(bytes: old), toward: TextLines(bytes: new),
                                                                hunks: ours.hunks)
            if result == new { rebuilt += 1 }
        }
        expect("diff corpus: \(total) randomly edited source files from this repository", total >= 150, "\(total)")
        expect("diff corpus: every diff rebuilds the edited file (\(rebuilt)/\(total))", rebuilt == total)
        expect("diff corpus: as few changed lines as git --minimal on every file (\(minimal)/\(total))", minimal == total)
        expect("diff corpus: hunks identical to git's on \(matched)/\(total), given the tail git trims under -U0", matched == total, mismatches.joined(separator: ", "))
    }

    static let tailBlock = 1_024

    // git: with no context lines xdi_diff first drops the common tail in 1,024-byte blocks (trim_common_tail), so -U0 runs see shorter files
    static func trimCommonTail(_ old: [UInt8], _ new: [UInt8]) -> (old: [UInt8], new: [UInt8]) {
        var trimmed = 0
        let smaller = min(old.count, new.count)
        while tailBlock + trimmed <= smaller,
              old[(old.count - trimmed - tailBlock)..<(old.count - trimmed)] == new[(new.count - trimmed - tailBlock)..<(new.count - trimmed)] {
            trimmed += tailBlock
        }
        var recovered = 0
        while recovered < trimmed {
            recovered += 1
            if old[old.count - trimmed + recovered - 1] == UInt8(ascii: "\n") { break }
        }
        return (Array(old.prefix(old.count - trimmed + recovered)), Array(new.prefix(new.count - trimmed + recovered)))
    }

    static func corpusFiles() -> [URL] {
        let roots = ["packages/ide/Sources", "packages/core/src", "packages/host/src", "packages/app/src"]
        var found: [URL] = []
        for root in roots {
            let folder = repository.appendingPathComponent(root)
            let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.fileSizeKey])
            while let url = walker?.nextObject() as? URL {
                guard ["swift", "ts", "tsx", "go"].contains(url.pathExtension), !url.path.contains("node_modules") else { continue }
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size > 200, size < 120_000 { found.append(url) }
            }
        }
        found.sort { $0.path < $1.path }
        return stride(from: 0, to: found.count, by: max(1, found.count / 200)).map { found[$0] }
    }

    static func edit(_ bytes: [UInt8], random: inout SeededRandom) -> [UInt8] {
        var lines = TextLines(bytes: bytes)
        var pieces = (0..<lines.count).map { Array(lines.bytes[lines.range(of: $0)]) }
        let edits = Int.random(in: 1...8, using: &random)
        for _ in 0..<edits {
            guard !pieces.isEmpty else { pieces.append(Array("new\n".utf8)); continue }
            let at = Int.random(in: 0..<pieces.count, using: &random)
            switch Int.random(in: 0..<6, using: &random) {
            case 0: pieces.removeSubrange(at..<min(pieces.count, at + Int.random(in: 1...5, using: &random)))
            case 1:
                let from = Int.random(in: 0..<pieces.count, using: &random)
                let block = Array(pieces[from..<min(pieces.count, from + Int.random(in: 1...4, using: &random))])
                pieces.insert(contentsOf: block, at: at)
            case 2:
                var line = pieces[at]
                if let space = line.firstIndex(of: UInt8(ascii: " ")) { line.insert(contentsOf: Array("renamed".utf8), at: space) }
                pieces[at] = line
            case 3: pieces.insert(Array("\n".utf8), at: at)
            case 4: pieces.insert(Array("}\n".utf8), at: at)
            default: pieces[at] = Array("    let replaced = \(Int.random(in: 0..<1000, using: &random))\n".utf8)
            }
        }
        lines = TextLines(bytes: pieces.flatMap { $0 })
        return lines.bytes
    }

    func spans() {
        func show(_ line: String, _ ranges: [Range<Int>]) -> [String] {
            let bytes = Array(line.utf8)
            return ranges.map { String(decoding: bytes[$0], as: UTF8.self) }
        }
        let cases: [(String, String, [String]?, [String]?)] = [
            ("one word", "return hub.send(message)", ["send"], ["broadcast"]),
            ("punctuation", "if (a, b) {", [], [", c"]),
            ("unrelated lines", "func main() {", nil, nil),
        ]
        let news = ["return hub.broadcast(message)", "if (a, b, c) {", "import { serve } from 'bun'"]
        for (index, (name, old, removed, added)) in cases.enumerated() {
            let found = Diff.spans(ArraySlice(Array(old.utf8)), ArraySlice(Array(news[index].utf8)))
            let got = found.map { (show(old, $0.removed), show(news[index], $0.added)) }
            let same = got?.0 == removed && got?.1 == added
            expect("spans \(name): changed tokens are \(removed ?? []) and \(added ?? [])", removed == nil ? found == nil : same,
                   "\(String(describing: got))")
        }
        let accents = Diff.spans(ArraySlice(Array("let café = 1".utf8)), ArraySlice(Array("let thé = 1".utf8)))
        expect("spans non-ASCII: a multi-byte word changes as one token",
               accents.map { show("let café = 1", $0.removed) } == ["café"], "\(String(describing: accents))")
    }
}

extension DiffHunk: CustomStringConvertible {
    public var description: String { "\(old.lowerBound)..<\(old.upperBound)→\(new.lowerBound)..<\(new.upperBound)" }
}
