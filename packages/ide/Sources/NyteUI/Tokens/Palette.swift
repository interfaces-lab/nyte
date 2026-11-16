import AppKit

public enum Tone: UInt8, Sendable, CaseIterable {
    case neutral, primary, success, warning, danger

    public var hue: Hue? {
        switch self {
        case .neutral: nil
        case .primary: .blue
        case .success: .green
        case .warning: .yellow
        case .danger: .red
        }
    }
}

public enum Palette {
    public static func color(_ role: Role, in hue: Hue? = nil) -> NSColor {
        guard let hue else { return neutral[Int(role.rawValue)] }
        return scoped[Int(hue.rawValue)][Int(role.rawValue)]
    }

    public static func color(_ role: Role, tone: Tone) -> NSColor { color(role, in: tone.hue) }

    public static let contentPrimary = color(.contentPrimary)
    public static let contentSecondary = color(.contentSecondary)
    public static let contentTertiary = color(.contentTertiary)
    public static let contentQuaternary = color(.contentQuaternary)
    public static let contentDisabled = color(.contentDisabled)
    public static let contentOnControl = color(.contentOnControl)

    public static let strokePrimary = color(.strokePrimary)
    public static let strokeSecondary = color(.strokeSecondary)
    public static let strokeTertiary = color(.strokeTertiary)
    public static let strokeQuaternary = color(.strokeQuaternary)
    public static let fillPrimary = color(.fillPrimary)
    public static let fillSecondary = color(.fillSecondary)
    public static let fillTertiary = color(.fillTertiary)

    public static let bgBase = color(.bgBase)
    public static let bgChrome = color(.bgChrome)
    public static let bgMuted = color(.bgMuted)
    public static let bgElevated = color(.bgElevated)
    public static let bgMutedTranslucent = color(.bgMutedTranslucent)
    public static let bgScrim = color(.bgScrim)
    public static let chromeWash = role(rgba: 0xFCFC_FB83, 0x0E0E_0EA0)
    public static let scrollbarThumb = color(.scrollbarThumb)
    public static let thumbLift = role(rgba: 0xFFFF_FF00, 0xFFFF_FF29)

    public static let bgControl = color(.bgControl)
    public static let bgControlHover = color(.bgControlHover)
    public static let bgControlPressed = color(.bgControlPressed)
    public static let bgControlSelected = color(.bgControlSelected)
    public static let bgControlSelectedHover = color(.bgControlSelectedHover)
    public static let bgControlSelectedPressed = color(.bgControlSelectedPressed)

    public static let focus = role(0x2783DE, 0x2783DE)
    public static let accentFill = solidFill(.primary).rest
    public static let accentInk = color(.contentAccent, tone: .primary)
    public static let successInk = color(.contentAccent, tone: .success)
    public static let successFill = color(.strokeAccent, tone: .success)
    public static let warningInk = color(.contentAccent, tone: .warning)
    public static let warningFill = color(.strokeAccent, tone: .warning)
    public static let dangerInk = color(.contentAccent, tone: .danger)
    public static let dangerFill = color(.strokeAccent, tone: .danger)

    public static let gitModified = color(.contentTertiary, in: .blue)
    public static let gitAdded = color(.contentTertiary, in: .green)
    public static let gitDeleted = color(.contentTertiary, in: .red)
    public static let gitRenamed = color(.contentTertiary, in: .orange)
    public static let gitUntracked = color(.contentTertiary, in: .green)
    public static let gitContainsChange = role(rgba: 0x2865_A480, 0x669F_DE80)

    public static let diffAddedLine = role(rgba: DiffTable.lineAdded.light, DiffTable.lineAdded.dark)
    public static let diffAddedSpan = role(rgba: DiffTable.spanAdded.light, DiffTable.spanAdded.dark)
    public static let diffRemovedLine = role(rgba: DiffTable.lineRemoved.light, DiffTable.lineRemoved.dark)
    public static let diffRemovedSpan = role(rgba: DiffTable.spanRemoved.light, DiffTable.spanRemoved.dark)
    public static let diffAddedBar = role(rgba: DiffTable.barAdded.light, DiffTable.barAdded.dark)
    public static let diffRemovedBar = role(rgba: DiffTable.barRemoved.light, DiffTable.barRemoved.dark)
    public static let diffModifiedBar = role(rgba: DiffTable.barModified.light, DiffTable.barModified.dark)
    public static let fileIconNeutral = role(0x84848A, 0xADADB1)

    public static func solidFill(_ tone: Tone) -> (rest: NSColor, hover: NSColor, pressed: NSColor) {
        solidFills[Int(tone.rawValue)]
    }

    private static let solidFills: [(rest: NSColor, hover: NSColor, pressed: NSColor)] = Tone.allCases.map { tone in
        (color(.buttonFill, tone: tone), color(.buttonFillHover, tone: tone), color(.buttonFillPressed, tone: tone))
    }

