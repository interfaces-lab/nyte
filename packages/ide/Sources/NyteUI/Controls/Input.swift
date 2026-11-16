import AppKit

@MainActor
public class Input: NSView, NSTextFieldDelegate {
    public enum Variant: Sendable {
        case raised
        case quiet
        case strip
        case bare
    }

    static let stripInset = Space.x05
    var isHovered = false { didSet { if isHovered != oldValue { needsDisplay = true } } }

    public enum Height: Sendable {
        case size
        case flexible
    }

    public let field: NSTextField
    public var stringValue: String {
        get { field.stringValue }
        set { field.stringValue = newValue; textDidChange() }
    }
    public var placeholder: String { didSet { updatePlaceholder() } }
    public var textStyle = Input.entryStyle { didSet { field.font = textStyle.font(); updatePlaceholder() } }
    public var variant: Variant { didSet { needsDisplay = true } }
    public var size: Size { didSet { sizeDidChange() } }
    public var height: Height { didSet { heightConstraint?.isActive = height == .size } }
    public var isInvalid = false {
        didSet {
            guard isInvalid != oldValue else { return }
            messageDidChange()
            needsUpdateConstraints = true
            needsDisplay = true
        }
    }
    public var isEnabled: Bool {
        get { field.isEnabled }
        set { field.isEnabled = newValue; field.textColor = newValue ? Palette.contentPrimary : Palette.contentDisabled; needsDisplay = true }
    }
    public var symbol: String? { didSet { needsUpdateConstraints = true; needsDisplay = true } }
    public var accessory: NSView? {
        didSet {
            oldValue?.removeFromSuperview()
            if let accessory { place(accessory) }
            needsUpdateConstraints = true
        }
    }
    public var message = "" { didSet { if message != oldValue { messageDidChange() } } }
    public var onCommand: ((Selector) -> Bool)?
    public var onChange: ((String) -> Void)?
    public var onSubmit: ((String) -> Void)?
    public var onCancel: (() -> Void)?
    public var onEndEditing: ((String) -> Void)?

    var showsFocus: Bool { KeyFocus.shows(holdsFocus: isFocused, windowIsKey: window?.hasKeyFocus ?? false) }
    public internal(set) var isFocused = false { didSet { if isFocused != oldValue { needsDisplay = true } } }

    var textInset: CGFloat { size == .lg ? Space.x25 : Space.x2 }
    static let accessoryInset = Space.x1
    static let glyphGap = Space.x15
    static let cellTextInset: CGFloat = 2
    static let invalidGlyph = Glyph.xs
    private var invalidRoom: CGFloat { isInvalid ? Self.invalidGlyph.rawValue + Self.glyphGap : 0 }

