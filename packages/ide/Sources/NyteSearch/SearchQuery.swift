import Foundation

public struct SearchQuery: Sendable, Hashable {
    public enum CaseMode: UInt8, Sendable, Hashable, Codable {
        case smart, sensitive, insensitive
    }

    public enum Scope: Sendable, Hashable {
        case workspace
        case folder(String)
        case files([String])
    }

    public struct Limits: Sendable, Hashable {
        public var matchesPerFile: Int
        public var matches: Int
        public var fileBytes: Int

        public init(matchesPerFile: Int = 1_000, matches: Int = 10_000, fileBytes: Int = 32 << 20) {
            self.matchesPerFile = matchesPerFile
            self.matches = matches
            self.fileBytes = fileBytes
        }
    }

    public var text: String
    public var caseMode: CaseMode
    public var wholeWord: Bool
    public var isRegex: Bool
    public var include: [String]
    public var exclude: [String]
    public var scope: Scope
    public var includesIgnored: Bool
    public var limits: Limits

    public init(_ text: String, caseMode: CaseMode = .smart, wholeWord: Bool = false, isRegex: Bool = false,
                include: [String] = [], exclude: [String] = [], scope: Scope = .workspace, includesIgnored: Bool = false,
                limits: Limits = Limits()) {
        self.text = text
        self.caseMode = caseMode
        self.wholeWord = wholeWord
        self.isRegex = isRegex
        self.include = include
        self.exclude = exclude
        self.scope = scope
        self.includesIgnored = includesIgnored
        self.limits = limits
    }

    public var isCaseSensitive: Bool {
        switch caseMode {
        case .sensitive: true
        case .insensitive: false
        case .smart: (isRegex ? RegexLiteral.literalCharacters(of: text) : text).unicodeScalars.contains {
            $0.properties.isUppercase
        }
        }
    }

    public static func globs(from field: String) -> [String] {
        field.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}

public struct SearchFailure: Sendable, Hashable {
    public var path: String
    public var reason: String

    public init(path: String, reason: String) {
        self.path = path
        self.reason = reason
    }
}

public struct SearchProgress: Sendable, Hashable {
    public var filesSearched = 0
    public var filesTotal = 0
    public var filesMatched = 0
    public var matches = 0

    public init() {}
}

public struct SearchSummary: Sendable {
    public enum Ending: Sendable, Equatable {
        case complete
        case capped
        case cancelled
    }

    public var ending: Ending
    public var progress: SearchProgress
    public var failures: [SearchFailure]
    public var binaryFiles: Int
    public var largeFiles: Int
    public var elapsed: Duration
    public var firstResult: Duration?
}

public enum SearchEvent: Sendable {
    case batch(SearchResults, SearchProgress)
    case finished(SearchSummary)
}

public struct PatternError: Error, Sendable, Equatable {
    public var message: String
}
