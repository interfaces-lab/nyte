import Darwin
import Foundation
import NyteCore
@testable import NyteLanguage

extension LanguageCheck {
    static var native: Fixture {
        var fixture = typescript
        fixture.server = "TypeScript"
        fixture.problems[1].severity = .warning
        fixture.action = ("src/index.ts:31:16", "import from \"./stats.ts\"")
        fixture.actionSetup = ("src/index.ts", 30, "const fresh = emptyStats();")
        return fixture
    }

    static func fixtureCopy(_ folder: String, named name: String) -> URL? {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../Fixtures/\(folder)")
            .standardizedFileURL
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(getpid())").standardizedFileURL
        try? FileManager.default.removeItem(at: copy)
        guard (try? FileManager.default.copyItem(at: source, to: copy)) != nil else { return nil }
        return URL(fileURLWithPath: copy.resolvingSymlinksInPath().path)
    }

    static func nativeTypeScript() async -> Int {
        guard let copy = fixtureCopy("notifyhub-ts", named: "nyte-ts-native") else {
            print("FAIL TypeScript native: copy the fixture outside any node_modules")
            return 1
        }
        defer { try? FileManager.default.removeItem(at: copy) }
        let check = LanguageCheck(native, root: copy)
        await check.nativeServerChoice()
        _ = await check.run()
        return check.failures
    }

    private func nativeServerChoice() async {
        let index = url(fixture.annotated)
        service.open(index, text: (try? String(contentsOf: index, encoding: .utf8)) ?? "")
        _ = await Patience.until(.seconds(60)) { self.service.status(for: index)?.state == .ready }
        let status = service.status(for: index)
        let managed = TypeScriptPackage.managed()
        expect(status?.name == "TypeScript" && status?.version.hasPrefix("TypeScript \(managed?.version ?? "?")") == true
            && status?.location?.lastPathComponent == "tsc",
            "TypeScript a project without its own node_modules runs the managed TypeScript \(managed?.version ?? "?") native server",
            "\(status?.name ?? "nil") \(status?.version ?? "") at \(status?.location?.path ?? "nil")")
        let tree = Probe.descendants(of: getpid())
        expect(!tree.isEmpty && !tree.contains { $0.command.hasSuffix("/node") || $0.command == "node" },
               "TypeScript the native path starts no Node process", tree.map(\.command).joined(separator: ", "))
        let lines = Probe.lines((try? String(contentsOf: index, encoding: .utf8)) ?? "")
        let hints = await service.inlayHints(
            in: TextSpan(start: .init(line: 0, column: 0), end: .init(line: lines.count, column: 0)), of: index
        )
        let literal = hints.contains { $0.kind == .parameter && $0.position.line == 6 && $0.label.hasPrefix("address") }
        let variable = hints.contains { $0.kind == .type && $0.position.line == 5 }
        expect(literal && !variable, "TypeScript the native server reads our inlay settings: names for literal arguments, no variable types",
               hints.prefix(6).map { "\(Probe.show(TextSpan(at: $0.position))) \($0.kind) \($0.label)" }.joined(separator: "; "))
        let samples = await service.sampleMemory()
        let resident = samples.first { $0.name == "TypeScript" }?.residentBytes ?? 0
        expect(resident > 0, "TypeScript status reports the server's resident memory", "\(resident) bytes")
        let before = Probe.descendants(of: getpid()).map(\.pid)
        if let id = status?.id { await service.restart(id) }
        let after = Probe.descendants(of: getpid()).map(\.pid)
        let back = service.status(for: index)?.state == .ready
        let hover = await service.hover(at: place(fixture.hover.at).1, in: url("src/index.ts"))
        expect(back && !after.isEmpty && Set(after).isDisjoint(with: before) && hover != nil,
               "TypeScript Restart stops the server and starts a new one that answers", "before \(before), after \(after), ready \(back)")
        service.close(index)
    }
}
