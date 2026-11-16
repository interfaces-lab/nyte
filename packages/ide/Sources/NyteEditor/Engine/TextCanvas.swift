import AppKit

@MainActor
final class TextCanvas: NSView, @preconcurrency CALayerDelegate {
    weak var engine: TextEngineView?
    private let surface = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        // AppKit: a view that draws in draw(_:) records a display list and replays it into a half-float store on wide-gamut displays; a plain layer draws once, in 8 bits.
        surface.contentsFormat = .RGBA8Uint
        surface.isOpaque = true
        surface.delegate = self
        layer?.addSublayer(surface)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var wantsUpdateLayer: Bool { true }

    override func updateLayer() {}

    override func draw(_ dirtyRect: NSRect) {
        engine?.drawContent(dirtyRect)
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func setNeedsDisplay(_ invalidRect: NSRect) {
        super.setNeedsDisplay(invalidRect)
        surface.setNeedsDisplay(invalidRect)
    }

    override var needsDisplay: Bool {
        get { super.needsDisplay }
        set {
            super.needsDisplay = newValue
            if newValue { surface.setNeedsDisplay() }
        }
    }

    override func layout() {
        super.layout()
        placeSurface()
    }

    func placeSurface() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        surface.frame = layer?.bounds ?? bounds
        surface.bounds = bounds
        surface.contentsScale = window?.backingScaleFactor ?? surface.contentsScale
        CATransaction.commit()
        surface.setNeedsDisplay()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        placeSurface()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        surface.setNeedsDisplay()
    }

    func draw(_ layer: CALayer, in context: CGContext) {
        guard let engine else { return }
        if !layer.contentsAreFlipped() {
            context.translateBy(x: 0, y: layer.bounds.minY * 2 + layer.bounds.height)
            context.scaleBy(x: 1, y: -1)
        }
        let previous = NSGraphicsContext.current
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        effectiveAppearance.performAsCurrentDrawingAppearance { engine.drawContent(context.boundingBoxOfClipPath) }
        NSGraphicsContext.current = previous
    }

    func action(for layer: CALayer, forKey event: String) -> (any CAAction)? { NSNull() }
}
