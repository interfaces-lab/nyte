import Foundation

public struct Indent: Sendable, Equatable {
    public static let defaultWidth = 4

    public var usesTabs: Bool
    public var width: Int

    public init(usesTabs: Bool, width: Int) {
        self.usesTabs = usesTabs
        self.width = width
    }

    public var unit: String { usesTabs ? "\t" : String(repeating: " ", count: width) }
}

struct StringRule: Sendable {
    enum Interpolation: Sendable { case none, swift, dollarBrace, shell }

    let open: [UInt16]
    let close: [UInt16]
    let escapes: Bool
    let multiline: Bool
    let interpolation: Interpolation

    init(_ open: String, _ close: String? = nil, escapes: Bool = true, multiline: Bool = false,
         interpolation: Interpolation = .none) {
        self.open = Array(open.utf16)
        self.close = Array((close ?? open).utf16)
        self.escapes = escapes
        self.multiline = multiline
        self.interpolation = interpolation
    }
}

public struct Language: Sendable {
    public enum Family: Sendable { case plain, code, markdown, markup }
    enum KeyRule: Sendable { case none, json, colon, equals }
    enum HashRule: Sendable { case none, swift, c, rust, css }
    enum RawHashes: Sendable { case none, swift, rust }

    public let name: String
    public let family: Family
    public let keywords: Set<String>
    let literals: Set<String>
    let variables: Set<String>
    let builtins: Set<String>
    public let lineComment: String?
    let lineCommentUnits: [UInt16]
    let commentNeedsSpace: Bool
    public let blockComment: (open: String, close: String)?
    let blockOpen: [UInt16]
    let blockClose: [UInt16]
    let nestedComments: Bool
    let strings: [StringRule]
    let stringPrefixes: Set<String>
    let rawHashes: RawHashes
    let lifetimes: Bool
    let atKind: SyntaxColor?
    let hashRule: HashRule
    let dollarVariables: Bool
    let dollarInIdentifiers: Bool
    let dashInIdentifiers: Bool
    let jsx: Bool
    let regexLiterals: Bool
    let macros: Bool
    let capitalTypes: Bool
    let capsConstants: Bool
    let keyRule: KeyRule
    let tableHeaders: Bool
    let yamlSigils: Bool
    public let indent: Indent

    init(
        _ name: String, family: Family = .code, keywords: String = "", literals: String = "", variables: String = "",
        builtins: String = "", lineComment: String? = nil, commentNeedsSpace: Bool = false,
        blockComment: (open: String, close: String)? = nil, nestedComments: Bool = false, strings: [StringRule] = [],
        stringPrefixes: String = "", rawHashes: RawHashes = .none, lifetimes: Bool = false, atKind: SyntaxColor? = nil,
        hashRule: HashRule = .none, dollarVariables: Bool = false, dollarInIdentifiers: Bool = false,
        dashInIdentifiers: Bool = false, jsx: Bool = false, regexLiterals: Bool = false, macros: Bool = false,
        capitalTypes: Bool = false, capsConstants: Bool = false, keyRule: KeyRule = .none, tableHeaders: Bool = false,
        yamlSigils: Bool = false, indent: Indent = Indent(usesTabs: false, width: 4)
    ) {
        func words(_ list: String) -> Set<String> { Set(list.split(separator: " ").map(String.init)) }
        self.name = name
        self.family = family
        self.keywords = words(keywords)
        self.literals = words(literals)
        self.variables = words(variables)
        self.builtins = words(builtins)
        self.lineComment = lineComment
        lineCommentUnits = Array((lineComment ?? "").utf16)
        self.commentNeedsSpace = commentNeedsSpace
        self.blockComment = blockComment
        blockOpen = Array((blockComment?.open ?? "").utf16)
        blockClose = Array((blockComment?.close ?? "").utf16)
        self.nestedComments = nestedComments
        self.strings = strings
        self.stringPrefixes = words(stringPrefixes)
        self.rawHashes = rawHashes
        self.lifetimes = lifetimes
        self.atKind = atKind
        self.hashRule = hashRule
        self.dollarVariables = dollarVariables
        self.dollarInIdentifiers = dollarInIdentifiers
        self.dashInIdentifiers = dashInIdentifiers
        self.jsx = jsx
        self.regexLiterals = regexLiterals
        self.macros = macros
        self.capitalTypes = capitalTypes
        self.capsConstants = capsConstants
        self.keyRule = keyRule
        self.tableHeaders = tableHeaders
        self.yamlSigils = yamlSigils
        self.indent = indent
    }
}

