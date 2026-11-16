import AppKit

public enum GitChange: UInt8, Sendable, CaseIterable {
    case modified, added, deleted, renamed, untracked, conflicted

    public var letter: Character {
        switch self {
        case .modified: "M"
        case .added: "A"
        case .deleted: "D"
        case .renamed: "R"
        case .untracked: "U"
        case .conflicted: "C"
        }
    }

    public var word: String {
        switch self {
        case .modified: "modified"
        case .added: "added"
        case .deleted: "deleted"
        case .renamed: "renamed"
        case .untracked: "untracked"
        case .conflicted: "conflicted"
        }
    }

    public var ink: RowContent.Ink {
        switch self {
        case .modified: .hue(.blue)
        case .added, .untracked: .hue(.green)
        case .deleted: .hue(.red)
        case .renamed: .hue(.orange)
        case .conflicted: .tone(.danger)
        }
    }

    public var status: RowContent.Status { RowContent.Status(letter, ink: ink) }

    @MainActor public var bar: NSColor {
        switch self {
        case .added, .untracked: Palette.diffAddedBar
        case .deleted: Palette.diffRemovedBar
        case .modified, .renamed, .conflicted: Palette.diffModifiedBar
        }
    }
}
