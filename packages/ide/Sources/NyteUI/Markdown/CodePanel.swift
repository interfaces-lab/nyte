import AppKit

public final class SideScroll: QuietScrollView {
    public var onScroll: ((CGFloat) -> Void)?
    public var showsEdges = false { didSet { updateEdges() } }
    private let leadingEdge = SurfaceView(fill: Palette.strokeTertiary)
    private let trailingEdge = SurfaceView(fill: Palette.strokeTertiary)

    override public init(frame: NSRect) {
        super.init(frame: frame)
        hasHorizontalScroller = true
        hasVerticalScroller = false
        autohidesScrollers = true
        scrollerStyle = NSScroller.preferredScrollerStyle
        drawsBackground = false
        borderType = .noBorder
        verticalScrollElasticity = .none
        horizontalScrollElasticity = .allowed
        automaticallyAdjustsContentInsets = false
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public static var reservesScroller: Bool { NSScroller.preferredScrollerStyle == .legacy }

    public static var scrollerHeight: CGFloat {
        reservesScroller ? NSScroller.scrollerWidth(for: .regular, scrollerStyle: .legacy) : 0
    }

    public var overflows: Bool { (documentView?.frame.width ?? 0) > contentView.bounds.width + Metric.hairline }

    override public func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        let center = NotificationCenter.default
        center.removeObserver(self, name: NSScroller.preferredScrollerStyleDidChangeNotification, object: nil)
        guard window != nil else { return }
        center.addObserver(self, selector: #selector(preferredStyleChanged), name: NSScroller.preferredScrollerStyleDidChangeNotification,
                           object: nil)
        scrollerStyle = NSScroller.preferredScrollerStyle
    }

    @objc private func preferredStyleChanged() { scrollerStyle = NSScroller.preferredScrollerStyle }

    override public func reflectScrolledClipView(_ clip: NSClipView) {
        super.reflectScrolledClipView(clip)
        onScroll?(clip.bounds.minX)
        updateEdges()
    }

    override public func tile() {
        super.tile()
        updateEdges()
    }

    public func edgeShown(_ edge: NSRectEdge) -> Bool {
        let line = edge == .minX ? leadingEdge : trailingEdge
        return line.superview === self && !line.isHidden
    }

    private func updateEdges() {
        for line in [leadingEdge, trailingEdge] where line.superview == nil && showsEdges { addSubview(line) }
        let clip = contentView.bounds
        let content = documentView?.frame.width ?? 0
        leadingEdge.isHidden = !showsEdges || clip.minX <= Metric.hairline
        trailingEdge.isHidden = !showsEdges || content - clip.maxX <= Metric.hairline
        leadingEdge.frame = NSRect(x: 0, y: 0, width: Metric.hairline, height: bounds.height)
        trailingEdge.frame = NSRect(x: bounds.width - Metric.hairline, y: 0, width: Metric.hairline, height: bounds.height)
    }

    override public func scrollWheel(with event: NSEvent) {
        guard overflows, abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY) else {
            nextResponder?.scrollWheel(with: event)
            return
        }
        super.scrollWheel(with: event)
    }
}

@MainActor
public enum CodeCopy {
    static let confirmation: Duration = .milliseconds(1500)
    static let symbol = "doc.on.doc"
    static let done = "checkmark"

    public static func button(label: String = "Copy", _ text: @escaping @MainActor () -> String) -> Button {
        let button = Button(symbol: symbol, label: label, size: .xs)
        var generation = 0
        button.onPress = { [weak button] in
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text(), forType: .string)
            guard let button else { return }
            generation += 1
            let mine = generation
            button.symbol = done
            button.setAccessibilityLabel("Copied")
            Task { @MainActor [weak button] in
                try? await Task.sleep(for: confirmation)
                guard generation == mine, let button else { return }
                button.symbol = symbol
                button.setAccessibilityLabel(label)
            }
        }
        return button
    }
}

@MainActor
public final class CodePanel: SurfaceView {
    public static var header: CGFloat { Metric.row }
    public static let inset = Space.x3
    public static let bottom = Space.x25
    public static let noteHeight = TextStyle.sm.lineHeight + Space.x2
    public static let compactLines = 3
    public static let compactInset = Space.x2
    static let highlightLines = 2_000
    static let highlightBytes = 50_000
    static let inlineHighlightLines = 200

