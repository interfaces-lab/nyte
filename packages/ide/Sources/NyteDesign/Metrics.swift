import AppKit

/// Nyte's 4pt grid. Only these steps exist.
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
    /// Rows, tabs, icon buttons, inputs.
    public static let control: CGFloat = 8
    /// A working pane: editor, terminal, agent. Concentric with the window corner at the 8pt gutter.
    public static let pane: CGFloat = 10
    public static let card: CGFloat = 12
    public static let composer: CGFloat = 16
}

public enum Metric {
    /// One row of chrome across the top; the traffic lights centre in it.
    public static let titlebar: CGFloat = 40
    /// Space the traffic lights take at the leading edge.
    public static let trafficLights: CGFloat = 80
    public static let gutter: CGFloat = 8
    public static let row: CGFloat = 28
    public static let tab: CGFloat = 28
    public static let paneHeader: CGFloat = 36
    public static let paneFooter: CGFloat = 26
    public static let iconButton: CGFloat = 28
    public static let hairline: CGFloat = 1

    public static let sidebarWidth: CGFloat = 256
    public static let sidebarMin: CGFloat = 214
    public static let sidebarMax: CGFloat = 400
    public static let agentWidth: CGFloat = 400
    public static let agentMin: CGFloat = 320
    public static let agentMax: CGFloat = 640
    public static let editorMin: CGFloat = 360
    public static let terminalHeight: CGFloat = 240
    public static let terminalMin: CGFloat = 120
}

public enum Motion {
    public static let instant: TimeInterval = 0.05
    public static let fast: TimeInterval = 0.10
    public static let normal: TimeInterval = 0.15
    public static let slow: TimeInterval = 0.20
    public static var easeOut: CAMediaTimingFunction { CAMediaTimingFunction(name: .easeOut) }
    public static var easeOutQuint: CAMediaTimingFunction { CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1) }

    /// Zero when the user asks for reduced motion, so every caller honours it by using this.
    @MainActor public static func duration(_ value: TimeInterval) -> TimeInterval {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : value
    }
}

/// The type scale at Nyte's default 13pt base. Size and line height travel together.
public struct TextStyle: Sendable {
    public let size: CGFloat
    public let lineHeight: CGFloat
    public let mono: Bool

    public static let xs = TextStyle(size: 11, lineHeight: 14, mono: false)
    public static let sm = TextStyle(size: 12, lineHeight: 16, mono: false)
    public static let base = TextStyle(size: 13, lineHeight: 18, mono: false)
    /// Prose in the agent pane: larger than the chrome around it, so reading feels roomy.
    public static let prose = TextStyle(size: 14, lineHeight: 22, mono: false)
    public static let lg = TextStyle(size: 15, lineHeight: 24, mono: false)
    public static let xl = TextStyle(size: 19, lineHeight: 24, mono: false)
    public static let code = TextStyle(size: 12, lineHeight: 18, mono: true)
    public static let codeSmall = TextStyle(size: 11, lineHeight: 16, mono: true)

    public func font(_ weight: NSFont.Weight = .regular) -> NSFont {
        mono ? NSFont.monospacedSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
    }

    /// A paragraph style that sets this step's line box and centres the glyphs in it.
    public func paragraph(lineBreak: NSLineBreakMode = .byWordWrapping) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = lineHeight
        style.maximumLineHeight = lineHeight
        style.lineBreakMode = lineBreak
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
