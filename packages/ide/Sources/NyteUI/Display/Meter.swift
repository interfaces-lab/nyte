import AppKit

@MainActor
public final class Meter: NSView {
    public var value: Double? { didSet { if value != oldValue { valueDidChange() } } }
    public var tone: Tone { didSet { needsDisplay = true } }

    static let sweepShare: CGFloat = 1.0 / 3
    static let sweepDuration: TimeInterval = 1.2
    static let percent: Double = 100
    private static let sweepKey = "sweep"

    private let indicator = CALayer()
    private lazy var gate = FrameGate(self) { [weak self] in self?.updateSweep() }

    public init(value: Double? = 0, tone: Tone = .neutral) {
        self.value = value
        self.tone = tone
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        layer?.masksToBounds = true
        indicator.cornerCurve = .continuous
        layer?.addSublayer(indicator)
        setContentHuggingPriority(.required, for: .vertical)
        setAccessibilityElement(true)
        setAccessibilityRole(.progressIndicator)
        valueDidChange()
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: Metric.meter) }
    override public var wantsUpdateLayer: Bool { true }

    override public func updateLayer() {
        guard let layer else { return }
        layer.backgroundColor = Palette.fillSecondary.cgColor
        layer.cornerRadius = bounds.height / 2
        layer.cornerCurve = .continuous
        let toned = tone != .neutral && value != nil
        indicator.backgroundColor = (toned ? Palette.color(.bgInteractiveStrong, tone: tone) : Palette.contentSecondary).cgColor
        indicator.cornerRadius = bounds.height / 2
    }

    private func valueDidChange() {
        setAccessibilityValue(value.map { $0 * Self.percent })
        needsDisplay = true
        needsLayout = true
    }

    override public func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setAnimationDuration(Motion.duration(Motion.fast))
        CATransaction.setAnimationTimingFunction(Motion.easeOut)
        if let value {
            indicator.removeAnimation(forKey: Self.sweepKey)
            indicator.frame = CGRect(x: 0, y: 0, width: bounds.width * min(max(value, 0), 1), height: bounds.height)
        } else {
            let width = (bounds.width * Self.sweepShare).rounded()
            CATransaction.setDisableActions(true)
            indicator.frame = CGRect(x: ((bounds.width - width) / 2).rounded(), y: 0, width: width, height: bounds.height)
        }
        CATransaction.commit()
        updateSweep()
    }

    override public func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        gate.viewDidMoveToWindow()
    }

    override public func viewDidHide() {
        super.viewDidHide()
        updateSweep()
    }

    override public func viewDidUnhide() {
        super.viewDidUnhide()
        updateSweep()
    }

    private func updateSweep() {
        let running = value == nil && gate.isOpen && Motion.duration(Self.sweepDuration) > 0
        guard running else { return indicator.removeAnimation(forKey: Self.sweepKey) }
        guard indicator.animation(forKey: Self.sweepKey) == nil else { return }
        let width = indicator.bounds.width
        let sweep = CABasicAnimation(keyPath: "position.x")
        sweep.fromValue = -width / 2
        sweep.toValue = bounds.width + width / 2
        sweep.duration = Self.sweepDuration
        sweep.timingFunction = Motion.easeInOutStrong
        sweep.repeatCount = .infinity
        indicator.add(sweep, forKey: Self.sweepKey)
    }
}
