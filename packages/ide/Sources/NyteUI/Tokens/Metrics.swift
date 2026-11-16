import AppKit

public enum Space {
    public static let hair: CGFloat = 1
    public static let x05: CGFloat = 2
    public static let x1: CGFloat = 4
    public static let x15: CGFloat = 6
    public static let x2: CGFloat = 8
    public static let x25: CGFloat = 10
    public static let x3: CGFloat = 12
    public static let x4: CGFloat = 16
    public static let x5: CGFloat = 20
    public static let x6: CGFloat = 24
    public static let x8: CGFloat = 32
}

public enum Radius {
    public static let indicator: CGFloat = 4
    public static let small: CGFloat = 6
    public static let control: CGFloat = 8
    public static let pane: CGFloat = 10
    public static let card: CGFloat = 12
    public static let menu: CGFloat = 14
    public static let surface: CGFloat = 16
    public static let composer: CGFloat = 16

    public static func nested(in outer: CGFloat, padding: CGFloat) -> CGFloat { max(0, outer - padding) }
}

public enum Glyph: CGFloat, Sendable, CaseIterable {
    case xxs = 10, xs = 12, sm = 14, md = 16, lg = 20

    public var pointSize: CGFloat { rawValue * 13 / 16 }
}

public enum Size: Sendable, CaseIterable {
    case xxs, xs, sm, md, lg, xl

    public var height: CGFloat { Density.current == .compact ? compactHeight : standardHeight }

    public var standardHeight: CGFloat {
        switch self {
        case .xxs: 16
        case .xs: 20
        case .sm: 24
        case .md: 28
        case .lg: 32
        case .xl: 36
        }
    }

    public var compactHeight: CGFloat {
        switch self {
        case .xxs: 14
        case .xs: 18
        case .sm: 22
        case .md: 24
        case .lg: 28
        case .xl: 32
        }
    }

    public var padding: CGFloat {
        switch self {
        case .xxs: 4
        case .xs: 6
        case .sm, .md: 8
        case .lg: 10
        case .xl: 12
        }
    }

    public var radius: CGFloat {
        switch self {
        case .xxs, .xs: Radius.indicator
        case .sm: Radius.small
        case .md, .lg: Radius.control
        case .xl: 10
        }
    }

    public var gap: CGFloat {
        switch self {
        case .xxs, .xs: 4
        case .sm, .md: 6
        case .lg, .xl: 8
        }
    }

    public var text: TextStyle {
        switch self {
        case .xxs, .xs: .sm
        default: .base
        }
    }

    public var glyph: Glyph {
        switch self {
        case .xxs, .xs: .xs
        case .sm, .md, .lg: .sm
        case .xl: .md
        }
    }

    public var soloGlyph: Glyph {
        switch self {
        case .xxs, .xs: .xs
        case .sm: .sm
        case .md, .lg: .md
        case .xl: .lg
        }
    }
}

public enum Metric {
    public static let titlebar: CGFloat = 40
    public static let trafficLights: CGFloat = 80
    public static let gutter: CGFloat = 8
    public static var row: CGFloat { Density.pick(compact: 24, standard: 28) }
    public static var rowCompact: CGFloat { Density.pick(compact: 22, standard: 24) }
    public static var rowDouble: CGFloat { Density.pick(compact: 36, standard: 40) }
    public static var commandBar: CGFloat { Density.pick(compact: 40, standard: 48) }
    public static var tab: CGFloat { Density.pick(compact: 24, standard: 28) }
    public static var paneHeader: CGFloat { Density.pick(compact: 28, standard: 32) }
    public static var paneFooter: CGFloat { Density.pick(compact: 22, standard: 24) }
    public static var iconButton: CGFloat { Density.pick(compact: 24, standard: 28) }
    public static var headerButton: CGFloat { Density.pick(compact: 22, standard: 24) }
    public static var paneInset: CGFloat { Density.pick(compact: 8, standard: 12) }
    public static var rowInset: CGFloat { Density.pick(compact: 6, standard: 8) }
    public static let hairline: CGFloat = 1
    public static let contentInset: CGFloat = 8
    public static let contentRadius: CGFloat = 6
    public static let settingsSidebarWidth: CGFloat = 200

    public static let sidebarWidth: CGFloat = 256
    public static let sidebarMin: CGFloat = 214
    public static let sidebarMax: CGFloat = 400
    public static let agentWidth: CGFloat = 400
    public static let agentMin: CGFloat = 320
    public static let agentMax: CGFloat = 640
    public static let editorMin: CGFloat = 360
    public static let terminalHeight: CGFloat = 240
    public static let terminalMin: CGFloat = 120

