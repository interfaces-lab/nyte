import NyteCore

enum ClientFeature: CaseIterable {
    case positionEncoding
    case workDoneProgress
    case showMessage
    case applyEdit
    case configuration
    case workspaceFolders
    case didChangeConfiguration
    case didChangeWatchedFiles
    case workspaceSymbol
    case executeCommand
    case synchronization
    case completion
    case completionResolve
    case hover
    case signatureHelp
    case definition
    case typeDefinition
    case implementation
    case references
    case documentHighlight
    case documentSymbol
    case codeAction
    case codeActionResolve
    case formatting
    case rename
    case prepareRename
    case publishDiagnostics
    case inlayHint
    case semanticTokens
    case pullDiagnostics
    case diagnosticRefresh

    var method: String {
        switch self {
        case .positionEncoding: "initialize"
        case .workDoneProgress: "$/progress"
        case .showMessage: "window/showMessage"
        case .applyEdit: "workspace/applyEdit"
        case .configuration: "workspace/configuration"
        case .workspaceFolders: "workspace/workspaceFolders"
        case .didChangeConfiguration: "workspace/didChangeConfiguration"
        case .didChangeWatchedFiles: "workspace/didChangeWatchedFiles"
        case .workspaceSymbol: "workspace/symbol"
        case .executeCommand: "workspace/executeCommand"
        case .synchronization: "textDocument/didOpen"
        case .completion: "textDocument/completion"
        case .completionResolve: "completionItem/resolve"
        case .hover: "textDocument/hover"
        case .signatureHelp: "textDocument/signatureHelp"
        case .definition: "textDocument/definition"
        case .typeDefinition: "textDocument/typeDefinition"
        case .implementation: "textDocument/implementation"
        case .references: "textDocument/references"
        case .documentHighlight: "textDocument/documentHighlight"
        case .documentSymbol: "textDocument/documentSymbol"
        case .codeAction: "textDocument/codeAction"
        case .codeActionResolve: "codeAction/resolve"
        case .formatting: "textDocument/formatting"
        case .rename: "textDocument/rename"
        case .prepareRename: "textDocument/prepareRename"
        case .publishDiagnostics: "textDocument/publishDiagnostics"
        case .inlayHint: "textDocument/inlayHint"
        case .semanticTokens: "textDocument/semanticTokens/full"
        case .pullDiagnostics: "textDocument/diagnostic"
        case .diagnosticRefresh: "workspace/diagnostic/refresh"
        }
    }

