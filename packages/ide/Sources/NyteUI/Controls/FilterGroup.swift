import AppKit

@MainActor
public final class FilterGroup: Control {
    public struct Filter: Equatable, Sendable {
        public var title: String
        public var symbol: String?
        public var tone: Tone?
        public var count: Int?
        public var isOn: Bool

        public init(_ title: String, symbol: String? = nil, tone: Tone? = nil, count: Int? = nil, isOn: Bool = true) {
            self.title = title
            self.symbol = symbol
            self.tone = tone
            self.count = count
            self.isOn = isOn
        }
    }

    public var filters: [Filter] { didSet { contentDidChange() } }
    public var onChange: ((Int, Bool) -> Void)?
    public var size: Size { didSet { contentDidChange() } }

    var current = 0 { didSet { if current != oldValue { noteFocusRingMaskChanged(); needsDisplay = true } } }
    var hoveredFilter: Int? { didSet { if hoveredFilter != oldValue { needsDisplay = true } } }
    var pressedFilter: Int? { didSet { if pressedFilter != oldValue { needsDisplay = true } } }

    static let padding = Space.x05
    static let gap = Space.hair
    static let radius = Radius.control
    static let countGap = Space.x1
    private var tileRadius: CGFloat { Radius.nested(in: Self.radius, padding: Self.padding) }

    public static func tile(on: Bool, hovered: Bool) -> NSColor? {
        if on { return Palette.fillPrimary }
        return hovered ? Palette.fillTertiary : nil
    }

    public static func labelInk(on: Bool) -> NSColor { on ? Palette.contentPrimary : Palette.contentSecondary }

