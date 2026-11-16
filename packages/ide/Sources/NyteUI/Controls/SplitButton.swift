import AppKit

@MainActor
public final class SplitButton: Control {
    public enum Variant: Sendable { case outline, solid }

    public var title: String { didSet { contentDidChange() } }
    public var symbol: String? { didSet { contentDidChange() } }
    public var variant: Variant { didSet { contentDidChange() } }
    public var tone: Tone { didSet { needsDisplay = true } }
    public var size: Size { didSet { contentDidChange() } }
    public var makeMenu: () -> NSMenu?

    enum Half { case action, chevron }
    var hoveredHalf: Half? { didSet { if hoveredHalf != oldValue { needsDisplay = true } } }
    var pressedHalf: Half? { didSet { if pressedHalf != oldValue { needsDisplay = true } } }
    var menuOpen = false { didSet { if menuOpen != oldValue { needsDisplay = true } } }

    private var heightConstraint: NSLayoutConstraint?

    public init(_ title: String, symbol: String? = nil, variant: Variant = .outline, tone: Tone = .neutral,
                size: Size = .md, onPress: (() -> Void)? = nil, menu: @escaping () -> NSMenu?) {
        self.title = title
        self.symbol = symbol
        self.variant = variant
        self.tone = tone
        self.size = size
        self.makeMenu = menu
        super.init(label: title)
        self.onPress = onPress
        tracksMovement = true
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        heightConstraint = heightAnchor.constraint(equalToConstant: size.height)
        heightConstraint?.isActive = true
    }

    override public func densityDidChange() {
        heightConstraint?.constant = size.height
        super.densityDidChange()
    }

