import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

@MainActor func runEditorProbe(_ arguments: [String]) async {
    _ = NSApplication.shared
    switch arguments.first {
    case "check" where arguments.dropFirst().first == "engine":
        let failures = await EditorCheck().runEngine()
        print(failures == 0 ? "editor check engine: all passed" : "editor check engine: \(failures) failed")
        exit(failures == 0 ? 0 : 1)
    case "check":
        let failures = await EditorCheck().run()
        print(failures == 0 ? "editor check: all passed" : "editor check: \(failures) failed")
        exit(failures == 0 ? 0 : 1)
    case "bench" where arguments.dropFirst().first == "buffer":
        EditorBench.bufferChoice(lines: arguments.dropFirst(2).compactMap { Int($0) }.first ?? 500_000)
    case "bench" where arguments.dropFirst().first == "memory": await EditorBench.memory()
    case "bench" where arguments.dropFirst().first == "tabs":
        await EditorBench.tabSwitch(lines: arguments.dropFirst(2).compactMap { Int($0) }.first ?? 500_000)
    case "geometry" where arguments.dropFirst().first == "engine": await EditorBench.engineGeometry()
    case "geometry": await EditorBench.geometry()
    case "bench" where arguments.dropFirst().first == "engine":
        await EditorBench.runEngine(sizes: arguments.dropFirst(2).compactMap { Int($0) })
    case "bench": await EditorBench.run(sizes: arguments.dropFirst().compactMap { Int($0) })
    default: fail("usage: NyteProbe editor <check|bench|geometry> [engine|buffer|tabs] [lines ...]")
    }
}

final class OffscreenWindow: NSWindow { override var isKeyWindow: Bool { true } }

@MainActor final class QuietIntelligence: LanguageIntelligence {
    var onEvent: ((IntelligenceEvent) -> Void)?
    var applyEdit: ((WorkspaceEdit) async -> Bool)?
    var changes = 0
    var completionRequests = 0
    var signatureRequests = 0
    var occurrences: [TextSpan] = []

    func handles(_ url: URL) -> Bool { true }
    func status(for url: URL) -> ServerStatus? { ServerStatus(name: "quiet", state: .ready) }
    func triggers(for url: URL) -> (completion: Set<String>, signature: Set<String>) { (["."], ["(", ","]) }
    func open(_ url: URL, text: String) {}
    func change(_ url: URL, range: TextSpan, text: String) { changes += 1 }
    func save(_ url: URL) {}
    func close(_ url: URL) {}
    func filesDidChange(_ urls: [URL]) {}
    func diagnostics(for url: URL) -> [Diagnostic] { [] }
    var filesWithDiagnostics: [URL] { [] }
    func completions(at position: TextPosition, in url: URL, trigger: CompletionTrigger) async -> CompletionList {
        defer { completionRequests += 1 }
        return CompletionList(items: [])
    }
    func resolve(_ item: CompletionItem) async -> CompletionItem { item }
    func hover(at position: TextPosition, in url: URL) async -> Hover? { nil }
    func signatureHelp(at position: TextPosition, in url: URL) async -> SignatureHelp? { signatureRequests += 1; return nil }
    func locations(_ query: LocationQuery, at position: TextPosition, in url: URL) async -> [FileLocation] { [] }
    func highlights(at position: TextPosition, in url: URL) async -> [TextSpan] { occurrences }
    func symbols(in url: URL) async -> [DocumentSymbol] { [] }
    func symbols(matching query: String) async -> [WorkspaceSymbol] { [] }
    func inlayHints(in range: TextSpan, of url: URL) async -> [InlayHint] { [] }
    func semanticTokens(for url: URL) async -> SemanticTokens? { nil }
    func renameTarget(at position: TextPosition, in url: URL) async -> RenameTarget? { occurrences.first.map { RenameTarget(range: $0, placeholder: "") } }
    func rename(at position: TextPosition, in url: URL, to name: String) async -> Result<WorkspaceEdit, IntelligenceFailure> {
        guard !occurrences.isEmpty else { return .failure(IntelligenceFailure("quiet")) }
        return .success(WorkspaceEdit(files: [WorkspaceEdit.File(url: url, edits: occurrences.map { TextEdit(range: $0, text: name) })]))
    }
    func actions(in range: TextSpan, of url: URL) async -> [CodeAction] { [] }
    func perform(_ action: CodeAction) async -> Result<Void, IntelligenceFailure> { .success(()) }
    func formatting(for url: URL, indent: Int, usesTabs: Bool) async -> [TextEdit] { [] }
}

struct Xorshift {
    var state: UInt64

    mutating func next(_ bound: Int) -> Int {
        state = state ^ state << 13
        state = state ^ state >> 7
        state = state ^ state << 17
        return bound <= 0 ? 0 : Int(state % UInt64(bound))
    }
}

@MainActor final class RecordingFeature: EditorFeature {
    var typed: [String] = []
    func didType(_ text: String) { typed.append(text) }
}

