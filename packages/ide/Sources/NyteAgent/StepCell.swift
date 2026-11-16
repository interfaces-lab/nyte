import AppKit
import NyteUI

@MainActor
final class StepCell: NSView {
    static let identifier = NSUserInterfaceItemIdentifier("step")
    static let glyph = Glyph.sm
    static let glyphGap = Space.x15
    static let wordGap = Space.x1
    static let style = TextStyle.base

    var onPress: (() -> Void)?
    var onReview: (() -> Void)?
    static let reviewSymbol = "plus.forwardslash.minus"
    private var kind = RowKind.tool
    private var verb = ""
    private var details = ""
    private var symbol: String?
    private var failed = false
    private var expandable = false
    private var expanded = false
    private var reviewable = false
    private var counts: (added: Int32, removed: Int32) = (0, 0)
    private var gap: CGFloat = 0
    private var tracking: NSTrackingArea?
    var hovering = false { didSet { if hovering != oldValue { needsDisplay = true } } }

    init() {
        super.init(frame: .zero)
        identifier = Self.identifier
        setAccessibilityElement(true)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    func configure(kind: RowKind, lead: String, text: String, glyph: ToolGlyph, flags: Transcript.Flags, added: Int32,
                   removed: Int32, gap: CGFloat)
    {
        self.kind = kind
        self.gap = gap
        failed = flags.contains(.failed)
        expandable = flags.contains(.expandable)
        expanded = flags.contains(.expanded)
        reviewable = flags.contains(.reviewable)
        setAccessibilityCustomActions(reviewable ? [NSAccessibilityCustomAction(name: "Review Changes") { [weak self] in
            self?.onReview?()
            return true
        }] : nil)
        counts = kind == .tool && glyph == .edit ? (added, removed) : (0, 0)
        symbol = kind == .tool ? glyph.symbol : nil
        switch kind {
        case .thinking:
            verb = flags.contains(.running) ? "Thinking" : "Thought"
            details = ""
        case .tool:
            verb = lead
            details = text
        default:
            verb = text
            details = ""
        }
        let spoken = [verb, details].filter { !$0.isEmpty }.joined(separator: " ")
        setAccessibilityRole(expandable ? .disclosureTriangle : .staticText)
        setAccessibilityLabel(counts == (0, 0) ? spoken : "\(spoken), \(counts.added) added, \(counts.removed) removed")
        setAccessibilityValue(expandable ? (expanded ? "Expanded" : "Collapsed") : nil)
        toolTip = details.isEmpty ? nil : details
        needsDisplay = true
    }

    func refresh() { needsDisplay = true }

    static let textX = Rows.inset + glyph.rawValue + glyphGap

    private var lit: Bool { hovering && expandable }

    private var verbInk: NSColor {
        if kind == .thinking || kind == .note || kind == .unknown { return lit ? Palette.contentSecondary : Palette.contentTertiary }
        return lit ? Palette.contentPrimary : Palette.contentSecondary
    }

    override func draw(_ dirtyRect: NSRect) {
        let line = NSRect(x: 0, y: gap, width: bounds.width, height: Rows.line)
        let end = bounds.width - Rows.inset
        if let symbol, let image = Symbol.image(symbol, glyph: Self.glyph) {
            let ink = failed ? Palette.dangerInk : (lit ? Palette.contentSecondary : Palette.contentTertiary)
            Draw.glyph(image, centeredIn: NSRect(x: Rows.inset, y: line.minY, width: Self.glyph.rawValue, height: line.height),
                       ink: ink)
        }
        var x = Self.textX
        let tail = trailingWidth
        let verbWidth = min(Draw.width(of: verb, style: Self.style), max(0, end - tail - x))
        Draw.text(verb, in: NSRect(x: x, y: line.minY, width: verbWidth, height: line.height), style: Self.style, ink: verbInk)
        x += verbWidth
        if !details.isEmpty {
            x += Self.wordGap
            let room = max(0, end - tail - x)
            let width = min(Draw.width(of: details, style: Self.style, tabular: true), room)
            Draw.text(details, in: NSRect(x: x, y: line.minY, width: width, height: line.height), style: Self.style,
                      ink: lit ? Palette.contentSecondary : Palette.contentTertiary, tabular: true)
            x += width
        }
        for (text, ink) in countParts {
            x += Self.wordGap
            let width = Draw.width(of: text, style: Self.style, tabular: true)
            Draw.text(text, in: NSRect(x: x, y: line.minY, width: width, height: line.height), style: Self.style, ink: ink,
                      tabular: true)
            x += width
        }
        if reviewable, let review = Symbol.image(Self.reviewSymbol, glyph: .xs) {
            Draw.glyph(review, centeredIn: reviewSlot(end: end, height: line.height, top: line.minY),
                       ink: hovering ? Palette.contentSecondary : Palette.contentTertiary)
        }
        guard expandable, let chevron = Symbol.image(expanded ? "chevron.down" : "chevron.right", glyph: .xs, weight: .semibold)
        else { return }
        Draw.glyph(chevron, centeredIn: NSRect(x: end - Glyph.xs.rawValue, y: line.minY, width: Glyph.xs.rawValue, height: line.height),
                   ink: hovering ? Palette.contentSecondary : Palette.contentTertiary)
    }

    private var countParts: [(String, NSColor)] {
        var parts: [(String, NSColor)] = []
        if counts.added > 0 { parts.append(("+\(counts.added)", Palette.successInk)) }
        if counts.removed > 0 { parts.append(("\u{2212}\(counts.removed)", Palette.dangerInk)) }
        return parts
    }

    private var trailingWidth: CGFloat {
        let numbers = countParts.reduce(0) { $0 + Self.wordGap + Draw.width(of: $1.0, style: Self.style, tabular: true) }
        let review = reviewable ? Self.reviewGap + Glyph.xs.rawValue : 0
        return numbers + review + (expandable ? Self.wordGap + Glyph.xs.rawValue : 0)
    }

    static let reviewGap = Space.x3

    private func reviewSlot(end: CGFloat, height: CGFloat, top: CGFloat) -> NSRect {
        let right = expandable ? end - Glyph.xs.rawValue - Self.reviewGap : end
        return NSRect(x: right - Glyph.xs.rawValue, y: top, width: Glyph.xs.rawValue, height: height)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let slot = reviewSlot(end: bounds.width - Rows.inset, height: Rows.line, top: gap).insetBy(dx: -Space.x1, dy: 0)
        guard reviewable, slot.contains(point) else { return super.mouseDown(with: event) }
        onReview?()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }

    override func accessibilityPerformPress() -> Bool {
        guard expandable else { return false }
        onPress?()
        return true
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        hovering = false
        onPress = nil
        onReview = nil
    }
}
