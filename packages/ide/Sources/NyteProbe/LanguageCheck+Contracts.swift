import Darwin
import Foundation
import NyteCore
@testable import NyteLanguage

extension LanguageCheck {
    static let snippetCases: [(name: String, snippet: String, text: String, stops: [[Int]])] = [
        ("escapes", #"a\$b\}c\\d$1"#, #"a$b}c\d"#, [[7, 0]]),
        ("choices", "${1|one,two,three|} end", "one end", [[0, 3]]),
        ("variables", "$TM_FILENAME x ${TM_SELECTED_TEXT:fallback} y ${UNKNOWN}", " x fallback y ", []),
        ("nested placeholders", "call(${1:first, ${2:second}})$0", "call(first, second)", [[5, 13], [12, 6], [19, 0]]),
    ]

    static let fakeServer = """
    #!/bin/sh
    log="$(dirname "$0")/../../wire.log"
    send() { printf 'Content-Length: %d\\r\\n\\r\\n%s' "${#1}" "$1"; }
    send '{"jsonrpc":"2.0","id":1,"result":{"capabilities":{"hoverProvider":true}}}'
    send '{"jsonrpc":"2.0","method":"$/progress","params":{"token":"index","value":{"kind":"begin","title":"Indexing","percentage":40}}}'
    send '{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"MAIN_URI","diagnostics":[{"range":{"start":{"line":2,"character":5},"end":{"line":2,"character":9}},"severity":2,"code":"probe","source":"fake","message":"main is lonely"},{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":7}},"severity":2,"message":"elsewhere"}]}}'
    send '{"jsonrpc":"2.0","id":"watch-1","method":"client/registerCapability","params":{"registrations":[{"id":"w1","method":"workspace/didChangeWatchedFiles","registerOptions":{"watchers":[{"globPattern":"**/*.{go,mod}"},{"globPattern":{"baseUri":"OUTSIDE_URI","pattern":"**/*.ts"},"kind":1}]}}]}}'
    send '{"jsonrpc":"2.0","id":"edit-1","method":"workspace/applyEdit","params":{"edit":{"documentChanges":[{"kind":"create","uri":"file:///tmp/nyte-created.go"}]}}}'
    exec cat > "$log"

    """

    static func contracts() async -> Int {
        let check = LanguageCheck(go, root: FileManager.default.temporaryDirectory.appendingPathComponent("nyte-lsp-fake-\(getpid())"))
        check.snippets()
        check.settingsCoding()
        await check.missing()
        await check.fakeServerContracts()
        return check.failures
    }

    func snippets() {
        for entry in Self.snippetCases {
            let snippet = Snippet(parsing: entry.snippet)
            let stops = snippet.stops.map { [$0.utf16Offset, $0.utf16Length] }
            expect(snippet.text == entry.text && stops == entry.stops, "snippet grammar: \(entry.name) in \(entry.snippet.debugDescription)",
                   "text \(snippet.text.debugDescription) stops \(stops)")
        }
    }

    func missing() async {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-lsp-home-\(getpid())")
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-lsp-missing-\(getpid())")
        defer {
            try? FileManager.default.removeItem(at: home)
            try? FileManager.default.removeItem(at: folder)
        }
        do {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try "package main\n".write(to: folder.appendingPathComponent("main.go"), atomically: true, encoding: .utf8)
        } catch {
            return expect(false, "gopls missing: set up an empty home", "\(error)")
        }
        let launch = ChildProcess.Launch(
            executable: URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL,
            arguments: ["lsp", "missing", folder.path, "main.go"],
            environment: ["HOME": home.path, "CFFIXED_USER_HOME": home.path, "PATH": "/usr/bin:/bin", "SHELL": "/bin/sh"]
        )
        let output = await ChildProcess.run(launch, timeout: .seconds(60))
        let said = output?.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? "the probe did not finish"
        let hint = ServerTable.goplsHint
        expect(said == String(describing: Optional(ServerStatus.State.missing(hint: hint))),
               "gopls a toolchain that cannot find the server reports missing with the install command", said)
    }

    func fakeServerContracts() async {
        let bin = root.appendingPathComponent("node_modules/.bin")
        let wire = root.appendingPathComponent("wire.log")
        let main = url("main.go")
        let outside = root.deletingLastPathComponent().appendingPathComponent("nyte-lsp-outside-\(getpid())")
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: outside)
        }
        do {
            try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
            try "module example.com/fake\n\ngo 1.22\n".write(to: url("go.mod"), atomically: true, encoding: .utf8)
            try "package main\n\nfunc main() {}\n".write(to: main, atomically: true, encoding: .utf8)
            try Self.fakeServer.replacingOccurrences(of: "MAIN_URI", with: Wire.uri(Wire.canonical(main)).string ?? "")
                .replacingOccurrences(of: "OUTSIDE_URI", with: Wire.uri(Wire.canonical(outside)).string ?? "")
                .write(to: bin.appendingPathComponent("gopls"), atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: bin.appendingPathComponent("gopls").path)
        } catch {
            return expect(false, "fake server: set up its workspace", "\(error)")
        }
        service.open(main, text: "package main\n\nfunc main() {}\n")

