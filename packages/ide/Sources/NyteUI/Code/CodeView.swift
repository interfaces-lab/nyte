import AppKit

public struct CodeViewSource {
    public var name: String
    public var language: Language
    public var firstLine: Int
    public var lineCount: Int
    public var entryState: UInt8
    public var widestColumns: Int?
    public var line: (Int) -> String
    public var state: ((Int) -> UInt8?)?

    public init(name: String = "", language: Language = .plain, firstLine: Int = 0, lineCount: Int,
                entryState: UInt8 = LexState.normal, widestColumns: Int? = nil, line: @escaping (Int) -> String) {
        self.name = name
        self.language = language
        self.firstLine = firstLine
        self.lineCount = lineCount
        self.entryState = entryState
        self.widestColumns = widestColumns
        self.line = line
    }

    public init(name: String = "", language: Language = .plain, firstLine: Int = 0, lines: [String],
                entryState: UInt8 = LexState.normal) {
        self.init(name: name, language: language, firstLine: firstLine, lineCount: lines.count, entryState: entryState,
                  widestColumns: lines.map(Self.columns).max()) { lines[$0] }
    }

    public static func columns(_ line: String) -> Int {
        line.utf16.reduce(0) { $0 + ($1 == UInt16(UInt8(ascii: "\t")) ? Indent.defaultWidth : 1) }
    }

    public static func state(after lines: some Sequence<String>, language: Language, from start: UInt8 = LexState.normal) -> UInt8 {
        var state = start
        var tokens: [UInt64] = []
        for line in lines {
            let units = Array(line.utf16)
            state = units.withUnsafeBufferPointer {
                Lexer.line($0, state: state, language: language, offset: 0, tokens: &tokens, emit: false)
            }
        }
        return state
    }

    var lastLine: Int { firstLine + max(lineCount, 1) - 1 }
}

public struct CodeMark: Equatable, Sendable {
    public var line: Int
    public var start: Int
    public var end: Int
    public var isCurrent: Bool

    public init(line: Int, start: Int, end: Int, isCurrent: Bool = false) {
        self.line = line
        self.start = start
        self.end = end
        self.isCurrent = isCurrent
    }
}

@MainActor
public final class CodeView: NSView {
    public let scrollView: NSScrollView
    let canvas = CodeCanvas()
    let gutter: CodeGutter
    private let placeholder = Label("", style: .sm, color: Palette.contentTertiary)
    private var pendingReveal: CodeMark?

    public var marks: [CodeMark] {
        get { canvas.marks }
        set {
            canvas.marks = newValue
            gutter.needsDisplay = true
        }
    }

    public var selectedText: String { canvas.selectedText }
    public var source: CodeViewSource? { canvas.source }

    public init() {
        let scrollView = NSScrollView()
        self.scrollView = scrollView
        gutter = CodeGutter(canvas: canvas)
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        scrollView.documentView = canvas
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.contentView.postsBoundsChangedNotifications = true
        for view in [gutter, scrollView] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            gutter.leadingAnchor.constraint(equalTo: leadingAnchor),
            gutter.topAnchor.constraint(equalTo: topAnchor),
            gutter.bottomAnchor.constraint(equalTo: bottomAnchor),
            scrollView.leadingAnchor.constraint(equalTo: gutter.trailingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(clipScrolled), name: NSView.boundsDidChangeNotification,
                                               object: scrollView.contentView)
        Pin.center(placeholder, in: self)
        placeholder.isHidden = true
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public func show(_ source: CodeViewSource, marks: [CodeMark] = [], revealing mark: CodeMark? = nil) {
        placeholder.isHidden = true
        scrollView.isHidden = false
        gutter.isHidden = false
        canvas.load(source, marks: marks)
        gutter.sourceDidChange()
        layoutSubtreeIfNeeded()
        canvas.fit(to: CodeCanvas.visibleSize(scrollView))
        pendingReveal = mark ?? marks.first(where: \.isCurrent)
        if pendingReveal == nil { scroll(to: .zero) }
        revealPending()
    }

    public func clear(_ message: String = "") {
        pendingReveal = nil
        canvas.load(nil, marks: [])
        gutter.sourceDidChange()
        scrollView.isHidden = true
        gutter.isHidden = true
        placeholder.stringValue = message
        placeholder.isHidden = message.isEmpty
    }

    public func reveal(_ mark: CodeMark) {
        pendingReveal = mark
        revealPending()
    }

    override public func layout() {
        super.layout()
        canvas.fit(to: CodeCanvas.visibleSize(scrollView))
        revealPending()
    }

    private func revealPending() {
        let visible = CodeCanvas.visibleSize(scrollView)
        guard let mark = pendingReveal, visible.width > 0, visible.height > 0 else { return }
        pendingReveal = nil
        let rect = canvas.rect(of: mark)
        let y = max(0, min(rect.midY - visible.height / 2, canvas.frame.height - visible.height))
        let x = rect.maxX + CodeCanvas.textInset <= visible.width ? 0 : rect.maxX + CodeCanvas.textInset * 2 - visible.width
        scroll(to: NSPoint(x: max(0, x), y: y))
    }

    private func scroll(to point: NSPoint) {
        scrollView.contentView.scroll(to: point)
        scrollView.reflectScrolledClipView(scrollView.contentView)
    }

    @objc private func clipScrolled() { gutter.needsDisplay = true }

    public func focus() { window?.makeFirstResponder(canvas) }
}

@MainActor
final class CodeGutter: NSView {
    static let padding = Space.x3
    static let style = TextStyle.codeSmall
    private weak var canvas: CodeCanvas?
    private var digits = 0
    private var width: NSLayoutConstraint?
    var thickness: CGFloat { width?.constant ?? 0 }

    init(canvas: CodeCanvas) {
        self.canvas = canvas
        super.init(frame: .zero)
        let width = widthAnchor.constraint(equalToConstant: 0)
        width.isActive = true
        self.width = width
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    func sourceDidChange() {
        let count = canvas?.source.map { String($0.lastLine + 1).count } ?? 0
        if count != digits {
            digits = count
            let digit = Draw.width(of: "0", style: Self.style, tabular: true)
            width?.constant = count == 0 ? 0 : (CGFloat(count) * digit + Self.padding * 2).rounded(.up)
        }
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let canvas, let source = canvas.source, source.lineCount > 0, let clip = canvas.enclosingScrollView?.contentView else { return }
        let offset = clip.bounds.minY
        let lines = canvas.lines(in: NSRect(x: 0, y: dirtyRect.minY + offset, width: 1, height: dirtyRect.height))
        let current = Set(canvas.marks.filter(\.isCurrent).map(\.line))
        let font = Self.style.tabularFont()
        let baseline = CodeCanvas.baselineOffset(CodeCanvas.style.font())
        for index in lines {
            let number = source.firstLine + index
            let text = NSAttributedString(string: String(number + 1), attributes: [
                .font: font, .foregroundColor: current.contains(number) ? Palette.contentSecondary : Palette.contentTertiary,
            ])
            let top = canvas.top(ofLine: index) - offset
            text.draw(at: NSPoint(x: bounds.width - Self.padding - ceil(text.size().width), y: top + baseline - font.ascender))
        }
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}
