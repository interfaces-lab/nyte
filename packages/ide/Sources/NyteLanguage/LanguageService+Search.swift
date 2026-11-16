import Foundation
import NyteCore

extension LanguageService {
    public func symbolSearch(_ query: String, near url: URL?) -> AsyncStream<SymbolResults> {
        searching?.cancel()
        searchGeneration += 1
        let generation = searchGeneration
        let connections = servers.compactMap(\.connection)
        let near = url.map(Wire.canonical)
        let workspace = workspace
        let (stream, continuation) = AsyncStream.makeStream(of: SymbolResults.self, bufferingPolicy: .bufferingNewest(1))
        guard !connections.isEmpty else {
            continuation.yield(SymbolResults(query: query, isComplete: true))
            continuation.finish()
            return stream
        }
        let task = Task { [weak self] in
            await withTaskGroup(of: [WorkspaceSymbol].self) { group in
                for connection in connections {
                    group.addTask { [weak self] in
                        guard let self else { return [] }
                        let answer = await ask(connection, .workspaceSymbol, ["query": .string(query)]) { connection, json in
                            connection.workspaceSymbols(json)
                        }
                        return (try? answer.get()) ?? []
                    }
                }
                var found: [WorkspaceSymbol] = []
                var remaining = connections.count
                for await batch in group {
                    remaining -= 1
                    guard !Task.isCancelled, let self, generation == self.searchGeneration else { break }
                    found += batch
                    let matches = SymbolRanking.rank(found, for: query, near: near, in: workspace)
                    continuation.yield(SymbolResults(query: query, matches: matches, isComplete: remaining == 0))
                }
                group.cancelAll()
            }
            continuation.finish()
        }
        searching = task
        continuation.onTermination = { _ in task.cancel() }
        return stream
    }

    public func symbols(matching query: String) async -> [WorkspaceSymbol] {
        var last: [SymbolMatch] = []
        for await results in symbolSearch(query, near: nil) { last = results.matches }
        return last.map(\.symbol)
    }
}
