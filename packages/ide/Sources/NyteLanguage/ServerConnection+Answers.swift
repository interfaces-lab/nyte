import Foundation
import NyteCore

extension ServerConnection {
    func completions(_ json: JSON) -> CompletionList {
        let items = json.array ?? json["items"]?.array ?? []
        let defaults = json["itemDefaults"]
        var list = CompletionList(items: [], isIncomplete: json["isIncomplete"]?.bool ?? false)
        list.items.reserveCapacity(items.count)
        for item in items {
            list.items.append(completion(item, defaults: defaults))
        }
        return list
    }

    func completion(_ item: JSON, defaults: JSON? = nil) -> CompletionItem {
        let label = item["label"]?.string ?? ""
        let format = item["insertTextFormat"]?.int ?? defaults?["insertTextFormat"]?.int ?? 1
        var raw = item["insertText"]?.string ?? label
        var replace: TextSpan?
        if let edit = item["textEdit"] {
            raw = edit["newText"]?.string ?? raw
            replace = range(edit["range"] ?? edit["replace"])
        } else if let editRange = defaults?["editRange"] {
            replace = range(editRange["replace"] ?? editRange)
            raw = item["textEditText"]?.string ?? raw
        }
        var text = raw
        var stops: [CompletionItem.Stop] = []
        if format == 2 {
            let snippet = Snippet(parsing: raw)
            text = snippet.text
            stops = snippet.stops
        }
        let details = item["labelDetails"]
        let detail = item["detail"]?.string ?? ""
        let kind = CompletionKind(rawValue: UInt8(clamping: max((item["kind"]?.int ?? 1) - 1, 0))) ?? .text
        var tail = details?["detail"]?.string ?? ""
        var type = details?["description"]?.string ?? detail
        var invocation = CompletionItem.Invocation.notCallable
        if Self.callableKinds.contains(kind) || detail.hasPrefix("func(") {
            invocation = .withArguments
            let shape = CallShape(signature: tail, after: "") ?? CallShape(signature: detail, after: label)
            if let shape {
                tail = shape.parameters
                type = shape.result
                invocation = shape.invocation
            }
            if text.hasPrefix(label + "("), text.hasSuffix(")") {
                text = label
                stops = []
            }
        }
        return CompletionItem(
            label: label,
            kind: kind,
            tail: tail,
            type: type,
            documentation: markdown(item["documentation"]),
            filter: item["filterText"]?.string,
            sort: item["sortText"]?.string,
            text: text,
            replace: replace,
            stops: stops,
            additionalEdits: (item["additionalTextEdits"]?.array ?? []).compactMap { textEdit($0) },
            commitCharacters: (item["commitCharacters"] ?? defaults?["commitCharacters"])?.array?.compactMap(\.string) ?? [],
            isPreselected: item["preselect"]?.bool ?? false,
            isDeprecated: item["deprecated"]?.bool ?? (item["tags"]?.array?.contains(1) ?? false),
            invocation: invocation
        )
    }

    static let callableKinds: Set<CompletionKind> = [.method, .function, .constructor]

    func hover(_ json: JSON) -> Hover? {
        let markdown = markdown(json["contents"])
        return markdown.isEmpty ? nil : Hover(markdown: markdown, range: range(json["range"]))
    }

    func signatureHelp(_ json: JSON) -> SignatureHelp? {
        let signatures = (json["signatures"]?.array ?? []).map { signature in
            let label = signature["label"]?.string ?? ""
            let parameters = (signature["parameters"]?.array ?? []).compactMap { parameter -> Range<Int>? in
                if let bounds = parameter["label"]?.array, bounds.count == 2, let start = bounds[0].int, let end = bounds[1].int {
                    return start..<end
                }
                guard let name = parameter["label"]?.string, let found = label.range(of: name) else { return nil }
                let start = label.utf16.distance(from: label.startIndex, to: found.lowerBound)
                return start..<start + name.utf16.count
            }
            return SignatureHelp.Signature(
                label: label, documentation: markdown(signature["documentation"]), parameterUTF16Ranges: parameters
            )
        }
        guard !signatures.isEmpty else { return nil }
        let active = json["activeSignature"]?.int ?? 0
        let parameter = (active < signatures.count ? json["signatures"]?.array?[active]["activeParameter"]?.int : nil)
            ?? json["activeParameter"]?.int
        return SignatureHelp(signatures: signatures, activeSignature: active, activeParameter: parameter)
    }

    func highlights(_ json: JSON) -> [TextSpan] {
        (json.array ?? []).compactMap { range($0["range"]) }
    }

    func symbols(_ json: JSON) -> [DocumentSymbol] {
        var rows: [DocumentSymbol] = []
        func walk(_ nodes: [JSON], depth: Int) {
            let ordered = nodes.compactMap { node in range(node["range"] ?? node["location"]?["range"]).map { (node, $0) } }
                .sorted { $0.1.start < $1.1.start }
            for (node, extent) in ordered {
                rows.append(DocumentSymbol(
                    name: node["name"]?.string ?? "", detail: node["detail"]?.string ?? "", kind: symbolKind(node["kind"]),
                    range: extent, selection: range(node["selectionRange"]) ?? extent, depth: depth,
                    isDeprecated: node["deprecated"]?.bool ?? (node["tags"]?.array?.contains(1) ?? false)
                ))
                walk(node["children"]?.array ?? [], depth: depth + 1)
            }
        }
        walk(json.array ?? [], depth: 0)
        return rows
    }

