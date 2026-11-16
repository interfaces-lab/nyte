import Foundation

public struct RunTarget: Sendable, Hashable {
    public enum Program: Sendable, Hashable {
        case goPackage(importPath: String)
        case goTest(importPath: String)
        case node(script: URL)
    }

    public var name: String
    public var program: Program
    public var directory: URL
    public var arguments: [String]
    public var runtimeArguments: [String]
    public var command: [String]

    public init(name: String, program: Program, directory: URL, arguments: [String] = [], runtimeArguments: [String] = [],
                command: [String]) {
        self.name = name
        self.program = program
        self.directory = directory
        self.arguments = arguments
        self.runtimeArguments = runtimeArguments
        self.command = command
    }
}

public struct RunMark: Sendable, Hashable {
    public enum Kind: UInt8, Sendable, CaseIterable {
        case program, test, suite
    }

    public var line: Int
    public var kind: Kind
    public var title: String
    public var target: RunTarget

    public init(line: Int, kind: Kind, title: String, target: RunTarget) {
        self.line = line
        self.kind = kind
        self.title = title
        self.target = target
    }
}

public struct UsageCount: Sendable, Hashable {
    public var name: String
    public var kind: SymbolKind
    public var selection: TextSpan
    public var usages: Int?
    public var implementations: Int?

    public init(name: String, kind: SymbolKind, selection: TextSpan, usages: Int?, implementations: Int? = nil) {
        self.name = name
        self.kind = kind
        self.selection = selection
        self.usages = usages
        self.implementations = implementations
    }
}

public struct SymbolMatch: Sendable, Hashable {
    public enum Quality: UInt8, Sendable, Comparable, CaseIterable {
        case exact, exactIgnoringCase, prefix, prefixIgnoringCase, wordStarts, substring, scattered

        public static func < (left: Quality, right: Quality) -> Bool { left.rawValue < right.rawValue }
    }

    public var symbol: WorkspaceSymbol
    public var quality: Quality
    public var matched: [NSRange]
    public var file: String

    public init(symbol: WorkspaceSymbol, quality: Quality, matched: [NSRange], file: String) {
        self.symbol = symbol
        self.quality = quality
        self.matched = matched
        self.file = file
    }
}

public struct SymbolResults: Sendable, Hashable {
    public var query: String
    public var matches: [SymbolMatch]
    public var isComplete: Bool

    public init(query: String, matches: [SymbolMatch] = [], isComplete: Bool = false) {
        self.query = query
        self.matches = matches
        self.isComplete = isComplete
    }
}

public struct SavePreparation: Sendable, Hashable {
    public enum Step: UInt8, Sendable, CaseIterable {
        case format, organizeImports
    }

    public enum Outcome: Sendable, Hashable {
        case unchanged
        case changed
        case timedOut(String)
        case failed(String)
        case outdated
    }

    public var edits: [TextEdit]
    public var steps: [Step]
    public var outcome: Outcome

    public init(edits: [TextEdit] = [], steps: [Step] = [], outcome: Outcome) {
        self.edits = edits
        self.steps = steps
        self.outcome = outcome
    }

    public static let defaultDeadline: Duration = .milliseconds(1_500)
}

public struct Usage: Sendable, Hashable {
    public enum Kind: UInt8, Sendable, Hashable, CaseIterable {
        case declaration, write, read, `import`, other

        public var title: String {
            switch self {
            case .declaration: "Declaration"
            case .write: "Value write"
            case .read: "Value read"
            case .import: "Import"
            case .other: "Usages"
            }
        }
    }

    public var location: FileLocation
    public var kind: Kind

    public init(location: FileLocation, kind: Kind = .other) {
        self.location = location
        self.kind = kind
    }
}