        let busy = ServerStatus.State.busy(title: "Indexing", percent: 40)
        let reported = await Patience.until(.seconds(20)) { self.service.status(for: main)?.state == busy }
        expect(reported, "fake server a $/progress begin report shows as busy with its title and percent",
               String(describing: service.status(for: main)?.state))

        let refusal = IntelligenceFailure.refusing(.create).message
        let answered = await Patience.until(.seconds(10)) {
            Self.messages(in: wire).contains { $0["id"]?.string == "edit-1" }
        }
        let reply = Self.messages(in: wire).first { $0["id"]?.string == "edit-1" }?["result"]
        expect(answered && reply?["applied"]?.bool == false && reply?["failureReason"]?.string == refusal && applied.isEmpty,
               "fake server a workspace edit that creates a file is refused with the named failure and never reaches the editor",
               "reply \(String(describing: reply)), edits routed \(applied.count)")

        await watchedPatterns(wire: wire, outside: outside)

        let asking = Task { await self.service.hover(at: TextPosition(line: 2, column: 5), in: main) }
        let sent = await Patience.until(.seconds(10)) {
            Self.messages(in: wire).contains { $0["method"]?.string == ClientFeature.hover.method }
        }
        asking.cancel()
        let hover = await asking.value
        let hoverID = Self.messages(in: wire).first { $0["method"]?.string == ClientFeature.hover.method }?["id"]?.int
        let cancelled = await Patience.until(.seconds(10)) {
            Self.messages(in: wire).contains { $0["method"]?.string == "$/cancelRequest" && $0["params"]?["id"]?.int == hoverID }
        }
        expect(sent && hover == nil && hoverID != nil && cancelled,
               "fake server cancelling the Swift task of a hover sends $/cancelRequest with its id",
               "sent \(sent), hover \(String(describing: hover)), id \(String(describing: hoverID)), cancel sent \(cancelled)")

        _ = await Patience.until(.seconds(10)) { !self.service.diagnostics(for: main).isEmpty }
        let acting = Task { await self.service.actions(in: TextSpan(start: .init(line: 2, column: 0), end: .init(line: 2, column: 14)), of: main) }
        let asked = await Patience.until(.seconds(10)) {
            Self.messages(in: wire).contains { $0["method"]?.string == ClientFeature.codeAction.method }
        }
        acting.cancel()
        _ = await acting.value
        let context = Self.messages(in: wire).first { $0["method"]?.string == ClientFeature.codeAction.method }?["params"]?["context"]
        let carried = context?["diagnostics"]?.array ?? []
        expect(asked && carried.count == 1 && carried.first?["message"]?.string == "main is lonely" && carried.first?["code"]?.string == "probe"
            && context?["only"] == nil,
            "fake server a code action request carries the diagnostics overlapping its range, with their codes, and no only filter",
            "context \(String(describing: context))")

        await service.shutdown()
        let gone = await Patience.until(.seconds(10)) { Probe.descendants(of: getpid()).isEmpty }
        expect(gone, "fake server shutdown leaves no child process", Probe.descendants(of: getpid()).map(\.command).joined(separator: ", "))
    }

    private func watchedPatterns(wire: URL, outside: URL) async {
        let watching = await Patience.until(.seconds(10)) { !self.service.externalRoots.isEmpty }
        let reported = { () -> [String] in
            Self.messages(in: wire).filter { $0["method"]?.string == ClientFeature.didChangeWatchedFiles.method }
                .flatMap { $0["params"]?["changes"]?.array ?? [] }.compactMap { $0["uri"]?.string.flatMap(URL.init(string:))?.lastPathComponent }
        }
        let go = url("extra.go")
        let text = url("notes.txt")
        try? "package main\n".write(to: go, atomically: true, encoding: .utf8)
        try? "notes\n".write(to: text, atomically: true, encoding: .utf8)
        service.filesDidChange([go, text])
        let matched = await Patience.until(.seconds(5)) { reported().contains("extra.go") }
        expect(matched && !reported().contains("notes.txt"),
               "fake server a change is sent only when it matches a registered watcher's glob", reported().joined(separator: ", "))
        try? "export {}\n".write(to: outside.appendingPathComponent("far.ts"), atomically: true, encoding: .utf8)
        try? "x\n".write(to: outside.appendingPathComponent("far.js"), atomically: true, encoding: .utf8)
        let external = await Patience.until(.seconds(10)) { reported().contains("far.ts") }
        _ = await Patience.pause(.milliseconds(500))
        let lowered = FileWatcher(["globPattern": .string(root.path.lowercased() + "/**/*.go")])
        expect(!FileWatcher.ignoresCase || lowered?.matches(url("extra.go"), kind: .changed) == true,
               "fake server a watcher whose pattern the server lower-cased still matches on a case-insensitive volume",
               "\(root.path.lowercased())/**/*.go against \(url("extra.go").path)")
        expect(watching && external && !reported().contains("far.js"),
               "fake server a watcher registered on a folder outside the workspace is watched, and only its pattern is sent",
               "watching \(service.externalRoots), sent \(reported().joined(separator: ", "))")
    }

    static func messages(in log: URL) -> [JSON] {
        guard let data = try? Data(contentsOf: log) else { return [] }
        var framer = MessageFramer()
        return framer.append(data).compactMap { JSON.parse($0) }
    }
}
