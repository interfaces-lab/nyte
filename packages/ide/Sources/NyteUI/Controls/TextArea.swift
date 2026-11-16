import AppKit

@MainActor
public final class TextArea: NSView, NSTextViewDelegate {
    public enum ReturnKey: Sendable { case newline, submit }
    public enum Chrome: Sendable { case boxed, borderless }

    public static let style = TextStyle.base
    public static let inset = Space.x2

    public let textView = TextAreaTextView()
    public var onChange: ((String) -> Void)?
    public var onSubmit: ((String) -> Void)?
    public var onCommand: ((Selector) -> Bool)?
    public var onFocusChange: ((Bool) -> Void)?
    public var returnKey: ReturnKey = .newline
    public var minimumLines: Int { didSet { fitHeight() } }
    public var maximumLines: Int { didSet { fitHeight() } }

    public let textStyle: TextStyle
    public let chrome: Chrome

    public var string: String {
        get { textView.string }
        set {
            textView.string = newValue
            textView.typingAttributes = typing
            textDidChange()
        }
    }

    public var placeholder: String {
        get { textView.placeholder }
        set {
            textView.placeholder = newValue
            textView.setAccessibilityLabel(newValue)
            textView.setAccessibilityPlaceholderValue(newValue)
            textView.needsDisplay = true
        }
    }

    public var isEnabled = true {
        didSet {
            textView.isEditable = isEnabled
            textView.textColor = isEnabled ? Palette.contentPrimary : Palette.contentDisabled
            textView.typingAttributes = typing
            needsDisplay = true
        }
    }

    public var isInvalid = false { didSet { if isInvalid != oldValue { messageDidChange() } } }
    public var message = "" { didSet { if message != oldValue { messageDidChange() } } }

    private let scroll = QuietScrollView()
    private let messageLabel = Label("", style: Input.messageStyle, color: Palette.contentSecondary)
    private var boxHeight: NSLayoutConstraint?
    private var messageRoom: NSLayoutConstraint?
    private var measuredWidth: CGFloat = 0

    public static let fewestLines = 3
    public static let mostLines = 10