extension Language {
    public static func detect(_ url: URL) -> Language {
        detect(fileName: url.lastPathComponent)
    }

    public static func detect(fileName: String) -> Language {
        let name = fileName.lowercased()
        if let language = byName[name] { return language }
        return byExtension[(name as NSString).pathExtension] ?? plain
    }

    public static func detect(fence: String) -> Language {
        let key = fence.lowercased()
        return byExtension[fenceAliases[key] ?? key] ?? plain
    }

    private static let fenceAliases: [String: String] = [
        "golang": "go", "typescript": "ts", "javascript": "js", "python": "py", "rust": "rs", "shell": "sh",
        "bash": "sh", "zsh": "sh", "console": "sh", "objc": "m", "c++": "cpp", "markdown": "md", "yml": "yaml",
    ]

    private static let byName: [String: Language] = [
        ".bashrc": shell, ".bash_profile": shell, ".zshrc": shell, ".zprofile": shell, ".zshenv": shell,
        ".profile": shell, ".envrc": shell, "cargo.lock": toml, "pipfile": toml, ".prettierrc": json, ".babelrc": json,
    ]

    private static let byExtension: [String: Language] = [
        "swift": swift,
        "ts": typeScript, "mts": typeScript, "cts": typeScript, "tsx": tsx,
        "js": javaScript, "mjs": javaScript, "cjs": javaScript, "jsx": jsx,
        "json": json, "jsonc": json, "json5": json, "webmanifest": json,
        "md": markdown, "markdown": markdown, "mdx": markdown,
        "py": python, "pyi": python, "pyw": python,
        "go": go, "rs": rust,
        "c": c, "h": c, "cc": cpp, "cpp": cpp, "cxx": cpp, "c++": cpp, "hpp": cpp, "hh": cpp, "hxx": cpp, "ipp": cpp,
        "m": objectiveC, "mm": objectiveCpp,
        "sh": shell, "bash": shell, "zsh": shell, "ksh": shell, "command": shell,
        "yml": yaml, "yaml": yaml, "toml": toml,
        "css": css, "scss": scss, "less": scss,
        "html": html, "htm": html, "xhtml": html, "vue": html, "svelte": html,
        "xml": xml, "plist": xml, "svg": xml, "xsd": xml, "xsl": xml, "xib": xml, "storyboard": xml, "entitlements": xml,
        "csproj": xml,
    ]

    public static let plain = Language("Plain Text", family: .plain)

    static let swift = Language(
        "Swift",
        keywords: """
        associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private \
        precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default \
        defer do else fallthrough for guard if in repeat return throw switch where while as is try await async throws \
        some any actor nonisolated isolated mutating nonmutating override final required convenience lazy weak unowned \
        dynamic optional indirect get set willSet didSet consume borrowing consuming package macro sending
        """,
        literals: "true false nil", variables: "self Self super",
        lineComment: "//", blockComment: ("/*", "*/"), nestedComments: true,
        strings: [
            StringRule("\"\"\"", multiline: true, interpolation: .swift),
            StringRule("\"", interpolation: .swift),
        ],
        rawHashes: .swift, atKind: .attribute, hashRule: .swift, capitalTypes: true
    )

    private static let scriptKeywords = """
        async await break case catch class const continue debugger default delete do else export extends finally for \
        from function get if import in instanceof let new of return set static super switch throw try typeof var void \
        while with yield
        """
    private static let typeScriptKeywords = scriptKeywords + """
         abstract as asserts declare enum implements infer interface is keyof module namespace override private \
        protected public readonly satisfies type unique accessor
        """
    private static let scriptStrings = [
        StringRule("`", multiline: true, interpolation: .dollarBrace),
        StringRule("\""),
        StringRule("'"),
    ]

