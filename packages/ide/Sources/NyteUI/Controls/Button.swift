import AppKit

@MainActor
public final class Button: Control {
    public enum Variant: Sendable {
        case ghost
        case outline
        case solid
        case soft
        case link
    }

    public var title: String { didSet { contentDidChange() } }
    public var symbol: String? { didSet { contentDidChange() } }
    public var trailingSymbol: String? { didSet { contentDidChange() } }
    public var shortcut: String = "" { didSet { contentDidChange() } }
    public var detail: String = "" { didSet { contentDidChange() } }
    public var symbolTone: Tone? { didSet { needsDisplay = true } }
    public var variant: Variant { didSet { contentDidChange() } }
    public var tone: Tone { didSet { needsDisplay = true } }
    public var size: Size { didSet { contentDidChange() } }
    public var isPill = false { didSet { needsDisplay = true } }
    public var ringsWhenOn = true { didSet { needsDisplay = true } }
    public var restInk: NSColor = Palette.contentSecondary { didSet { needsDisplay = true } }
    public var isLoading = false { didSet { if isLoading != oldValue { loadingDidChange() } } }

    private var heightConstraint: NSLayoutConstraint?
    private var loader: Loader?
    private static let filledSuffix = ".fill"

    public init(_ title: String = "", symbol: String? = nil, label: String? = nil, variant: Variant = .ghost,
                tone: Tone = .neutral, size: Size = .md, onPress: (() -> Void)? = nil) {
        self.title = title
        self.symbol = symbol
        self.variant = variant
        self.tone = tone
        self.size = size
        super.init(label: label ?? title)
        self.onPress = onPress
        if title.isEmpty { toolTip = label }
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
        heightConstraint = heightAnchor.constraint(equalToConstant: size.height)
        heightConstraint?.isActive = true
    }

    public convenience init(_ title: String = "", symbol: String? = nil, label: String? = nil, variant: Variant = .ghost,
                            tone: Tone = .neutral, size: Size = .md, target: AnyObject?, action: Selector) {
        self.init(title, symbol: symbol, label: label, variant: variant, tone: tone, size: size)
        self.target = target
        self.action = action
    }

    override public func densityDidChange() {
        heightConstraint?.constant = size.height
        super.densityDidChange()
    }

    private var padding: CGFloat { variant == .link ? 0 : size.padding }

    func showsUnderline(_ state: Interaction) -> Bool {
        guard variant == .link, !state.contains(.disabled) else { return false }
        return state.contains(.hovered) || KeyFocus.shows(holdsFocus: window?.firstResponder === self,
                                                          windowIsKey: window?.hasKeyFocus ?? false)
    }

    override public var focusRingType: NSFocusRingType {
        get { variant == .link ? .none : super.focusRingType }
        set { super.focusRingType = newValue }
    }

    override public func resetCursorRects() {
        super.resetCursorRects()
        if variant == .link { addCursorRect(bounds, cursor: .pointingHand) }
    }

    override public func becomeFirstResponder() -> Bool {
        needsDisplay = true
        return super.becomeFirstResponder()
    }

    override public func resignFirstResponder() -> Bool {
        needsDisplay = true
        return super.resignFirstResponder()
    }

    private var isIconOnly: Bool { title.isEmpty && shortcut.isEmpty && detail.isEmpty }
    private var weight: NSFont.Weight { variant == .solid ? .medium : .regular }
    private var glyph: Glyph { isIconOnly ? size.soloGlyph : size.glyph }
    private var radius: CGFloat { isPill ? size.height / 2 : size.radius }

