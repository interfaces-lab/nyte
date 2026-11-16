import Foundation
import NyteCore

extension ServerConnection {
    func decodeCapabilities(_ json: JSON) -> Capabilities {
        let capabilities = json["capabilities"]
        var decoded = Capabilities()
        decoded.completionTriggers = Set(capabilities?["completionProvider"]?["triggerCharacters"]?.array?.compactMap(\.string) ?? [])
        decoded.resolvesCompletion = capabilities?["completionProvider"]?["resolveProvider"]?.bool ?? false
        decoded.resolvesCodeAction = capabilities?["codeActionProvider"]?["resolveProvider"]?.bool ?? false
        let signature = capabilities?["signatureHelpProvider"]
        decoded.signatureTriggers = Set(
            ((signature?["triggerCharacters"]?.array ?? []) + (signature?["retriggerCharacters"]?.array ?? [])).compactMap(\.string)
        )
        let legend = capabilities?["semanticTokensProvider"]?["legend"]
        decoded.tokenKinds = (legend?["tokenTypes"]?.array ?? []).map { name in
            TokenKind.allCases.first { "\($0)" == name.string } ?? .other
        }
        decoded.tokenModifiers = (legend?["tokenModifiers"]?.array ?? []).map { name in
            Wire.modifierNames.firstIndex(of: name.string ?? "").map { TokenModifiers(rawValue: 1 << $0) } ?? []
        }
        if let provider = capabilities?["diagnosticProvider"], provider != .null {
            decoded.diagnostics = .pulled(acrossFiles: provider["interFileDependencies"]?.bool ?? false)
        }
        decoded.serverName = json["serverInfo"]?["name"]?.string ?? ""
        let version = json["serverInfo"]?["version"]?.string ?? ""
        decoded.serverVersion = JSON.parse(Data(version.utf8))?["Version"]?.string ?? version
        return decoded
    }

    func url(_ json: JSON?) -> URL? {
        guard let text = json?.string, let url = URL(string: text), url.isFileURL else { return nil }
        return Wire.canonical(url)
    }

    func position(_ json: JSON?) -> TextPosition? {
        guard let line = json?["line"]?.int, let column = json?["character"]?.int else { return nil }
        return TextPosition(line: line, column: column)
    }

    func range(_ json: JSON?) -> TextSpan? {
        guard let start = position(json?["start"]), let end = position(json?["end"]) else { return nil }
        return TextSpan(start: start, end: end)
    }

    func location(_ json: JSON) -> FileLocation? {
        if let url = url(json["uri"]), let range = range(json["range"]) { return FileLocation(url: url, range: range) }
        guard let url = url(json["targetUri"]), let range = range(json["targetSelectionRange"] ?? json["targetRange"]) else { return nil }
        return FileLocation(url: url, range: range)
    }

    func locations(_ json: JSON) -> [FileLocation] {
        if let single = location(json) { return [single] }
        return (json.array ?? []).compactMap { location($0) }
    }

    func textEdit(_ json: JSON) -> TextEdit? {
        guard let range = range(json["range"]), let text = json["newText"]?.string else { return nil }
        return TextEdit(range: range, text: text)
    }

    func markdown(_ json: JSON?) -> String {
        guard let json else { return "" }
        if let text = json.string { return text }
        if let parts = json.array { return parts.map { markdown($0) }.filter { !$0.isEmpty }.joined(separator: "\n\n") }
        if let language = json["language"]?.string { return "```\(language)\n\(json["value"]?.string ?? "")\n```" }
        guard let value = json["value"]?.string else { return "" }
        return json["kind"]?.string == "plaintext" ? value.replacingOccurrences(of: "\n", with: "  \n") : value
    }

    func severity(_ json: JSON?) -> Diagnostic.Severity {
        Diagnostic.Severity(rawValue: UInt8(clamping: max((json?.int ?? 1) - 1, 0))) ?? .error
    }

    func diagnostic(_ json: JSON) -> Diagnostic? {
        guard let range = range(json["range"]), let message = json["message"]?.string else { return nil }
        var tags: Diagnostic.Tags = []
        for tag in json["tags"]?.array ?? [] {
            if tag.int == 1 { tags.insert(.unnecessary) }
            if tag.int == 2 { tags.insert(.deprecated) }
        }
        let related = (json["relatedInformation"]?.array ?? []).compactMap { item -> Diagnostic.Related? in
            guard let place = item["location"].flatMap({ location($0) }) else { return nil }
            return Diagnostic.Related(location: place, message: item["message"]?.string ?? "")
        }
        let code = json["code"].map { $0.string ?? $0.int.map(String.init) ?? "" } ?? ""
        return Diagnostic(
            range: range, severity: severity(json["severity"]), message: message, source: json["source"]?.string ?? "",
            code: code, tags: tags, related: related
        )
    }

    func symbolKind(_ json: JSON?) -> SymbolKind {
        SymbolKind(rawValue: UInt8(clamping: max((json?.int ?? 13) - 1, 0))) ?? .variable
    }

    func workspaceEdit(_ json: JSON) throws(IntelligenceFailure) -> WorkspaceEdit {
        var files: [WorkspaceEdit.File] = []
        for change in json["documentChanges"]?.array ?? [] {
            if let kind = change.kind {
                throw .refusing(IntelligenceFailure.FileOperation(rawValue: kind) ?? .create)
            }
            guard let url = url(change["textDocument"]?["uri"]) else { continue }
            files.append(.init(url: url, edits: (change["edits"]?.array ?? []).compactMap { textEdit($0) }))
        }
        if files.isEmpty, let changes = json["changes"]?.object {
            files = changes.keys.sorted().compactMap { key in
                guard let url = url(.string(key)) else { return nil }
                return .init(url: url, edits: (changes[key]?.array ?? []).compactMap { textEdit($0) })
            }
        }
        return WorkspaceEdit(files: files)
    }
}
