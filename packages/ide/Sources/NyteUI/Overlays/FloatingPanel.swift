import AppKit

@MainActor
public final class FloatingPanel: NSObject {
    public static let anchorGap = Space.x1
    public static let screenMargin = Space.x2
    public static let rise = Space.x05
    public static let centredThird: CGFloat = 6
    public static let shadowMargin = Space.x8

    public enum Presentation: Sendable, Equatable {
        case palette, popover, hover

        var takesKey: Bool { self == .palette }
    }

    public let presentation: Presentation

    public var content: NSView? {
        didSet {
            oldValue?.removeFromSuperview()
            guard let content else { return }
            content.translatesAutoresizingMaskIntoConstraints = false
            ground.addSubview(content)
            NSLayoutConstraint.activate([
                content.leadingAnchor.constraint(equalTo: ground.leadingAnchor),
                content.trailingAnchor.constraint(equalTo: ground.trailingAnchor),
                content.topAnchor.constraint(equalTo: ground.topAnchor),
                content.bottomAnchor.constraint(equalTo: ground.bottomAnchor),
            ])
        }
    }

    public var onDismiss: (() -> Void)?
    public var isShown: Bool { panel.isVisible && !isClosing }
    public var window: NSWindow { panel }

    private let panel: Panel
    private let ground: FloatingSurface
    private let host = ShadowHost()
    private weak var parent: NSWindow?
    private var growsUp = false
    private var isClosing = false
    private var monitors: [Any] = []

    public convenience init(radius: CGFloat = Radius.card, takesKey: Bool = false) {
        self.init(radius: radius, presentation: takesKey ? .palette : .popover)
    }

    public init(radius: CGFloat = Radius.card, presentation: Presentation) {
        self.presentation = presentation
        panel = Panel(presentation: presentation)
        ground = FloatingSurface(radius: radius)
        super.init()
        ground.translatesAutoresizingMaskIntoConstraints = true
        ground.autoresizingMask = [.width, .height]
        host.radius = radius
        host.addSubview(ground)
        panel.contentView = host
        panel.onCancel = { [weak self] in self?.dismiss() }
        panel.onResignKey = { [weak self] in self?.dismiss() }
    }

    isolated deinit {
        monitors.forEach(NSEvent.removeMonitor)
    }

    public func show(size: NSSize, anchoredTo rect: NSRect, in view: NSView, prefersAbove: Bool = false) {
        guard let window = view.window else { return }
        let anchor = window.convertToScreen(view.convert(rect, to: nil))
        let visible = (window.screen ?? NSScreen.main)?.visibleFrame ?? window.frame
        let below = anchor.minY - Self.anchorGap - visible.minY
        let above = visible.maxY - anchor.maxY - Self.anchorGap
        growsUp = prefersAbove ? above >= size.height || above > below : below < size.height && above > below
        let y = growsUp ? anchor.maxY + Self.anchorGap : anchor.minY - Self.anchorGap - size.height
        let x = min(max(anchor.minX, visible.minX + Self.screenMargin), visible.maxX - Self.screenMargin - size.width)
        present(in: window, frame: NSRect(x: x, y: y, width: size.width, height: size.height), from: growsUp ? -Self.rise : Self.rise)
    }

    public func show(size: NSSize, beside other: FloatingPanel) {
        guard let window = other.parent, other.panel.isVisible else { return }
        let frame = other.contentFrame
        let visible = (window.screen ?? NSScreen.main)?.visibleFrame ?? window.frame
        growsUp = other.growsUp
        let right = frame.maxX + Self.anchorGap
        let x = right + size.width <= visible.maxX - Self.screenMargin ? right : frame.minX - Self.anchorGap - size.width
        let y = growsUp ? frame.minY : frame.maxY - size.height
        present(in: window, frame: NSRect(x: x, y: y, width: size.width, height: size.height), from: 0)
    }

    public func show(size: NSSize, centredIn window: NSWindow) {
        growsUp = false
        let frame = window.frame
        let top = min(frame.maxY - frame.height / Self.centredThird + size.height / 2, frame.maxY - Metric.titlebar)
        present(in: window, frame: NSRect(x: frame.midX - size.width / 2, y: top - size.height, width: size.width,
                                          height: size.height), from: Self.rise)
    }

    public func resize(to size: NSSize) {
        var frame = contentFrame
        if !growsUp { frame.origin.y = frame.maxY - size.height }
        frame.size = size
        place(frame, display: true)
    }

    public var frame: NSRect { contentFrame }
    var contentFrame: NSRect { panel.frame.insetBy(dx: Self.shadowMargin, dy: Self.shadowMargin) }

    private func place(_ frame: NSRect, display: Bool) {
        panel.setFrame(frame.insetBy(dx: -Self.shadowMargin, dy: -Self.shadowMargin), display: display)
        ground.frame = host.bounds.insetBy(dx: Self.shadowMargin, dy: Self.shadowMargin)
        host.needsLayout = true
    }

