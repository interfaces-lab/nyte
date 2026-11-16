import AppKit

@MainActor
public final class Segmented: Control {
    public struct Segment: Equatable, Sendable {
        public var title: String
        public var symbol: String?
        public var label: String
        public var badge: Int?
        public var badgeTone: Tone?

        public init(_ title: String, symbol: String? = nil) {
            self.title = title
            self.symbol = symbol
            self.label = title
        }

        public init(symbol: String, label: String) {
            self.title = ""
            self.symbol = symbol
            self.label = label
        }
    }

    public enum Sizing: Sendable {
        case equal
        case hug
    }

    public var segments: [Segment] { didSet { contentDidChange() } }
    public var selectedIndex: Int {
        didSet {
            guard selectedIndex != oldValue else { return }
            thumb.move(to: CGFloat(selectedIndex), duration: Motion.duration(Motion.fast), curve: Motion.easeOut)
            setAccessibilityValue(segments.indices.contains(selectedIndex) ? segments[selectedIndex].label : nil)
            NSAccessibility.post(element: self, notification: .valueChanged)
        }
    }
    public var onSelect: ((Int) -> Void)?
    public var size: Size { didSet { contentDidChange() } }
    public var sizing: Sizing { didSet { contentDidChange() } }

    var hoveredSegment: Int? { didSet { if hoveredSegment != oldValue { needsDisplay = true } } }
    var pressedSegment: Int? { didSet { if pressedSegment != oldValue { needsDisplay = true } } }
    private lazy var thumb = makeTween(CGFloat(selectedIndex))

    private static let padding = Space.x05
    private static let gap = Space.hair
    private static let radius = Radius.control
    private var segmentRadius: CGFloat { Radius.nested(in: Self.radius, padding: Self.padding) }

    public init(_ segments: [Segment], selectedIndex: Int = 0, size: Size = .sm, sizing: Sizing = .equal,
                label: String = "", onSelect: ((Int) -> Void)? = nil) {
        self.segments = segments
        self.selectedIndex = selectedIndex
        self.size = size
        self.sizing = sizing
        super.init(label: label)
        self.onSelect = onSelect
        tracksMovement = true
        setAccessibilityRole(.radioGroup)
        setAccessibilityValue(segments.indices.contains(selectedIndex) ? segments[selectedIndex].label : nil)
        setContentHuggingPriority(.required, for: .vertical)
        setContentHuggingPriority(.defaultHigh, for: .horizontal)
    }

