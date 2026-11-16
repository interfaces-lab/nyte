public struct TerminalPreferences: Sendable, Equatable {
    public enum OptionKey: Sendable, Equatable, CaseIterable {
        case none, left, right, both
    }

    public enum CursorStyle: Sendable, Equatable, CaseIterable {
        case block, bar, underline
    }

    public var shellPath: String?
    public var fontFamily: String?
    public var fontSize: Double?
    public var lineHeight: Double
    public var scrollbackLines: Int
    public var optionAsMeta: OptionKey
    public var cursorStyle: CursorStyle
    public var cursorBlinks: Bool
    public var copiesOnSelect: Bool

    public static let standard = TerminalPreferences()
    public static let lineHeightRange = 0.8 ... 2.0
    public static let scrollbackRange = 0 ... 1_000_000

    public init(shellPath: String? = nil, fontFamily: String? = nil, fontSize: Double? = nil, lineHeight: Double = 1,
                scrollbackLines: Int = 10_000, optionAsMeta: OptionKey = .left, cursorStyle: CursorStyle = .block,
                cursorBlinks: Bool = false, copiesOnSelect: Bool = false) {
        self.shellPath = shellPath
        self.fontFamily = fontFamily
        self.fontSize = fontSize
        self.lineHeight = min(max(lineHeight, Self.lineHeightRange.lowerBound), Self.lineHeightRange.upperBound)
        self.scrollbackLines = min(max(scrollbackLines, Self.scrollbackRange.lowerBound), Self.scrollbackRange.upperBound)
        self.optionAsMeta = optionAsMeta
        self.cursorStyle = cursorStyle
        self.cursorBlinks = cursorBlinks
        self.copiesOnSelect = copiesOnSelect
    }

    var font: TerminalFont { TerminalFont(family: fontFamily, size: fontSize, lineHeight: lineHeight) }
}

struct TerminalFont: Equatable {
    var family: String?
    var size: Double?
    var lineHeight: Double
}