    func workspaceSymbols(_ json: JSON) -> [WorkspaceSymbol] {
        (json.array ?? []).compactMap { symbol in
            guard let place = symbol["location"].flatMap({ location($0) })
                ?? url(symbol["location"]?["uri"]).map({ FileLocation(url: $0, range: TextSpan(at: .init(line: 0, column: 0))) })
            else { return nil }
            return WorkspaceSymbol(
                name: symbol["name"]?.string ?? "", kind: symbolKind(symbol["kind"]),
                container: symbol["containerName"]?.string ?? "", location: place
            )
        }
    }

    func inlayHints(_ json: JSON) -> [InlayHint] {
        let hints = (json.array ?? []).compactMap { hint -> InlayHint? in
            guard let position = position(hint["position"]) else { return nil }
            let label = hint["label"]?.string ?? (hint["label"]?.array ?? []).compactMap { $0["value"]?.string }.joined()
            let kind: InlayHint.Kind = switch hint["kind"]?.int { case 1: .type; case 2: .parameter; default: .other }
            return InlayHint(
                position: position, label: label, kind: kind, padsLeading: hint["paddingLeft"]?.bool ?? false,
                padsTrailing: hint["paddingRight"]?.bool ?? false
            )
        }
        return hints.sorted { $0.position < $1.position }
    }

    func semanticTokens(_ json: JSON) -> SemanticTokens? {
        guard let data = json["data"]?.array else { return nil }
        var tokens = SemanticTokens()
        let count = data.count / 5
        tokens.lines.reserveCapacity(count)
        tokens.columns.reserveCapacity(count)
        tokens.lengths.reserveCapacity(count)
        tokens.kinds.reserveCapacity(count)
        tokens.modifiers.reserveCapacity(count)
        var line: Int32 = 0
        var column: Int32 = 0
        for index in 0..<count {
            let base = index * 5
            let deltaLine = Int32(data[base].int ?? 0)
            let deltaColumn = Int32(data[base + 1].int ?? 0)
            line += deltaLine
            column = deltaLine == 0 ? column + deltaColumn : deltaColumn
            let kind = data[base + 3].int ?? -1
            let bits = data[base + 4].int ?? 0
            var modifiers: TokenModifiers = []
            for (bit, modifier) in capabilities.tokenModifiers.enumerated() where bits & (1 << bit) != 0 { modifiers.formUnion(modifier) }
            tokens.lines.append(line)
            tokens.columns.append(column)
            tokens.lengths.append(Int32(data[base + 2].int ?? 0))
            tokens.kinds.append(capabilities.tokenKinds.indices.contains(kind) ? capabilities.tokenKinds[kind] : .other)
            tokens.modifiers.append(modifiers)
        }
        return tokens
    }

    func renameTarget(_ json: JSON, text: (TextSpan) -> String) -> RenameTarget? {
        if let range = range(json) { return RenameTarget(range: range, placeholder: text(range)) }
        guard let range = range(json["range"]) else { return nil }
        return RenameTarget(range: range, placeholder: json["placeholder"]?.string ?? text(range))
    }

    func codeActions(_ json: JSON) -> [CodeAction] {
        (json.array ?? []).map { action in
            CodeAction(
                title: action["title"]?.string ?? "", kind: actionKind(action["kind"]?.string ?? ""),
                isPreferred: action["isPreferred"]?.bool ?? false, disabledReason: action["disabled"]?["reason"]?.string ?? ""
            )
        }
    }

    private func actionKind(_ kind: String) -> CodeAction.Kind {
        let table: [(String, CodeAction.Kind)] = [
            ("quickfix", .quickFix), ("refactor.extract", .extract), ("refactor.inline", .inline),
            ("refactor.rewrite", .rewrite), ("refactor", .refactor), ("source.organizeImports", .organizeImports),
            ("source.fixAll", .fixAll), ("source", .source),
        ]
        return table.first { kind == $0.0 || kind.hasPrefix($0.0 + ".") }?.1 ?? .other
    }

    func actionPlan(_ action: JSON) -> ActionPlan {
        if action["command"]?.string != nil { return ActionPlan(edit: nil, command: action, needsResolve: false) }
        let edit = action["edit"].map { edit in Result { () throws(IntelligenceFailure) in try workspaceEdit(edit) } }
        return ActionPlan(edit: edit, command: action["command"], needsResolve: edit == nil && capabilities.resolvesCodeAction)
    }
}

struct ActionPlan: Sendable {
    var edit: Result<WorkspaceEdit, IntelligenceFailure>?
    var command: JSON?
    var needsResolve: Bool
}
