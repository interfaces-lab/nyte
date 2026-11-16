import Foundation
@testable import NyteTerminal

extension TerminalCheck {
    func links() async {
        typealias Target = TerminalLinks.Target
        let cases: [(String, String, [(String, Target)])] = [
            ("Go compiler", "./hub/hub.go:42:7: undefined: upgrader",
             [("./hub/hub.go:42:7", .file(path: "./hub/hub.go", line: 42, column: 7))]),
            ("Go test failure", "    hub_test.go:31: expected 3, got 2",
             [("hub_test.go:31", .file(path: "hub_test.go", line: 31, column: nil))]),
            ("TypeScript, tsc", "src/hub.ts(38,5): error TS2304: Cannot find name 'x'.",
             [("src/hub.ts(38,5)", .file(path: "src/hub.ts", line: 38, column: 5))]),
            ("TypeScript, pretty", "src/hub.ts:38:5 - error TS2304: Cannot find name 'x'.",
             [("src/hub.ts:38:5", .file(path: "src/hub.ts", line: 38, column: 5))]),
            ("Swift compiler", "/Users/me/Sources/App/Main.swift:12:9: error: cannot find 'x' in scope",
             [("/Users/me/Sources/App/Main.swift:12:9", .file(path: "/Users/me/Sources/App/Main.swift", line: 12, column: 9))]),
            ("Rust compiler", "   --> src/main.rs:4:5", [("src/main.rs:4:5", .file(path: "src/main.rs", line: 4, column: 5))]),
            ("ripgrep hit", "Sources/NyteFiles/GitStatus.swift:12:    let changes",
             [("Sources/NyteFiles/GitStatus.swift:12", .file(path: "Sources/NyteFiles/GitStatus.swift", line: 12, column: nil))]),
            ("file:line", "see main.go:12 for the call", [("main.go:12", .file(path: "main.go", line: 12, column: nil))]),
            ("file(line,col)", "Program.cs(10,3): warning CS0168", [("Program.cs(10,3)", .file(path: "Program.cs", line: 10, column: 3))]),
            ("quoted path with spaces and a position", #"error in "My Folder/notes file.md":3:2"#,
             [(#""My Folder/notes file.md":3:2"#, .file(path: "My Folder/notes file.md", line: 3, column: 2))]),
            ("quoted path with spaces alone", "wrote 'build output/log.txt'",
             [("'build output/log.txt'", .file(path: "build output/log.txt", line: nil, column: nil))]),
            ("URL with trailing punctuation", "docs at https://example.com/a?b=1).",
             [("https://example.com/a?b=1", .url("https://example.com/a?b=1"))]),
            ("a URL is one link, not a path", "fetch https://example.com/main.go:12 now",
             [("https://example.com/main.go:12", .url("https://example.com/main.go:12"))]),
            ("version numbers are not paths", "version 1.2.3 and 10.5 are out", []),
        ]
        for (name, line, want) in cases {
            let units = Array(line.utf16)
            let got = TerminalLinks.detect(in: line).map { link in
                (String(decoding: units[link.range], as: UTF16.self), link.target)
            }
            let matches = got.count == want.count && zip(got, want).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
            expect(matches, "links: \(name)", got.map { "\($0.0) -> \($0.1)" }.joined(separator: "; "))
        }

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-links-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: folder.appendingPathComponent("hub"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        try? Data("package hub\n".utf8).write(to: folder.appendingPathComponent("hub/hub.go"))
        let resolved = TerminalLinks.resolve("./hub/hub.go", against: folder)
        let absolute = TerminalLinks.resolve("/etc/hosts", against: folder)
        expect(resolved == folder.appendingPathComponent("hub/hub.go").standardizedFileURL && absolute?.path == "/etc/hosts",
               "links: a relative path resolves against the reported directory, an absolute one stands alone",
               "\(String(describing: resolved)) \(String(describing: absolute))")
        var present = false
        if let resolved { present = await TerminalLinks.existingFile(at: resolved) }
        let missing = await TerminalLinks.existingFile(at: folder.appendingPathComponent("hub/gone.go"))
        let directory = await TerminalLinks.existingFile(at: folder.appendingPathComponent("hub"))
        expect(present && !missing && !directory, "links: only a file that exists is offered, not a missing file or a folder")
    }
}