    static let typeScript = script("TypeScript", keywords: typeScriptKeywords, jsx: false)
    static let tsx = script("TSX", keywords: typeScriptKeywords, jsx: true)
    static let javaScript = script("JavaScript", keywords: scriptKeywords, jsx: true)
    static let jsx = script("JSX", keywords: scriptKeywords, jsx: true)

    private static func script(_ name: String, keywords: String, jsx: Bool) -> Language {
        Language(
            name, keywords: keywords, literals: "true false null undefined NaN Infinity", variables: "this",
            builtins: "any boolean never number object string symbol unknown bigint",
            lineComment: "//", blockComment: ("/*", "*/"), strings: scriptStrings, atKind: .attribute,
            dollarInIdentifiers: true, jsx: jsx, regexLiterals: true, capitalTypes: true, capsConstants: true,
            indent: Indent(usesTabs: false, width: 2)
        )
    }

    static let json = Language(
        "JSON", literals: "true false null", lineComment: "//", blockComment: ("/*", "*/"), strings: [StringRule("\"")],
        keyRule: .json, indent: Indent(usesTabs: false, width: 2)
    )

    static let markdown = Language("Markdown", family: .markdown, indent: Indent(usesTabs: false, width: 2))

    static let python = Language(
        "Python",
        keywords: """
        and as assert async await break class continue def del elif else except finally for from global if import \
        in is lambda nonlocal not or pass raise return try while with yield match case
        """,
        literals: "True False None NotImplemented Ellipsis", variables: "self cls",
        builtins: """
        print len range str int float bool list dict set tuple object type isinstance issubclass super open \
        enumerate zip map filter sorted reversed min max sum any all abs repr hash id iter next input format \
        getattr setattr hasattr delattr callable vars dir bytes bytearray frozenset property staticmethod classmethod
        """,
        lineComment: "#",
        strings: [
            StringRule("\"\"\"", multiline: true), StringRule("'''", multiline: true), StringRule("\""), StringRule("'"),
        ],
        stringPrefixes: "r u b f rb br fr rf R U B F Rb rB RB bR Br BR Fr fR FR rF Rf RF",
        atKind: .attribute, capitalTypes: true, capsConstants: true
    )

    static let go = Language(
        "Go",
        keywords: """
        break case chan const continue default defer else fallthrough for func go goto if import interface map \
        package range return select struct switch type var
        """,
        literals: "true false nil iota",
        builtins: """
        append cap clear close complex copy delete imag len make max min new panic print println real recover any \
        bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint \
        uint8 uint16 uint32 uint64 uintptr
        """,
        lineComment: "//", blockComment: ("/*", "*/"),
        strings: [StringRule("`", escapes: false, multiline: true), StringRule("\""), StringRule("'")],
        capitalTypes: true, indent: Indent(usesTabs: true, width: 4)
    )

    static let rust = Language(
        "Rust",
        keywords: """
        as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut \
        pub ref return static struct super trait type union unsafe use where while yield macro_rules
        """,
        literals: "true false Some None Ok Err", variables: "self Self",
        builtins: "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str",
        lineComment: "//", blockComment: ("/*", "*/"), nestedComments: true,
        strings: [StringRule("\"", multiline: true), StringRule("'")],
        stringPrefixes: "r b br c cr", rawHashes: .rust, lifetimes: true, hashRule: .rust, macros: true,
        capitalTypes: true, capsConstants: true
    )

    private static let cKeywords = """
        auto break case char const continue default do double else enum extern float for goto if inline int long \
        register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while \
        _Bool _Complex _Imaginary _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local bool
        """
    private static let cppKeywords = """
         alignas alignof and and_eq asm bitand bitor catch char8_t char16_t char32_t class co_await co_return co_yield \
        compl concept consteval constexpr constinit const_cast decltype delete dynamic_cast explicit export friend \
        mutable namespace new noexcept not not_eq operator or or_eq private protected public reinterpret_cast requires \
        static_assert static_cast template thread_local throw try typeid typename using virtual wchar_t xor xor_eq \
        override final
        """
    private static let objectiveCKeywords = " id instancetype nonatomic atomic strong weak copy assign readonly readwrite "
        + "nullable nonnull __block __weak __strong __kindof"
    private static let cBuiltins = """
        size_t ssize_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t uintptr_t intptr_t ptrdiff_t FILE
        """
    private static let cStrings = [StringRule("\""), StringRule("'")]
    private static let objectiveCStrings = [StringRule("@\""), StringRule("\""), StringRule("'")]

