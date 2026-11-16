import AppKit

@MainActor
open class Control: NSControl {
    public struct Interaction: OptionSet, Sendable {
        public let rawValue: UInt8
        public init(rawValue: UInt8) { self.rawValue = rawValue }

        public static let hovered = Interaction(rawValue: 1 << 0)
        public static let pressed = Interaction(rawValue: 1 << 1)
        public static let on = Interaction(rawValue: 1 << 2)
        public static let disabled = Interaction(rawValue: 1 << 3)
        public static let inactive = Interaction(rawValue: 1 << 4)
    }

    public var onPress: (() -> Void)?
    public var menuProvider: (() -> NSMenu?)?
    public var isOn = false { didSet { if isOn != oldValue { stateDidChange() } } }
    public var alwaysFocusable = false
    public var tracksWhenInactive = false { didSet { updateTrackingAreas() } }
    public var tracksMovement = false { didSet { updateTrackingAreas() } }

    public internal(set) var isHovered = false { didSet { if isHovered != oldValue { stateDidChange() } } }
    public internal(set) var isPressed = false { didSet { if isPressed != oldValue { stateDidChange() } } }
    private var showsMenu = false { didSet { if showsMenu != oldValue { stateDidChange() } } }
    private var tracking: NSTrackingArea?
    private var tweens: [Tween] = []

    public init(label: String) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel(label)
        observeDensity(#selector(densityChanged))
    }

    @objc private func densityChanged() { densityDidChange() }

    open func densityDidChange() {
        invalidateIntrinsicContentSize()
        stateDidChange()
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public var interaction: Interaction {
        var state: Interaction = []
        let inactive = window.map { !$0.hasKeyFocus } ?? false
        if !isEnabled { return inactive ? [.disabled, .inactive] : .disabled }
        if isHovered { state.insert(.hovered) }
        if isPressed { state.insert(.pressed) }
        if isOn || showsMenu { state.insert(.on) }
        if inactive { state.insert(.inactive) }
        return state
    }

    open func stateDidChange() { needsDisplay = true }

    func makeTween(_ value: CGFloat) -> Tween {
        let tween = Tween(value, in: self)
        tweens.append(tween)
        return tween
    }

    open var outline: NSBezierPath { Shape.rounded(bounds, radius: Radius.control) }

    open func press() {
        guard isEnabled else { return }
        sendAction(action, to: target)
        onPress?()
    }

    override open var isEnabled: Bool {
        didSet {
            guard isEnabled != oldValue else { return }
            if !isEnabled { isHovered = false; isPressed = false }
            stateDidChange()
        }
    }

    override open var isFlipped: Bool { true }
    override open var mouseDownCanMoveWindow: Bool { false }
    override open func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override open func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        var options: NSTrackingArea.Options = [.mouseEnteredAndExited, .inVisibleRect]
        options.insert(tracksWhenInactive ? .activeAlways : .activeInKeyWindow)
        if tracksMovement { options.insert(.mouseMoved) }
        let area = NSTrackingArea(rect: .zero, options: options, owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override open func mouseEntered(with event: NSEvent) { isHovered = isEnabled }
    override open func mouseExited(with event: NSEvent) { isHovered = false }

    override open func mouseDown(with event: NSEvent) {
        guard isEnabled else { return }
        if let menu = menuProvider?() { return popUpMenu(menu) }
        isPressed = true
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = bounds.contains(convert(next.locationInWindow, from: nil))
            isPressed = inside
            guard next.type == .leftMouseUp else { continue }
            isPressed = false
            if inside { press() }
            return
        }
        isPressed = false
    }

    private func popUpMenu(_ menu: NSMenu) {
        showsMenu = true
        menu.minimumWidth = max(menu.minimumWidth, bounds.width)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.maxY + Space.x1), in: self)
        showsMenu = false
        resyncHoverAfterMenuTracking()
    }

    var pointerLocation: NSPoint? { window.map { convert($0.mouseLocationOutsideOfEventStream, from: nil) } }

    func resyncHoverAfterMenuTracking() {
        isHovered = isEnabled && pointerLocation.map(bounds.contains) == true
    }

    override open func viewDidHide() {
        super.viewDidHide()
        isHovered = false
    }

    override open func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        observeKeyFocus(moving: newWindow, #selector(windowKeyDidChange))
        if newWindow == nil {
            NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(endPressedFlash), object: nil)
            isHovered = false
            isPressed = false
            for tween in tweens { tween.finish() }
        }
    }

    @objc private func windowKeyDidChange() { stateDidChange() }

    private static let pressKeys: Set<UInt16> = [KeyCode.returnKey, KeyCode.enter, KeyCode.space]

    override open var acceptsFirstResponder: Bool { isEnabled && (alwaysFocusable || NSApp.isFullKeyboardAccessEnabled) }
    override open var canBecomeKeyView: Bool { acceptsFirstResponder }

    override open func keyDown(with event: NSEvent) {
        guard isEnabled, Self.pressKeys.contains(event.keyCode) else {
            return super.keyDown(with: event)
        }
        performClick(nil)
    }

    override open func performClick(_ sender: Any?) {
        guard isEnabled else { return }
        if let menu = menuProvider?() { return popUpMenu(menu) }
        flashPressed()
        press()
    }

    func flashPressed() {
        isPressed = true
        NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(endPressedFlash), object: nil)
        perform(#selector(endPressedFlash), with: nil, afterDelay: Motion.fast)
    }

    @objc func endPressedFlash() { isPressed = false }

    override open var focusRingMaskBounds: NSRect { bounds }
    override open func drawFocusRingMask() { outline.fill() }

    override open func accessibilityPerformPress() -> Bool {
        guard isEnabled else { return false }
        performClick(nil)
        return true
    }

    override open func isAccessibilityEnabled() -> Bool { isEnabled }
}

@MainActor
public enum Stairs {
    public static func fill(_ state: Control.Interaction) -> NSColor? {
        if state.contains(.disabled) { return nil }
        if state.contains(.pressed) || state.contains(.on) { return Palette.fillSecondary }
        if state.contains(.hovered) { return Palette.fillTertiary }
        return nil
    }

    public static func raisedFill(_ state: Control.Interaction, tone: Tone = .neutral) -> NSColor {
        if state.contains(.disabled) { return Palette.fillTertiary }
        if state.contains(.pressed) || state.contains(.on) { return Palette.color(.fillPrimary, tone: tone) }
        if state.contains(.hovered) { return Palette.color(.fillSecondary, tone: tone) }
        return Palette.color(.fillTertiary, tone: tone)
    }

    public static func ring(_ state: Control.Interaction) -> NSColor? {
        state.contains(.on) && !state.contains(.disabled) ? Palette.contentTertiary : nil
    }

    public static func edge(_ state: Control.Interaction, rest: NSColor = Palette.strokeTertiary) -> NSColor {
        state.contains(.on) && !state.contains(.disabled) ? Palette.strokeSecondary : rest
    }

    public static func paint(_ state: Control.Interaction, in rect: NSRect, radius: CGFloat) {
        if let fill = fill(state) { Draw.fill(rect, radius: radius, color: fill) }
        if let ring = ring(state) { Draw.ring(rect, radius: radius, color: ring) }
    }

    public static func ink(_ state: Control.Interaction, rest: NSColor = Palette.contentSecondary) -> NSColor {
        if state.contains(.disabled) { return Palette.contentDisabled }
        if !state.isDisjoint(with: [.hovered, .pressed, .on]) { return Palette.contentPrimary }
        return rest
    }
}
