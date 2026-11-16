import AppKit

@MainActor
public final class SearchField: Input {
    public var count: String = "" { didSet { countLabel.stringValue = count; countLabel.isHidden = count.isEmpty } }
    public var onMove: ((Int) -> Void)?

    private let countLabel = Label("", style: .sm, color: Palette.contentTertiary)
    private let clear = Button(symbol: "xmark.circle.fill", label: "Clear", size: .xs)

    public init(_ text: String = "", placeholder: String = "Search", size: Size = .md, variant: Variant = .quiet) {
        super.init(text, placeholder: placeholder, variant: variant, size: size, symbol: "magnifyingglass")
        countLabel.font = TextStyle.sm.tabularFont()
        countLabel.isHidden = true
        countLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
        clear.restInk = Palette.contentTertiary
        clear.onPress = { [weak self] in self?.clearText() }
        clear.isHidden = text.isEmpty
        let trailing = NSStackView(views: [countLabel, clear])
        trailing.orientation = .horizontal
        trailing.spacing = Space.x1
        trailing.setHuggingPriority(.required, for: .horizontal)
        accessory = trailing
        field.setAccessibilitySubrole(.searchField)
    }

    private func clearText() {
        stringValue = ""
        window?.makeFirstResponder(field)
    }

    override func textDidChange() {
        clear.isHidden = field.stringValue.isEmpty
        super.textDidChange()
    }

    override func handle(_ command: Selector) -> Bool {
        switch command {
        case #selector(NSResponder.cancelOperation(_:)):
            if field.stringValue.isEmpty { window?.makeFirstResponder(nil) } else { stringValue = "" }
            return true
        case #selector(NSResponder.moveUp(_:)):
            onMove?(-1)
            return onMove != nil
        case #selector(NSResponder.moveDown(_:)):
            onMove?(1)
            return onMove != nil
        default:
            return super.handle(command)
        }
    }
}