    private let titleLabel = Label("", style: .sm, color: Palette.contentTertiary, weight: .medium)
    private let note = Label("", style: .sm, color: Palette.contentTertiary)
    private lazy var copy = CodeCopy.button { [weak self] in self?.code ?? "" }
    private let scroll = SideScroll()
    private let storage = NSTextStorage()
    private let manager = NSLayoutManager()
    private let container = NSTextContainer(size: NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
    private let text: CodeTextView
    private(set) var code = ""
    private(set) var language = ""
    private var isOpen = false
    private var codeWidth: CGFloat = 0
    private var highlighting: Task<Void, Never>?
    public var markdown: (() -> String)?
    public var title: String? { didSet { titleLabel.stringValue = title ?? Self.displayName(language) } }
    public var accessory: NSView? {
        didSet {
            oldValue?.removeFromSuperview()
            if let accessory { addSubview(accessory) }
            needsLayout = true
        }
    }
    public var wraps = false {
        didSet {
            guard wraps != oldValue else { return }
            scroll.hasHorizontalScroller = !wraps
            code = ""
            storage.setAttributedString(NSAttributedString())
            needsLayout = true
        }
    }
    public var compact = false {
        didSet {
            titleLabel.isHidden = compact
            needsLayout = true
        }
    }
    public var content: NSView? {
        didSet {
            oldValue?.removeFromSuperview()
            if let content { addSubview(content) }
            scroll.isHidden = content != nil
            needsLayout = true
        }
    }

    public init() {
        container.lineFragmentPadding = 0
        container.widthTracksTextView = false
        manager.addTextContainer(container)
        storage.addLayoutManager(manager)
        text = CodeTextView(frame: .zero, textContainer: container)
        super.init(fill: Palette.bgMuted, ring: Palette.strokeQuaternary, radius: Radius.control)
        text.isEditable = false
        text.isSelectable = true
        text.drawsBackground = false
        text.isRichText = false
        text.isHorizontallyResizable = false
        text.isVerticallyResizable = false
        text.textContainerInset = NSSize(width: Self.inset, height: 0)
        text.panel = self
        scroll.documentView = text
        for view in [titleLabel, scroll, copy, note] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = true
            addSubview(view)
        }
        note.isHidden = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityCustomActions([NSAccessibilityCustomAction(name: "Copy code") { [weak self] in
            self?.copyCode()
            return true
        }])
    }

    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    public static func lines(_ code: String) -> Int {
        code.utf8.reduce(1) { $1 == UInt8(ascii: "\n") ? $0 + 1 : $0 }
    }

    public static func height(code: String, note: Bool = false, compact: Bool = false, overflows: Bool = false) -> CGFloat {
        height(lines: lines(code), note: note, compact: compact) + (overflows ? SideScroll.scrollerHeight : 0)
    }

    public static func height(lines: Int, note: Bool, compact: Bool = false) -> CGFloat {
        let body = CGFloat(max(1, lines)) * TextStyle.code.lineHeight + (note ? noteHeight : 0)
        return compact ? body + compactInset * 2 : header + body + bottom
    }

    public static func overflows(_ code: String, width: CGFloat) -> Bool {
        guard SideScroll.reservesScroller else { return false }
        var longest = 0
        var current = 0
        for unit in code.utf16 {
            if unit == UInt16(UInt8(ascii: "\n")) {
                longest = max(longest, current)
                current = 0
            } else {
                current += unit == UInt16(UInt8(ascii: "\t")) ? tabColumns : 1
            }
        }
        let advance = Draw.width(of: "0", style: .code)
        return CGFloat(max(longest, current)) * advance + inset * 2 > width - Metric.hairline * 2
    }

    static let tabColumns = 4

    public static func displayName(_ language: String) -> String {
        let names = [
            "go": "Go", "golang": "Go", "ts": "TypeScript", "typescript": "TypeScript", "tsx": "TSX", "js": "JavaScript",
            "javascript": "JavaScript", "jsx": "JSX", "swift": "Swift", "py": "Python", "python": "Python", "rs": "Rust",
            "rust": "Rust", "sh": "Shell", "bash": "Bash", "zsh": "Zsh", "shell": "Shell", "console": "Console",
            "json": "JSON", "yaml": "YAML", "yml": "YAML", "toml": "TOML", "html": "HTML", "css": "CSS", "sql": "SQL",
            "md": "Markdown", "markdown": "Markdown", "diff": "Diff", "c": "C", "cpp": "C++", "c++": "C++", "objc": "Objective-C",
            "java": "Java", "kotlin": "Kotlin", "kt": "Kotlin", "rb": "Ruby", "ruby": "Ruby", "mermaid": "Mermaid", "txt": "Text",
            "text": "Text", "xml": "XML", "graphql": "GraphQL", "dockerfile": "Dockerfile", "make": "Makefile",
        ]
        let key = language.lowercased()
        if key.isEmpty { return "Code" }
        if let known = names[key] { return known }
        return key.prefix(1).uppercased() + key.dropFirst()
    }