    private func contentDidChange() {
        heightConstraint?.constant = size.height
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    private var chevronWidth: CGFloat { Glyph.xs.rawValue + size.gap * 2 }
    private var radius: CGFloat { size.radius }
    private var weight: NSFont.Weight { variant == .solid ? .medium : .regular }

    override public var intrinsicContentSize: NSSize {
        var width = size.padding * 2 + Draw.width(of: title, style: size.text, weight: weight)
        if symbol != nil { width += size.glyph.rawValue + size.gap }
        return NSSize(width: width + Metric.hairline + chevronWidth, height: size.height)
    }

    private var chevronRect: NSRect {
        NSRect(x: bounds.maxX - chevronWidth, y: bounds.minY, width: chevronWidth, height: bounds.height)
    }

    private var actionRect: NSRect {
        NSRect(x: bounds.minX, y: bounds.minY, width: bounds.width - chevronWidth - Metric.hairline, height: bounds.height)
    }

    private func half(at point: NSPoint) -> Half? {
        guard bounds.contains(point) else { return nil }
        return point.x >= chevronRect.minX - Metric.hairline ? .chevron : .action
    }

    override public var outline: NSBezierPath { Shape.rounded(bounds, radius: radius) }

    override public func draw(_ dirtyRect: NSRect) {
        let state = interaction
        let disabled = state.contains(.disabled)
        let shape = Shape.rounded(bounds, radius: radius)
        let ink: NSColor
        let divider: NSColor
        switch (variant, disabled) {
        case (_, true):
            Draw.fill(bounds, radius: radius, color: Palette.fillTertiary)
            ink = Palette.contentDisabled
            divider = Palette.strokeQuaternary
        case (.outline, false):
            Draw.fill(bounds, radius: radius, color: Palette.bgElevated)
            for half in [Half.action, .chevron] {
                if let fill = Stairs.fill(halfState(half)) { fillHalf(half, shape: shape, color: fill) }
            }
            Draw.ring(bounds, radius: radius, color: Palette.strokeTertiary)
            if menuOpen { ringHalf(.chevron, color: Stairs.edge([.on])) }
            ink = tone == .neutral ? Palette.contentPrimary : Palette.color(.contentAccent, tone: tone)
            divider = Palette.strokeTertiary
        case (.solid, false):
            let fills = Palette.solidFill(state.contains(.inactive) ? .neutral : tone)
            Draw.fill(bounds, radius: radius, color: fills.rest)
            for half in [Half.action, .chevron] {
                let local = halfState(half)
                if local.contains(.pressed) || local.contains(.on) {
                    fillHalf(half, shape: shape, color: fills.pressed)
                } else if local.contains(.hovered) {
                    fillHalf(half, shape: shape, color: fills.hover)
                }
            }
            if menuOpen { ringHalf(.chevron, color: Palette.strokeSecondary) }
            ink = Palette.contentOnControl
            divider = Palette.strokeSecondary
        }
        let line = NSRect(x: actionRect.maxX, y: bounds.minY + Space.x1, width: Metric.hairline, height: bounds.height - Space.x1 * 2)
        divider.setFill()
        line.fill()
        drawContent(ink: ink)
    }

    private func halfState(_ half: Half) -> Interaction {
        var state = interaction.subtracting([.hovered, .pressed, .on])
        if hoveredHalf == half { state.insert(.hovered) }
        if pressedHalf == half { state.insert(.pressed) }
        if half == .chevron, menuOpen { state.insert(.on) }
        return state
    }

    private func fillHalf(_ half: Half, shape: NSBezierPath, color: NSColor) {
        NSGraphicsContext.saveGraphicsState()
        shape.addClip()
        color.setFill()
        (half == .action ? actionRect : chevronRect).fill()
        NSGraphicsContext.restoreGraphicsState()
    }

    private func ringHalf(_ half: Half, color: NSColor) {
        let rect = half == .action ? actionRect : chevronRect
        let outer = CornerRadii(topLeft: half == .action ? radius : 0, topRight: half == .chevron ? radius : 0,
                                bottomLeft: half == .action ? radius : 0, bottomRight: half == .chevron ? radius : 0)
        let inset = Metric.hairline / 2
        let inner = CornerRadii(topLeft: max(0, outer.topLeft - inset), topRight: max(0, outer.topRight - inset),
                                bottomLeft: max(0, outer.bottomLeft - inset), bottomRight: max(0, outer.bottomRight - inset))
        let path = Shape.rounded(rect.insetBy(dx: inset, dy: inset), radii: inner, flipped: true)
        path.lineWidth = Metric.hairline
        color.setStroke()
        path.stroke()
    }

    private func drawContent(ink: NSColor) {
        let rect = actionRect.insetBy(dx: size.padding, dy: 0)
        var x = rect.minX
        if let symbol, let image = Symbol.image(symbol, glyph: size.glyph, weight: weight) {
            Draw.glyph(image, centeredIn: NSRect(x: x, y: rect.minY, width: size.glyph.rawValue, height: rect.height), ink: ink)
            x += size.glyph.rawValue + size.gap
        }
        Draw.text(title, in: NSRect(x: x, y: rect.minY, width: rect.maxX - x, height: rect.height),
                  style: size.text, ink: ink, weight: weight)
        if let chevron = Symbol.image("chevron.down", glyph: .xs, weight: .medium) {
            Draw.glyph(chevron, centeredIn: chevronRect, ink: ink)
        }
    }

    override public func mouseMoved(with event: NSEvent) {
        hoveredHalf = isEnabled ? half(at: convert(event.locationInWindow, from: nil)) : nil
    }

    override public func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        hoveredHalf = nil
    }

    override public func mouseDown(with event: NSEvent) {
        guard isEnabled, let half = half(at: convert(event.locationInWindow, from: nil)) else { return }
        if half == .chevron { return openMenu() }
        pressedHalf = .action
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = self.half(at: convert(next.locationInWindow, from: nil)) == .action
            pressedHalf = inside ? .action : nil
            guard next.type == .leftMouseUp else { continue }
            pressedHalf = nil
            if inside { press() }
            return
        }
        pressedHalf = nil
    }

    func openMenu() {
        guard isEnabled, let menu = makeMenu() else { return }
        menuOpen = true
        menu.minimumWidth = max(menu.minimumWidth, bounds.width)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.maxY + Space.x1), in: self)
        menuOpen = false
        resyncHoverAfterMenuTracking()
    }

    override func resyncHoverAfterMenuTracking() {
        hoveredHalf = pointerLocation.flatMap(half(at:))
        isHovered = hoveredHalf != nil
    }

    override public func keyDown(with event: NSEvent) {
        guard isEnabled, event.keyCode == KeyCode.down else { return super.keyDown(with: event) }
        openMenu()
    }

    override func flashPressed() {
        super.flashPressed()
        pressedHalf = .action
    }

    override func endPressedFlash() {
        super.endPressedFlash()
        pressedHalf = nil
    }

    override public func accessibilityPerformShowMenu() -> Bool {
        openMenu()
        return true
    }
}