    public init(_ filters: [Filter], size: Size = .sm, label: String = "", onChange: ((Int, Bool) -> Void)? = nil) {
        self.filters = filters
        self.size = size
        super.init(label: label)
        self.onChange = onChange
        tracksMovement = true
        setAccessibilityRole(.group)
        setContentHuggingPriority(.required, for: .vertical)
        setContentHuggingPriority(.defaultHigh, for: .horizontal)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func contentDidChange() {
        current = min(current, max(0, filters.count - 1))
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    private func countText(_ filter: Filter) -> String { filter.count.map { CountBadge.text($0) } ?? "" }

    private func naturalWidth(_ filter: Filter) -> CGFloat {
        var width = size.padding * 2 + Draw.width(of: filter.title, style: size.text, weight: .medium)
        if filter.symbol != nil { width += size.glyph.rawValue + size.gap }
        if filter.count != nil { width += Self.countGap + Draw.width(of: countText(filter), style: size.text, tabular: true) }
        return width.rounded(.up)
    }

    override public var intrinsicContentSize: NSSize {
        let content = filters.map(naturalWidth).reduce(0, +) + CGFloat(max(0, filters.count - 1)) * Self.gap
        return NSSize(width: content + Self.padding * 2, height: size.height + Self.padding * 2)
    }

    func filterRect(_ index: Int) -> NSRect {
        let inner = bounds.insetBy(dx: Self.padding, dy: Self.padding)
        var x = inner.minX
        for previous in 0..<index { x += naturalWidth(filters[previous]) + Self.gap }
        return NSRect(x: x, y: inner.minY, width: naturalWidth(filters[index]), height: inner.height)
    }

    override public var outline: NSBezierPath { Shape.rounded(bounds, radius: Self.radius) }
    override public var focusRingMaskBounds: NSRect { filters.indices.contains(current) ? filterRect(current) : bounds }
    override public func drawFocusRingMask() {
        guard filters.indices.contains(current) else { return super.drawFocusRingMask() }
        Shape.rounded(filterRect(current), radius: tileRadius).fill()
    }

    override public func draw(_ dirtyRect: NSRect) {
        let state = interaction
        Draw.faded(state.contains(.disabled) ? Opacity.disabled : 1, in: bounds) {
            Draw.fill(bounds, radius: Self.radius, color: Palette.bgMutedTranslucent)
            for index in filters.indices { drawFilter(index, enabled: !state.contains(.disabled)) }
        }
    }

    private func drawFilter(_ index: Int, enabled: Bool) {
        let filter = filters[index]
        let rect = filterRect(index)
        let hovered = enabled && index == hoveredFilter
        let on = filter.isOn != (enabled && index == pressedFilter)
        if let tile = Self.tile(on: on, hovered: hovered) { Draw.fill(rect, radius: tileRadius, color: tile) }
        let ink = Self.labelInk(on: on)
        var x = rect.minX + size.padding
        if let name = filter.symbol, let image = Symbol.image(name, glyph: size.glyph) {
            let glyphInk = on ? filter.tone.map { Palette.color(.contentAccent, tone: $0) } ?? Palette.contentSecondary : Palette.contentTertiary
            Draw.glyph(image, centeredIn: NSRect(x: x, y: rect.minY, width: size.glyph.rawValue, height: rect.height), ink: glyphInk)
            x += size.glyph.rawValue + size.gap
        }
        let title = Draw.width(of: filter.title, style: size.text, weight: .medium)
        Draw.text(filter.title, in: NSRect(x: x, y: rect.minY, width: title, height: rect.height), style: size.text, ink: ink, weight: .medium)
        guard filter.count != nil else { return }
        x += title + Self.countGap
        Draw.text(countText(filter), in: NSRect(x: x, y: rect.minY, width: rect.maxX - x, height: rect.height), style: size.text,
                  ink: on ? Palette.contentSecondary : Palette.contentTertiary, tabular: true)
    }

    private func filter(at point: NSPoint) -> Int? {
        filters.indices.first { filterRect($0).insetBy(dx: -Self.gap, dy: -Self.padding).contains(point) }
    }

    override public func mouseMoved(with event: NSEvent) {
        hoveredFilter = isEnabled ? filter(at: convert(event.locationInWindow, from: nil)) : nil
    }

    override public func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        hoveredFilter = nil
    }

    override public func mouseDown(with event: NSEvent) {
        guard isEnabled, let index = filter(at: convert(event.locationInWindow, from: nil)) else { return }
        pressedFilter = index
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = filter(at: convert(next.locationInWindow, from: nil)) == index
            pressedFilter = inside ? index : nil
            guard next.type == .leftMouseUp else { continue }
            pressedFilter = nil
            if inside {
                current = index
                toggle(index)
            }
            return
        }
        pressedFilter = nil
    }

    override public func keyDown(with event: NSEvent) {
        guard isEnabled, !filters.isEmpty else { return super.keyDown(with: event) }
        let forward = userInterfaceLayoutDirection == .rightToLeft ? -1 : 1
        switch event.keyCode {
        case KeyCode.left: current = max(0, current - forward)
        case KeyCode.right: current = min(filters.count - 1, current + forward)
        case KeyCode.space: toggle(current)
        default: super.keyDown(with: event)
        }
    }

    func toggle(_ index: Int) {
        guard filters.indices.contains(index) else { return }
        filters[index].isOn.toggle()
        sendAction(action, to: target)
        onChange?(index, filters[index].isOn)
        NSAccessibility.post(element: self, notification: .valueChanged)
    }

    override public func press() {}

    override public func viewDidHide() {
        super.viewDidHide()
        hoveredFilter = nil
    }

    override public func accessibilityChildren() -> [Any]? {
        filters.indices.map { index in
            let filter = filters[index]
            let label = filter.count.map { "\(filter.title), \($0)" } ?? filter.title
            let element = PressableElement.make(role: .checkBox, label: label, frame: filterRect(index), parent: self) { [weak self] in
                self?.toggle(index)
            }
            element.setAccessibilityValue(filter.isOn ? 1 : 0)
            return element
        }
    }

    override public func accessibilityPerformPress() -> Bool { false }
}
