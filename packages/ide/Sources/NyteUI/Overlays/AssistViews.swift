import AppKit

public struct DocumentationNote: Sendable, Equatable {
    public var symbol: String
    public var tone: Tone
    public var message: String
    public var detail: String

    public init(symbol: String, tone: Tone, message: String, detail: String = "") {
        self.symbol = symbol
        self.tone = tone
        self.message = message
        self.detail = detail
    }
}

@MainActor
public final class DocumentationView: NSView {
    public static let maxWidth: CGFloat = 500
    public static let maxHeight: CGFloat = 320
    public static let minWidth: CGFloat = 160
    public static let inset = Space.x3
    public static let verticalInset = Space.x25
    public static let noteGlyph = Glyph.sm
    public static let noteGap = Space.x15
    public static let noteSpacing = Space.x1
    public static let detailGap = Space.x1
    private static let ruleLength = 3

    public var onHover: ((Bool) -> Void)?
    public var language = ""
    public var onOpenLink: ((URL) -> Void)? { didSet { body.onOpenLink = onOpenLink } }
    public var onOpenFile: ((String, Int?) -> Void)? { didSet { body.onOpenFile = onOpenFile } }

    let notes = DocumentationView.makeText()
    private let rule = Hairline()
    private let scroll = NSScrollView()
    private let body = MarkdownView(body: DocumentationView.bodyStyle, code: .wrap)
    private var markdown = ""
    private var hasNotes = false
    private var hasBody: Bool { !markdown.isEmpty }
    static let bodyStyle = TextStyle.base
    private var measuredWidth: CGFloat?

