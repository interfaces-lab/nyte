import AppKit
import NyteUI

@MainActor
final class SessionTitle: Control {
    var title: String { didSet { contentDidChange() } }

    static let symbol = "chevron.down"

    init(_ title: String) {
        self.title = title
        super.init(label: "Sessions")
        translatesAutoresizingMaskIntoConstraints = false
        alwaysFocusable = true
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        setContentHuggingPriority(.required, for: .horizontal)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func contentDidChange() {
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    override func densityDidChange() {
        super.densityDidChange()
        contentDidChange()
    }

    override var intrinsicContentSize: NSSize {
        let text = Draw.width(of: title, style: PaneHeader.titleStyle, weight: .semibold)
        return NSSize(width: text + Space.x1 + Glyph.xs.rawValue, height: PaneHeader.titleStyle.lineHeight)
    }

    override func draw(_ dirtyRect: NSRect) {
        let chevron = Glyph.xs.rawValue
        let textWidth = max(0, min(Draw.width(of: title, style: PaneHeader.titleStyle, weight: .semibold),
                                   bounds.width - Space.x1 - chevron))
        Draw.text(title, in: NSRect(x: 0, y: 0, width: textWidth, height: bounds.height), style: PaneHeader.titleStyle,
                  ink: Palette.contentPrimary, weight: .semibold)
        guard let image = Symbol.image(Self.symbol, glyph: .xs, weight: .medium) else { return }
        let ink = isHovered || isPressed ? Palette.contentPrimary : Palette.contentTertiary
        Draw.glyph(image, centeredIn: NSRect(x: textWidth + Space.x1, y: 0, width: chevron, height: bounds.height), ink: ink)
    }
}
