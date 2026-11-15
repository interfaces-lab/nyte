import AppKit

/// Nyte's colour roles, resolved from the same generated table the mobile app reads
/// (`platformColors` in @nyte-ai/ui). Each role is a light, dark and increased-contrast set.
public enum Palette {
    // Ink, strongest first. Text never fades with opacity; pick a lower step instead.
    public static let contentPrimary = role(0x2C2C2B, 0xF0EFED, more: (0x202020, 0xFFFFFF))
    public static let contentSecondary = role(0x494846, 0xBCBAB6, more: (0x383836, 0xE6E5E3))
    public static let contentTertiary = role(0x66635E, 0xA19E99, more: (0x494846, 0xBCBAB6))
    public static let contentQuaternary = role(0x83807B, 0x7D7A75, more: (0x5F5E59, 0xA19E99))
    public static let contentDisabled = role(0xBCBAB6, 0x5F5E59, more: (0xA19E99, 0x7D7A75))
    public static let contentOnControl = role(0xFFFFFF, 0xFFFFFF)

    // Translucent strokes and fills sit on any surface. State climbs: none, tertiary, secondary, primary.
    public static let strokePrimary = role(0x5F5E59, 0x8E8B86)
    public static let strokeSecondary = role(rgba: 0x1B15_0030, 0xFFFC_EB4E, more: (0x150E_0049, 0xFFFC_EB4E))
    public static let strokeTertiary = role(rgba: 0x1B12_001C, 0xFFFF_F022, more: (0x1B15_0030, 0xFFFA_F135))
    public static let strokeQuaternary = role(rgba: 0x2B1C_0012, 0xFFFF_FF0F, more: (0x1B12_001C, 0xFFFF_F022))
    public static let fillPrimary = role(rgba: 0x1B15_0030, 0xFFFF_F022, more: (0x150E_0049, 0xFFFA_F135))
    public static let fillSecondary = role(rgba: 0x2B1C_0012, 0xFFFF_F315, more: (0x1B15_0030, 0xFFFF_F022))
    public static let fillTertiary = role(rgba: 0x3B14_000D, 0xFFFF_FF0F, more: (0x1B12_001C, 0xFFFF_F315))

    // Surfaces.
    public static let bgBase = role(0xFFFFFF, 0x1B1B1B)
    public static let bgChrome = role(0xFBFBFA, 0x191919)
    public static let bgMuted = role(0xF9F8F7, 0x202020)
    public static let bgElevated = role(0xFFFFFF, 0x202020)
    public static let bgMutedTranslucent = role(rgba: 0x4020_0008, 0xFFFF_FF08)
    /// The wash laid over the window's vibrancy; the sidebar sits directly on it.
    public static let chromeWash = role(rgba: 0xFBFB_FA8F, 0x1919_19A8)
    public static let scrollbarThumb = role(rgba: 0xA19E_9980, 0x7D7A_7580)

    // Hue is rare: the primary action, focus, and status.
    public static let focus = role(0x2783DE, 0x2783DE)
    public static let accentFill = role(0x3884D2, 0x3884D2)
    public static let accentInk = role(0x3C5F85, 0x63AFFF)
    public static let accentWash = role(rgba: 0x197C_D613, 0x4A9C_F11E)
    public static let successInk = role(0x116D3E, 0x0BCB74)
    public static let successFill = role(0x00AB56, 0x00AB56)
    public static let warningInk = role(0x955A14, 0xF79000)
    public static let dangerInk = role(0xA63536, 0xFF535A)
    public static let dangerFill = role(0xFF3042, 0xFF3042)

    /// Git status marks in the file tree, taken from each hue's tertiary ink.
    public static let gitModified = role(0x2865A4, 0x669FDE)
    public static let gitAdded = role(0x007A3A, 0x3EC67A)
    public static let gitDeleted = role(0xC90007, 0xFF4E54)
    public static let gitRenamed = role(0x9E4800, 0xFF9E22)

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

/// Syntax colours: Pierre's light and dark themes, each already moved to 4.5:1 on Nyte's code surfaces.
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

/// The terminal's sixteen colours, derived from the roles the way the desktop app derives them.
public enum TerminalPalette {
    public static let foreground = Palette.contentPrimary
    public static let background = Palette.bgBase
    public static let cursor = Palette.contentPrimary
    public static let selection = Palette.role(0xD4D3CF, 0x393937)

    public static let ansi: [NSColor] = [
        Palette.role(0x2C2C2B, 0x1B1B1B),
        Palette.role(0xC90007, 0xFF4E54),
        Palette.role(0x007A3A, 0x3EC67A),
        Palette.role(0x9E4800, 0xFF9E22),
        Palette.role(0x2865A4, 0x669FDE),
        Palette.role(0xC70069, 0xFE66AA),
        Palette.role(0x007866, 0x15C2AC),
        Palette.role(0xFFFFFF, 0xF0EFED),
        Palette.role(0x494846, 0xBCBAB6),
        Palette.role(0xA63536, 0xFF535A),
        Palette.role(0x116D3E, 0x0BCB74),
        Palette.role(0x955A14, 0xF79000),
        Palette.role(0x3C5F85, 0x63AFFF),
        Palette.role(0x8F355D, 0xFF4FB1),
        Palette.role(0x006A5C, 0x20C5AF),
        Palette.role(0xFFFFFF, 0xF0EFED),
    ]
}