    public static let checkbox: CGFloat = 16
    public static let markStroke: CGFloat = 1.5
    public static let switchWidth: CGFloat = 30
    public static let switchHeight: CGFloat = 18
    public static let switchKnob: CGFloat = 14
    public static let meter: CGFloat = 4
    public static let dot: CGFloat = 8
    public static let smallDot: CGFloat = 6
    public static let tabMin: CGFloat = 72
    public static let tabMax: CGFloat = 240
    public static var toolTab: CGFloat { Density.pick(compact: 22, standard: 24) }
    public static let dragThreshold: CGFloat = 4
}

public enum Opacity {
    public static let disabled: CGFloat = 0.5
    public static let track: CGFloat = 0.25
    public static let earthshine: CGFloat = 0.22
}

public enum Motion {
    public static let instant: TimeInterval = 0.05
    public static let fast: TimeInterval = 0.10
    public static let normal: TimeInterval = 0.15
    public static let slow: TimeInterval = 0.20
    public static var easeOut: CAMediaTimingFunction { CAMediaTimingFunction(name: .easeOut) }
    public static var easeOutQuint: CAMediaTimingFunction { CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1) }
    public static var easeInOutStrong: CAMediaTimingFunction { CAMediaTimingFunction(controlPoints: 0.77, 0, 0.175, 1) }
    public static let pressScale: CGFloat = 0.97
    public static let spinnerFrame: TimeInterval = 0.10
    public static let loaderTurn: TimeInterval = 0.80

    @MainActor public static func duration(_ value: TimeInterval) -> TimeInterval {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : value
    }
}

public struct Elevation: Sendable {
    public let blur: CGFloat
    public let offset: CGFloat
    let light: UInt32
    let dark: UInt32

    public static let sm = Elevation(blur: 6, offset: 2, light: 0x4223_0312, dark: 0x4223_0324)
    public static let md = Elevation(blur: 10, offset: 4, light: 0x4223_0314, dark: 0x4223_0328)
    public static let lg = Elevation(blur: 20, offset: 10, light: 0x2A1C_001C, dark: 0x2A1C_0038)
    public static let xl = Elevation(blur: 48, offset: 16, light: 0x1B15_0038, dark: 0x1B15_0070)

    public var color: NSColor { Palette.role(rgba: light, dark) }

    // AppKit: resolve it inside `draw(_:)` so the colour follows the appearance.
    @MainActor public func shadow(flipped: Bool) -> NSShadow {
        let shadow = NSShadow()
        shadow.shadowColor = color
        shadow.shadowBlurRadius = blur
        shadow.shadowOffset = NSSize(width: 0, height: flipped ? offset : -offset)
        return shadow
    }

    // Core Animation: call again when the appearance changes.
    @MainActor public func apply(to layer: CALayer) {
        layer.shadowColor = color.cgColor
        layer.shadowOpacity = 1
        layer.shadowRadius = blur / 2
        layer.shadowOffset = CGSize(width: 0, height: -offset)
    }
}

public struct TextStyle: Sendable, Equatable {
    public let size: CGFloat
    public let lineHeight: CGFloat
    public let mono: Bool

    public static let xxs = TextStyle(size: 9, lineHeight: 12, mono: false)
    public static let xs = TextStyle(size: 11, lineHeight: 14, mono: false)
    public static let sm = TextStyle(size: 12, lineHeight: 16, mono: false)
    public static let base = TextStyle(size: 13, lineHeight: 18, mono: false)
    public static let baseCompact = TextStyle(size: 13, lineHeight: 16, mono: false)
    public static let prose = TextStyle(size: 14, lineHeight: 22, mono: false)
    public static let lg = TextStyle(size: 15, lineHeight: 24, mono: false)
    public static let xl = TextStyle(size: 19, lineHeight: 24, mono: false)
    public static let xxl = TextStyle(size: 24, lineHeight: 32, mono: false)
    public static let code = TextStyle(size: 12, lineHeight: 18, mono: true)
    public static let codeSmall = TextStyle(size: 11, lineHeight: 16, mono: true)

    public func font(_ weight: NSFont.Weight = .regular) -> NSFont {
        mono ? NSFont.monospacedSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
    }

    public func tabularFont(_ weight: NSFont.Weight = .regular) -> NSFont {
        mono ? font(weight) : NSFont.monospacedDigitSystemFont(ofSize: size, weight: weight)
    }

    public func paragraph(lineBreak: NSLineBreakMode = .byWordWrapping, alignment: NSTextAlignment = .natural) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = lineHeight
        style.maximumLineHeight = lineHeight
        style.lineBreakMode = lineBreak
        style.alignment = alignment
        return style
    }

    public func attributes(_ color: NSColor, weight: NSFont.Weight = .regular) -> [NSAttributedString.Key: Any] {
        let font = font(weight)
        let natural = font.ascender - font.descender + font.leading
        return [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: paragraph(),
            .baselineOffset: (lineHeight - natural) / 2,
        ]
    }
}
