import Foundation
@_spi(LanguageService) import NyteCore
import os

extension LanguageService {
    typealias Decoder<T> = @Sendable (isolated ServerConnection, JSON) throws(IntelligenceFailure) -> T

    public func completions(at position: TextPosition, in url: URL, trigger: CompletionTrigger) async -> CompletionList {
        let url = Wire.canonical(url)
        guard let (server, connection) = route(url) else { return CompletionList() }
        yieldToForeground(url)
        if let older = completionInFlight[url] { older.connection.enqueue(.cancel(older.id)) }
        let id = connection.nextID()
        completionInFlight[url] = (connection, id)
        let context: JSON = switch trigger {
        case .invoked: ["triggerKind": 1]
        case let .character(character): ["triggerKind": 2, "triggerCharacter": .string(character)]
        case .incomplete: ["triggerKind": 3]
        }
        var params = Wire.at(position, in: url)
        params = .object((params.object ?? [:]).merging(["context": context]) { _, new in new })
        let answer = await ask(connection, .completion, params, id: id) { connection, json in
            (connection.completions(json), json.array.map(JSON.array) ?? json["items"] ?? [], json["itemDefaults"] ?? .null)
        }
        if completionInFlight[url]?.id == id { completionInFlight[url] = nil }
        guard case let .success((list, items, defaults)) = answer else { return CompletionList() }
        let generation = completionRaw.generation &+ 1
        completionRaw = (server, generation, items.array ?? [], defaults)
        var tagged = list
        for index in tagged.items.indices {
            tagged.items[index].token = ResolveToken(generation: generation, index: UInt32(index))
        }
        guard servers[server].capabilities.resolvesCompletion else { return tagged }
        let bare = tagged.items.indices.filter { tagged.items[$0].invocation != .notCallable && tagged.items[$0].tail.isEmpty }
        let chosen = bare.sorted { (tagged.items[$0].sort, tagged.items[$0].label) < (tagged.items[$1].sort, tagged.items[$1].label) }
            .prefix(Self.detailRows)
        for (index, resolved) in await resolveDetails(Array(chosen), of: tagged.items, on: connection) {
            tagged.items[index].tail = resolved.tail
            tagged.items[index].type = resolved.type
            tagged.items[index].invocation = resolved.invocation
            if tagged.items[index].documentation.isEmpty { tagged.items[index].documentation = resolved.documentation }
        }
        return tagged
    }

    enum DetailAnswer: Sendable {
        case resolved(Int, CompletionItem)
        case unanswered
        case expired
    }

    static let detailRows = 24
    static let detailBudget: Duration = .milliseconds(300)

    private func resolveDetails(_ indices: [Int], of items: [CompletionItem], on connection: ServerConnection) async
        -> [(Int, CompletionItem)] {
        guard !indices.isEmpty else { return [] }
        let raw = completionRaw.items
        let defaults = completionRaw.defaults
        return await withTaskGroup(of: DetailAnswer.self) { group in
            for index in indices where raw.indices.contains(index) {
                let item = raw[index]
                group.addTask {
                    let answer = await self.ask(connection, .completionResolve, item) { connection, json in
                        connection.completion(json, defaults: defaults)
                    }
                    guard case let .success(resolved) = answer else { return .unanswered }
                    return .resolved(index, resolved)
                }
            }
            group.addTask {
                do { try await Task.sleep(for: Self.detailBudget) } catch { return .unanswered }
                return .expired
            }
            var found: [(Int, CompletionItem)] = []
            var pending = indices.count
            loop: while pending > 0, let next = await group.next() {
                switch next {
                case let .resolved(index, item):
                    found.append((index, item))
                    pending -= 1
                case .unanswered:
                    pending -= 1
                case .expired:
                    break loop
                }
            }
            group.cancelAll()
            return found
        }
    }

    public func resolve(_ item: CompletionItem) async -> CompletionItem {
        let index = Int(item.token.index)
        guard item.token.generation == completionRaw.generation, item.token != .unissued,
              completionRaw.items.indices.contains(index),
              servers[completionRaw.server].capabilities.resolvesCompletion,
              let connection = servers[completionRaw.server].connection
        else { return item }
        let defaults = completionRaw.defaults
        let answer = await ask(connection, .completionResolve, completionRaw.items[index]) { connection, json in
            connection.completion(json, defaults: defaults)
        }
        guard case var .success(resolved) = answer else { return item }
        resolved.token = item.token
        if resolved.replace == nil { resolved.replace = item.replace }
        return resolved
    }

