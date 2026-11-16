import AppKit

extension RowContent.Mark {
    public static func code(letter: Character, semanticType name: String, modifiers: some Sequence<String> = [String]()) -> Self {
        let type = SyntaxColor.SemanticType(rawValue: name)
        return .code(letter, type.map { SyntaxColor.mark($0, SyntaxColor.SemanticModifiers(names: modifiers)) } ?? .plain)
    }
}