    private func contentDidChange() {
        heightConstraint?.constant = size.height
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    override public var intrinsicContentSize: NSSize {
        guard !isIconOnly || trailingSymbol != nil else { return NSSize(width: size.height, height: size.height) }
        var width = padding * 2 + (isPill ? Space.x05 * 2 : 0)
        var parts = 0
        if symbol != nil { width += glyph.rawValue; parts += 1 }
        if !title.isEmpty { width += Draw.width(of: title, style: size.text, weight: weight); parts += 1 }
        if !detail.isEmpty { width += Draw.width(of: detail, style: size.text, tabular: true); parts += 1 }
        if !shortcut.isEmpty { width += Draw.width(of: shortcut, style: size.text); parts += 1 }
        if trailingSymbol != nil { width += Glyph.xs.rawValue; parts += 1 }
        width += CGFloat(max(0, parts - 1)) * size.gap
        return NSSize(width: max(width, size.height), height: size.height)
    }

    override public var outline: NSBezierPath { Shape.rounded(bounds, radius: radius) }

    override public func draw(_ dirtyRect: NSRect) {
        let state = interaction
        let pressed = state.contains(.pressed)
        if pressed, let context = NSGraphicsContext.current?.cgContext {
            context.translateBy(x: bounds.midX, y: bounds.midY)
            context.scaleBy(x: Motion.pressScale, y: Motion.pressScale)
            context.translateBy(x: -bounds.midX, y: -bounds.midY)
        }
        let ink = drawSurface(state)
        guard !isLoading else { return }

        let label = size.text
        var parts: [(width: CGFloat, draw: (NSRect) -> Void)] = []
        let symbolWeight: NSFont.Weight = isIconOnly ? .regular : weight
        if let symbol, let image = (isOn ? Symbol.image(symbol + Self.filledSuffix, glyph: glyph, weight: symbolWeight) : nil)
            ?? Symbol.image(symbol, glyph: glyph, weight: symbolWeight) {
            let toned = state.isDisjoint(with: [.disabled, .inactive]) ? symbolTone : nil
            let glyphInk = toned.map { Palette.color(.contentAccent, tone: $0) } ?? ink
            parts.append((glyph.rawValue, { Draw.glyph(image, centeredIn: $0, ink: glyphInk) }))
        }
        if !title.isEmpty {
            let title = title, weight = weight, underlined = showsUnderline(state)
            parts.append((Draw.width(of: title, style: label, weight: weight), {
                Draw.text(title, in: $0, style: label, ink: ink, weight: weight)
                guard underlined else { return }
                let font = label.font(weight)
                let baseline = ($0.midY + (font.ascender + font.descender) / 2).rounded()
                ink.setFill()
                NSRect(x: $0.minX, y: baseline - font.underlinePosition, width: $0.width,
                       height: max(Metric.hairline, font.underlineThickness)).fill()
            }))
        }
        if !detail.isEmpty {
            let detail = detail
            let dim = variant == .solid ? ink : Palette.contentTertiary
            parts.append((Draw.width(of: detail, style: label, tabular: true), {
                Draw.text(detail, in: $0, style: label, ink: dim, tabular: true)
            }))
        }
        if !shortcut.isEmpty {
            let shortcut = shortcut
            let dim = variant == .solid ? ink : Palette.contentTertiary
            parts.append((Draw.width(of: shortcut, style: label), { Draw.text(shortcut, in: $0, style: label, ink: dim) }))
        }
        if let trailingSymbol, let image = Symbol.image(trailingSymbol, glyph: .xs, weight: .medium) {
            let chevron = variant == .solid ? ink : (state.isDisjoint(with: [.hovered, .pressed, .on]) ? Palette.contentTertiary : ink)
            parts.append((Glyph.xs.rawValue, { Draw.glyph(image, centeredIn: $0, ink: chevron) }))
        }
        guard !parts.isEmpty else { return }

        let content = parts.reduce(0) { $0 + $1.width } + CGFloat(parts.count - 1) * size.gap
        let inset = isIconOnly && trailingSymbol == nil ? 0 : padding + (isPill ? Space.x05 : 0)
        let available = bounds.width - inset * 2
        var x = bounds.minX + inset + max(0, (available - content) / 2)
        let overflow = max(0, content - available)
        for (index, part) in parts.enumerated() {
            let isTitle = !title.isEmpty && index == (symbol == nil ? 0 : 1)
            let width = isTitle ? max(0, part.width - overflow) : part.width
            part.draw(NSRect(x: x.rounded(), y: bounds.minY, width: width, height: bounds.height))
            x += width + size.gap
        }
    }

    private func drawSurface(_ state: Interaction) -> NSColor {
        let rect = bounds
        let disabled = state.contains(.disabled)
        switch variant {
        case .ghost:
            if ringsWhenOn {
                Stairs.paint(state, in: rect, radius: radius)
            } else if let fill = Stairs.fill(state) {
                Draw.fill(rect, radius: radius, color: fill)
            }
            return tone == .neutral || disabled
                ? Stairs.ink(state, rest: restInk)
                : Palette.color(.contentAccent, tone: tone)

        case .soft:
            Draw.fill(rect, radius: radius, color: Stairs.raisedFill(state, tone: disabled ? .neutral : tone))
            if let ring = Stairs.ring(state) { Draw.ring(rect, radius: radius, color: ring) }
            return disabled ? Palette.contentDisabled
                : (tone == .neutral ? Palette.contentPrimary : Palette.color(.contentSecondary, tone: tone))

        case .outline:
            if disabled {
                Draw.fill(rect, radius: radius, color: Palette.fillTertiary)
                return Palette.contentDisabled
            }
            Draw.fill(rect, radius: radius, color: Palette.bgElevated)
            if let fill = Stairs.fill(state) { Draw.fill(rect, radius: radius, color: fill) }
            Draw.ring(rect, radius: radius, color: Stairs.edge(state))
            return tone == .neutral ? Stairs.ink(state, rest: Palette.contentPrimary) : Palette.color(.contentAccent, tone: tone)

        case .link:
            return disabled ? Palette.contentDisabled : Palette.accentInk

        case .solid:
            if disabled {
                Draw.fill(rect, radius: radius, color: Palette.fillTertiary)
                return Palette.contentDisabled
            }
            let fills = Palette.solidFill(state.contains(.inactive) ? .neutral : tone)
            let fill = state.contains(.pressed) ? fills.pressed : (state.contains(.hovered) ? fills.hover : fills.rest)
            Draw.fill(rect, radius: radius, color: fill)
            return Palette.contentOnControl
        }
    }

    private func loadingDidChange() {
        needsDisplay = true
        loader?.removeFromSuperview()
        loader = nil
        setAccessibilityValue(isLoading ? "Loading" : nil)
        guard isLoading else { return }
        let loader = Loader(side: Glyph.md.rawValue)
        loader.ink = variant == .solid ? Palette.contentOnControl : Palette.contentSecondary
        loader.setAccessibilityElement(false)
        addSubview(loader)
        NSLayoutConstraint.activate([
            loader.centerXAnchor.constraint(equalTo: centerXAnchor),
            loader.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        self.loader = loader
    }

    override public func isAccessibilityEnabled() -> Bool { isEnabled && !isLoading }
}

public typealias IconButton = Button

@MainActor
public final class GlassButton: NSButton {
    public init(symbol name: String, label: String, target: AnyObject?, action: Selector) {
        super.init(frame: .zero)
        image = Symbol.image(name, glyph: .md, weight: .medium)
        imagePosition = .imageOnly
        bezelStyle = .glass
        borderShape = .capsule
        controlSize = .large
        self.target = target
        self.action = action
        toolTip = label
        setAccessibilityLabel(label)
        translatesAutoresizingMaskIntoConstraints = false
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var mouseDownCanMoveWindow: Bool { false }
}
