import AppKit

/// A layer-backed box whose fill, ring and radius are colour roles. Roles re-resolve on every
/// appearance change because the layer is rebuilt in `updateLayer`.
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

/// A working pane: the base surface, a hairline ring, and a radius concentric with the window.
@MainActor
public final class PaneCard: SurfaceView {
    public init() {
        super.init(fill: Palette.bgBase, ring: Palette.strokeQuaternary, radius: Radius.pane)
        clipsContent = true
    }

    /// Pins a pane's content to the card's edges.
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

/// A 1pt separator that takes its thickness from a constraint, not from layout padding.
@MainActor
public final class Hairline: SurfaceView {
    public enum Axis { case horizontal, vertical }

    public init(_ axis: Axis = .horizontal, color: NSColor = Palette.strokeQuaternary) {
        super.init(fill: color)
        let thickness = axis == .horizontal ? heightAnchor : widthAnchor
        thickness.constraint(equalToConstant: Metric.hairline).isActive = true
    }
}

/// The window's ground: system vibrancy with Nyte's warm wash over it. The sidebar and the
/// titlebar row sit directly on this; panes are cards above it.
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
