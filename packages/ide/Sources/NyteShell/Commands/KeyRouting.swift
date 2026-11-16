import AppKit

enum KeyRouting {
    enum Focus: Equatable { case terminal, other }
    enum Owner: Equatable { case terminal, command }

    private static let reserved = [Key("`", [.control])]

    static func owner(of key: Key, focus: Focus) -> Owner {
        guard focus == .terminal, !key.modifiers.contains(.command), !key.isFunctionKey,
              !reserved.contains(where: { $0.character == key.character && $0.modifiers == key.modifiers })
        else { return .command }
        return .terminal
    }
}