    public func dismiss() {
        guard panel.isVisible, !isClosing else { return }
        isClosing = true
        stopWatching()
        let duration = Motion.duration(Motion.fast)
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = duration
            context.timingFunction = Motion.easeOutQuint
            panel.animator().alphaValue = 0
        }, completionHandler: { MainActor.assumeIsolated { self.finishDismiss() } })
    }

    private func finishDismiss() {
        guard isClosing else { return }
        isClosing = false
        let heldFocus = panel.isKeyWindow
        parent?.removeChildWindow(panel)
        panel.orderOut(nil)
        if heldFocus { parent?.makeKey() }
        onDismiss?()
    }

    private func present(in window: NSWindow, frame: NSRect, from offset: CGFloat) {
        isClosing = false
        if parent !== window {
            parent?.removeChildWindow(panel)
            parent = window
        }
        place(frame, display: false)
        if panel.parent == nil { window.addChildWindow(panel, ordered: .above) }
        let wasShown = panel.isVisible && panel.alphaValue > 0
        if presentation == .hover { panel.ignoresMouseEvents = !contentFrame.contains(NSEvent.mouseLocation) }
        if presentation.takesKey, NSApp.isActive { panel.makeKeyAndOrderFront(nil) } else { panel.orderFront(nil) }
        startWatching()
        guard !wasShown else { panel.alphaValue = 1; return }
        let duration = Motion.duration(Motion.normal)
        guard duration > 0, let layer = ground.layer else { panel.alphaValue = 1; return }
        panel.alphaValue = 0
        let travel = CABasicAnimation(keyPath: "transform.translation.y")
        travel.fromValue = -offset
        travel.toValue = 0
        travel.duration = duration
        travel.timingFunction = Motion.easeOutQuint
        layer.add(travel, forKey: "rise")
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = Motion.easeOutQuint
            panel.animator().alphaValue = 1
        }
    }

    private func startWatching() {
        stopWatching()
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown],
                                                          handler: { [weak self] event in self?.filter(event) ?? event }) {
            monitors.append(monitor)
        }
        if presentation == .hover, let monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved], handler: { [weak self] event in
            self?.followPointer()
            return event
        }) {
            monitors.append(monitor)
        }
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown],
                                                           handler: { [weak self] _ in
                                                               MainActor.assumeIsolated { self?.dismiss() }
                                                           }) {
            monitors.append(monitor)
        }
        guard let parent else { return }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(parentChanged), name: NSWindow.willMoveNotification, object: parent)
        center.addObserver(self, selector: #selector(parentChanged), name: NSWindow.didResizeNotification, object: parent)
        center.addObserver(self, selector: #selector(parentResignedKey), name: NSWindow.didResignKeyNotification, object: parent)
        center.addObserver(self, selector: #selector(parentClosing), name: NSWindow.willCloseNotification, object: parent)
    }

    private func stopWatching() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        NotificationCenter.default.removeObserver(self)
    }

    private func followPointer() {
        let outside = !contentFrame.contains(NSEvent.mouseLocation)
        if panel.ignoresMouseEvents != outside { panel.ignoresMouseEvents = outside }
    }

    private func filter(_ event: NSEvent) -> NSEvent? {
        if event.type == .keyDown {
            guard event.keyCode == KeyCode.escape else { return event }
            dismiss()
            return nil
        }
        if event.window !== panel { dismiss() }
        return event
    }

    @objc private func parentChanged() { dismiss() }

    @objc private func parentClosing() {
        stopWatching()
        isClosing = true
        finishDismiss()
    }

    @objc private func parentResignedKey() {
        DispatchQueue.main.async { [weak self] in
            guard let self, NSApp.keyWindow !== self.panel else { return }
            self.dismiss()
        }
    }
}

@MainActor
private final class Panel: NSPanel {
    let presentation: FloatingPanel.Presentation
    var takesKey: Bool { presentation.takesKey }
    var onCancel: (() -> Void)?
    var onResignKey: (() -> Void)?

    init(presentation: FloatingPanel.Presentation) {
        self.presentation = presentation
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        isMovable = false
        hidesOnDeactivate = true
        animationBehavior = .none
        becomesKeyOnlyIfNeeded = !presentation.takesKey
        isReleasedWhenClosed = false
        acceptsMouseMovedEvents = presentation == .hover
    }

    override var canBecomeKey: Bool { takesKey }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { onCancel?() }

    override func resignKey() {
        super.resignKey()
        guard takesKey else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, NSApp.keyWindow !== self else { return }
            self.onResignKey?()
        }
    }
}

@MainActor
public final class FloatingSurface: SurfaceView {
    public init(radius: CGFloat = Radius.card) {
        super.init(fill: Palette.bgElevated, ring: Palette.strokeQuaternary, radius: radius)
        clipsContent = true
    }
}

@MainActor
final class ShadowHost: NSView {
    static let offset = Space.x2
    static let blur = Space.x3
    static let lightAlpha: Float = 0.12
    static let darkAlpha: Float = 0.3

    var radius: CGFloat = Radius.card
    private let shadowLayer = CALayer()

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.addSublayer(shadowLayer)
        shadowLayer.shadowOffset = CGSize(width: 0, height: -Self.offset)
        shadowLayer.shadowRadius = Self.blur
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var wantsUpdateLayer: Bool { true }

    override func updateLayer() {
        let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        shadowLayer.shadowOpacity = dark ? Self.darkAlpha : Self.lightAlpha
        shadowLayer.shadowColor = Palette.bgScrim.cgColor
    }

    override func layout() {
        super.layout()
        let surface = bounds.insetBy(dx: FloatingPanel.shadowMargin, dy: FloatingPanel.shadowMargin)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        shadowLayer.frame = bounds
        shadowLayer.shadowPath = CGPath(roundedRect: surface, cornerWidth: radius, cornerHeight: radius, transform: nil)
        CATransaction.commit()
    }
}
