import AppKit

@MainActor
public final class BreadcrumbBar: Control {
    public struct Crumb: Equatable {
        public var title: String
        public var symbol: String?
        public var image: NSImage?
        public var mark: RowContent.Mark?

        public init(_ title: String, symbol: String? = nil, image: NSImage? = nil, mark: RowContent.Mark? = nil) {
            self.title = title
            self.symbol = symbol
            self.image = image
            self.mark = mark
        }
    }

    public var crumbs: [Crumb] = [] { didSet { if crumbs != oldValue { needsLayout = true; needsDisplay = true } } }
    public var onPressCrumb: ((Int, NSRect) -> Void)?
    public var onPressCollapsed: ((Range<Int>, NSRect) -> Void)?

    static var chipHeight: CGFloat { Size.xs.height }
    static let padding = Space.x1
    static let glyph = Glyph.sm
    static let glyphGap = Space.x1
    static let separator = Glyph.xxs
    static let separatorGap = Space.hair
    static let style = TextStyle.sm
    static let ellipsis = "…"
    static let minTitle = Space.x8 + Space.x4
    static let compactWidth: CGFloat = 240
    static let longestExtension = 8

    enum Slot: Equatable {
        case crumb(Int)
        case collapsed(Range<Int>)
    }

    var slots: [(slot: Slot, rect: NSRect, titleWidth: CGFloat)] = []
    var hoveredSlot: Int? { didSet { if hoveredSlot != oldValue { needsDisplay = true } } }
    var pressedSlot: Int? { didSet { if pressedSlot != oldValue { needsDisplay = true } } }
    var focusedSlot = 0 { didSet { if focusedSlot != oldValue { needsDisplay = true; noteFocusRingMaskChanged() } } }

    public init(_ crumbs: [Crumb] = [], label: String = "Path") {
        self.crumbs = crumbs
        super.init(label: label)
        tracksMovement = true
        setAccessibilityRole(.group)
        setContentHuggingPriority(.required, for: .vertical)
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }

