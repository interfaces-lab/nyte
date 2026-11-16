import AppKit

extension SyntaxColor {
    public enum SemanticType: String, CaseIterable, Sendable {
        case namespace, type, `class`, `enum`, interface, `struct`, typeParameter, parameter, variable, property, enumMember,
            event, function, method, macro, keyword, modifier, comment, string, number, regexp, `operator`, decorator,
            label
    }

    public struct SemanticModifiers: OptionSet, Sendable, Hashable {
        public let rawValue: UInt16
        public init(rawValue: UInt16) { self.rawValue = rawValue }

        public static let declaration = SemanticModifiers(rawValue: 1 << 0)
        public static let definition = SemanticModifiers(rawValue: 1 << 1)
        public static let readonly = SemanticModifiers(rawValue: 1 << 2)
        public static let `static` = SemanticModifiers(rawValue: 1 << 3)
        public static let deprecated = SemanticModifiers(rawValue: 1 << 4)
        public static let abstract = SemanticModifiers(rawValue: 1 << 5)
        public static let async = SemanticModifiers(rawValue: 1 << 6)
        public static let modification = SemanticModifiers(rawValue: 1 << 7)
        public static let documentation = SemanticModifiers(rawValue: 1 << 8)
        public static let defaultLibrary = SemanticModifiers(rawValue: 1 << 9)

        static let names: [String: SemanticModifiers] = [
            "declaration": .declaration, "definition": .definition, "readonly": .readonly, "static": .static,
            "deprecated": .deprecated, "abstract": .abstract, "async": .async, "modification": .modification,
            "documentation": .documentation, "defaultLibrary": .defaultLibrary,
        ]

        public init(names: some Sequence<String>) {
            self = names.reduce(into: []) { $0.formUnion(Self.names[$1] ?? []) }
        }
    }

    public static func semantic(_ type: SemanticType, _ modifiers: SemanticModifiers = []) -> SyntaxColor? {
        switch type {
        case .type, .class, .enum, .interface, .struct, .typeParameter:
            modifiers.contains(.defaultLibrary) ? .builtin : .type
        case .function, .method:
            modifiers.contains(.defaultLibrary) ? .builtin : .function
        case .variable:
            modifiers.contains(.readonly) && !modifiers.isDisjoint(with: [.defaultLibrary, .static]) ? .constant : .plain
        case .namespace, .parameter: .plain
        case .property, .event: .property
        case .enumMember: .constant
        case .macro: .builtin
        case .decorator: .attribute
        case .keyword, .modifier, .comment, .string, .number, .regexp, .operator, .label: nil
        }
    }

    public static func semantic(type name: String, modifiers names: some Sequence<String> = [String]()) -> SyntaxColor? {
        SemanticType(rawValue: name).flatMap { semantic($0, SemanticModifiers(names: names)) }
    }

    public static func mark(_ type: SemanticType, _ modifiers: SemanticModifiers = []) -> SyntaxColor {
        semantic(type, modifiers) ?? lexical(type)
    }

    static func lexical(_ type: SemanticType) -> SyntaxColor {
        switch type {
        case .keyword, .modifier: .keyword
        case .string, .regexp: .string
        case .number: .number
        case .operator: .operator
        case .comment: .comment
        default: .plain
        }
    }
}
