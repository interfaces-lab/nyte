import AppKit

@MainActor
public final class Badge: NSView {
    public enum Shape: Sendable { case pill, rounded }

    public var text: String { didSet { contentDidChange() } }
    public var tone: Tone { didSet { needsDisplay = true } }
    public var size: Size { didSet { contentDidChange() } }
    public var shape: Shape { didSet { needsDisplay = true } }
    public var showsDot: Bool { didSet { contentDidChange() } }
    public var symbol: String? { didSet { contentDidChange() } }

    public static func needsInput(size: Size = .sm) -> Badge {
        Badge(Attention.needsInputText, tone: Attention.tone, size: size, symbol: Attention.symbol)
    }

    public init(_ text: String, tone: Tone = .neutral, size: Size = .sm, shape: Shape = .pill, dot: Bool = false,
                symbol: String? = nil) {
        self.symbol = symbol
        self.text = text
        self.tone = tone
        self.size = size
        self.shape = shape
        self.showsDot = dot
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        setAccessibilityValue(text)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    private func contentDidChange() {
        setAccessibilityValue(text)
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    private var height: CGFloat { size == .xs ? Size.xxs.height : Size.xs.height }
    private var style: TextStyle { size == .xs ? .xs : .sm }
    private var padding: CGFloat { size == .xs ? Space.x15 : Space.x2 }

    override public var intrinsicContentSize: NSSize {
        let dot = showsDot ? Metric.smallDot + Space.x1 : (symbol == nil ? 0 : Glyph.xs.rawValue + Space.x1)
        return NSSize(width: padding * 2 + dot + Draw.width(of: text, style: style, weight: .medium), height: height)
    }

    override public func draw(_ dirtyRect: NSRect) {
        let radius = shape == .pill ? bounds.height / 2 : Radius.indicator
        Draw.fill(bounds, radius: radius, color: Palette.color(.fillTertiary, tone: tone))
        let ink = Palette.color(.contentSecondary, tone: tone)
        var x = bounds.minX + padding
        if showsDot {
            let accent = tone == .neutral ? Palette.contentTertiary : Palette.color(.contentAccent, tone: tone)
            Draw.dot(in: NSRect(x: x, y: bounds.minY, width: Metric.smallDot, height: bounds.height),
                     diameter: Metric.smallDot, color: accent)
            x += Metric.smallDot + Space.x1
        } else if let symbol, let image = Symbol.image(symbol, glyph: .xs) {
            Draw.glyph(image, centeredIn: NSRect(x: x, y: bounds.minY, width: Glyph.xs.rawValue, height: bounds.height), ink: ink)
            x += Glyph.xs.rawValue + Space.x1
        }
        Draw.text(text, in: NSRect(x: x, y: bounds.minY, width: bounds.maxX - padding - x, height: bounds.height),
                  style: style, ink: ink, weight: .medium)
    }
}

@MainActor
public final class CountBadge: NSView {
    public var count: Int { didSet { if count != oldValue { contentDidChange() } } }
    public var tone: Tone { didSet { needsDisplay = true } }
    public var size: Size { didSet { contentDidChange() } }
    public static let defaultLimit = 99
    public var limit = CountBadge.defaultLimit { didSet { contentDidChange() } }

    public init(_ count: Int, tone: Tone = .neutral, size: Size = .xs) {
        self.count = count
        self.tone = tone
        self.size = size
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        setAccessibilityValue(String(count))
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    private func contentDidChange() {
        setAccessibilityValue(String(count))
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    private var text: String { Self.text(count, limit: limit) }

    static func text(_ count: Int, limit: Int = defaultLimit) -> String { count > limit ? "\(limit)+" : String(count) }
    static func height(_ size: Size) -> CGFloat { size == .xs ? Size.xxs.height : Size.xs.height }
    static func style(_ size: Size) -> TextStyle { size == .xs ? .xs : .sm }

    static func size(of text: String, size: Size) -> NSSize {
        let width = Draw.width(of: text, style: style(size), weight: .medium, tabular: true) + Space.x1 * 2
        return NSSize(width: max(height(size), width), height: height(size))
    }

    static func draw(_ text: String, tone: Tone, size: Size, in rect: NSRect) {
        Draw.fill(rect, radius: rect.height / 2, color: Palette.color(.fillTertiary, tone: tone))
        Draw.text(text, in: rect, style: style(size), ink: Palette.color(.contentSecondary, tone: tone), weight: .medium,
                  alignment: .center, tabular: true)
    }

    override public var intrinsicContentSize: NSSize { Self.size(of: text, size: size) }

    override public func draw(_ dirtyRect: NSRect) { Self.draw(text, tone: tone, size: size, in: bounds) }
}