    private static let neutral: [NSColor] = Role.allCases.map { role in
        let index = Int(role.rawValue) * 2
        let more = moreContrast[role]
        return dynamic(
            translucent(RoleTable.base[index]), translucent(RoleTable.base[index + 1]),
            more.map { (translucent($0.0), translucent($0.1)) }
        )
    }

    private static let scoped: [[NSColor]] = Hue.allCases.map { hue in
        var colors = neutral
        let values = RoleTable.hues[Int(hue.rawValue)]
        for (slot, role) in RoleTable.scoped.enumerated() {
            colors[Int(role.rawValue)] = dynamic(translucent(values[slot * 2]), translucent(values[slot * 2 + 1]), nil)
        }
        return colors
    }

    private static let moreContrast: [Role: (UInt32, UInt32)] = Dictionary(
        uniqueKeysWithValues: RoleTable.moreContrast.map { ($0.role, ($0.light, $0.dark)) }
    )

    static func role(_ light: UInt32, _ dark: UInt32, more: (UInt32, UInt32)? = nil) -> NSColor {
        dynamic(opaque(light), opaque(dark), more.map { (opaque($0.0), opaque($0.1)) })
    }

    static func role(rgba light: UInt32, _ dark: UInt32, more: (UInt32, UInt32)? = nil) -> NSColor {
        dynamic(translucent(light), translucent(dark), more.map { (translucent($0.0), translucent($0.1)) })
    }

    private static func dynamic(_ light: NSColor, _ dark: NSColor, _ more: (NSColor, NSColor)?) -> NSColor {
        NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [
                .aqua, .darkAqua, .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua,
            ])
            switch match {
            case .darkAqua: return dark
            case .accessibilityHighContrastAqua: return more?.0 ?? light
            case .accessibilityHighContrastDarkAqua: return more?.1 ?? dark
            default: return light
            }
        }
    }

    private static func opaque(_ hex: UInt32) -> NSColor {
        NSColor(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }

    private static func translucent(_ hex: UInt32) -> NSColor {
        NSColor(
            srgbRed: CGFloat((hex >> 24) & 0xFF) / 255,
            green: CGFloat((hex >> 16) & 0xFF) / 255,
            blue: CGFloat((hex >> 8) & 0xFF) / 255,
            alpha: CGFloat(hex & 0xFF) / 255
        )
    }
}

public enum SyntaxColor: UInt8, CaseIterable, Sendable {
    case plain, comment, string, escape, number, constant, keyword, `operator`, function, type, variable, builtin,
        property, tag, attribute

    public var color: NSColor {
        switch self {
        case .plain: Palette.contentPrimary
        case .comment: Palette.role(0x5B5B5B, 0xB6B6B6)
        case .string: Palette.role(0x0D692A, 0x5ECC71)
        case .escape: Palette.role(0x096759, 0x61D5C0)
        case .number: Palette.role(0x0D637B, 0x68CDF2)
        case .constant: Palette.role(0x705804, 0xFFD452)
        case .keyword: Palette.role(0xAD204E, 0xFF98AD)
        case .operator: Palette.role(0x01637D, 0x3EC4F0)
        case .function: Palette.role(0x6839CE, 0xC1A9FD)
        case .type: Palette.role(0x9129A7, 0xE09EF0)
        case .variable: Palette.role(0x8A4A16, 0xFFA359)
        case .builtin: Palette.role(0x7C520B, 0xFFAB16)
        case .property: Palette.role(0x005E9B, 0x80BAFF)
        case .tag: Palette.role(0x9E3A20, 0xFF9C82)
        case .attribute: Palette.role(0x0B6843, 0x60D199)
        }
    }
}

public enum TerminalPalette {
    public static let foreground = Palette.contentPrimary
    public static let background = Palette.bgBase
    public static let cursor = Palette.contentPrimary
    public static let selection = Palette.role(0xD4D3CF, 0x393937)

    public static let ansi: [NSColor] = [
        Palette.role(0x2C2C2B, 0x5F5E59),
        Palette.role(0xC90007, 0xFF4E54),
        Palette.role(0x007A3A, 0x3EC67A),
        Palette.role(0x9E4800, 0xFF9E22),
        Palette.role(0x2865A4, 0x669FDE),
        Palette.role(0xC70069, 0xFE66AA),
        Palette.role(0x007866, 0x15C2AC),
        Palette.role(0x83807B, 0xBCBAB6),
        Palette.role(0x494846, 0x7D7A75),
        Palette.role(0xA63536, 0xFF535A),
        Palette.role(0x116D3E, 0x0BCB74),
        Palette.role(0x955A14, 0xF79000),
        Palette.role(0x3C5F85, 0x63AFFF),
        Palette.role(0x8F355D, 0xFF4FB1),
        Palette.role(0x006A5C, 0x20C5AF),
        Palette.role(0x66635E, 0xF0EFED),
    ]
}
