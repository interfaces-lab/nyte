import AppKit

@MainActor
public final class StatusItem: Control {
    public static let size = Size.xs
    public static let glyph = Glyph.xs

    public var title: String { didSet { contentDidChange() } }
    public var symbol: String? { didSet { contentDidChange() } }
    public var tone: Tone = .neutral { didSet { needsDisplay = true } }
    public var isLoading = false {
        didSet {
            loader.isHidden = !isLoading
            contentDidChange()
        }
    }

    private let loader = Loader(side: StatusItem.glyph.rawValue)

    public init(_ title: String, symbol: String? = nil, onPress: (() -> Void)? = nil) {
        self.title = title
        self.symbol = symbol
        super.init(label: title)
        self.onPress = onPress
        loader.isHidden = true
        loader.ink = Palette.contentTertiary
        addSubview(loader)
        let heightConstraint = heightAnchor.constraint(equalToConstant: Self.size.height)
        self.heightConstraint = heightConstraint
        NSLayoutConstraint.activate([
            loader.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.size.padding),
            loader.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightConstraint,
        ])
        setContentHuggingPriority(.required, for: .horizontal)
    }

    private var heightConstraint: NSLayoutConstraint?

    override public func densityDidChange() {
        heightConstraint?.constant = Self.size.height
        super.densityDidChange()
    }

    private var hasGlyph: Bool { isLoading || symbol != nil }

    private func contentDidChange() {
        setAccessibilityLabel(title)
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    override public var intrinsicContentSize: NSSize {
        let size = Self.size
        var width = size.padding * 2 + Draw.width(of: title, style: size.text)
        if hasGlyph { width += Self.glyph.rawValue + size.gap }
        return NSSize(width: width, height: size.height)
    }

    override public var outline: NSBezierPath { Shape.rounded(bounds, radius: Self.size.radius) }

    var restInk: NSColor { title.isEmpty ? Palette.contentSecondary : Palette.contentTertiary }

    private var isPassive: Bool { onPress == nil && action == nil && menuProvider == nil }

    override public func mouseEntered(with event: NSEvent) {
        if !isPassive { super.mouseEntered(with: event) }
    }

    override public func mouseDown(with event: NSEvent) {
        if !isPassive { super.mouseDown(with: event) }
    }

    override public func accessibilityRole() -> NSAccessibility.Role? { isPassive ? .staticText : .button }
    override public var acceptsFirstResponder: Bool { !isPassive && super.acceptsFirstResponder }

    override public func draw(_ dirtyRect: NSRect) {
        let state = interaction
        let size = Self.size
        if let fill = Stairs.fill(state) { Draw.fill(bounds, radius: size.radius, color: fill) }
        let ink: NSColor = state.contains(.disabled) ? Palette.contentDisabled
            : state.isDisjoint(with: [.hovered, .pressed, .on]) ? restInk : Palette.contentPrimary
        var x = size.padding
        if hasGlyph {
            let slot = NSRect(x: x, y: bounds.minY, width: Self.glyph.rawValue, height: bounds.height)
            if !isLoading, let symbol, let image = Symbol.image(symbol, glyph: Self.glyph) {
                let toned = tone == .neutral || state.contains(.disabled) ? ink : Palette.color(.contentAccent, tone: tone)
                Draw.glyph(image, centeredIn: slot, ink: toned)
            }
            x = slot.maxX + size.gap
        }
        Draw.text(title, in: NSRect(x: x, y: bounds.minY, width: bounds.width - x - size.padding, height: bounds.height),
                  style: size.text, ink: ink)
    }
}
