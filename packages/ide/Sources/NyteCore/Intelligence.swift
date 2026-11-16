import Foundation

public struct Diagnostic: Sendable, Hashable {
    public enum Severity: UInt8, Sendable, CaseIterable {
        case error, warning, information, hint

        public func isMoreSevere(than other: Severity) -> Bool { rawValue < other.rawValue }
    }

    public struct Tags: OptionSet, Sendable, Hashable {
        public let rawValue: UInt8
        public init(rawValue: UInt8) { self.rawValue = rawValue }

        public static let unnecessary = Tags(rawValue: 1 << 0)
        public static let deprecated = Tags(rawValue: 1 << 1)
    }

    public struct Related: Sendable, Hashable {
        public var location: FileLocation
        public var message: String

        public init(location: FileLocation, message: String) {
            self.location = location
            self.message = message
        }
    }

    public var range: TextSpan
    public var severity: Severity
    public var message: String
    public var source: String
    public var code: String
    public var tags: Tags
    public var related: [Related]

    public init(range: TextSpan, severity: Severity, message: String, source: String = "", code: String = "",
                tags: Tags = [], related: [Related] = []) {
        self.range = range
        self.severity = severity
        self.message = message
        self.source = source
        self.code = code
        self.tags = tags
        self.related = related
    }
}

public enum SymbolKind: UInt8, Sendable, CaseIterable {
    case file, module, namespace, package, `class`, method, property, field, constructor, `enum`, interface, function,
        variable, constant, string, number, boolean, array, object, key, null, enumMember, `struct`, event,
        `operator`, typeParameter
}

public struct DocumentSymbol: Sendable, Hashable {
    public var name: String
    public var detail: String
    public var kind: SymbolKind
    public var range: TextSpan
    public var selection: TextSpan
    public var depth: Int
    public var isDeprecated: Bool
    public var signature: String

    public init(name: String, detail: String = "", kind: SymbolKind, range: TextSpan, selection: TextSpan,
                depth: Int = 0, isDeprecated: Bool = false, signature: String = "") {
        self.signature = signature
        self.name = name
        self.detail = detail
        self.kind = kind
        self.range = range
        self.selection = selection
        self.depth = depth
        self.isDeprecated = isDeprecated
    }
}

public struct WorkspaceSymbol: Sendable, Hashable {
    public var name: String
    public var kind: SymbolKind
    public var container: String
    public var location: FileLocation

    public init(name: String, kind: SymbolKind, container: String = "", location: FileLocation) {
        self.name = name
        self.kind = kind
        self.container = container
        self.location = location
    }
}

public enum CompletionKind: UInt8, Sendable, CaseIterable {
    case text, method, function, constructor, field, variable, `class`, interface, module, property, unit, value,
        `enum`, keyword, snippet, color, file, reference, folder, enumMember, constant, `struct`, event, `operator`,
        typeParameter
}

public enum CompletionTrigger: Sendable, Equatable {
    case invoked
    case character(String)
    case incomplete
}

public struct ResolveToken: Sendable, Hashable {
    @_spi(LanguageService) public let generation: UInt32
    @_spi(LanguageService) public let index: UInt32

    @_spi(LanguageService) public init(generation: UInt32, index: UInt32) {
        self.generation = generation
        self.index = index
    }

    public static let unissued = ResolveToken(generation: 0, index: 0)
}

public struct CompletionItem: Sendable, Hashable {
    public enum Invocation: Sendable, Hashable {
        case notCallable
        case withoutArguments
        case withArguments
    }

    public struct Stop: Sendable, Hashable {
        public var utf16Offset: Int
        public var utf16Length: Int

        public init(utf16Offset: Int, utf16Length: Int) {
            self.utf16Offset = utf16Offset
            self.utf16Length = utf16Length
        }
    }

