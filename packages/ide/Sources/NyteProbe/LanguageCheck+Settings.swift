import Foundation
import NyteCore
@testable import NyteLanguage
import NyteUI

extension LanguageCheck {
    func settingsFlip() async {
        let file = url(fixture.annotated)
        let lines = Probe.lines((try? String(contentsOf: file, encoding: .utf8)) ?? "").count
        let everything = TextSpan(start: .init(line: 0, column: 0), end: .init(line: lines, column: 0))
        let typeHints = { () async -> Int in await self.service.inlayHints(in: everything, of: file).filter { $0.kind == .type }.count }
        let before = await typeHints()
        let go = fixture.server == "gopls"
        if go { service.settings.go.inlayHints.assignVariableTypes = true } else { service.settings.typeScript.inlayHints.variableTypes = true }
        var after = await typeHints()
        let deadline = ContinuousClock.now + .seconds(15)
        while after <= before, ContinuousClock.now < deadline, await Patience.pause(.milliseconds(200)) { after = await typeHints() }
        if go { service.settings.go.inlayHints.assignVariableTypes = false } else { service.settings.typeScript.inlayHints.variableTypes = false }
        var restored = await typeHints()
        let back = ContinuousClock.now + .seconds(15)
        while restored != before, ContinuousClock.now < back, await Patience.pause(.milliseconds(200)) { restored = await typeHints() }
        let switchName = go ? "assignVariableTypes" : "variableTypes"
        expect(after > before && restored == before && service.status(for: file)?.state == .ready,
               "\(fixture.server) flipping the \(switchName) inlay switch at runtime changes the hints without reopening the file, and back",
               "type hints \(before) → \(after) → \(restored)")
    }

    func settingsCoding() {
        var changed = LanguageSettings()
        changed.go.countsUsages = true
        changed.go.serverPath = "/opt/gopls"
        changed.typeScript.server = .tsserver
        changed.typeScript.inlayHints.parameterNames = .all
        let roundTrip = (try? JSONEncoder().encode(changed)).map(LanguageSettings.decoded(from:))
        let partial = LanguageSettings.decoded(from: Data(#"{"version":0,"go":{"countsUsages":true,"retired":1},"typeScript":{"languageServerPath":"/x"}}"#.utf8))
        let garbage = LanguageSettings.decoded(from: Data("not json".utf8))
        expect(roundTrip == changed && partial.go.countsUsages && partial.typeScript.languageServerPath == "/x"
            && partial.go.inlayHints == LanguageSettings.GoInlayHints() && partial.version == LanguageSettings.currentVersion
            && garbage == LanguageSettings(),
            "settings decode: a round trip keeps every field, missing fields take defaults, unknown ones are dropped, garbage falls back",
            "round trip \(roundTrip == changed), partial \(partial), garbage default \(garbage == LanguageSettings())")
    }

    static let colouredSource = "package p\n\nvar text = `first\ninside raw string`\n\n/* comment start\nstill comment */\nfunc F() {}\n"

    static func findColours() async -> Int {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-lsp-colours-\(getpid())")
        defer { try? FileManager.default.removeItem(at: folder) }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("p.go")
        try? colouredSource.write(to: file, atomically: true, encoding: .utf8)
        let check = LanguageCheck(go, root: folder)
        let arena = await LineArena.read([(url: file, requests: [LineRequest(line: 3, column: 0), LineRequest(line: 6, column: 0),
                                                  LineRequest(line: 7, column: 0)])])
        let kinds = (0..<3).map { Set(arena.colors($0).map(\.color)) }
        let whole = (0..<2).allSatisfy { index in arena.colors(index).first.map { $0.range == NSRange(location: 0, length: Int(arena.lengths[index])) } ?? false }
        check.expect(kinds[0] == [.string] && kinds[1] == [.comment] && kinds[2].contains(.keyword) && whole,
                     "Find colours a result line that starts inside a raw string or a block comment from the state carried from the top of the file",
                     "\(kinds)")
        let line = "type Counts struct {"
        let preview = FindResultsViewController.preview(
            of: line, column: 0, edits: [TextEdit(range: TextSpan(start: .init(line: 0, column: 5), end: .init(line: 0, column: 11)), text: "Totals")]
        )
        let tokens = CodeColors.ranges(in: line, language: "go").map { Token.pack($0.range.location, $0.range.length, $0.color) }
        let moved = LineColors.moved(tokens, through: preview.kept).map { (Token.range($0), Token.kind($0)) }
        let structAt = (preview.text as NSString).range(of: "struct")
        check.expect(moved.contains { $0.0 == structAt && $0.1 == .keyword } && moved.contains { $0.0 == NSRange(location: 0, length: 4) },
                     "Find's preview line keeps each source token's colour where the edit moved it",
                     "\(preview.text.debugDescription) \(moved)")
        return check.failures
    }
}
