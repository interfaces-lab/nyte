import Foundation
import NyteCore

extension LanguageService {
    enum SaveRace: Sendable {
        case finished(SavePreparation)
        case expired
    }

    public func editsBeforeSave(_ url: URL, indent: Int, usesTabs: Bool, deadline: Duration) async -> SavePreparation {
        let url = Wire.canonical(url)
        guard let index = document(at: url), servers[documents[index].server].connection != nil else {
            return SavePreparation(outcome: .unchanged)
        }
        let original = documents[index].text
        saving[url] = documents[index].version
        let race = await withTaskGroup(of: SaveRace.self) { group in
            group.addTask { await .finished(self.prepare(url, original: original, indent: indent, usesTabs: usesTabs)) }
            group.addTask {
                do { try await Task.sleep(for: deadline) } catch { return .expired }
                return .expired
            }
            let first = await group.next() ?? .expired
            group.cancelAll()
            return first
        }
        if saving.removeValue(forKey: url) != nil, sentOwnText.contains(url), let current = document(at: url) { sendWholeText(current) }
        sentOwnText.remove(url)
        captures[url] = nil
        switch race {
        case let .finished(preparation): return preparation
        case .expired:
            let limit = deadline.formatted(.units(allowed: [.seconds], fractionalPart: .show(length: 1)))
            let name = document(at: url).map { servers[documents[$0].server].name } ?? "The language server"
            return SavePreparation(outcome: .timedOut("Saved without formatting: \(name) took longer than \(limit)."))
        }
    }

    private func prepare(_ url: URL, original: String, indent: Int, usesTabs: Bool) async -> SavePreparation {
        var text = original
        var ran: [SavePreparation.Step] = []
        for step in SavePreparation.Step.allCases {
            let answer: Result<[TextEdit], IntelligenceFailure> = switch step {
            case .format: await formatEdits(url, indent: indent, usesTabs: usesTabs)
            case .organizeImports: await organizeImportEdits(url, text: text)
            }
            guard !Task.isCancelled else { return SavePreparation(outcome: .outdated) }
            guard saving[url] != nil, let index = document(at: url) else { return SavePreparation(outcome: .outdated) }
            let edits: [TextEdit]
            switch answer {
            case let .success(found): edits = found
            case let .failure(failure):
                return SavePreparation(outcome: .failed("Saved without \(step == .format ? "formatting" : "organising imports"): \(failure.message)"))
            }
            guard !edits.isEmpty else { continue }
            ran.append(step)
            text = LineDiff.applying(edits, to: text)
            sendOwnText(text, for: index)
        }
        let edits = LineDiff.edits(from: original, to: text)
        return SavePreparation(edits: edits, steps: ran, outcome: edits.isEmpty ? .unchanged : .changed)
    }

    private func formatEdits(_ url: URL, indent: Int, usesTabs: Bool) async -> Result<[TextEdit], IntelligenceFailure> {
        guard let (_, connection) = route(url) else { return .failure(.noServer) }
        let params: JSON = [
            "textDocument": Wire.document(url),
            "options": ["tabSize": .number(Double(indent)), "insertSpaces": .bool(!usesTabs)],
        ]
        return await ask(connection, .formatting, params) { connection, json in (json.array ?? []).compactMap { connection.textEdit($0) } }
    }

    private func organizeImportEdits(_ url: URL, text: String) async -> Result<[TextEdit], IntelligenceFailure> {
        guard let (server, connection) = route(url) else { return .failure(.noServer) }
        let lines = text.reduce(0) { $1 == "\n" ? $0 + 1 : $0 }
        let params: JSON = [
            "textDocument": Wire.document(url),
            "range": Wire.range(TextSpan(start: .init(line: 0, column: 0), end: .init(line: lines + 1, column: 0))),
            "context": ["diagnostics": [], "only": ["source.organizeImports"], "triggerKind": 1],
        ]
        let answer = await ask(connection, .codeAction, params) { connection, json in
            (json.array ?? []).first { ($0["kind"]?.string ?? "").hasPrefix("source.organizeImports") }
                .map { (connection.actionPlan($0), $0) }
        }
        guard case let .success(found) = answer else { return answer.map { _ in [] } }
        guard var (plan, item) = found else { return .success([]) }
        if plan.needsResolve, servers[server].capabilities.resolvesCodeAction {
            switch await ask(connection, .codeActionResolve, item, decode: { connection, json in (connection.actionPlan(json), json) }) {
            case let .success(resolved): (plan, item) = resolved
            case let .failure(failure): return .failure(failure)
            }
        }
        if let edit = plan.edit {
            return edit.map { edit in edit.files.filter { $0.url == url }.flatMap(\.edits) }
        }
        guard let command = plan.command else { return .success([]) }
        captures[url] = []
        let executed = await execute(command, on: connection)
        let captured = captures.removeValue(forKey: url) ?? []
        return executed.map { captured }
    }

    func capture(_ edit: WorkspaceEdit) -> Bool {
        guard let first = edit.files.first, captures[first.url] != nil, edit.files.allSatisfy({ $0.url == first.url }) else { return false }
        captures[first.url, default: []] += first.edits
        return true
    }

    private func sendOwnText(_ text: String, for index: Int) {
        documents[index].version += 1
        sentOwnText.insert(documents[index].url)
        sendWholeText(documents[index], text: text)
    }

    func sendWholeText(_ index: Int) {
        documents[index].version += 1
        sendWholeText(documents[index], text: documents[index].text)
    }

    private func sendWholeText(_ document: OpenDocument, text: String) {
        servers[document.server].connection?.enqueue(.notify("textDocument/didChange", [
            "textDocument": ["uri": Wire.uri(document.url), "version": .number(Double(document.version))],
            "contentChanges": [["text": .string(text)]],
        ]))
    }
}