    static let c = Language(
        "C", keywords: cKeywords, literals: "true false NULL nullptr", builtins: cBuiltins,
        lineComment: "//", blockComment: ("/*", "*/"), strings: cStrings, stringPrefixes: "L u U u8",
        hashRule: .c, capitalTypes: true, capsConstants: true
    )

    static let cpp = Language(
        "C++", keywords: cKeywords + cppKeywords, literals: "true false NULL nullptr", variables: "this",
        builtins: cBuiltins + " std string vector map unique_ptr shared_ptr",
        lineComment: "//", blockComment: ("/*", "*/"), strings: cStrings, stringPrefixes: "L u U u8",
        hashRule: .c, capitalTypes: true, capsConstants: true
    )

    static let objectiveC = Language(
        "Objective-C", keywords: cKeywords + objectiveCKeywords, literals: "true false NULL nil Nil YES NO",
        variables: "self super", builtins: cBuiltins + " BOOL SEL IMP Class",
        lineComment: "//", blockComment: ("/*", "*/"), strings: objectiveCStrings, stringPrefixes: "L u U u8",
        atKind: .keyword, hashRule: .c, capitalTypes: true, capsConstants: true
    )

    static let objectiveCpp = Language(
        "Objective-C++", keywords: cKeywords + cppKeywords + objectiveCKeywords,
        literals: "true false NULL nullptr nil Nil YES NO", variables: "self super this",
        builtins: cBuiltins + " BOOL SEL IMP Class",
        lineComment: "//", blockComment: ("/*", "*/"), strings: objectiveCStrings, stringPrefixes: "L u U u8",
        atKind: .keyword, hashRule: .c, capitalTypes: true, capsConstants: true
    )

    static let shell = Language(
        "Shell",
        keywords: """
        if then else elif fi case esac for select while until do done in function time coproc return exit break \
        continue local export readonly declare typeset unset shift source alias eval exec trap set
        """,
        literals: "true false", builtins: "echo printf cd pwd test read let",
        lineComment: "#", commentNeedsSpace: true,
        strings: [
            StringRule("\"", multiline: true, interpolation: .shell),
            StringRule("'", escapes: false, multiline: true),
        ],
        dollarVariables: true, dashInIdentifiers: true, indent: Indent(usesTabs: false, width: 2)
    )

    static let yaml = Language(
        "YAML", literals: "true false null yes no on off True False Null TRUE FALSE NULL ~",
        lineComment: "#", commentNeedsSpace: true,
        strings: [StringRule("\""), StringRule("'", escapes: false)],
        dashInIdentifiers: true, keyRule: .colon, yamlSigils: true, indent: Indent(usesTabs: false, width: 2)
    )

    static let toml = Language(
        "TOML", literals: "true false inf nan", lineComment: "#",
        strings: [
            StringRule("\"\"\"", multiline: true), StringRule("'''", escapes: false, multiline: true),
            StringRule("\""), StringRule("'", escapes: false),
        ],
        dashInIdentifiers: true, keyRule: .equals, tableHeaders: true
    )

    static let css = Language(
        "CSS", keywords: "important", blockComment: ("/*", "*/"), strings: [StringRule("\""), StringRule("'")],
        atKind: .keyword, hashRule: .css, dashInIdentifiers: true, keyRule: .colon,
        indent: Indent(usesTabs: false, width: 2)
    )

    static let scss = Language(
        "SCSS", keywords: "important", lineComment: "//", blockComment: ("/*", "*/"),
        strings: [StringRule("\""), StringRule("'")], atKind: .keyword, hashRule: .css, dollarVariables: true,
        dashInIdentifiers: true, keyRule: .colon, indent: Indent(usesTabs: false, width: 2)
    )

    static let html = Language(
        "HTML", family: .markup, blockComment: ("<!--", "-->"), indent: Indent(usesTabs: false, width: 2)
    )

    static let xml = Language(
        "XML", family: .markup, blockComment: ("<!--", "-->"), indent: Indent(usesTabs: false, width: 2)
    )
}
