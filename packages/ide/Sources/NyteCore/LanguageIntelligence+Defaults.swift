import Foundation

extension LanguageIntelligence {
    public func runMarks(in url: URL) async -> [RunMark] { [] }

    public func usages(in range: TextSpan, of url: URL) async -> [UsageCount] { [] }

    public func symbolSearch(_ query: String, near url: URL?) -> AsyncStream<SymbolResults> {
        AsyncStream { continuation in
            continuation.yield(SymbolResults(query: query, isComplete: true))
            continuation.finish()
        }
    }

    public func editsBeforeSave(_ url: URL, indent: Int, usesTabs: Bool, deadline: Duration) async -> SavePreparation {
        SavePreparation(outcome: .unchanged)
    }

    public func openText(of url: URL) -> String? { nil }

    public func classifiedReferences(at position: TextPosition, in url: URL) async -> [Usage] {
        await locations(.references(includeDeclaration: true), at: position, in: url).map { Usage(location: $0) }
    }
}