    public init() {
        super.init(frame: .zero)
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.documentView = body
        rule.translatesAutoresizingMaskIntoConstraints = true
        for view in [notes, rule, scroll] as [NSView] { addSubview(view) }
        setAccessibilityRole(.group)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    private static func makeText() -> NSTextView {
        let storage = NSTextStorage()
        let layout = ProseLayoutManager()
        let container = NSTextContainer(size: NSSize(width: maxWidth, height: CGFloat.greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
        let text = NSTextView(frame: .zero, textContainer: container)
        text.isEditable = false
        text.isSelectable = true
        text.drawsBackground = false
        text.isVerticallyResizable = true
        text.isHorizontallyResizable = false
        text.textContainerInset = .zero
        text.linkTextAttributes = [.foregroundColor: Palette.accentInk, .cursor: NSCursor.pointingHand]
        text.selectedTextAttributes = [.backgroundColor: Palette.fillPrimary]
        return text
    }

    public func show(notes items: [DocumentationNote], markdown: String) {
        let lines = NSMutableAttributedString()
        for (index, item) in items.enumerated() {
            if index > 0 { lines.append(NSAttributedString(string: "\n")) }
            lines.append(Self.note(item))
        }
        set(notes: lines, markdown: Self.labelFences(markdown.trimmingCharacters(in: .whitespacesAndNewlines), language: language))
    }

    static let fence = "```"

    static func labelFences(_ markdown: String, language: String) -> String {
        guard !language.isEmpty, markdown.contains(fence) else { return markdown }
        var inside = false
        return markdown.split(separator: "\n", omittingEmptySubsequences: false).map { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix(fence) else { return String(line) }
            defer { inside.toggle() }
            return !inside && trimmed == fence ? line.replacingOccurrences(of: fence, with: fence + language) : String(line)
        }.joined(separator: "\n")
    }

    public func show(signature label: String, active: NSRange?, overload: String, note: String) {
        let text = NSMutableAttributedString()
        if !overload.isEmpty {
            text.append(NSAttributedString(string: overload + "  ", attributes: TextStyle.code.attributes(Palette.contentTertiary)))
        }
        let start = text.length
        text.append(NSAttributedString(string: label, attributes: TextStyle.code.attributes(Palette.contentSecondary)))
        for token in CodeColors.ranges(in: label, language: language) where NSMaxRange(token.range) <= (label as NSString).length {
            text.addAttribute(.foregroundColor, value: token.color.color,
                              range: NSRange(location: start + token.range.location, length: token.range.length))
        }
        if let active, NSMaxRange(active) <= (label as NSString).length {
            text.addAttributes([.font: TextStyle.code.font(.semibold)],
                               range: NSRange(location: start + active.location, length: active.length))
        }
        let style = TextStyle.code.paragraph(lineBreak: .byWordWrapping).mutableCopy() as? NSMutableParagraphStyle
        style?.headIndent = Draw.width(of: overload.isEmpty ? "" : overload + "  ", style: .code)
        if let style { text.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: text.length)) }
        if !note.isEmpty {
            text.append(NSAttributedString(string: "\n"))
            var attributes = TextStyle.sm.attributes(Palette.contentSecondary)
            attributes[.paragraphStyle] = TextStyle.sm.paragraph(lineBreak: .byTruncatingTail)
            text.append(NSAttributedString(string: note, attributes: attributes))
        }
        set(notes: text, markdown: "")
        measuredWidth = ceil(NSAttributedString(attributedString: text.attributedSubstring(
            from: NSRange(location: 0, length: start + (label as NSString).length)
        )).size().width)
    }

    public func show(message: String) {
        set(notes: Prose.plain(message, style: .base, color: Palette.contentSecondary), markdown: "")
    }

    private func set(notes text: NSAttributedString, markdown source: String) {
        measuredWidth = nil
        notes.textStorage?.setAttributedString(text)
        markdown = source
        body.update(source)
        hasNotes = text.length > 0
        notes.isHidden = !hasNotes
        scroll.isHidden = !hasBody
        rule.isHidden = !(hasNotes && hasBody)
        setAccessibilityLabel([text.string, source].filter { !$0.isEmpty }.joined(separator: "\n"))
        scroll.contentView.scroll(to: .zero)
        needsLayout = true
    }

    private static func note(_ item: DocumentationNote) -> NSAttributedString {
        let out = NSMutableAttributedString()
        let ink = Palette.color(.contentAccent, tone: item.tone)
        if let symbol = Symbol.image(item.symbol, glyph: noteGlyph) {
            let image = NSImage(size: symbol.size, flipped: false) { rect in
                MainActor.assumeIsolated { Draw.glyph(symbol, in: rect, ink: ink) }
                return true
            }
            let attachment = NSTextAttachment()
            attachment.image = image
            let font = TextStyle.base.font()
            attachment.bounds = NSRect(x: 0, y: ((font.capHeight - image.size.height) / 2).rounded(),
                                       width: image.size.width, height: image.size.height)
            out.append(NSAttributedString(attachment: attachment))
        }
        out.append(NSAttributedString(string: "\t"))
        out.append(NSAttributedString(string: item.message, attributes: TextStyle.base.attributes(Palette.contentPrimary)))
        let lead = noteGlyph.rawValue + noteGap
        let message = TextStyle.base.paragraph().mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
        message.tabStops = [NSTextTab(textAlignment: .left, location: lead)]
        message.headIndent = lead
        message.paragraphSpacing = item.detail.isEmpty ? noteSpacing : detailGap
        out.addAttribute(.paragraphStyle, value: message, range: NSRange(location: 0, length: out.length))
        guard !item.detail.isEmpty else { return out }
        let detail = TextStyle.sm.paragraph().mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
        detail.headIndent = lead
        detail.firstLineHeadIndent = lead
        detail.paragraphSpacing = noteSpacing
        var attributes = TextStyle.sm.attributes(Palette.contentSecondary)
        attributes[.paragraphStyle] = detail
        out.append(NSAttributedString(string: "\n" + item.detail, attributes: attributes))
        return out
    }

    public func fittingSize(maxWidth: CGFloat = DocumentationView.maxWidth,
                            maxHeight: CGFloat = DocumentationView.maxHeight) -> NSSize {
        let room = maxWidth - Self.inset * 2
        let notesWidth = measuredWidth.map { min($0, room) } ?? (hasNotes ? Self.naturalWidth(notes, room: room) : 0)
        let natural = max(notesWidth, hasBody ? Self.naturalWidth(markdown: markdown, room: room) : 0)
        let width = min(max(natural + Self.inset * 2, Self.minWidth), maxWidth).rounded(.up)
        let inner = width - Self.inset * 2
        var height = Self.verticalInset * 2
        if hasNotes { height += Self.height(of: notes, width: inner) }
        if hasNotes, hasBody { height += Self.verticalInset * 2 + Metric.hairline }
        if hasBody { height += MarkdownView.height(for: markdown, width: inner, body: Self.bodyStyle) }
        return NSSize(width: width, height: min(height, maxHeight).rounded(.up))
    }

    private static func naturalWidth(_ text: NSTextView, room: CGFloat) -> CGFloat {
        guard let layout = text.layoutManager, let container = text.textContainer else { return 0 }
        container.size = NSSize(width: room, height: CGFloat.greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        return min(layout.usedRect(for: container).width.rounded(.up), room)
    }

    private static func naturalWidth(markdown: String, room: CGFloat) -> CGFloat {
        let blocks = markdown.contains("```") || markdown.contains("|")
        guard !blocks else { return room }
        let widest = markdown.split(separator: "\n").map { Draw.width(of: String($0), style: bodyStyle) }.max() ?? 0
        return min(widest, room)
    }

    private static func height(of text: NSTextView, width: CGFloat) -> CGFloat {
        guard let storage = text.textStorage else { return 0 }
        return ProseMeasure.shared.height(storage, width: width)
    }

    override public func layout() {
        super.layout()
        let inner = max(0, bounds.width - Self.inset * 2)
        var y = Self.verticalInset
        if hasNotes {
            let height = Self.height(of: notes, width: inner)
            notes.textContainer?.size = NSSize(width: inner, height: CGFloat.greatestFiniteMagnitude)
            notes.frame = NSRect(x: Self.inset, y: y, width: inner, height: height)
            y += height + Self.verticalInset
        }
        if hasNotes, hasBody {
            rule.frame = NSRect(x: 0, y: y, width: bounds.width, height: Metric.hairline)
            y += Metric.hairline + Self.verticalInset
        }
        guard hasBody else { return }
        scroll.frame = NSRect(x: Self.inset, y: y, width: inner, height: max(0, bounds.height - y - Self.verticalInset))
        let height = MarkdownView.height(for: markdown, width: inner, body: Self.bodyStyle)
        body.frame = NSRect(x: 0, y: 0, width: inner, height: max(height, scroll.contentSize.height))
    }

    private var pointerArea: NSTrackingArea?

    override public func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let pointerArea { removeTrackingArea(pointerArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area)
        pointerArea = area
    }

    override public func mouseEntered(with event: NSEvent) { onHover?(true) }
    override public func mouseExited(with event: NSEvent) { onHover?(false) }
}

@MainActor
public final class PromptView: NSView {
    public static let radius = Size.md.radius
    public static let minWidth: CGFloat = 220
    public static let maxWidth: CGFloat = 420

    public let input: Input
    public var textLead: CGFloat { input.textInset - Input.cellTextInset }
    public var message = "" {
        didSet {
            error.stringValue = message
            error.isHidden = message.isEmpty
            input.isInvalid = !message.isEmpty
            needsLayout = true
        }
    }

    private let error = KitTextField(wrappingLabelWithString: "")

    public init(placeholder: String, monospace: Bool = false) {
        input = Input(placeholder: placeholder, size: .md)
        super.init(frame: .zero)
        input.translatesAutoresizingMaskIntoConstraints = true
        if monospace { input.field.font = TextStyle.code.font() }
        error.font = TextStyle.sm.font()
        error.textColor = Palette.dangerInk
        error.isSelectable = true
        error.isHidden = true
        addSubview(input)
        addSubview(error)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    public func fittingSize(for text: String) -> NSSize {
        let style: TextStyle = input.field.font == TextStyle.code.font() ? .code : .base
        let natural = Draw.width(of: text, style: style) + input.textInset * 2 + Space.x8
        let width = min(max(natural, Self.minWidth), Self.maxWidth).rounded(.up)
        return NSSize(width: width, height: input.size.height + messageHeight(width: width))
    }

    private func messageHeight(width: CGFloat) -> CGFloat {
        guard !message.isEmpty else { return 0 }
        let room = width - input.textInset * 2
        return ceil(error.attributedStringValue.boundingRect(
            with: NSSize(width: room, height: CGFloat.greatestFiniteMagnitude), options: [.usesLineFragmentOrigin]
        ).height) + Space.x2 * 2
    }

    override public func layout() {
        super.layout()
        input.frame = NSRect(x: 0, y: 0, width: bounds.width, height: input.size.height)
        let x = input.textInset
        error.frame = NSRect(x: x, y: input.frame.maxY + Space.x2, width: bounds.width - x * 2,
                             height: max(0, bounds.height - input.frame.maxY - Space.x2 * 2))
    }
}
