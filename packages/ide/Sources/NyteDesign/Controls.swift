import AppKit

/// SF Symbols at one weight and one optical size per context, so glyphs match their neighbours.
public enum Symbol {
    @MainActor public static func image(_ name: String, size: CGFloat = 13, weight: NSFont.Weight = .regular) -> NSImage? {
        NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: size, weight: weight))
    }
}

/// A single-line label set with a type step and an ink role.
@MainActor
public final class Label: NSTextField {
    public init(_ text: String = "", style: TextStyle = .base, color: NSColor = Palette.contentPrimary,
                weight: NSFont.Weight = .regular) {
        super.init(frame: .zero)
        stringValue = text
        font = style.font(weight)
        textColor = color
        isEditable = false
        isSelectable = false
        isBordered = false
        drawsBackground = false
        lineBreakMode = .byTruncatingTail
        maximumNumberOfLines = 1
        cell?.truncatesLastVisibleLine = true
        translatesAutoresizingMaskIntoConstraints = false
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

/// A quiet icon button for content surfaces: no bezel at rest, a tertiary fill on hover and a
/// secondary fill while pressed or while `isOn`. Use `GlassButton` only in the titlebar row.
@MainActor
public final class IconButton: NSControl {
    public var isOn = false { didSet { needsDisplay = true } }
    public var ink: NSColor = Palette.contentSecondary { didSet { needsDisplay = true } }
    private let symbol: NSImage?
    private var hovering = false { didSet { needsDisplay = true } }
    private var pressing = false { didSet { needsDisplay = true } }

    public init(symbol name: String, label: String, size: CGFloat = 13, target: AnyObject? = nil, action: Selector? = nil) {
        symbol = Symbol.image(name, size: size)
        super.init(frame: .zero)
        self.target = target
        self.action = action
        toolTip = label
        setAccessibilityLabel(label)
        setAccessibilityRole(.button)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: Metric.iconButton),
            heightAnchor.constraint(equalToConstant: Metric.iconButton),
        ])
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var mouseDownCanMoveWindow: Bool { false }
    override public func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override public func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow], owner: self))
    }

    override public func mouseEntered(with event: NSEvent) { hovering = true }
    override public func mouseExited(with event: NSEvent) { hovering = false }

    override public func mouseDown(with event: NSEvent) {
        guard isEnabled else { return }
        pressing = true
        while let next = window?.nextEvent(matching: [.leftMouseUp, .leftMouseDragged]) {
            let inside = bounds.contains(convert(next.locationInWindow, from: nil))
            pressing = inside
            guard next.type == .leftMouseUp else { continue }
            pressing = false
            if inside { sendAction(action, to: target) }
            return
        }
    }

    override public func accessibilityPerformPress() -> Bool {
        sendAction(action, to: target)
    }

    override public func draw(_ dirtyRect: NSRect) {
        let fill: NSColor? = if pressing || isOn { Palette.fillSecondary } else if hovering { Palette.fillTertiary } else { nil }
        if let fill {
            fill.setFill()
            NSBezierPath(roundedRect: bounds, xRadius: Radius.control, yRadius: Radius.control).fill()
        }
        guard let symbol else { return }
        let tint = isEnabled ? (hovering || isOn ? Palette.contentPrimary : ink) : Palette.contentDisabled
        let tinted = symbol.withSymbolConfiguration(
            NSImage.SymbolConfiguration(paletteColors: [tint]).applying(symbol.symbolConfiguration)
        ) ?? symbol
        let size = tinted.size
        tinted.draw(in: NSRect(
            x: ((bounds.width - size.width) / 2).rounded(), y: ((bounds.height - size.height) / 2).rounded(),
            width: size.width, height: size.height
        ))
    }
}

/// The titlebar row's control: the system's glass capsule. Glass belongs here, on the few
/// navigation controls that float over the chrome, and nowhere inside a pane.
@MainActor
public final class GlassButton: NSButton {
    public init(symbol name: String, label: String, target: AnyObject?, action: Selector) {
        super.init(frame: .zero)
        image = Symbol.image(name, size: 13, weight: .medium)
        imagePosition = .imageOnly
        bezelStyle = .glass
        borderShape = .capsule
        controlSize = .regular
        self.target = target
        self.action = action
        toolTip = label
        setAccessibilityLabel(label)
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: 34),
            heightAnchor.constraint(equalToConstant: 28),
        ])
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var mouseDownCanMoveWindow: Bool { false }
}

/// A list row's background: an inset, rounded fill that climbs Nyte's stairs with state.
/// Selection is never coloured.
@MainActor
public final class ListRowView: NSTableRowView {
    public var hovering = false { didSet { needsDisplay = true } }

    override public var isEmphasized: Bool { get { false } set {} }
    override public var interiorBackgroundStyle: NSView.BackgroundStyle { .normal }

    override public func drawBackground(in dirtyRect: NSRect) {
        guard hovering, !isSelected else { return }
        Palette.fillTertiary.setFill()
        pill.fill()
    }

    override public func drawSelection(in dirtyRect: NSRect) {
        Palette.fillSecondary.setFill()
        pill.fill()
        Palette.strokeQuaternary.setStroke()
        let ring = NSBezierPath(
            roundedRect: pillRect.insetBy(dx: 0.5, dy: 0.5), xRadius: Radius.control - 0.5, yRadius: Radius.control - 0.5
        )
        ring.lineWidth = 1
        ring.stroke()
    }

    private var pillRect: NSRect { bounds.insetBy(dx: Space.x2, dy: 1) }
    private var pill: NSBezierPath { NSBezierPath(roundedRect: pillRect, xRadius: Radius.control, yRadius: Radius.control) }
}
