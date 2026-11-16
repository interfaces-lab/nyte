import AppKit

@MainActor
public final class Checkbox: Control {
    public enum State: Int, Sendable {
        case off = 0, on = 1, mixed = 2
    }

    public var state: State {
        didSet {
            guard state != oldValue else { return }
            isOn = state != .off
            setAccessibilityValue(state.rawValue)
        }
    }
    public var title: String { didSet { setAccessibilityLabel(title); invalidateIntrinsicContentSize(); needsDisplay = true } }
    public var onChange: ((State) -> Void)?

    private static let box = Metric.checkbox
    private static let gap = Space.x2
    private static let style = TextStyle.base

    public init(_ title: String = "", label: String? = nil, state: State = .off, onChange: ((State) -> Void)? = nil) {
        self.state = state
        self.title = title
        super.init(label: label ?? title)
        self.onChange = onChange
        isOn = state != .off
        setAccessibilityRole(.checkBox)
        setAccessibilityValue(state.rawValue)
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
    }

    override public var intrinsicContentSize: NSSize {
        guard !title.isEmpty else { return NSSize(width: Self.box, height: Self.box) }
        return NSSize(width: Self.box + Self.gap + Draw.width(of: title, style: Self.style), height: Self.style.lineHeight)
    }

    private var boxRect: NSRect {
        NSRect(x: bounds.minX, y: (bounds.midY - Self.box / 2).rounded(), width: Self.box, height: Self.box)
    }

    override public var outline: NSBezierPath { Shape.rounded(boxRect, radius: Radius.indicator) }
    override public var focusRingMaskBounds: NSRect { boxRect }

    override public func press() {
        guard isEnabled else { return }
        state = state == .on ? .off : .on
        super.press()
        onChange?(state)
    }

    override public func draw(_ dirtyRect: NSRect) {
        let interaction = self.interaction
        let pressed = interaction.contains(.pressed), hovered = interaction.contains(.hovered)
        Draw.faded(interaction.contains(.disabled) ? Opacity.disabled : 1, in: bounds) {
            let box = boxRect
            Self.drawBox(state, in: box, hovered: hovered, pressed: pressed)
            guard !title.isEmpty else { return }
            let x = box.maxX + Self.gap
            Draw.text(title, in: NSRect(x: x, y: bounds.minY, width: bounds.maxX - x, height: bounds.height),
                      style: Self.style, ink: Palette.contentPrimary)
        }
    }

    static func drawBox(_ state: State, in box: NSRect, hovered: Bool = false, pressed: Bool = false) {
        if state == .off {
            if pressed || hovered {
                Draw.fill(box, radius: Radius.indicator, color: pressed ? Palette.fillSecondary : Palette.fillTertiary)
            }
            Draw.ring(box, radius: Radius.indicator, color: Palette.strokePrimary, width: Metric.markStroke)
            return
        }
        let fill = pressed ? Palette.bgControlSelectedPressed
            : (hovered ? Palette.bgControlSelectedHover : Palette.bgControlSelected)
        Draw.fill(box, radius: Radius.indicator, color: fill)
        drawMark(state, in: box)
    }

    private static func drawMark(_ state: State, in box: NSRect) {
        guard state == .on else {
            let dash = NSRect(x: box.midX - Metric.dot / 2, y: box.midY - Space.x05 / 2, width: Metric.dot, height: Space.x05)
            Draw.fill(dash, radius: Space.x05 / 2, color: Palette.contentOnControl)
            return
        }
        if let check = Symbol.image("checkmark", glyph: .xs, weight: .bold) {
            Draw.glyph(check, centeredIn: box, ink: Palette.contentOnControl)
        }
    }
}