    public func show(code: String, language: String, isOpen: Bool, note: String? = nil) {
        let changed = code != self.code || language != self.language || isOpen != self.isOpen
        let appends = isOpen && language == self.language && code.count > self.code.count && code.hasPrefix(self.code)
        self.isOpen = isOpen
        copy.isHidden = isOpen
        self.note.stringValue = note ?? ""
        self.note.isHidden = note == nil
        setAccessibilityLabel("\(Self.displayName(language)) code")
        setAccessibilityRoleDescription("code block")
        setAccessibilityValue(code)
        guard changed else {
            needsLayout = true
            return
        }
        highlighting?.cancel()
        highlighting = nil
        storage.beginEditing()
        if appends {
            let delta = String(code[code.index(code.startIndex, offsetBy: self.code.count)...])
            storage.append(NSAttributedString(string: delta, attributes: Self.attributes(wraps: wraps)))
        } else {
            storage.setAttributedString(isOpen ? NSAttributedString(string: code, attributes: Self.attributes(wraps: wraps))
                : Self.attributed(code, language: language, wraps: wraps))
        }
        storage.endEditing()
        self.code = code
        self.language = language
        if !isOpen { highlight(code, language: language) }
        titleLabel.stringValue = title ?? Self.displayName(language)
        manager.ensureLayout(for: container)
        codeWidth = manager.usedRect(for: container).width.rounded(.up)
        needsLayout = true
    }

    static let hangingIndent = Space.x4

    static func attributes(wraps: Bool) -> [NSAttributedString.Key: Any] {
        var attributes = TextStyle.code.attributes(Palette.contentPrimary)
        let paragraph = TextStyle.code.paragraph(lineBreak: wraps ? .byWordWrapping : .byClipping).mutableCopy() as? NSMutableParagraphStyle
            ?? NSMutableParagraphStyle()
        if wraps { paragraph.headIndent = hangingIndent }
        attributes[.paragraphStyle] = paragraph
        return attributes
    }

    static func textWidth(panel width: CGFloat, compact: Bool, copies: Bool) -> CGFloat {
        let button = Size.xs.height
        let gutter = compact && copies ? button + ((header - button) / 2).rounded() * 2 : 0
        return max(1, width - Metric.hairline * 2 - gutter - inset * 2)
    }

    static func wrappedLines(_ code: String, width: CGFloat, compact: Bool, copies: Bool) -> Int {
        CodeMeasure.lines(NSAttributedString(string: code, attributes: attributes(wraps: true)),
                          width: textWidth(panel: width, compact: compact, copies: copies))
    }

    static func attributed(_ code: String, language: String, wraps: Bool = false) -> NSAttributedString {
        let out = NSMutableAttributedString(string: code, attributes: attributes(wraps: wraps))
        if language.lowercased() == "diff" {
            var location = 0
            for line in code.components(separatedBy: "\n") {
                let length = (line as NSString).length
                if let color = CodeInk.diff(line) {
                    out.addAttribute(.foregroundColor, value: color, range: NSRange(location: location, length: length))
                }
                location += length + 1
            }
            return out
        }
        return out
    }

    static func highlights(_ code: String, language: String) -> Bool {
        !language.isEmpty && language.lowercased() != "diff" && code.utf8.count <= highlightBytes && lines(code) <= highlightLines
    }

    static func colorize(_ text: NSMutableAttributedString, with tokens: [(range: NSRange, color: SyntaxColor)]) {
        let length = text.length
        for token in tokens where token.range.location >= 0 && NSMaxRange(token.range) <= length {
            text.addAttribute(.foregroundColor, value: token.color.color, range: token.range)
        }
    }

