import AppKit

@MainActor
public final class Chip: Control, NSViewToolTipOwner {
    public var title: String { didSet { contentDidChange() } }
    public var detail: String { didSet { contentDidChange() } }
    public var image: NSImage? { didSet { contentDidChange() } }
    public var symbol: String? { didSet { contentDidChange() } }
    public var symbolTone: Tone? { didSet { needsDisplay = true } }
    public var onRemove: (() -> Void)? { didSet { contentDidChange() } }
    public var onPeek: ((Bool) -> Void)?

    public static var height: CGFloat { Size.xs.height }
    public static let removeWord = "Remove"
    static let padding = Space.x15
    static let gap = Space.x1
    static let style = TextStyle.sm
    static let icon = Glyph.sm
    static let cross = Glyph.xxs
    static var crossTarget: CGFloat { Size.xxs.height }

    private var peeking = false
    private var ownToolTip: String?
    var isCrossHovered = false { didSet { if isCrossHovered != oldValue { needsDisplay = true } } }
    var isCrossPressed = false { didSet { if isCrossPressed != oldValue { needsDisplay = true } } }

    public init(_ title: String, detail: String = "", image: NSImage? = nil, symbol: String? = nil) {
        self.title = title
        self.detail = detail
        self.image = image
        self.symbol = symbol
        super.init(label: title)
        translatesAutoresizingMaskIntoConstraints = false
        tracksMovement = true
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        contentDidChange()
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var onPress: (() -> Void)? { didSet { contentDidChange() } }

    private var isRemovable: Bool { onRemove != nil && isEnabled }
    var isInteractive: Bool { onPress != nil || onRemove != nil || onPeek != nil || menuProvider != nil }

    private func contentDidChange() {
        setAccessibilityLabel(detail.isEmpty ? title : "\(title), \(detail)")
        setAccessibilityRole(onPress == nil && menuProvider == nil ? .staticText : .button)
        setAccessibilityCustomActions(onRemove == nil ? nil : [NSAccessibilityCustomAction(name: Self.removeWord) { [weak self] in
            self?.remove() ?? false
        }])
        invalidateIntrinsicContentSize()
        needsLayout = true
        needsDisplay = true
    }

    override public var intrinsicContentSize: NSSize {
        var width = Self.padding * 2 + iconRoom + Draw.width(of: title, style: Self.style, weight: .medium)
        if !detail.isEmpty { width += Self.gap + Draw.width(of: detail, style: Self.style, tabular: true) }
        if onRemove != nil { width += Self.gap + Self.cross.rawValue }
        return NSSize(width: width.rounded(.up), height: Self.height)
    }

    override public var outline: NSBezierPath { Shape.rounded(bounds, radius: Radius.indicator) }

    private var iconRoom: CGFloat { image == nil && symbol == nil ? 0 : Self.icon.rawValue + Self.gap }

    var removeSlot: NSRect {
        NSRect(x: bounds.maxX - Self.padding - Self.cross.rawValue, y: bounds.minY, width: Self.cross.rawValue, height: bounds.height)
    }

    var removeTarget: NSRect {
        guard onRemove != nil else { return .zero }
        let slot = removeSlot
        return NSRect(x: slot.midX - Self.crossTarget / 2, y: slot.midY - Self.crossTarget / 2, width: Self.crossTarget,
                      height: Self.crossTarget).intersection(bounds)
    }

    override public func draw(_ dirtyRect: NSRect) {
        let state = interaction
        let disabled = state.contains(.disabled)
        let live = isInteractive && !disabled
        let lit = live && state.contains(.hovered) && !isCrossHovered
        let fill = live && state.contains(.pressed) ? Palette.fillPrimary : (lit ? Palette.fillSecondary : Palette.fillTertiary)
        Draw.fill(bounds, radius: Radius.indicator, color: fill)
        let ink = disabled ? Palette.contentDisabled : (lit ? Palette.contentPrimary : Palette.contentSecondary)
        var x = bounds.minX + Self.padding
        let slot = NSRect(x: x, y: bounds.minY, width: Self.icon.rawValue, height: bounds.height)
        if let image {
            image.draw(in: slot.insetBy(dx: 0, dy: (bounds.height - Self.icon.rawValue) / 2), from: .zero, operation: .sourceOver,
                       fraction: disabled ? Opacity.disabled : 1, respectFlipped: true, hints: nil)
        } else if let symbol, let glyph = Symbol.image(symbol, glyph: Self.icon) {
            let toned = state.isDisjoint(with: [.disabled, .inactive]) ? symbolTone : nil
            let glyphInk = disabled ? Palette.contentDisabled : toned.map { Palette.color(.contentAccent, tone: $0) } ?? Palette.contentTertiary
            Draw.glyph(glyph, centeredIn: slot, ink: glyphInk)
        }
        x += iconRoom
        let end = onRemove == nil ? bounds.maxX - Self.padding : removeSlot.minX - Self.gap
        let titleWidth = min(Draw.width(of: title, style: Self.style, weight: .medium), max(0, end - x))
        Draw.text(title, in: NSRect(x: x, y: bounds.minY, width: titleWidth, height: bounds.height), style: Self.style, ink: ink,
                  weight: .medium)
        x += titleWidth + Self.gap
        if !detail.isEmpty, x < end {
            Draw.text(detail, in: NSRect(x: x, y: bounds.minY, width: end - x, height: bounds.height), style: Self.style,
                      ink: disabled ? Palette.contentDisabled : Palette.contentTertiary, tabular: true)
        }
        guard onRemove != nil, let cross = Symbol.image("xmark", glyph: Self.cross, weight: .semibold) else { return }
        if isRemovable, isCrossHovered {
            Draw.fill(removeTarget, radius: Radius.indicator, color: isCrossPressed ? Palette.fillPrimary : Palette.fillSecondary)
        }
        let crossInk = disabled ? Palette.contentDisabled
            : (isCrossHovered ? Palette.contentPrimary : (lit ? Palette.contentSecondary : Palette.contentTertiary))
        Draw.glyph(cross, centeredIn: removeSlot, ink: crossInk)
    }

    override public func stateDidChange() {
        super.stateDidChange()
        if !isHovered { isCrossHovered = false }
        peek(isEnabled && (isHovered || window?.firstResponder === self))
    }

    private func peek(_ shown: Bool) {
        guard shown != peeking else { return }
        peeking = shown
        onPeek?(shown)
    }

    override public func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        if became { peek(isEnabled) }
        return became
    }

