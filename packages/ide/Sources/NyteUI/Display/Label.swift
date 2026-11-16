import AppKit

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

    override public func draw(_ dirtyRect: NSRect) {
        TextInk.matchTextViews()
        super.draw(dirtyRect)
    }
}