    private func highlight(_ code: String, language: String) {
        guard Self.highlights(code, language: language) else { return }
        guard Self.lines(code) > Self.inlineHighlightLines else {
            storage.beginEditing()
            Self.colorize(storage, with: CodeColors.ranges(in: code, language: language))
            storage.endEditing()
            return
        }
        highlighting = Task { @MainActor [weak self] in
            let tokens = await Task.detached(priority: .utility) { CodeColors.ranges(in: code, language: language) }.value
            guard !Task.isCancelled, let self, self.code == code, self.language == language else { return }
            storage.beginEditing()
            Self.colorize(storage, with: tokens)
            storage.endEditing()
            highlighting = nil
        }
    }

    override public func layout() {
        super.layout()
        let titleHeight = TextStyle.sm.lineHeight
        titleLabel.frame = NSRect(x: Self.inset, y: ((Self.header - titleHeight) / 2).rounded(), width: max(0, bounds.width / 2),
                                  height: titleHeight)
        let button = Size.xs.height
        let edge = ((Self.header - button) / 2).rounded()
        copy.frame = NSRect(x: bounds.width - edge - button, y: edge, width: button, height: button)
        if let accessory {
            let size = accessory.intrinsicContentSize
            accessory.frame = NSRect(x: copy.frame.minX - Space.x1 - size.width, y: ((Self.header - size.height) / 2).rounded(),
                                     width: size.width, height: size.height)
        }
        if let content {
            content.frame = NSRect(x: Metric.hairline, y: Self.header, width: max(0, bounds.width - Metric.hairline * 2),
                                   height: max(0, bounds.height - Self.header - Metric.hairline))
        }
        let textWidth = Self.textWidth(panel: bounds.width, compact: compact, copies: !copy.isHidden)
        if wraps, container.size.width != textWidth {
            container.size = NSSize(width: textWidth, height: CGFloat.greatestFiniteMagnitude)
            manager.ensureLayout(for: container)
        }
        let codeHeight = wraps ? max(TextStyle.code.lineHeight, manager.usedRect(for: container).height.rounded(.up))
            : CGFloat(max(1, Self.lines(code))) * TextStyle.code.lineHeight
        let top = compact ? Self.compactInset : Self.header
        let gutter = compact && !copy.isHidden ? button + edge * 2 : 0
        let pane = NSRect(x: Metric.hairline, y: top, width: max(0, bounds.width - Metric.hairline * 2 - gutter),
                          height: max(0, bounds.height - top - Metric.hairline - (note.isHidden ? 0 : Self.noteHeight)))
        if compact { copy.frame.origin.y = ((Self.compactInset * 2 + TextStyle.code.lineHeight - button) / 2).rounded() }
        scroll.frame = pane
        let reserve = scroll.overflows ? SideScroll.scrollerHeight : 0
        let wide = wraps ? pane.width : max(pane.width, codeWidth + Self.inset * 2)
        text.frame = NSRect(x: 0, y: 0, width: wide, height: max(codeHeight, pane.height - reserve))
        note.frame = NSRect(x: Self.inset, y: top + codeHeight + (compact ? Self.compactInset : Self.bottom), width: max(0, bounds.width - Self.inset * 2),
                            height: TextStyle.sm.lineHeight)
    }

    func copyCode() {
        MarkdownPasteboard.write(plain: code, markdown: markdown?())
    }

    fileprivate func contextMenu() -> NSMenu {
        let selected = text.selectedRange().length > 0
        return Menu.make([
            MenuItem("Copy") { [weak self] in
                guard let self else { return }
                if selected { text.copy(nil) } else { copyCode() }
            },
            MenuItem("Copy as Markdown") { [weak self] in
                guard let self else { return }
                MarkdownPasteboard.write(plain: markdown?() ?? "```\(language)\n\(code)\n```", markdown: nil)
            },
        ])
    }

    override public func menu(for event: NSEvent) -> NSMenu? { contextMenu() }
}

final class CodeTextView: NSTextView {
    weak var panel: CodePanel?

    override func menu(for event: NSEvent) -> NSMenu? { panel?.contextMenu() }
}

@MainActor
enum CodeMeasure {
    private static let storage = NSTextStorage()
    private static let manager = NSLayoutManager()
    private static let container: NSTextContainer = {
        let container = NSTextContainer(size: .zero)
        container.lineFragmentPadding = 0
        manager.addTextContainer(container)
        storage.addLayoutManager(manager)
        return container
    }()

    static func lines(_ text: NSAttributedString, width: CGFloat) -> Int {
        container.size = NSSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        storage.setAttributedString(text)
        manager.ensureLayout(for: container)
        return max(1, Int((manager.usedRect(for: container).height / TextStyle.code.lineHeight).rounded()))
    }
}