    public init(placeholder: String = "", textStyle: TextStyle = TextArea.style, chrome: Chrome = .boxed,
                minimumLines: Int = TextArea.fewestLines, maximumLines: Int = TextArea.mostLines) {
        self.textStyle = textStyle
        self.chrome = chrome
        self.minimumLines = minimumLines
        self.maximumLines = maximumLines
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        configure(textView)
        self.placeholder = placeholder
        scroll.documentView = textView
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scroll)
        messageLabel.isHidden = true
        addSubview(messageLabel)
        let edge = self.edge
        let boxHeight = scroll.heightAnchor.constraint(equalToConstant: height(lines: minimumLines))
        let messageRoom = bottomAnchor.constraint(equalTo: scroll.bottomAnchor, constant: edge)
        self.boxHeight = boxHeight
        self.messageRoom = messageRoom
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor, constant: edge),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -edge),
            scroll.topAnchor.constraint(equalTo: topAnchor, constant: edge),
            messageLabel.topAnchor.constraint(equalTo: scroll.bottomAnchor, constant: edge + Input.messageGap),
            messageLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: chrome == .boxed ? Self.inset : 0),
            messageLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor),
            boxHeight, messageRoom,
        ])
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    private var edge: CGFloat { chrome == .boxed ? Metric.hairline : 0 }
    private var textInset: CGFloat { chrome == .boxed ? Self.inset : 0 }
    private var typing: [NSAttributedString.Key: Any] {
        [.font: textStyle.font(), .foregroundColor: isEnabled ? Palette.contentPrimary : Palette.contentDisabled,
         .paragraphStyle: textStyle.paragraph()]
    }

    private func configure(_ text: TextAreaTextView) {
        text.font = textStyle.font()
        text.style = textStyle
        text.textColor = Palette.contentPrimary
        text.insertionPointColor = Palette.contentPrimary
        text.drawsBackground = false
        text.isRichText = false
        text.allowsUndo = true
        text.isAutomaticQuoteSubstitutionEnabled = false
        text.isAutomaticDashSubstitutionEnabled = false
        text.isAutomaticTextReplacementEnabled = false
        if chrome == .boxed {
            text.textContainerInset = NSSize(width: Self.inset - Space.x1, height: Self.inset - Space.x05)
        } else {
            text.textContainerInset = .zero
            text.textContainer?.lineFragmentPadding = 0
        }
        text.textContainer?.widthTracksTextView = true
        text.isVerticallyResizable = true
        text.isHorizontallyResizable = false
        text.autoresizingMask = [.width]
        text.delegate = self
        text.defaultParagraphStyle = textStyle.paragraph()
        text.typingAttributes = typing
        text.onFocusChange = { [weak self] focused in
            self?.needsDisplay = true
            self?.onFocusChange?(focused)
        }
        text.onCommandReturn = { [weak self] in self?.commandReturn() ?? false }
    }

    public static func height(lines: Int) -> CGFloat { (CGFloat(lines) * style.lineHeight + inset * 2).rounded(.up) }

    public func height(lines: Int) -> CGFloat { (CGFloat(lines) * textStyle.lineHeight + textInset * 2).rounded(.up) }

    var lineCount: Int {
        guard let manager = textView.layoutManager, let container = textView.textContainer else { return minimumLines }
        manager.ensureLayout(for: container)
        let used = manager.usedRect(for: container).height
        return max(1, Int((used / textStyle.lineHeight).rounded(.up)))
    }

    var showsFocus: Bool {
        KeyFocus.shows(holdsFocus: window?.firstResponder === textView, windowIsKey: window?.hasKeyFocus ?? false)
    }

    public func textDidChange(_ notification: Notification) { textDidChange() }

    private func textDidChange() {
        textView.needsDisplay = true
        fitHeight()
        onChange?(textView.string)
    }

    public func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        guard !textView.hasMarkedText() else { return false }
        if onCommand?(selector) == true { return true }
        guard selector == #selector(NSResponder.insertNewline(_:)), returnKey == .submit else { return false }
        let flags = NSApp.currentEvent?.modifierFlags ?? []
        guard flags.isDisjoint(with: [.shift, .option]) else {
            textView.insertNewlineIgnoringFieldEditor(nil)
            return true
        }
        onSubmit?(textView.string)
        return true
    }

    private func commandReturn() -> Bool {
        guard !textView.hasMarkedText() else { return false }
        switch returnKey {
        case .newline: onSubmit?(textView.string)
        case .submit: textView.insertNewlineIgnoringFieldEditor(nil)
        }
        return true
    }

    override public func layout() {
        super.layout()
        guard bounds.width != measuredWidth else { return }
        measuredWidth = bounds.width
        fitHeight()
    }

    private func fitHeight() {
        let lines = min(maximumLines, max(minimumLines, lineCount))
        let fitted = height(lines: lines)
        if boxHeight?.constant != fitted { boxHeight?.constant = fitted }
    }

    private func messageDidChange() {
        messageLabel.stringValue = message
        messageLabel.isHidden = message.isEmpty
        messageLabel.textColor = isInvalid ? Palette.dangerInk : Palette.contentSecondary
        textView.setAccessibilityHelp(message.isEmpty ? (isInvalid ? Input.invalidWord : nil) : message)
        messageRoom?.constant = message.isEmpty ? edge : edge + Input.messageGap + Input.messageStyle.lineHeight
        needsDisplay = true
    }

    override public func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        observeKeyFocus(moving: newWindow, #selector(windowKeyDidChange))
    }

    @objc private func windowKeyDidChange() { needsDisplay = true }

    override public func draw(_ dirtyRect: NSRect) {
        guard chrome == .boxed else { return }
        let box = scroll.frame.insetBy(dx: -Metric.hairline, dy: -Metric.hairline)
        let radius = Size.md.radius
        Draw.fill(box, radius: radius, color: isEnabled ? Palette.bgElevated : Palette.fillTertiary)
        let edge: NSColor = isInvalid ? Palette.color(.strokeAccent, tone: .danger) : (showsFocus ? Palette.focus : Palette.strokeTertiary)
        Draw.ring(box, radius: radius, color: edge)
    }
}

@MainActor
public final class TextAreaTextView: NSTextView {
    var placeholder = ""
    var style = TextArea.style
    var onCommandReturn: (() -> Bool)?
    var onFocusChange: ((Bool) -> Void)?

    override public func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        if modifiers == .command, event.specialKey == .carriageReturn || event.specialKey == .enter, onCommandReturn?() == true {
            return
        }
        super.keyDown(with: event)
    }

    override public func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        if became { onFocusChange?(true) }
        return became
    }

    override public func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned { onFocusChange?(false) }
        return resigned
    }

    override public func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !hasMarkedText() else { return }
        let origin = NSPoint(x: textContainerInset.width + (textContainer?.lineFragmentPadding ?? 0), y: textContainerInset.height)
        var attributes = style.attributes(Input.placeholderInk)
        attributes[.paragraphStyle] = style.paragraph(lineBreak: .byTruncatingTail)
        let width = bounds.width - origin.x - textContainerInset.width - (textContainer?.lineFragmentPadding ?? 0)
        NSAttributedString(string: placeholder, attributes: attributes)
            .draw(in: NSRect(x: origin.x, y: origin.y, width: max(0, width), height: style.lineHeight))
    }
}
