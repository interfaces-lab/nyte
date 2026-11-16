import AppKit

@MainActor
public final class PinnedLinesView: NSView {
    public var ground = Palette.bgBase { didSet { needsDisplay = true } }
    public var onPressLine: ((Int) -> Void)?
    public private(set) var lines: [NSAttributedString] = []

    private let strip = CALayer()
    private let rule = CALayer()
    private var lineLayers: [PinnedLineLayer] = []
    private var lineHeight: CGFloat = 0
    private var push: CGFloat = 0
    private var contentBeneath = false

    public init() {
        super.init(frame: .zero)
        wantsLayer = true
        isHidden = true
        strip.masksToBounds = true
        layer?.addSublayer(strip)
        layer?.addSublayer(rule)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel(Self.label)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    static let label = "Pinned lines"

    override public var isFlipped: Bool { true }
    override public var wantsUpdateLayer: Bool { true }

    public func show(_ lines: [NSAttributedString], lineHeight: CGFloat, leadingInset: CGFloat, baseline: CGFloat,
                     push: CGFloat = 0, in scrollView: NSScrollView) {
        self.lines = lines
        guard !lines.isEmpty else {
            isHidden = true
            return
        }
        if superview !== scrollView { scrollView.addSubview(self, positioned: .above, relativeTo: scrollView.contentView) }
        self.lineHeight = lineHeight
        self.push = min(max(push, 0), lineHeight)
        let clip = scrollView.contentView
        let top = clip.bounds.minY + scrollView.contentInsets.top
        contentBeneath = top > 0
        let height = CGFloat(lines.count) * lineHeight - self.push
        frame = placed(NSRect(x: clip.bounds.minX, y: top, width: clip.bounds.width, height: height), from: clip)
        while lineLayers.count < lines.count {
            let layer = PinnedLineLayer()
            strip.insertSublayer(layer, at: 0)
            lineLayers.append(layer)
        }
        for (index, layer) in lineLayers.enumerated() {
            layer.isHidden = index >= lines.count
            guard index < lines.count else { continue }
            layer.text = lines[index]
            layer.leadingInset = leadingInset
            layer.baseline = baseline
            layer.appearance = effectiveAppearance
            layer.setNeedsDisplay()
        }
        isHidden = false
        needsLayout = true
        needsDisplay = true
    }

    private func placed(_ rect: NSRect, from clip: NSClipView) -> NSRect {
        superview.map { $0.convert(rect, from: clip) } ?? rect
    }

    override public func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        strip.frame = bounds
        for (index, layer) in lineLayers.enumerated() {
            let pushed = index == lines.count - 1 ? push : 0
            layer.frame = NSRect(x: 0, y: CGFloat(index) * lineHeight - pushed, width: bounds.width, height: lineHeight)
            layer.contentsScale = window?.backingScaleFactor ?? layer.contentsScale
        }
        rule.frame = NSRect(x: 0, y: bounds.height - Metric.hairline, width: bounds.width, height: Metric.hairline)
        CATransaction.commit()
    }

    override public func updateLayer() {
        guard let layer else { return }
        layer.backgroundColor = ground.cgColor
        for line in lineLayers { line.backgroundColor = ground.cgColor }
        rule.backgroundColor = Palette.strokeQuaternary.cgColor
        Elevation.sm.apply(to: layer)
        layer.shadowOpacity = contentBeneath ? layer.shadowOpacity : 0
    }

    override public func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        for layer in lineLayers {
            layer.appearance = effectiveAppearance
            layer.setNeedsDisplay()
        }
    }

    override public func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        needsLayout = true
        lineLayers.forEach { $0.setNeedsDisplay() }
    }

    override public func mouseDown(with event: NSEvent) {
        let index = line(at: convert(event.locationInWindow, from: nil))
        if let index { onPressLine?(index) }
    }

    func line(at point: NSPoint) -> Int? {
        guard lineHeight > 0, bounds.contains(point) else { return nil }
        let index = min(Int(point.y / lineHeight), lines.count - 1)
        return index >= 0 ? index : nil
    }

    override public func accessibilityChildren() -> [Any]? {
        lines.indices.map { index in
            PressableElement.make(role: .button, label: lines[index].string.trimmingCharacters(in: .whitespaces),
                                  frame: NSRect(x: 0, y: CGFloat(index) * lineHeight, width: bounds.width, height: lineHeight),
                                  parent: self) { [weak self] in self?.onPressLine?(index) }
        }
    }
}

final class PinnedLineLayer: CALayer {
    var text = NSAttributedString()
    var leadingInset: CGFloat = 0
    var baseline: CGFloat = 0
    var appearance: NSAppearance?

    override init() {
        super.init()
        needsDisplayOnBoundsChange = true
    }

    override init(layer: Any) { super.init(layer: layer) }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func draw(in context: CGContext) {
        let text = self.text, inset = leadingInset, baseline = self.baseline, height = bounds.height
        let flipped = contentsAreFlipped()
        let draw = {
            NSGraphicsContext.saveGraphicsState()
            if !flipped {
                context.translateBy(x: 0, y: height)
                context.scaleBy(x: 1, y: -1)
            }
            NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
            let font = text.length > 0 ? text.attribute(.font, at: 0, effectiveRange: nil) as? NSFont : nil
            text.draw(at: NSPoint(x: inset, y: baseline - (font?.ascender ?? 0)))
            NSGraphicsContext.restoreGraphicsState()
        }
        guard let appearance else { return draw() }
        appearance.performAsCurrentDrawingAppearance(draw)
    }
}
