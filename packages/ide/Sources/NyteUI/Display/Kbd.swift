import AppKit

@MainActor
public final class Kbd: NSView {
    public var keys: [String] { didSet { contentDidChange() } }
    public var size: Size { didSet { contentDidChange() } }
    public var isPlain: Bool { didSet { contentDidChange() } }

    public init(keys: [String], size: Size = .xs, plain: Bool = false) {
        self.keys = keys
        self.size = size
        self.isPlain = plain
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        setAccessibilityValue(keys.joined())
    }

    public convenience init(_ shortcut: String, size: Size = .xs, plain: Bool = false) {
        self.init(keys: Self.split(shortcut), size: size, plain: plain)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public static func split(_ shortcut: String) -> [String] {
        let modifiers: Set<Character> = ["⌃", "⌥", "⇧", "⌘", "⇪"]
        var keys: [String] = []
        var rest = ""
        for character in shortcut {
            if modifiers.contains(character), rest.isEmpty { keys.append(String(character)) } else { rest.append(character) }
        }
        if !rest.isEmpty { keys.append(rest) }
        return keys
    }

    override public var isFlipped: Bool { true }

    private func contentDidChange() {
        setAccessibilityValue(keys.joined())
        invalidateIntrinsicContentSize()
        needsDisplay = true
    }

    private var style: TextStyle { size == .xs ? .xs : .sm }
    private var capHeight: CGFloat { style.lineHeight + Space.hair * 2 }
    private var gap: CGFloat { isPlain ? Space.hair : Space.x05 }

    private func capWidth(_ key: String) -> CGFloat {
        let text = Draw.width(of: key, style: style, tabular: true)
        return isPlain ? text : max(capHeight, text + Space.x1 * 2)
    }

    override public var intrinsicContentSize: NSSize {
        let widths = keys.map(capWidth)
        return NSSize(width: widths.reduce(0, +) + CGFloat(max(0, keys.count - 1)) * gap, height: capHeight)
    }

    override public func draw(_ dirtyRect: NSRect) {
        var x = bounds.minX
        let y = (bounds.midY - capHeight / 2).rounded()
        for key in keys {
            let rect = NSRect(x: x, y: y, width: capWidth(key), height: capHeight)
            if !isPlain { Draw.fill(rect, radius: Radius.indicator, color: Palette.fillTertiary) }
            Draw.text(key, in: rect, style: style, ink: isPlain ? Palette.contentTertiary : Palette.contentSecondary,
                      alignment: .center, lineBreak: .byClipping, tabular: true)
            x = rect.maxX + gap
        }
    }
}
