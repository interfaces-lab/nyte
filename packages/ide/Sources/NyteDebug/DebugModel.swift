import Foundation

public struct DebugTarget: Sendable, Hashable, Identifiable {
    public enum Kind: Sendable, Hashable {
        case goPackage(URL)
        case goTest(URL, test: String?)
        case node(URL)
    }

    public var id: String
    public var name: String
    public var kind: Kind
    public var directory: URL
    public var arguments: [String]
    public var runtimeArguments: [String]
    public var environment: [String: String]

    public init(id: String, name: String, kind: Kind, directory: URL, arguments: [String] = [], environment: [String: String] = [:],
                runtimeArguments: [String] = []) {
        self.runtimeArguments = runtimeArguments
        self.id = id
        self.name = name
        self.kind = kind
        self.directory = directory
        self.arguments = arguments
        self.environment = environment
    }
}

public struct DebugThread: Sendable, Hashable {
    public var id: Int
    public var name: String
    public var state = ""
    public var function = ""
}

public struct DebugFrame: Sendable, Hashable {
    public var id: Int
    public var function: String
    public var url: URL?
    public var line: Int
    public var column: Int
    public var isUserCode: Bool
    public var isLabel = false
}

public struct DebugScope: Sendable, Hashable {
    public var name: String
    public var reference: Int
    public var isExpensive: Bool
}

public struct DebugVariable: Sendable, Hashable {
    public var name: String
    public var value: String
    public var type: String
    public var reference: Int
    public var childCount: Int?
    public var indexedCount: Int?
    public var isChanged: Bool
}

public struct DebugOutput: Sendable, Hashable {
    public enum Category: Sendable, Hashable {
        case stdout, stderr
        case console
    }

    public var category: Category
    public var text: String
}

public enum EvaluateContext: String, Sendable {
    case watch, repl, hover
}

public struct ExceptionFilter: Sendable, Hashable, Codable {
    public var id: String
    public var label: String
    public var detail: String
    public var isDefault: Bool
}

public struct DebugCapabilities: Sendable, Equatable {
    public var exceptionFilters: [ExceptionFilter] = []
    public var supportsConditionalBreakpoints = false
    public var supportsHitConditionalBreakpoints = false
    public var supportsLogPoints = false
    public var supportsCompletions = false
    public var supportsTerminate = false
}

public struct DebugCompletion: Sendable, Hashable {
    public var label: String
    public var text: String
    public var type: String
    public var start: Int?
    public var length: Int
}

public struct InlineValue: Sendable, Hashable {
    public var line: Int
    public var name: String
    public var text: String
    public var isChanged: Bool
}

public struct DebugFailure: Error, Sendable, Hashable {
    public var message: String

    public init(_ message: String) {
        self.message = message
    }
}

extension DebugFailure {
    static func adapterStopped(_ adapter: String, status: Int32, output: String) -> DebugFailure {
        let tail = output.split(separator: "\n").suffix(8).joined(separator: "\n")
        let sentence = "The debug adapter (\(adapter)) stopped with status \(status) before the session ended."
        return DebugFailure(tail.isEmpty ? sentence : sentence + "\n" + tail)
    }
}
