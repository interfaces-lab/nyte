import AppKit

@MainActor
public final class Loader: NSView {
    public var ink: NSColor = Palette.contentSecondary { didSet { needsDisplay = true } }
    public let side: CGFloat

    static let arc: CGFloat = 0.25
    static let start: CGFloat = -0.25
    private static let turnKey = "turn"

    private let track = CAShapeLayer()
    private let ring = CAShapeLayer()
    private lazy var gate = FrameGate(self) { [weak self] in self?.updateAnimation() }
    var isAnimating: Bool { ring.animation(forKey: Self.turnKey) != nil }

    public init(side: CGFloat = Glyph.md.rawValue) {
        self.side = side
        super.init(frame: NSRect(origin: .zero, size: NSSize(width: side, height: side)))
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        for shape in [track, ring] {
            shape.fillColor = nil
            shape.lineWidth = Metric.markStroke
            shape.lineCap = .round
            layer?.addSublayer(shape)
        }
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        setAccessibilityElement(true)
        setAccessibilityRole(.progressIndicator)
        setAccessibilityLabel("Loading")
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var intrinsicContentSize: NSSize { NSSize(width: side, height: side) }
    override public var wantsUpdateLayer: Bool { true }

    override public func updateLayer() {
        let color = ink.cgColor
        track.strokeColor = color
        track.opacity = Float(Opacity.track)
        ring.strokeColor = color
    }

    override public func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let box = CGRect(x: (bounds.width - side) / 2, y: (bounds.height - side) / 2, width: side, height: side)
        let circle = box.insetBy(dx: Metric.markStroke / 2, dy: Metric.markStroke / 2)
        let radius = circle.width / 2
        let path = CGMutablePath()
        let begin = Self.start * 2 * .pi
        path.addArc(center: CGPoint(x: circle.midX, y: circle.midY), radius: radius,
                    startAngle: -begin, endAngle: -(begin + Self.arc * 2 * .pi), clockwise: true)
        for shape in [track, ring] { shape.frame = bounds }
        track.path = CGPath(ellipseIn: circle, transform: nil)
        ring.path = path
        CATransaction.commit()
        updateAnimation()
    }

    override public func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        gate.viewDidMoveToWindow()
    }

    override public func viewDidHide() {
        super.viewDidHide()
        updateAnimation()
    }

    override public func viewDidUnhide() {
        super.viewDidUnhide()
        updateAnimation()
    }

    public static var currentTurn: CGFloat {
        let period = Motion.duration(Motion.loaderTurn)
        guard period > 0 else { return 0 }
        return CGFloat(CACurrentMediaTime().truncatingRemainder(dividingBy: period) / period)
    }

    static let degreesPerTurn: CGFloat = 360

    public static func draw(turn: CGFloat, ink: NSColor, track trackInk: NSColor = Palette.fillPrimary, side: CGFloat, in rect: NSRect) {
        let box = NSRect(x: (rect.midX - side / 2).rounded(), y: (rect.midY - side / 2).rounded(), width: side, height: side)
        let circle = box.insetBy(dx: Metric.markStroke / 2, dy: Metric.markStroke / 2)
        let track = NSBezierPath(ovalIn: circle)
        track.lineWidth = Metric.markStroke
        trackInk.setStroke()
        track.stroke()
        let ring = NSBezierPath()
        let begin = (start + turn) * degreesPerTurn
        ring.appendArc(withCenter: NSPoint(x: circle.midX, y: circle.midY), radius: circle.width / 2, startAngle: begin,
                       endAngle: begin + arc * degreesPerTurn)
        ring.lineWidth = Metric.markStroke
        ring.lineCapStyle = .round
        ink.setStroke()
        ring.stroke()
    }

    private func updateAnimation() {
        let running = gate.isOpen && Motion.duration(Motion.loaderTurn) > 0
        guard running else { return ring.removeAnimation(forKey: Self.turnKey) }
        guard ring.animation(forKey: Self.turnKey) == nil else { return }
        ring.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        ring.position = CGPoint(x: bounds.midX, y: bounds.midY)
        let turn = CABasicAnimation(keyPath: "transform.rotation.z")
        turn.fromValue = 0
        turn.toValue = -2 * Double.pi
        turn.duration = Motion.loaderTurn
        turn.repeatCount = .infinity
        ring.add(turn, forKey: Self.turnKey)
    }
}
