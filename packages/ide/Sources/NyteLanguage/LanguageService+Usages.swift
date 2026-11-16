import Foundation
import NyteCore

extension LanguageService {
    static let countedKinds: Set<SymbolKind> = [.class, .struct, .interface, .enum, .function, .method, .typeParameter]
    static let visibleLineLimit = 240
    static let memoryCheckEvery = 8

    enum CountingVerdict: Equatable {
        case count
        case paused(resident: Int, limit: Int)
    }

    static func countingVerdict(resident: Int?, ceiling: Int) -> CountingVerdict {
        guard let resident, resident > ceiling / 2 else { return .count }
        return .paused(resident: resident, limit: ceiling / 2)
    }

    func countingVerdict(_ server: Int, _ connection: ServerConnection) async -> CountingVerdict {
        let resident = await ProcessMemory.resident(of: [connection.identifier]).first ?? nil
        guard servers[server].connection === connection else { return .paused(resident: 0, limit: 0) }
        servers[server].residentBytes = resident
        return Self.countingVerdict(resident: resident, ceiling: ServerTable.memoryCeiling(of: ServerTable.all[servers[server].spec], settings))
    }

    public func usages(in range: TextSpan, of url: URL) async -> [UsageCount] {
        let url = Wire.canonical(url)
        guard let index = document(at: url), let (server, connection) = route(url),
              ServerTable.countsUsages(ServerTable.all[servers[server].spec], settings)
        else { return [] }
        let range = TextSpan(start: range.start, end: min(range.end, TextPosition(line: range.start.line + Self.visibleLineLimit, column: 0)))
        let version = documents[index].version
        let symbols = await outline(url)
        if counted[url]?.version != version { counted[url] = (version, [:]) }
        let visible = symbols.indices.filter { slot in
            let line = symbols[slot].selection.start.line
            return range.start.line <= line && line <= range.end.line && Self.countedKinds.contains(symbols[slot].kind)
        }
        let epoch = foregroundEpoch[server, default: 0]
        var asked = 0
        for slot in visible where counted[url]?.counts[symbols[slot].selection] == nil {
            guard !Task.isCancelled, foregroundEpoch[server, default: 0] == epoch, document(at: url).map({ documents[$0].version }) == version
            else { break }
            if asked % Self.memoryCheckEvery == 0, case .paused = await countingVerdict(server, connection) { break }
            asked += 1
            let symbol = symbols[slot]
            let usages = await count(.references(includeDeclaration: false), at: symbol.selection.start, in: url, on: connection)
            let implementations = Self.hasImplementations(slot, in: symbols)
                ? await count(.implementations, at: symbol.selection.start, in: url, on: connection) : nil
            guard !Task.isCancelled, foregroundEpoch[server, default: 0] == epoch, let usages, counted[url]?.version == version else { break }
            counted[url]?.counts[symbol.selection] = UsageCount(
                name: symbol.name, kind: symbol.kind, selection: symbol.selection, usages: usages, implementations: implementations
            )
        }
        return visible.map { slot in
            counted[url]?.counts[symbols[slot].selection]
                ?? UsageCount(name: symbols[slot].name, kind: symbols[slot].kind, selection: symbols[slot].selection, usages: nil)
        }
    }

    static func hasImplementations(_ slot: Int, in symbols: [DocumentSymbol]) -> Bool {
        let symbol = symbols[slot]
        if symbol.kind == .interface { return true }
        guard symbol.kind == .method, symbol.depth > 0 else { return false }
        let parent = symbols[..<slot].last { $0.depth == symbol.depth - 1 }
        return parent?.kind == .interface
    }

    private func count(_ query: LocationQuery, at position: TextPosition, in url: URL, on connection: ServerConnection) async -> Int? {
        var params = Wire.at(position, in: url).object ?? [:]
        let feature: ClientFeature
        switch query {
        case .implementations: feature = .implementation
        case let .references(includeDeclaration):
            feature = .references
            params["context"] = ["includeDeclaration": .bool(includeDeclaration)]
        case .definition, .typeDefinition:
            return nil
        }
        let id = connection.nextID()
        background[connection.identifier] = id
        defer { if background[connection.identifier] == id { background[connection.identifier] = nil } }
        let answer = await ask(connection, feature, .object(params), id: id) { connection, json in
            Set(connection.locations(json).map { "\($0.url.path)\u{0}\($0.range.start.line):\($0.range.start.column)" }).count
        }
        return try? answer.get()
    }

    func yieldToForeground(_ url: URL) {
        guard let (server, connection) = route(url) else { return }
        foregroundEpoch[server, default: 0] += 1
        guard let id = background.removeValue(forKey: connection.identifier) else { return }
        connection.enqueue(.cancel(id))
    }
}
