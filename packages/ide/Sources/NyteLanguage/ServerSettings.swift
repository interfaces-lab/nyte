import NyteCore

enum GoSettings {
    static let usesPlaceholders = false
    static let completesUnimported = true
    static let runsStaticcheck = true

    static func options(_ go: LanguageSettings.Go) -> JSON {
        let hints = go.inlayHints
        return [
            "semanticTokens": true,
            "usePlaceholders": .bool(usesPlaceholders),
            "completeUnimported": .bool(completesUnimported),
            "staticcheck": .bool(runsStaticcheck),
            "hints": [
                "parameterNames": .bool(hints.parameterNames), "constantValues": .bool(hints.constantValues),
                "assignVariableTypes": .bool(hints.assignVariableTypes), "rangeVariableTypes": .bool(hints.rangeVariableTypes),
                "compositeLiteralTypes": .bool(hints.compositeLiteralTypes),
                "compositeLiteralFields": .bool(hints.compositeLiteralFields),
                "functionTypeParameters": .bool(hints.functionTypeParameters),
            ],
            "analyses": ["nilness": true, "unusedparams": true, "unusedwrite": true, "shadow": true, "useany": true],
        ]
    }
}

enum TypeScriptSettings {
    static let completesFunctionCalls = false

    static func preferences(_ typeScript: LanguageSettings.TypeScript) -> JSON {
        let hints = typeScript.inlayHints
        return [
            "includeInlayParameterNameHints": .string(hints.parameterNames.rawValue),
            "includeInlayParameterNameHintsWhenArgumentMatchesName": .bool(hints.parameterNamesWhenArgumentMatches),
            "includeInlayFunctionParameterTypeHints": .bool(hints.functionParameterTypes),
            "includeInlayVariableTypeHints": .bool(hints.variableTypes),
            "includeInlayPropertyDeclarationTypeHints": .bool(hints.propertyDeclarationTypes),
            "includeInlayFunctionLikeReturnTypeHints": .bool(hints.functionLikeReturnTypes),
            "includeInlayEnumMemberValueHints": .bool(hints.enumMemberValues),
            "completeFunctionCalls": .bool(completesFunctionCalls),
            "includeCompletionsWithSnippetText": true,
            "useLabelDetailsInCompletionEntries": true,
        ]
    }

    static func language(_ typeScript: LanguageSettings.TypeScript) -> JSON {
        let hints = typeScript.inlayHints
        let vscode: [String: JSON] = [
            "parameterNames": [
                "enabled": .string(hints.parameterNames.rawValue),
                "suppressWhenArgumentMatchesName": .bool(!hints.parameterNamesWhenArgumentMatches),
            ],
            "parameterTypes": ["enabled": .bool(hints.functionParameterTypes)],
            "variableTypes": ["enabled": .bool(hints.variableTypes)],
            "propertyDeclarationTypes": ["enabled": .bool(hints.propertyDeclarationTypes)],
            "functionLikeReturnTypes": ["enabled": .bool(hints.functionLikeReturnTypes)],
            "enumMemberValues": ["enabled": .bool(hints.enumMemberValues)],
        ]
        let tsserver = (preferences(typeScript).object ?? [:]).filter { $0.key.hasPrefix("includeInlay") }
        return [
            "inlayHints": .object(vscode.merging(tsserver) { first, _ in first }),
            "suggest": ["completeFunctionCalls": .bool(completesFunctionCalls)],
        ]
    }
}
