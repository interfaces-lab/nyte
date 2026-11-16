import AppKit

@MainActor
open class SurfaceView: NSView {
    public var fill: NSColor? { didSet { needsDisplay = true } }
    public var ring: NSColor? { didSet { needsDisplay = true } }
    public var ringWidth: CGFloat = Metric.hairline { didSet { needsDisplay = true } }
    public var radius: CGFloat = 0 { didSet { needsDisplay = true } }
    public var clipsContent = false { didSet { needsDisplay = true } }

    public init(fill: NSColor? = nil, ring: NSColor? = nil, radius: CGFloat = 0) {
        self.fill = fill
        self.ring = ring
        self.radius = radius
        super.init(frame: .zero)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override open var wantsUpdateLayer: Bool { true }

    override open func updateLayer() {
        guard let layer else { return }
        layer.backgroundColor = fill?.cgColor
        layer.borderColor = ring?.cgColor
        layer.borderWidth = ring == nil ? 0 : ringWidth
        layer.cornerRadius = radius
        layer.cornerCurve = .continuous
        layer.masksToBounds = clipsContent
    }
}

@MainActor
public final class PaneCard: SurfaceView {
    public var isFocused = false {
        didSet { ring = isFocused ? Palette.strokeTertiary : Palette.strokeQuaternary }
    }

    public private(set) var cornerRadii = CornerRadii(Radius.pane)
    // Core Animation: a layer rounds its corners alike, so differing corners clip with a mask
    private let shapeMask = CAShapeLayer()
    private let edge = CAShapeLayer()

    public init() {
        super.init(fill: Palette.bgBase, ring: Palette.strokeQuaternary, radius: Radius.pane)
        clipsContent = true
        edge.fillColor = nil
        edge.zPosition = 1
    }

    override public var cornerConfiguration: NSViewCornerConfiguration? {
        .corners(radius: .containerConcentric(Radius.pane))
    }

    override public func viewDidChangeEffectiveCornerRadii() {
        super.viewDidChangeEffectiveCornerRadii()
        guard let resolved = effectiveCornerRadii else { return }
        cornerRadii = CornerRadii(
            topLeft: max(resolved.topLeft, Radius.pane), topRight: max(resolved.topRight, Radius.pane),
            bottomLeft: max(resolved.bottomLeft, Radius.pane), bottomRight: max(resolved.bottomRight, Radius.pane)
        )
        needsDisplay = true
    }

    override public func updateLayer() {
        super.updateLayer()
        guard let layer else { return }
        guard !cornerRadii.isUniform else {
            layer.cornerRadius = cornerRadii.topLeft
            layer.mask = nil
            edge.removeFromSuperlayer()
            return
        }
        layer.cornerRadius = 0
        layer.borderWidth = 0
        layer.masksToBounds = false
        layer.mask = shapeMask
        if edge.superlayer !== layer { layer.addSublayer(edge) }
        edge.strokeColor = ring?.cgColor
        edge.lineWidth = ringWidth
        updateShapes()
    }

    override public func layout() {
        super.layout()
        if !cornerRadii.isUniform { updateShapes() }
    }

    private func updateShapes() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        shapeMask.frame = bounds
        shapeMask.path = Shape.rounded(bounds, radii: cornerRadii, flipped: isFlipped).cgPath
        edge.frame = bounds
        let inset = ringWidth / 2
        let inner = CornerRadii(
            topLeft: cornerRadii.topLeft - inset, topRight: cornerRadii.topRight - inset,
            bottomLeft: cornerRadii.bottomLeft - inset, bottomRight: cornerRadii.bottomRight - inset
        )
        edge.path = Shape.rounded(bounds.insetBy(dx: inset, dy: inset), radii: inner, flipped: isFlipped).cgPath
        CATransaction.commit()
    }

    public func embed(_ content: NSView) {
        content.translatesAutoresizingMaskIntoConstraints = false
        addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: leadingAnchor),
            content.trailingAnchor.constraint(equalTo: trailingAnchor),
            content.topAnchor.constraint(equalTo: topAnchor),
            content.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }
}

@MainActor
public final class Hairline: SurfaceView {
    public enum Axis { case horizontal, vertical }

    public init(_ axis: Axis = .horizontal, color: NSColor = Palette.strokeQuaternary) {
        super.init(fill: color)
        let thickness = axis == .horizontal ? heightAnchor : widthAnchor
        thickness.constraint(equalToConstant: Metric.hairline).isActive = true
    }
}

@MainActor
public final class ChromeBackground: NSVisualEffectView {
    private let wash = SurfaceView(fill: Palette.chromeWash)

    public init() {
        super.init(frame: .zero)
        material = .sidebar
        blendingMode = .behindWindow
        state = .followsWindowActiveState
        translatesAutoresizingMaskIntoConstraints = false
        addSubview(wash)
        NSLayoutConstraint.activate([
            wash.leadingAnchor.constraint(equalTo: leadingAnchor),
            wash.trailingAnchor.constraint(equalTo: trailingAnchor),
            wash.topAnchor.constraint(equalTo: topAnchor),
            wash.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(displayOptionsChanged),
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil
        )
        displayOptionsChanged()
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func displayOptionsChanged() {
        let workspace = NSWorkspace.shared
        let opaque = workspace.accessibilityDisplayShouldReduceTransparency
            || workspace.accessibilityDisplayShouldIncreaseContrast
        wash.fill = opaque ? Palette.bgChrome : Palette.chromeWash
    }
}