    private func contentDidChange() {
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    private var glyph: Glyph { size.glyph }

    private func naturalWidth(_ segment: Segment) -> CGFloat {
        let badge = segment.badge.map { badgeWidth($0) } ?? 0
        guard !segment.title.isEmpty else { return size.height + max(0, badge - Self.badgeGap) }
        let text = Draw.width(of: segment.title, style: size.text, weight: .medium)
        return size.padding * 2 + text + (segment.symbol == nil ? 0 : glyph.rawValue + size.gap) + badge
    }

    override public var intrinsicContentSize: NSSize {
        let widths = segments.map(naturalWidth)
        let content = sizing == .equal
            ? (widths.max() ?? 0) * CGFloat(widths.count)
            : widths.reduce(0, +)
        let gaps = CGFloat(max(0, segments.count - 1)) * Self.gap
        return NSSize(width: content + gaps + Self.padding * 2, height: size.height + Self.padding * 2)
    }

    func segmentRect(_ index: Int) -> NSRect {
        let inner = bounds.insetBy(dx: Self.padding, dy: Self.padding)
        let gaps = CGFloat(max(0, segments.count - 1)) * Self.gap
        guard sizing == .hug else {
            let width = (inner.width - gaps) / CGFloat(max(1, segments.count))
            let x = (inner.minX + CGFloat(index) * (width + Self.gap)).rounded()
            let end = (inner.minX + CGFloat(index) * (width + Self.gap) + width).rounded()
            return NSRect(x: x, y: inner.minY, width: end - x, height: inner.height)
        }
        var x = inner.minX
        for previous in 0..<index { x += naturalWidth(segments[previous]) + Self.gap }
        return NSRect(x: x, y: inner.minY, width: naturalWidth(segments[index]), height: inner.height)
    }

    private var thumbRect: NSRect? {
        guard !segments.isEmpty else { return nil }
        let position = min(max(thumb.value, 0), CGFloat(segments.count - 1))
        let lower = Int(position.rounded(.down)), upper = Int(position.rounded(.up))
        let from = segmentRect(lower), to = segmentRect(upper), t = position - CGFloat(lower)
        return NSRect(x: (from.minX + (to.minX - from.minX) * t).rounded(), y: from.minY,
                      width: (from.width + (to.width - from.width) * t).rounded(), height: from.height)
    }

    override public var outline: NSBezierPath { Shape.rounded(bounds, radius: Self.radius) }

    override public func layout() {
        super.layout()
        removeAllToolTips()
        for index in segments.indices where segments[index].title.isEmpty {
            addToolTip(segmentRect(index), owner: segments[index].label as NSString, userData: nil)
        }
    }

    override public func draw(_ dirtyRect: NSRect) {
        let state = interaction
        Draw.faded(state.contains(.disabled) ? Opacity.disabled : 1, in: bounds) {
            Draw.fill(bounds, radius: Self.radius, color: Palette.bgMutedTranslucent)
            if let thumbRect, segments.indices.contains(selectedIndex) {
                NSGraphicsContext.saveGraphicsState()
                Elevation.sm.shadow(flipped: true).set()
                Draw.fill(thumbRect, radius: segmentRadius, color: Palette.bgElevated)
                NSGraphicsContext.restoreGraphicsState()
                Draw.fill(thumbRect, radius: segmentRadius, color: Palette.thumbLift)
                Draw.ring(thumbRect, radius: segmentRadius, color: Palette.strokeQuaternary)
            }
            for index in segments.indices { drawSegment(index, state: state) }
        }
    }

    private func drawSegment(_ index: Int, state: Interaction) {
        let rect = segmentRect(index)
        let selected = index == selectedIndex
        let enabled = !state.contains(.disabled)
        let hovered = enabled && index == hoveredSegment
        let pressed = enabled && index == pressedSegment
        var local: Interaction = []
        if hovered { local.insert(.hovered) }
        if pressed { local.insert(.pressed) }
        if !selected, let fill = Stairs.fill(local) { Draw.fill(rect, radius: segmentRadius, color: fill) }
        let ink = selected || hovered || pressed ? Palette.contentPrimary : Palette.contentSecondary
        let weight: NSFont.Weight = selected ? .medium : .regular
        let segment = segments[index]
        let image = segment.symbol.flatMap { Symbol.image($0, glyph: segment.title.isEmpty ? size.soloGlyph : glyph) }
        guard !segment.title.isEmpty else {
            let glyphRect = NSRect(x: rect.minX, y: rect.minY, width: rect.height, height: rect.height)
            if let image { Draw.glyph(image, centeredIn: segment.badge == nil ? rect : glyphRect, ink: ink) }
            if let badge = segment.badge { drawBadge(badge, tone: segment.badgeTone, x: glyphRect.maxX - Self.badgeGap, in: rect) }
            return
        }
        let text = Draw.width(of: segment.title, style: size.text, weight: weight)
        let badge = segment.badge.map { badgeWidth($0) } ?? 0
        let content = text + (image == nil ? 0 : glyph.rawValue + size.gap) + badge
        let available = rect.width - size.padding * 2
        var x = (rect.minX + size.padding + max(0, (available - content) / 2)).rounded()
        if let image {
            Draw.glyph(image, centeredIn: NSRect(x: x, y: rect.minY, width: glyph.rawValue, height: rect.height), ink: ink)
            x += glyph.rawValue + size.gap
        }
        let titleWidth = min(text, max(0, rect.maxX - size.padding - badge - x))
        Draw.text(segment.title, in: NSRect(x: x, y: rect.minY, width: titleWidth, height: rect.height), style: size.text, ink: ink,
                  weight: weight)
        if let count = segment.badge { drawBadge(count, tone: segment.badgeTone, x: x + titleWidth + Self.badgeGap, in: rect) }
    }

    static let badgeGap = Space.x1
    static let badgeSize = Size.xs

    func badgeWidth(_ count: Int) -> CGFloat {
        CountBadge.size(of: CountBadge.text(count), size: Self.badgeSize).width + Self.badgeGap
    }

    func badgeRect(_ count: Int, x: CGFloat, in rect: NSRect) -> NSRect {
        let size = CountBadge.size(of: CountBadge.text(count), size: Self.badgeSize)
        return NSRect(x: x, y: (rect.midY - size.height / 2).rounded(), width: size.width, height: size.height)
    }

    private func drawBadge(_ count: Int, tone: Tone?, x: CGFloat, in rect: NSRect) {
        CountBadge.draw(CountBadge.text(count), tone: tone ?? .neutral, size: Self.badgeSize, in: badgeRect(count, x: x, in: rect))
    }

    private func segment(at point: NSPoint) -> Int? {
        segments.indices.first { segmentRect($0).insetBy(dx: -Self.gap, dy: -Self.padding).contains(point) }
    }

    override public func mouseMoved(with event: NSEvent) {
        hoveredSegment = isEnabled ? segment(at: convert(event.locationInWindow, from: nil)) : nil
    }

    override public func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        hoveredSegment = nil
    }

    override public func mouseDown(with event: NSEvent) {
        guard isEnabled, let index = segment(at: convert(event.locationInWindow, from: nil)) else { return }
        pressedSegment = index
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = segment(at: convert(next.locationInWindow, from: nil)) == index
            pressedSegment = inside ? index : nil
            guard next.type == .leftMouseUp else { continue }
            pressedSegment = nil
            if inside { choose(index) }
            return
        }
        pressedSegment = nil
    }

    override public func keyDown(with event: NSEvent) {
        guard isEnabled, !segments.isEmpty else { return super.keyDown(with: event) }
        let step: Int
        switch event.keyCode {
        case KeyCode.left: step = userInterfaceLayoutDirection == .rightToLeft ? 1 : -1
        case KeyCode.right: step = userInterfaceLayoutDirection == .rightToLeft ? -1 : 1
        default: return super.keyDown(with: event)
        }
        choose(min(max(selectedIndex + step, 0), segments.count - 1))
    }

    func choose(_ index: Int) {
        guard index != selectedIndex else { return }
        selectedIndex = index
        sendAction(action, to: target)
        onSelect?(index)
    }

    override public func press() {}

    override public func viewDidHide() {
        super.viewDidHide()
        hoveredSegment = nil
    }

    override public func accessibilityChildren() -> [Any]? {
        segments.indices.map { index in
            let element = PressableElement.make(role: .radioButton, label: segments[index].label, frame: segmentRect(index),
                                                parent: self) { [weak self] in
                self?.choose(index)
            }
            element.setAccessibilityValue(index == selectedIndex ? 1 : 0)
            element.setAccessibilityValueDescription(segments[index].badge.map { CountBadge.text($0) })
            return element
        }
    }

    override public func accessibilityPerformPress() -> Bool { false }
}
