import AppKit
import NyteCore

@MainActor
final class FakeIntelligence: LanguageIntelligence {
    var onEvent: ((IntelligenceEvent) -> Void)?
    var applyEdit: ((WorkspaceEdit) async -> Bool)?

    var problems: [URL: [Diagnostic]] = [:]
    var outline: [DocumentSymbol] = []
    var serverStatus: ServerStatus?
    var handledExtensions: Set<String> = ["go", "ts"]
    private(set) var diagnosticsReads = 0

    func handles(_ url: URL) -> Bool { handledExtensions.contains(url.pathExtension) }
    func status(for url: URL) -> ServerStatus? { handles(url) ? serverStatus : nil }
    func triggers(for url: URL) -> (completion: Set<String>, signature: Set<String>) { ([], []) }

    func open(_ url: URL, text: String) {}
    func change(_ url: URL, range: TextSpan, text: String) {}
    func save(_ url: URL) {}
    func close(_ url: URL) {}
    func filesDidChange(_ urls: [URL]) {}

    func diagnostics(for url: URL) -> [Diagnostic] {
        diagnosticsReads += 1
        return problems[url] ?? []
    }

    var filesWithDiagnostics: [URL] { problems.filter { !$0.value.isEmpty }.keys.sorted { $0.path < $1.path } }

    func completions(at position: TextPosition, in url: URL, trigger: CompletionTrigger) async -> CompletionList { CompletionList() }
    func resolve(_ item: CompletionItem) async -> CompletionItem { item }
    func hover(at position: TextPosition, in url: URL) async -> Hover? { nil }
    func signatureHelp(at position: TextPosition, in url: URL) async -> SignatureHelp? { nil }
    func locations(_ query: LocationQuery, at position: TextPosition, in url: URL) async -> [FileLocation] { [] }
    func highlights(at position: TextPosition, in url: URL) async -> [TextSpan] { [] }
    func symbols(in url: URL) async -> [DocumentSymbol] { outline }
    func symbols(matching query: String) async -> [WorkspaceSymbol] { [] }
    func inlayHints(in range: TextSpan, of url: URL) async -> [InlayHint] { [] }
    func semanticTokens(for url: URL) async -> SemanticTokens? { nil }
    func renameTarget(at position: TextPosition, in url: URL) async -> RenameTarget? { nil }
    func rename(at position: TextPosition, in url: URL, to name: String) async -> Result<WorkspaceEdit, IntelligenceFailure> {
        .failure(IntelligenceFailure("No rename here."))
    }
    func actions(in range: TextSpan, of url: URL) async -> [CodeAction] { [] }
    func perform(_ action: CodeAction) async -> Result<Void, IntelligenceFailure> { .success(()) }
    func formatting(for url: URL, indent: Int, usesTabs: Bool) async -> [TextEdit] { [] }
}

enum Synthetic {
    static let files = 300
    static let problems = 5_000
    static let results = 5_000
    static let linesPerFile = 40
    static let folders = 12
    static let codes = 9
    static let matchStart = 18
    static let matchEnd = 21
    static let messages = [
        "undefined: upgrader", "cannot use msg (variable of type string) as []byte value", "unused parameter: ctx",
        "error return value of conn.Close is not checked", "should omit type int from declaration",
        "result of fmt.Sprintf call not used", "this value of err is never used",
    ]

    static func url(_ root: URL, _ file: Int) -> URL {
        root.appendingPathComponent("pkg\(file % folders)/file\(file).go")
    }

    static func diagnostic(_ index: Int) -> Diagnostic {
        let line = index % linesPerFile
        let severity = Diagnostic.Severity.allCases[index % Diagnostic.Severity.allCases.count]
        return Diagnostic(range: TextSpan(start: TextPosition(line: line, column: 1), end: TextPosition(line: line, column: 2)),
                          severity: severity, message: messages[index % messages.count], source: "compiler",
                          code: "Code\(index % codes)")
    }

    static func problems(in root: URL) -> [URL: [Diagnostic]] {
        var problems: [URL: [Diagnostic]] = [:]
        for index in 0..<Synthetic.problems { problems[url(root, index % files), default: []].append(diagnostic(index)) }
        return problems
    }

    static func writeSources(in root: URL) -> [FileLocation] {
        var locations: [FileLocation] = []
        for file in 0..<files {
            let url = url(root, file)
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let lines = (0..<linesPerFile).map { "\tresult := counts.Add(value\($0), total) // line \($0)" }
            try? lines.joined(separator: "\n").write(to: url, atomically: true, encoding: .utf8)
        }
        for index in 0..<results {
            let line = index / files % linesPerFile
            let start = TextPosition(line: line, column: matchStart)
            locations.append(FileLocation(url: url(root, index % files),
                                          range: TextSpan(start: start, end: TextPosition(line: line, column: matchEnd))))
        }
        return locations
    }
}