    public func hover(at position: TextPosition, in url: URL) async -> Hover? {
        yieldToForeground(Wire.canonical(url))
        return await question(url, .hover, Wire.at(position, in: Wire.canonical(url)), empty: nil) { connection, json in connection.hover(json) }
    }

    public func signatureHelp(at position: TextPosition, in url: URL) async -> SignatureHelp? {
        yieldToForeground(Wire.canonical(url))
        return await question(url, .signatureHelp, Wire.at(position, in: Wire.canonical(url)), empty: nil) { connection, json in
            connection.signatureHelp(json)
        }
    }

    public func locations(_ query: LocationQuery, at position: TextPosition, in url: URL) async -> [FileLocation] {
        var params = Wire.at(position, in: Wire.canonical(url)).object ?? [:]
        let feature: ClientFeature
        switch query {
        case .definition: feature = .definition
        case .typeDefinition: feature = .typeDefinition
        case .implementations: feature = .implementation
        case let .references(includeDeclaration):
            feature = .references
            params["context"] = ["includeDeclaration": .bool(includeDeclaration)]
        }
        return await question(url, feature, .object(params), empty: []) { connection, json in connection.locations(json) }
    }

    public func highlights(at position: TextPosition, in url: URL) async -> [TextSpan] {
        await question(url, .documentHighlight, Wire.at(position, in: Wire.canonical(url)), empty: []) { connection, json in
            connection.highlights(json)
        }
    }

    public func symbols(in url: URL) async -> [DocumentSymbol] {
        let source = text(of: Wire.canonical(url)) ?? ""
        return await question(url, .documentSymbol, ["textDocument": Wire.document(Wire.canonical(url))], empty: []) { connection, json in
            SymbolDetail.compact(connection.symbols(json), source: source)
        }
    }

    public func inlayHints(in range: TextSpan, of url: URL) async -> [InlayHint] {
        let params: JSON = ["textDocument": Wire.document(Wire.canonical(url)), "range": Wire.range(range)]
        return await question(url, .inlayHint, params, empty: []) { connection, json in connection.inlayHints(json) }
    }

    public func semanticTokens(for url: URL) async -> SemanticTokens? {
        await question(url, .semanticTokens, ["textDocument": Wire.document(Wire.canonical(url))], empty: nil) { connection, json in
            connection.semanticTokens(json)
        }
    }

    public func renameTarget(at position: TextPosition, in url: URL) async -> RenameTarget? {
        let text = self.text(of: Wire.canonical(url)) ?? ""
        return await question(url, .prepareRename, Wire.at(position, in: Wire.canonical(url)), empty: nil) { connection, json in
            connection.renameTarget(json) { (text as NSString).substring(with: LanguageService.nsRange($0, in: text)) }
        }
    }

    public func rename(at position: TextPosition, in url: URL, to name: String) async -> Result<WorkspaceEdit, IntelligenceFailure> {
        guard let (_, connection) = route(Wire.canonical(url)) else { return .failure(.noServer) }
        var params = Wire.at(position, in: Wire.canonical(url)).object ?? [:]
        params["newName"] = .string(name)
        return await ask(connection, .rename, .object(params)) { connection, json throws(IntelligenceFailure) in
            try connection.workspaceEdit(json)
        }
    }

    public func actions(in range: TextSpan, of url: URL) async -> [CodeAction] {
        let url = Wire.canonical(url)
        guard let (server, connection) = route(url) else { return [] }
        let overlapping = (problems[url] ?? []).filter { $0.range.start <= range.end && range.start <= $0.range.end }
        let params: JSON = [
            "textDocument": Wire.document(url), "range": Wire.range(range),
            "context": ["diagnostics": .array(overlapping.map(Wire.diagnostic)), "triggerKind": 1],
        ]
        let answer = await ask(connection, .codeAction, params) { connection, json in
            let items = json.array ?? []
            return (connection.codeActions(json), items.map { connection.actionPlan($0) }, items)
        }
        guard case .success(var (actions, plans, items)) = answer else { return [] }
        if ServerTable.all[servers[server].spec].name == ServerTable.typescript.name, !actions.contains(where: { $0.kind == .quickFix }) {
            for (action, plan) in LocalFixes.removingUnused(overlapping, in: text(of: url) ?? "", of: url) {
                actions.append(action)
                plans.append(plan)
                items.append(.null)
            }
        }
        let generation = actionRaw.generation &+ 1
        actionRaw = (server, generation, plans, items)
        return actions.enumerated().map { index, action in
            var tagged = action
            tagged.token = ResolveToken(generation: generation, index: UInt32(index))
            return tagged
        }
    }

