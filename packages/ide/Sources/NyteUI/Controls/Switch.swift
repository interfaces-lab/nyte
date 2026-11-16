import AppKit

@MainActor
public final class Switch: Control {
    public var onChange: ((Bool) -> Void)?

    private lazy var knob = makeTween(isOn ? 1 : 0)

    public init(label: String, isOn: Bool = false, onChange: ((Bool) -> Void)? = nil) {
        super.init(label: label)
        self.isOn = isOn
        self.onChange = onChange
        setAccessibilityRole(.checkBox)
        setAccessibilitySubrole(.switch)
        setAccessibilityValue(isOn ? 1 : 0)
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
    }

    override public var intrinsicContentSize: NSSize { NSSize(width: Metric.switchWidth, height: Metric.switchHeight) }

    private var track: NSRect {
        NSRect(x: bounds.minX, y: (bounds.midY - Metric.switchHeight / 2).rounded(),
               width: Metric.switchWidth, height: Metric.switchHeight)
    }

    override public var outline: NSBezierPath { Shape.rounded(track, radius: Metric.switchHeight / 2) }
    override public var focusRingMaskBounds: NSRect { track }

    override public func stateDidChange() {
        super.stateDidChange()
        if knob.target != (isOn ? 1 : 0) {
            knob.move(to: isOn ? 1 : 0, duration: Motion.duration(Motion.slow), curve: Motion.easeInOutStrong)
            setAccessibilityValue(isOn ? 1 : 0)
        }
    }

    override public func press() {
        guard isEnabled else { return }
        isOn.toggle()
        super.press()
        onChange?(isOn)
    }

    override public func draw(_ dirtyRect: NSRect) {
        let state = interaction
        let pressed = state.contains(.pressed), hovered = state.contains(.hovered)
        Draw.faded(state.contains(.disabled) ? Opacity.disabled : 1, in: bounds) {
            let track = self.track
            let fill: NSColor = isOn
                ? (pressed ? Palette.bgControlSelectedPressed : hovered ? Palette.bgControlSelectedHover : Palette.bgControlSelected)
                : (pressed ? Palette.bgControlHover : hovered ? Palette.bgControl : Palette.fillPrimary)
            Draw.fill(track, radius: track.height / 2, color: fill)
            if !isOn, !pressed, !hovered, !state.contains(.disabled) {
                Draw.ring(track, radius: track.height / 2, color: Palette.contentTertiary)
            }
            let travel = Metric.switchWidth - Metric.switchKnob - Space.x05 * 2
            let knobRect = NSRect(x: track.minX + Space.x05 + travel * knob.value, y: track.minY + Space.x05,
                                  width: Metric.switchKnob, height: Metric.switchKnob)
            NSGraphicsContext.saveGraphicsState()
            Elevation.sm.shadow(flipped: true).set()
            Palette.contentOnControl.setFill()
            NSBezierPath(ovalIn: knobRect).fill()
            NSGraphicsContext.restoreGraphicsState()
        }
    }
}