    public var label: String
    public var kind: CompletionKind
    public var tail: String
    public var type: String
    public var documentation: String
    public var filter: String
    public var sort: String
    public var text: String
    public var replace: TextSpan?
    public var stops: [Stop]
    public var additionalEdits: [TextEdit]
    public var commitCharacters: [String]
    public var isPreselected: Bool
    public var isDeprecated: Bool
    public var invocation: Invocation
    public var token: ResolveToken

    public init(label: String, kind: CompletionKind = .text, tail: String = "", type: String = "",
                documentation: String = "", filter: String? = nil, sort: String? = nil, text: String? = nil,
                replace: TextSpan? = nil, stops: [Stop] = [], additionalEdits: [TextEdit] = [],
                commitCharacters: [String] = [], isPreselected: Bool = false, isDeprecated: Bool = false,
                invocation: Invocation = .notCallable, token: ResolveToken = .unissued) {
        self.label = label
        self.kind = kind
        self.tail = tail
        self.type = type
        self.documentation = documentation
        self.filter = filter ?? label
        self.sort = sort ?? label
        self.text = text ?? label
        self.replace = replace
        self.stops = stops
        self.additionalEdits = additionalEdits
        self.commitCharacters = commitCharacters
        self.isPreselected = isPreselected
        self.isDeprecated = isDeprecated
        self.invocation = invocation
        self.token = token
    }
}

public struct CompletionList: Sendable, Hashable {
    public var items: [CompletionItem]
    public var isIncomplete: Bool

    public init(items: [CompletionItem] = [], isIncomplete: Bool = false) {
        self.items = items
        self.isIncomplete = isIncomplete
    }
}

public struct Hover: Sendable, Hashable {
    public var markdown: String
    public var range: TextSpan?

    public init(markdown: String, range: TextSpan? = nil) {
        self.markdown = markdown
        self.range = range
    }
}

public struct SignatureHelp: Sendable, Hashable {
    public struct Signature: Sendable, Hashable {
        public var label: String
        public var documentation: String
        public var parameterUTF16Ranges: [Range<Int>]

        public init(label: String, documentation: String = "", parameterUTF16Ranges: [Range<Int>] = []) {
            self.label = label
            self.documentation = documentation
            self.parameterUTF16Ranges = parameterUTF16Ranges
        }
    }

    public var signatures: [Signature]
    public var activeSignature: Int
    public var activeParameter: Int?

    public init(signatures: [Signature], activeSignature: Int = 0, activeParameter: Int? = nil) {
        self.signatures = signatures
        self.activeSignature = activeSignature
        self.activeParameter = activeParameter
    }
}

public enum LocationQuery: Sendable, Hashable {
    case definition, typeDefinition, implementations
    case references(includeDeclaration: Bool)
}

public struct InlayHint: Sendable, Hashable {
    public enum Kind: UInt8, Sendable { case type, parameter, other }

    public var position: TextPosition
    public var label: String
    public var kind: Kind
    public var padsLeading: Bool
    public var padsTrailing: Bool

    public init(position: TextPosition, label: String, kind: Kind = .other, padsLeading: Bool = false,
                padsTrailing: Bool = false) {
        self.position = position
        self.label = label
        self.kind = kind
        self.padsLeading = padsLeading
        self.padsTrailing = padsTrailing
    }
}

public enum TokenKind: UInt8, Sendable, CaseIterable {
    case namespace, type, `class`, `enum`, interface, `struct`, typeParameter, parameter, variable, property, enumMember,
        event, function, method, macro, keyword, modifier, comment, string, number, regexp, `operator`, decorator,
        label, other
}

public struct TokenModifiers: OptionSet, Sendable, Hashable {
    public let rawValue: UInt16
    public init(rawValue: UInt16) { self.rawValue = rawValue }