    public func perform(_ action: CodeAction) async -> Result<Void, IntelligenceFailure> {
        let index = Int(action.token.index)
        guard action.token.generation == actionRaw.generation, action.token != .unissued, actionRaw.plans.indices.contains(index),
              let connection = servers[actionRaw.server].connection
        else { return .failure(.outdatedAction) }
        var plan = actionRaw.plans[index]
        if plan.needsResolve {
            switch await ask(connection, .codeActionResolve, actionRaw.items[index], decode: { connection, json in connection.actionPlan(json) }) {
            case let .success(resolved): plan = resolved
            case let .failure(failure): return .failure(failure)
            }
        }
        switch plan.edit {
        case let .failure(failure)?:
            return .failure(failure)
        case let .success(edit)?:
            guard await applyEdit?(edit) == true else { return .failure(.editorRefused) }
        case nil:
            break
        }
        guard let command = plan.command else { return .success(()) }
        return await execute(command, on: connection)
    }

    public func formatting(for url: URL, indent: Int, usesTabs: Bool) async -> [TextEdit] {
        let params: JSON = [
            "textDocument": Wire.document(Wire.canonical(url)),
            "options": ["tabSize": .number(Double(indent)), "insertSpaces": .bool(!usesTabs)],
        ]
        return await question(url, .formatting, params, empty: []) { connection, json in
            (json.array ?? []).compactMap { connection.textEdit($0) }
        }
    }

    func execute(_ command: JSON, on connection: ServerConnection) async -> Result<Void, IntelligenceFailure> {
        let params: JSON = ["command": command["command"] ?? "", "arguments": command["arguments"] ?? []]
        return await ask(connection, .executeCommand, params) { _, _ in () }
    }

    func route(_ url: URL) -> (Int, ServerConnection)? {
        guard let server = server(for: url), let connection = servers[server].connection else { return nil }
        return (server, connection)
    }

    func question<T: Sendable>(
        _ url: URL, _ feature: ClientFeature, _ params: JSON, empty: T, decode: @escaping Decoder<T>
    ) async -> T {
        guard let (_, connection) = route(Wire.canonical(url)) else { return empty }
        guard case let .success(answer) = await ask(connection, feature, params, decode: decode) else { return empty }
        return answer
    }

    func ask<T: Sendable>(
        _ connection: ServerConnection, _ feature: ClientFeature, _ params: JSON, id: Int? = nil, decode: @escaping Decoder<T>
    ) async -> Result<T, IntelligenceFailure> {
        await request(connection, feature.method, params, id: id, decode: decode)
    }

    func request<T: Sendable>(
        _ connection: ServerConnection, _ method: String, _ params: JSON, id: Int? = nil, decode: @escaping Decoder<T>
    ) async -> Result<T, IntelligenceFailure> {
        let id = id ?? connection.nextID()
        let answer = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                connection.enqueue(.request(id, method, params, { connection, result in
                    continuation.resume(returning: result.flatMap { json in
                        Result { () throws(IntelligenceFailure) in try decode(connection, json) }
                    })
                }))
            }
        } onCancel: {
            connection.enqueue(.cancel(id))
        }
        if case let .failure(failure) = answer, failure != .cancelled {
            Logger.language.error("\(method, privacy: .public) to \(connection.name, privacy: .public) failed: \(failure.message, privacy: .public)")
            appendLog(connection.name, "Nyte IDE: \(method) failed: \(failure.message)\n")
        }
        return answer
    }

    func initializeParameters(_ options: JSON, root: URL) -> JSON {
        let folder: JSON = ["uri": Wire.uri(root), "name": .string(root.lastPathComponent)]
        return [
            "processId": .number(Double(ProcessInfo.processInfo.processIdentifier)),
            "clientInfo": ["name": "Nyte IDE"],
            "rootUri": Wire.uri(root),
            "workspaceFolders": [folder],
            "initializationOptions": options,
            "capabilities": ClientFeature.capabilities,
        ]
    }
}

extension IntelligenceFailure {
    static let noServer = IntelligenceFailure("No language server knows this file.")
    static let outdatedAction = IntelligenceFailure("This action is out of date. Ask for actions again.")
    static let editorRefused = IntelligenceFailure("The editor did not apply the edit.")
}