    var capability: (path: [String], value: JSON) {
        switch self {
        case .positionEncoding: (["general", "positionEncodings"], ["utf-16"])
        case .workDoneProgress: (["window", "workDoneProgress"], true)
        case .showMessage: (["window", "showMessage"], [:])
        case .applyEdit:
            (["workspace"], [
                "applyEdit": true,
                "workspaceEdit": ["documentChanges": true, "resourceOperations": [], "failureHandling": "abort"],
            ])
        case .configuration: (["workspace", "configuration"], true)
        case .workspaceFolders: (["workspace", "workspaceFolders"], true)
        case .didChangeConfiguration: (["workspace", "didChangeConfiguration"], ["dynamicRegistration": false])
        case .didChangeWatchedFiles: (["workspace", "didChangeWatchedFiles"], ["dynamicRegistration": true])
        case .workspaceSymbol: (["workspace", "symbol"], ["symbolKind": ["valueSet": Self.symbolKinds]])
        case .executeCommand: (["workspace", "executeCommand"], [:])
        case .synchronization: (["textDocument", "synchronization"], ["didSave": true, "willSave": false, "willSaveWaitUntil": false])
        case .completion:
            (["textDocument", "completion"], [
                "completionItem": [
                    "snippetSupport": true, "labelDetailsSupport": true, "documentationFormat": Self.markup,
                    "deprecatedSupport": true, "preselectSupport": true, "tagSupport": ["valueSet": [1]],
                ],
                "completionItemKind": ["valueSet": .array((1...25).map { .number(Double($0)) })],
                "completionList": ["itemDefaults": ["editRange", "insertTextFormat", "commitCharacters"]],
                "contextSupport": true,
            ])
        case .completionResolve:
            (["textDocument", "completion", "completionItem", "resolveSupport"],
             ["properties": ["documentation", "detail", "additionalTextEdits"]])
        case .hover: (["textDocument", "hover"], ["contentFormat": Self.markup])
        case .signatureHelp:
            (["textDocument", "signatureHelp"], [
                "signatureInformation": [
                    "documentationFormat": Self.markup, "parameterInformation": ["labelOffsetSupport": true],
                    "activeParameterSupport": true,
                ],
            ])
        case .definition: (["textDocument", "definition"], ["linkSupport": true])
        case .typeDefinition: (["textDocument", "typeDefinition"], ["linkSupport": true])
        case .implementation: (["textDocument", "implementation"], ["linkSupport": true])
        case .references: (["textDocument", "references"], [:])
        case .documentHighlight: (["textDocument", "documentHighlight"], [:])
        case .documentSymbol:
            (["textDocument", "documentSymbol"], ["hierarchicalDocumentSymbolSupport": true, "symbolKind": ["valueSet": Self.symbolKinds]])
        case .codeAction:
            (["textDocument", "codeAction"], [
                "codeActionLiteralSupport": ["codeActionKind": ["valueSet": [
                    "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source",
                    "source.organizeImports", "source.fixAll",
                ]]],
                "isPreferredSupport": true, "disabledSupport": true, "dataSupport": true,
            ])
        case .codeActionResolve: (["textDocument", "codeAction", "resolveSupport"], ["properties": ["edit"]])
        case .formatting: (["textDocument", "formatting"], [:])
        case .rename: (["textDocument", "rename"], [:])
        case .prepareRename: (["textDocument", "rename", "prepareSupport"], true)
        case .publishDiagnostics:
            (["textDocument", "publishDiagnostics"],
             ["relatedInformation": true, "tagSupport": ["valueSet": [1, 2]], "codeDescriptionSupport": false])
        case .inlayHint: (["textDocument", "inlayHint"], [:])
        case .semanticTokens:
            (["textDocument", "semanticTokens"], [
                "requests": ["full": true],
                "tokenTypes": .array(TokenKind.allCases.filter { $0 != .other }.map { .string("\($0)") }),
                "tokenModifiers": .array(Wire.modifierNames.map { .string($0) }),
                "formats": ["relative"],
                "overlappingTokenSupport": false, "multilineTokenSupport": false,
            ])
        case .pullDiagnostics: (["textDocument", "diagnostic"], ["dynamicRegistration": false, "relatedDocumentSupport": false])
        case .diagnosticRefresh: (["workspace", "diagnostics"], ["refreshSupport": true])
        }
    }

    static let capabilities: JSON = allCases.reduce(JSON.object([:])) { built, feature in
        let capability = feature.capability
        return inserting(capability.value, at: capability.path[...], into: built)
    }

    private static let markup: JSON = ["markdown", "plaintext"]
    private static let symbolKinds = JSON.array((1...26).map { .number(Double($0)) })

    private static func inserting(_ value: JSON, at path: ArraySlice<String>, into target: JSON) -> JSON {
        guard let key = path.first else { return merging(value, into: target) }
        var fields = target.object ?? [:]
        fields[key] = inserting(value, at: path.dropFirst(), into: fields[key] ?? .object([:]))
        return .object(fields)
    }

    private static func merging(_ value: JSON, into target: JSON) -> JSON {
        guard let incoming = value.object, var fields = target.object else { return value }
        for (key, item) in incoming { fields[key] = merging(item, into: fields[key] ?? .null) }
        return .object(fields)
    }
}
