import Foundation
import NyteCore

struct Capabilities: Sendable {
    var completionTriggers: Set<String> = []
    var signatureTriggers: Set<String> = []
    var resolvesCompletion = false
    var resolvesCodeAction = false
    var tokenKinds: [TokenKind] = []
    var tokenModifiers: [TokenModifiers] = []
    var diagnostics = DiagnosticModel.pushed
    var serverName = ""
    var serverVersion = ""
}

enum DiagnosticModel: Sendable, Equatable {
    case pushed
    case pulled(acrossFiles: Bool)
}

enum Wire {
    static let modifierNames = [
        "declaration", "definition", "readonly", "static", "deprecated", "abstract", "async", "modification",
        "documentation", "defaultLibrary",
    ]

    static func uri(_ url: URL) -> JSON { .string(url.absoluteString) }

    static func document(_ url: URL) -> JSON { ["uri": uri(url)] }

    static func position(_ position: TextPosition) -> JSON {
        ["line": .number(Double(position.line)), "character": .number(Double(position.column))]
    }

    static func range(_ range: TextSpan) -> JSON { ["start": position(range.start), "end": position(range.end)] }

    static func at(_ position: TextPosition, in url: URL) -> JSON {
        ["textDocument": document(url), "position": Wire.position(position)]
    }

    static func diagnostic(_ diagnostic: Diagnostic) -> JSON {
        var value: [String: JSON] = [
            "range": range(diagnostic.range), "severity": .number(Double(diagnostic.severity.rawValue + 1)),
            "message": .string(diagnostic.message),
        ]
        if !diagnostic.source.isEmpty { value["source"] = .string(diagnostic.source) }
        if !diagnostic.code.isEmpty { value["code"] = Int(diagnostic.code).map { .number(Double($0)) } ?? .string(diagnostic.code) }
        return .object(value)
    }

    static func canonical(_ url: URL) -> URL { URL(fileURLWithPath: url.standardizedFileURL.path) }
}