    public static let declaration = TokenModifiers(rawValue: 1 << 0)
    public static let definition = TokenModifiers(rawValue: 1 << 1)
    public static let readonly = TokenModifiers(rawValue: 1 << 2)
    public static let `static` = TokenModifiers(rawValue: 1 << 3)
    public static let deprecated = TokenModifiers(rawValue: 1 << 4)
    public static let abstract = TokenModifiers(rawValue: 1 << 5)
    public static let async = TokenModifiers(rawValue: 1 << 6)
    public static let modification = TokenModifiers(rawValue: 1 << 7)
    public static let documentation = TokenModifiers(rawValue: 1 << 8)
    public static let defaultLibrary = TokenModifiers(rawValue: 1 << 9)
}

public struct SemanticTokens: Sendable, Hashable {
    public var lines: [Int32]
    public var columns: [Int32]
    public var lengths: [Int32]
    public var kinds: [TokenKind]
    public var modifiers: [TokenModifiers]

    public init(lines: [Int32] = [], columns: [Int32] = [], lengths: [Int32] = [], kinds: [TokenKind] = [],
                modifiers: [TokenModifiers] = []) {
        self.lines = lines
        self.columns = columns
        self.lengths = lengths
        self.kinds = kinds
        self.modifiers = modifiers
    }

    public var count: Int { lines.count }

    public func indices(onLines first: Int, through last: Int) -> Range<Int> {
        func lowerBound(_ line: Int32) -> Int {
            var low = 0
            var high = lines.count
            while low < high {
                let middle = (low + high) / 2
                if lines[middle] < line { low = middle + 1 } else { high = middle }
            }
            return low
        }
        return lowerBound(Int32(first))..<lowerBound(Int32(last + 1))
    }
}

public struct RenameTarget: Sendable, Hashable {
    public var range: TextSpan
    public var placeholder: String

    public init(range: TextSpan, placeholder: String) {
        self.range = range
        self.placeholder = placeholder
    }
}

public struct CodeAction: Sendable, Hashable {
    public enum Kind: UInt8, Sendable { case quickFix, refactor, extract, inline, rewrite, source, organizeImports, fixAll, other }

    public var title: String
    public var kind: Kind
    public var isPreferred: Bool
    public var disabledReason: String
    public var token: ResolveToken

    public init(title: String, kind: Kind = .other, isPreferred: Bool = false, disabledReason: String = "",
                token: ResolveToken = .unissued) {
        self.title = title
        self.kind = kind
        self.isPreferred = isPreferred
        self.disabledReason = disabledReason
        self.token = token
    }
}

public struct IntelligenceFailure: Error, Sendable, Hashable {
    public var message: String

    public init(_ message: String) {
        self.message = message
    }

    public enum FileOperation: String, Sendable, Hashable {
        case create, rename, delete
    }

    public static func refusing(_ operation: FileOperation) -> IntelligenceFailure {
        IntelligenceFailure("This change would \(operation.rawValue) a file, which the editor cannot do yet. Nothing was changed.")
    }
}

public struct ServerStatus: Sendable, Hashable {
    public enum State: Sendable, Hashable {
        case missing(hint: String)
        case starting
        case ready
        case busy(title: String, percent: Int?)
        case failed(String)
    }

    public enum Offer: Sendable, Hashable {
        case useTSServer, useNative

        public var title: String {
            switch self {
            case .useTSServer: "Use tsserver for This Workspace"
            case .useNative: "Use Native for This Workspace"
            }
        }
    }

    public var id: Int
    public var name: String
    public var shortName: String
    public var state: State
    public var version: String
    public var location: URL?
    public var root: URL?
    public var residentBytes: Int?
    public var memoryCeiling: Int?
    public var source: ToolSource?
    public var note: String?
    public var install: ToolInstall?
    public var offer: Offer?

    public init(id: Int = 0, name: String, shortName: String? = nil, state: State, version: String = "", location: URL? = nil,
                root: URL? = nil, residentBytes: Int? = nil, memoryCeiling: Int? = nil) {
        self.id = id
        self.name = name
        self.shortName = shortName ?? name
        self.state = state
        self.version = version
        self.location = location
        self.root = root
        self.residentBytes = residentBytes
        self.memoryCeiling = memoryCeiling
    }