    override public var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: Metric.paneFooter)
    }

    private func hasGlyph(_ crumb: Crumb) -> Bool { crumb.image != nil || crumb.symbol != nil || crumb.mark != nil }

    private func chipWidth(_ crumb: Crumb, title: CGFloat) -> CGFloat {
        Self.padding * 2 + title + (hasGlyph(crumb) ? Self.glyph.rawValue + Self.glyphGap : 0)
    }

    private var separatorWidth: CGFloat { Self.separator.rawValue + Self.separatorGap * 2 }

    override public func layout() {
        super.layout()
        arrange()
    }

    private func arrange() {
        let titles = crumbs.map { Draw.width(of: $0.title, style: Self.style) }
        let ellipsis = Self.padding * 2 + Draw.width(of: Self.ellipsis, style: Self.style)
        func total(_ plan: [Slot]) -> CGFloat {
            let chips = plan.reduce(CGFloat(0)) { sum, slot in
                switch slot {
                case .crumb(let index): sum + chipWidth(crumbs[index], title: titles[index])
                case .collapsed: sum + ellipsis
                }
            }
            return chips + CGFloat(max(0, plan.count - 1)) * separatorWidth
        }
        func plan(folding count: Int) -> [Slot] {
            let shown = crumbs.indices[count...].map { Slot.crumb($0) }
            return count == 0 || bounds.width < Self.compactWidth ? shown : [.collapsed(0..<count)] + shown
        }
        func give(_ plan: [Slot]) -> CGFloat {
            plan.dropLast().reduce(CGFloat(0)) { sum, slot in
                guard case .crumb(let index) = slot else { return sum }
                return sum + max(0, titles[index] - Self.minTitle)
            }
        }
        let tail = max(0, crumbs.count - 2)
        var folded = 0
        while folded < crumbs.count - 1 {
            let candidate = plan(folding: folded)
            let over = total(candidate) - bounds.width
            if over <= 0 || (folded >= tail && give(candidate) >= over) { break }
            folded += 1
        }
        let chosen = plan(folding: folded)
        var overflow = max(0, total(chosen) - bounds.width)
        var cuts = Array(repeating: CGFloat(0), count: crumbs.count)
        for slot in chosen.dropLast().reversed() {
            guard case .crumb(let index) = slot, overflow > 0 else { continue }
            let cut = min(overflow, max(0, titles[index] - Self.minTitle))
            cuts[index] = cut
            overflow -= cut
        }
        if case .crumb(let last)? = chosen.last { cuts[last] += overflow }
        var x = bounds.minX
        let y = (bounds.midY - Self.chipHeight / 2).rounded()
        slots = chosen.map { slot in
            var title: CGFloat = 0
            let width: CGFloat
            switch slot {
            case .crumb(let index):
                let allowed = max(0, titles[index] - cuts[index])
                title = min(allowed, Draw.width(of: Self.fitted(crumbs[index].title, width: allowed), style: Self.style))
                width = chipWidth(crumbs[index], title: title)
            case .collapsed:
                width = ellipsis
            }
            defer { x += width + separatorWidth }
            return (slot, NSRect(x: x, y: y, width: width, height: Self.chipHeight), title)
        }
        focusedSlot = min(focusedSlot, max(0, slots.count - 1))
        needsDisplay = true
    }

    override public var outline: NSBezierPath {
        guard slots.indices.contains(focusedSlot) else { return Shape.rounded(bounds, radius: Size.xs.radius) }
        return Shape.rounded(slots[focusedSlot].rect, radius: Size.xs.radius)
    }

    override public var focusRingMaskBounds: NSRect { outline.bounds }

    override public func draw(_ dirtyRect: NSRect) {
        let chevron = Symbol.image("chevron.right", glyph: Self.separator, weight: .medium)
        for (position, entry) in slots.enumerated() {
            let last = entry.slot == .crumb(crumbs.count - 1)
            let hot = position == hoveredSlot || position == pressedSlot
            if hot {
                Draw.fill(entry.rect, radius: Size.xs.radius,
                          color: position == pressedSlot ? Palette.fillSecondary : Palette.fillTertiary)
            }
            let ink = last ? (hot ? Palette.contentPrimary : Palette.contentSecondary)
                : (hot ? Palette.contentSecondary : Palette.contentTertiary)
            var x = entry.rect.minX + Self.padding
            switch entry.slot {
            case .collapsed:
                Draw.text(Self.ellipsis, in: NSRect(x: x, y: entry.rect.minY, width: entry.rect.maxX - x, height: entry.rect.height),
                          style: Self.style, ink: ink, lineBreak: .byClipping)
            case .crumb(let index):
                let crumb = crumbs[index]
                let slot = NSRect(x: x, y: entry.rect.minY, width: Self.glyph.rawValue, height: entry.rect.height)
                if let mark = crumb.mark {
                    RowRenderer.drawMark(mark, in: slot)
                } else if let image = crumb.image {
                    let box = NSRect(x: slot.minX, y: (slot.midY - Self.glyph.rawValue / 2).rounded(),
                                     width: Self.glyph.rawValue, height: Self.glyph.rawValue)
                    if image.isTemplate { Draw.glyph(image, centeredIn: box, ink: ink) }
                    else { image.draw(in: box, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil) }
                } else if let symbol = crumb.symbol, let image = Symbol.image(symbol, glyph: Self.glyph) {
                    Draw.glyph(image, centeredIn: slot, ink: ink)
                }
                if hasGlyph(crumb) { x = slot.maxX + Self.glyphGap }
                Draw.text(Self.fitted(crumb.title, width: entry.titleWidth), in: NSRect(x: x, y: entry.rect.minY,
                          width: entry.titleWidth, height: entry.rect.height), style: Self.style, ink: ink, lineBreak: .byClipping)
            }
            if position < slots.count - 1, let chevron {
                let rect = NSRect(x: entry.rect.maxX + Self.separatorGap, y: entry.rect.minY,
                                  width: Self.separator.rawValue, height: entry.rect.height)
                Draw.glyph(chevron, centeredIn: rect, ink: Palette.contentQuaternary)
            }
        }
    }

    static func fitted(_ title: String, width: CGFloat) -> String {
        guard Draw.width(of: title, style: style) > width else { return title }
        let dot = title.lastIndex(of: ".").flatMap { $0 == title.startIndex ? nil : $0 }
        let suffix = dot.map { String(title[$0...]) } ?? ""
        let keepsSuffix = !suffix.isEmpty && suffix.count <= longestExtension
        let stem = Array(keepsSuffix ? title[..<(dot ?? title.endIndex)] : Substring(title))
        let tail = keepsSuffix ? suffix : ""
        var kept = stem.count
        while kept > 0 {
            kept -= 1
            let head = (kept + 1) / 2, back = kept / 2
            let candidate = String(stem.prefix(head)) + ellipsis + String(stem.suffix(back)) + tail
            if Draw.width(of: candidate, style: style) <= width { return candidate }
        }
        return ellipsis + tail
    }

    private func slot(at point: NSPoint) -> Int? {
        slots.indices.first { slots[$0].rect.insetBy(dx: 0, dy: -Space.x05).contains(point) }
    }

    override public func mouseMoved(with event: NSEvent) {
        hoveredSlot = isEnabled ? slot(at: convert(event.locationInWindow, from: nil)) : nil
    }

    override public func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        hoveredSlot = nil
    }

    override public func mouseDown(with event: NSEvent) {
        guard isEnabled, let index = slot(at: convert(event.locationInWindow, from: nil)) else { return }
        pressedSlot = index
        activate(index)
        pressedSlot = nil
        resyncHoverAfterMenuTracking()
    }

    override func resyncHoverAfterMenuTracking() {
        super.resyncHoverAfterMenuTracking()
        hoveredSlot = pointerLocation.flatMap(slot(at:))
    }

    func activate(_ index: Int) {
        guard slots.indices.contains(index) else { return }
        let entry = slots[index]
        switch entry.slot {
        case .crumb(let crumb): onPressCrumb?(crumb, entry.rect)
        case .collapsed(let range): onPressCollapsed?(range, entry.rect)
        }
    }

    override public func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case KeyCode.left: focusedSlot = max(0, focusedSlot - 1)
        case KeyCode.right: focusedSlot = min(max(0, slots.count - 1), focusedSlot + 1)
        default: super.keyDown(with: event)
        }
    }

    override public func press() { activate(focusedSlot) }

    override public func accessibilityChildren() -> [Any]? {
        slots.indices.map { index in
            let entry = slots[index]
            let label = switch entry.slot {
            case .crumb(let crumb): crumbs[crumb].title
            case .collapsed: "More"
            }
            return PressableElement.make(role: .button, label: label, frame: entry.rect, parent: self) { [weak self] in
                self?.activate(index)
            }
        }
    }

    override public func accessibilityPerformPress() -> Bool { false }
}