    override public func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned { peek(isHovered) }
        return resigned
    }

    override public func mouseMoved(with event: NSEvent) {
        isCrossHovered = isRemovable && removeTarget.contains(convert(event.locationInWindow, from: nil))
    }

    override public func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        mouseMoved(with: event)
    }

    override public func mouseDown(with event: NSEvent) {
        guard isRemovable, removeTarget.contains(convert(event.locationInWindow, from: nil)) else { return super.mouseDown(with: event) }
        isCrossPressed = true
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = removeTarget.contains(convert(next.locationInWindow, from: nil))
            isCrossPressed = inside
            isCrossHovered = inside
            guard next.type == .leftMouseUp else { continue }
            isCrossPressed = false
            if inside { _ = remove() }
            return
        }
        isCrossPressed = false
    }

    override public func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .option, .control])
        let deletes = event.specialKey.map { [.delete, .deleteForward, .backspace].contains($0) } ?? false
        guard deletes, modifiers.isEmpty, isRemovable else { return super.keyDown(with: event) }
        _ = remove()
    }

    @discardableResult
    func remove() -> Bool {
        guard isRemovable, let onRemove else { return false }
        let held = window?.firstResponder === self
        let neighbour = held ? (nextValidKeyView ?? previousValidKeyView) : nil
        let window = window
        onRemove()
        guard held, let window, window.firstResponder === self || window.firstResponder === window else { return true }
        if let neighbour, neighbour !== self, neighbour.window === window { window.makeFirstResponder(neighbour) }
        return true
    }

    override public func accessibilityPerformDelete() -> Bool { remove() }

    override public func accessibilityPerformPress() -> Bool {
        guard onPress != nil || menuProvider != nil else { return false }
        return super.accessibilityPerformPress()
    }

    override public var toolTip: String? {
        get { ownToolTip }
        set {
            ownToolTip = newValue
            needsLayout = true
        }
    }

    override public func layout() {
        super.layout()
        removeAllToolTips()
        let cross = removeTarget
        guard isRemovable, !cross.isEmpty else {
            addToolTip(bounds, owner: self, userData: nil)
            return
        }
        addToolTip(NSRect(x: bounds.minX, y: bounds.minY, width: cross.minX - bounds.minX, height: bounds.height), owner: self, userData: nil)
        addToolTip(NSRect(x: cross.minX, y: bounds.minY, width: bounds.maxX - cross.minX, height: bounds.height), owner: self, userData: nil)
    }

    public func view(_ view: NSView, stringForToolTip tag: NSView.ToolTipTag, point: NSPoint,
                     userData data: UnsafeMutableRawPointer?) -> String {
        if isRemovable, point.x >= removeTarget.minX { return Self.removeWord }
        return ownToolTip ?? ""
    }
}