    private var heightConstraint: NSLayoutConstraint?
    private var leadingConstraint: NSLayoutConstraint?
    private var trailingConstraint: NSLayoutConstraint?
    private var boxBottomConstraint: NSLayoutConstraint?
    private let box = NSLayoutGuide()
    private let messageLabel = Label("", style: Input.messageStyle, color: Palette.contentSecondary)
    static let messageStyle = TextStyle.xs
    public static let placeholderInk = Palette.contentTertiary
    public static let entryStyle = TextStyle.base
    static let messageGap = Space.x1
    private var messageRoom: CGFloat { message.isEmpty ? 0 : Self.messageGap + Self.messageStyle.lineHeight }
    private var boxRect: NSRect { NSRect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height - messageRoom) }

    public init(_ text: String = "", placeholder: String = "", variant: Variant = .raised, size: Size = .md,
                symbol: String? = nil, height: Height = .size) {
        field = FirstResponderReportingField()
        self.height = height
        self.placeholder = placeholder
        self.variant = variant
        self.size = size
        self.symbol = symbol
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        field.stringValue = text
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = Input.entryStyle.font()
        field.textColor = Palette.contentPrimary
        field.usesSingleLineMode = true
        field.lineBreakMode = .byClipping
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.delegate = self
        field.translatesAutoresizingMaskIntoConstraints = false
        field.setAccessibilityLabel(placeholder)
        (field as? FirstResponderReportingField)?.onBecomeFirstResponder = { [weak self] in self?.isFocused = true }
        addSubview(field)
        addLayoutGuide(box)
        messageLabel.isHidden = true
        addSubview(messageLabel)
        boxBottomConstraint = box.bottomAnchor.constraint(equalTo: bottomAnchor)
        NSLayoutConstraint.activate([
            box.topAnchor.constraint(equalTo: topAnchor), box.leadingAnchor.constraint(equalTo: leadingAnchor),
            box.trailingAnchor.constraint(equalTo: trailingAnchor),
            messageLabel.topAnchor.constraint(equalTo: box.bottomAnchor, constant: Self.messageGap),
            messageLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: textInset),
            messageLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor),
        ] + [boxBottomConstraint].compactMap { $0 })
        heightConstraint = heightAnchor.constraint(equalToConstant: size.height)
        leadingConstraint = field.leadingAnchor.constraint(equalTo: leadingAnchor)
        trailingConstraint = field.trailingAnchor.constraint(equalTo: trailingAnchor)
        NSLayoutConstraint.activate([
            leadingConstraint, trailingConstraint, field.centerYAnchor.constraint(equalTo: box.centerYAnchor),
        ].compactMap { $0 })
        heightConstraint?.isActive = height == .size
        updatePlaceholder()
        sizeDidChange()
        observeDensity(#selector(densityDidChange))
    }

    @objc private func densityDidChange() {
        sizeDidChange()
        needsUpdateConstraints = true
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    private func messageDidChange() {
        messageLabel.stringValue = message
        messageLabel.isHidden = message.isEmpty
        messageLabel.textColor = isInvalid ? Palette.dangerInk : Palette.contentSecondary
        field.setAccessibilityHelp(message.isEmpty ? (isInvalid ? Self.invalidWord : nil) : message)
        boxBottomConstraint?.constant = -messageRoom
        sizeDidChange()
    }

    static let invalidWord = "Invalid"

    private func sizeDidChange() {
        heightConstraint?.constant = size.height + messageRoom
        needsUpdateConstraints = true
        needsDisplay = true
    }

    private func updatePlaceholder() {
        field.placeholderAttributedString = NSAttributedString(string: placeholder, attributes: [
            .font: textStyle.font(), .foregroundColor: Input.placeholderInk,
        ])
        if field.accessibilityLabel()?.isEmpty ?? true { field.setAccessibilityLabel(placeholder) }
    }

    private func place(_ accessory: NSView) {
        accessory.translatesAutoresizingMaskIntoConstraints = false
        addSubview(accessory)
        NSLayoutConstraint.activate([
            accessory.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.accessoryInset),
            accessory.centerYAnchor.constraint(equalTo: box.centerYAnchor),
        ])
    }

    override public func updateConstraints() {
        leadingConstraint?.constant = textInset - Self.cellTextInset + (symbol == nil ? 0 : size.glyph.rawValue + Self.glyphGap)
        if let accessory {
            trailingConstraint?.isActive = false
            trailingConstraint = field.trailingAnchor.constraint(equalTo: accessory.leadingAnchor,
                                                                 constant: -Self.glyphGap - invalidRoom)
        } else {
            trailingConstraint?.isActive = false
            trailingConstraint = field.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -textInset - invalidRoom)
        }
        trailingConstraint?.isActive = true
        super.updateConstraints()
    }

    override public func draw(_ dirtyRect: NSRect) {
        let enabled = field.isEnabled
        let bounds = variant == .strip ? boxRect.insetBy(dx: 0, dy: Self.stripInset) : boxRect
        let radius = variant == .strip ? Size.xs.radius : size.radius
        if variant == .bare { return }
        if variant == .strip {
            if enabled, isHovered || showsFocus { Draw.fill(bounds, radius: radius, color: Palette.bgMutedTranslucent) }
            if isInvalid { Draw.ring(bounds, radius: radius, color: Palette.color(.strokeAccent, tone: .danger)) }
            else if showsFocus { Draw.ring(bounds, radius: radius, color: Palette.focus) }
        } else {
            let fill = !enabled ? Palette.fillTertiary : (variant == .raised ? Palette.bgElevated : Palette.bgMutedTranslucent)
            Draw.fill(bounds, radius: radius, color: fill)
            let edge: NSColor = if isInvalid { Palette.color(.strokeAccent, tone: .danger) }
                else if showsFocus { Palette.focus }
                else { variant == .raised ? Palette.strokeTertiary : Palette.strokeQuaternary }
            Draw.ring(bounds, radius: radius, color: edge)
        }
        if let symbol, let image = Symbol.image(symbol, glyph: size.glyph) {
            let slot = NSRect(x: bounds.minX + textInset, y: bounds.minY, width: size.glyph.rawValue, height: bounds.height)
            Draw.glyph(image, centeredIn: slot, ink: enabled ? Palette.contentTertiary : Palette.contentDisabled)
        }
        if isInvalid, let image = Symbol.image("exclamationmark.circle.fill", glyph: Self.invalidGlyph) {
            let end = accessory.map { $0.frame.minX - Self.glyphGap } ?? bounds.maxX - textInset
            let slot = NSRect(x: end - Self.invalidGlyph.rawValue, y: bounds.minY, width: Self.invalidGlyph.rawValue,
                              height: bounds.height)
            Draw.glyph(image, centeredIn: slot, ink: enabled ? Palette.dangerInk : Palette.contentDisabled)
        }
    }

    override public func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self))
    }

    override public func mouseEntered(with event: NSEvent) { isHovered = field.isEnabled }
    override public func mouseExited(with event: NSEvent) { isHovered = false }

    override public func mouseDown(with event: NSEvent) {
        guard field.isEnabled else { return }
        window?.makeFirstResponder(field)
    }

    override public func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        observeKeyFocus(moving: newWindow, #selector(windowKeyDidChange))
    }

    @objc private func windowKeyDidChange() { needsDisplay = true }

    func textDidChange() { onChange?(field.stringValue) }

    func handle(_ command: Selector) -> Bool {
        if command == #selector(NSResponder.cancelOperation(_:)), let onCancel {
            onCancel()
            return true
        }
        guard command == #selector(NSResponder.insertNewline(_:)) else { return false }
        onSubmit?(field.stringValue)
        return true
    }

    public func controlTextDidChange(_ notification: Notification) { textDidChange() }
    public func controlTextDidBeginEditing(_ notification: Notification) { isFocused = true }
    public func controlTextDidEndEditing(_ notification: Notification) {
        isFocused = false
        onEndEditing?(field.stringValue)
    }

    public func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        guard !textView.hasMarkedText() else { return false }
        if onCommand?(commandSelector) == true { return true }
        return handle(commandSelector)
    }
}

@MainActor
final class FirstResponderReportingField: KitTextField {
    var onBecomeFirstResponder: (() -> Void)?

    override func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        if became { onBecomeFirstResponder?() }
        return became
    }
}
