public struct KindMark: Sendable, Hashable {
    public var letter: Character
    public var token: TokenKind
}

extension SymbolKind {
    public var mark: KindMark {
        switch self {
        case .file: KindMark(letter: "D", token: .other)
        case .module, .package: KindMark(letter: "p", token: .namespace)
        case .namespace: KindMark(letter: "N", token: .namespace)
        case .class: KindMark(letter: "C", token: .class)
        case .method: KindMark(letter: "m", token: .method)
        case .property: KindMark(letter: "p", token: .property)
        case .field: KindMark(letter: "f", token: .property)
        case .constructor: KindMark(letter: "c", token: .method)
        case .enum: KindMark(letter: "E", token: .enum)
        case .interface: KindMark(letter: "I", token: .interface)
        case .function: KindMark(letter: "f", token: .function)
        case .variable: KindMark(letter: "v", token: .variable)
        case .constant: KindMark(letter: "c", token: .enumMember)
        case .string: KindMark(letter: "s", token: .string)
        case .number: KindMark(letter: "n", token: .number)
        case .boolean: KindMark(letter: "b", token: .enumMember)
        case .array: KindMark(letter: "a", token: .variable)
        case .object: KindMark(letter: "o", token: .variable)
        case .key: KindMark(letter: "k", token: .property)
        case .null: KindMark(letter: "x", token: .keyword)
        case .enumMember: KindMark(letter: "e", token: .enumMember)
        case .struct: KindMark(letter: "S", token: .struct)
        case .event: KindMark(letter: "e", token: .event)
        case .operator: KindMark(letter: "o", token: .operator)
        case .typeParameter: KindMark(letter: "T", token: .typeParameter)
        }
    }
}

extension CompletionKind {
    public var mark: KindMark {
        switch self {
        case .method: KindMark(letter: "m", token: .method)
        case .function, .constructor: KindMark(letter: "f", token: .function)
        case .field: KindMark(letter: "f", token: .property)
        case .property: KindMark(letter: "p", token: .property)
        case .variable, .reference: KindMark(letter: "v", token: .variable)
        case .constant, .value: KindMark(letter: "c", token: .enumMember)
        case .enumMember: KindMark(letter: "e", token: .enumMember)
        case .class: KindMark(letter: "C", token: .class)
        case .struct: KindMark(letter: "S", token: .struct)
        case .interface: KindMark(letter: "I", token: .interface)
        case .enum: KindMark(letter: "E", token: .enum)
        case .typeParameter: KindMark(letter: "T", token: .typeParameter)
        case .module, .folder, .file: KindMark(letter: "p", token: .namespace)
        case .keyword: KindMark(letter: "k", token: .keyword)
        case .snippet: KindMark(letter: "s", token: .other)
        case .operator: KindMark(letter: "o", token: .operator)
        case .event: KindMark(letter: "e", token: .event)
        case .unit, .color, .text: KindMark(letter: "t", token: .other)
        }
    }
}
