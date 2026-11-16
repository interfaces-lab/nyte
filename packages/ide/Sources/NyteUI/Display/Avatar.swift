import AppKit

@MainActor
public final class Avatar: NSView {
    public var name: String { didSet { if name != oldValue { needsDisplay = true; setAccessibilityLabel(name) } } }
    public var size: Size { didSet { invalidateIntrinsicContentSize(); needsDisplay = true } }

    public init(_ name: String, size: Size = .xs) {
        self.name = name
        self.size = size
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
        setAccessibilityLabel(name)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }
    override public var intrinsicContentSize: NSSize { NSSize(width: size.height, height: size.height) }

    static func monogram(for name: String) -> String {
        var words: [Character] = []
        var previous: Character?
        for character in name {
            let boundary = previous.map { !($0.isLetter || $0.isNumber) || (character.isUppercase && $0.isLowercase) } ?? true
            if boundary, character.isLetter || character.isNumber { words.append(character) }
            previous = character
        }
        return String(words.prefix(2)).uppercased()
    }

    private var style: TextStyle {
        switch size {
        case .xxs: .xxs
        case .xs: .xs
        default: .sm
        }
    }

    override public func draw(_ dirtyRect: NSRect) {
        let box = NSRect(x: ((bounds.width - size.height) / 2).rounded(), y: ((bounds.height - size.height) / 2).rounded(),
                         width: size.height, height: size.height)
        Draw.fill(box, radius: size.radius, color: Palette.fillSecondary)
        Draw.text(Self.monogram(for: name), in: box, style: style, ink: Palette.contentSecondary,
                  weight: .semibold, alignment: .center, lineBreak: .byClipping)
    }
}