    public var headline: String {
        [version.isEmpty ? name : version, note].compactMap(\.self).joined(separator: " \u{00B7} ")
    }

    public var isOverMemoryCeiling: Bool {
        guard let residentBytes, let memoryCeiling else { return false }
        return residentBytes > memoryCeiling
    }
}

public enum IntelligenceEvent: Sendable {
    case diagnostics(URL)
    case status(ServerStatus)
    case notice(String, Diagnostic.Severity)
}

@MainActor
public protocol LanguageIntelligence: AnyObject {
    var onEvent: ((IntelligenceEvent) -> Void)? { get set }
    var applyEdit: ((WorkspaceEdit) async -> Bool)? { get set }

    func handles(_ url: URL) -> Bool
    func status(for url: URL) -> ServerStatus?
    func triggers(for url: URL) -> (completion: Set<String>, signature: Set<String>)

    func open(_ url: URL, text: String)
    func change(_ url: URL, range: TextSpan, text: String)
    func save(_ url: URL)
    func close(_ url: URL)
    func filesDidChange(_ urls: [URL])

    func diagnostics(for url: URL) -> [Diagnostic]
    var filesWithDiagnostics: [URL] { get }

    func completions(at position: TextPosition, in url: URL, trigger: CompletionTrigger) async -> CompletionList
    func resolve(_ item: CompletionItem) async -> CompletionItem
    func hover(at position: TextPosition, in url: URL) async -> Hover?
    func signatureHelp(at position: TextPosition, in url: URL) async -> SignatureHelp?
    func locations(_ query: LocationQuery, at position: TextPosition, in url: URL) async -> [FileLocation]
    func highlights(at position: TextPosition, in url: URL) async -> [TextSpan]
    func symbols(in url: URL) async -> [DocumentSymbol]
    func symbols(matching query: String) async -> [WorkspaceSymbol]
    func inlayHints(in range: TextSpan, of url: URL) async -> [InlayHint]
    func semanticTokens(for url: URL) async -> SemanticTokens?

    func renameTarget(at position: TextPosition, in url: URL) async -> RenameTarget?
    func rename(at position: TextPosition, in url: URL, to name: String) async -> Result<WorkspaceEdit, IntelligenceFailure>
    func actions(in range: TextSpan, of url: URL) async -> [CodeAction]
    func perform(_ action: CodeAction) async -> Result<Void, IntelligenceFailure>
    func formatting(for url: URL, indent: Int, usesTabs: Bool) async -> [TextEdit]

    func runMarks(in url: URL) async -> [RunMark]
    func usages(in range: TextSpan, of url: URL) async -> [UsageCount]
    func symbolSearch(_ query: String, near url: URL?) -> AsyncStream<SymbolResults>
    func editsBeforeSave(_ url: URL, indent: Int, usesTabs: Bool, deadline: Duration) async -> SavePreparation
    func openText(of url: URL) -> String?
    func classifiedReferences(at position: TextPosition, in url: URL) async -> [Usage]
}

public struct SourceBreakpoint: Sendable, Hashable {
    public enum Verification: Sendable, Hashable {
        case notDebugging
        case unverified
        case verified
    }

    public var zeroBasedLine: Int
    public var isEnabled: Bool
    public var condition: String
    public var hitCondition: String
    public var logMessage: String
    public var verification: Verification

    public init(zeroBasedLine: Int, isEnabled: Bool = true, condition: String = "", hitCondition: String = "", logMessage: String = "",
                verification: Verification = .notDebugging) {
        self.zeroBasedLine = zeroBasedLine
        self.isEnabled = isEnabled
        self.condition = condition
        self.hitCondition = hitCondition
        self.logMessage = logMessage
        self.verification = verification
    }

    public var isLogpoint: Bool { !logMessage.isEmpty }
    public var isConditional: Bool { !condition.isEmpty || !hitCondition.isEmpty }
}
