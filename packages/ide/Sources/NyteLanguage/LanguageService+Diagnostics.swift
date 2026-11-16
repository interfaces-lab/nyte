import Foundation
import NyteCore

extension LanguageService {
    static let pullDelay: Duration = .milliseconds(150)
    static let dependentPullDelay: Duration = .milliseconds(600)

    func publish(_ diagnostics: [Diagnostic], for url: URL) {
        problems[url] = diagnostics
        onEvent?(.diagnostics(url))
    }

    func documentDidChange(_ document: OpenDocument) {
        guard case let .pulled(acrossFiles) = servers[document.server].capabilities.diagnostics else { return }
        pullDiagnostics(document.url, after: Self.pullDelay)
        guard acrossFiles else { return }
        for other in documents where other.server == document.server && other.url != document.url {
            pullDiagnostics(other.url, after: Self.dependentPullDelay)
        }
    }

    func pullDiagnostics(_ url: URL, after delay: Duration) {
        guard let index = document(at: url) else { return }
        let server = documents[index].server
        guard case .pulled = servers[server].capabilities.diagnostics, let connection = servers[server].connection else { return }
        pulls[url]?.cancel()
        let previous = pullResults[url]
        pulls[url] = Task { [weak self] in
            if delay > .zero {
                do { try await Task.sleep(for: delay) } catch { return }
            }
            guard let self else { return }
            var params: [String: JSON] = ["textDocument": Wire.document(url)]
            if let previous { params["previousResultId"] = .string(previous) }
            let answer = await ask(connection, .pullDiagnostics, .object(params)) { connection, json in
                PulledDiagnostics(
                    isUnchanged: json["kind"]?.string == "unchanged", resultID: json["resultId"]?.string,
                    diagnostics: (json["items"]?.array ?? []).compactMap { connection.diagnostic($0) }
                )
            }
            guard !Task.isCancelled, case let .success(pulled) = answer, document(at: url) != nil else { return }
            pulls[url] = nil
            pullResults[url] = pulled.resultID
            if !pulled.isUnchanged { publish(pulled.diagnostics, for: url) }
        }
    }
}

struct PulledDiagnostics: Sendable {
    var isUnchanged: Bool
    var resultID: String?
    var diagnostics: [Diagnostic]
}
