import AppKit
import NyteUI

enum Rows {
    static let inset = Space.x3
    static let line = TextStyle.prose.lineHeight + Space.x05
    static let cardPadding = NSSize(width: Space.x25, height: Space.x2)
    static let stopped = "Stopped"

    enum Look { case step, failure, review, context, markdown, text }

    static func isLine(_ kind: RowKind) -> Bool {
        switch kind {
        case .tool, .thinking, .note, .unknown: true
        case .user, .prose, .output, .ended, .failure, .review, .context: false
        }
    }

    static func gap(_ kind: RowKind, look: Look, after previous: (kind: RowKind, look: Look)?) -> CGFloat {
        guard let previous else { return Space.x3 }
        if kind == .user { return Space.x6 }
        if kind == .context, previous.kind == .user { return Space.x1 }
        if previous.kind == .user || previous.kind == .context { return Space.x3 }
        if kind == .output { return Space.x1 }
        let stepped: Set<Look> = [.step, .failure]
        if stepped.contains(look), stepped.contains(previous.look) { return 0 }
        if kind == .prose, previous.kind == .prose { return Space.x3 }
        return Space.x2
    }
}

@MainActor
final class FailureCell: NSView {
    static let identifier = NSUserInterfaceItemIdentifier("failure")
    static let symbol = "exclamationmark.triangle"
    static let style = TextStyle.base
    static let actionGap = Space.x15

    var onRetry: (() -> Void)?
    private var words = NSAttributedString()
    private var gap: CGFloat = 0
    private let retry = Button("Retry", variant: .outline, size: .sm)
    private let wait = Label("", style: .sm, color: Palette.contentTertiary)
    private var until: Date?
    private var clock: Timer?

    init() {
        super.init(frame: .zero)
        identifier = Self.identifier
        setAccessibilityElement(false)
        retry.translatesAutoresizingMaskIntoConstraints = true
        retry.isHidden = true
        retry.onPress = { [weak self] in self?.onRetry?() }
        wait.translatesAutoresizingMaskIntoConstraints = true
        wait.isHidden = true
        addSubview(retry)
        addSubview(wait)
    }

    isolated deinit {
        clock?.invalidate()
    }

    var waitText: String { wait.isHidden ? "" : wait.stringValue }

    private func countDown() {
        let remaining = retry.isHidden ? nil : SessionState.remaining(until: until, now: .now)
        wait.stringValue = remaining.map { "Wait " + $0 } ?? ""
        wait.isHidden = remaining == nil
        retry.toolTip = remaining.map { "The provider asked to wait another " + $0 }
        guard remaining != nil, window != nil else {
            clock?.invalidate()
            clock = nil
            return
        }
        guard clock == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.countDown()
                self?.needsLayout = true
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        clock = timer
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        countDown()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    static func height(lead: String, text: String, retryable: Bool, width: CGFloat) -> CGFloat {
        let lines = textHeight(attributed(lead: lead, text: text), width: width)
        return retryable ? lines + actionGap + Size.sm.height : lines
    }

    private static func textHeight(_ words: NSAttributedString, width: CGFloat) -> CGFloat {
        let room = max(1, width - StepCell.textX - Rows.inset)
        let box = words.boundingRect(with: NSSize(width: room, height: CGFloat.greatestFiniteMagnitude), options: [.usesLineFragmentOrigin])
        return max(Rows.line, box.height.rounded(.up) + Rows.line - style.lineHeight)
    }

    private static func attributed(lead: String, text: String) -> NSAttributedString {
        guard !lead.isEmpty else { return NSAttributedString(string: text, attributes: style.attributes(Palette.dangerInk)) }
        let made = NSMutableAttributedString(string: lead, attributes: style.attributes(Palette.dangerInk, weight: .medium))
        if !text.isEmpty {
            made.append(NSAttributedString(string: "\n" + text, attributes: style.attributes(Palette.contentSecondary)))
        }
        return made
    }

    func configure(lead: String, text: String, retryable: Bool, until: Date?, gap: CGFloat) {
        words = Self.attributed(lead: lead, text: text)
        self.gap = gap
        self.until = until
        retry.isHidden = !retryable
        countDown()
        retry.setAccessibilityLabel(lead.isEmpty ? "Retry" : "Retry after " + lead)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Failed: " + [lead, text].filter { !$0.isEmpty }.joined(separator: ". "))
        needsLayout = true
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        guard !retry.isHidden else { return }
        let size = retry.fittingSize
        let top = gap + Self.textHeight(words, width: bounds.width) + Self.actionGap
        retry.frame = NSRect(origin: NSPoint(x: StepCell.textX, y: top), size: NSSize(width: size.width, height: Size.sm.height))
        let label = wait.fittingSize
        wait.frame = NSRect(x: retry.frame.maxX + Space.x2, y: (retry.frame.midY - label.height / 2).rounded(),
                            width: min(label.width, max(0, bounds.width - retry.frame.maxX - Space.x2 - Rows.inset)), height: label.height)
    }

    override func draw(_ dirtyRect: NSRect) {
        if let image = Symbol.image(Self.symbol, glyph: StepCell.glyph) {
            Draw.glyph(image, centeredIn: NSRect(x: Rows.inset, y: gap, width: StepCell.glyph.rawValue, height: Rows.line),
                       ink: Palette.dangerInk)
        }
        let room = max(0, bounds.width - StepCell.textX - Rows.inset)
        let top = gap + (Rows.line - Self.style.lineHeight) / 2
        words.draw(with: NSRect(x: StepCell.textX, y: top, width: room, height: max(0, bounds.height - top)),
                   options: [.usesLineFragmentOrigin])
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        onRetry = nil
    }
}

@MainActor
final class ContextCell: NSView {
    static let identifier = NSUserInterfaceItemIdentifier("context")
    let flow = ChipFlow(singleLine: true)
    private lazy var top = flow.topAnchor.constraint(equalTo: topAnchor)

    init() {
        super.init(frame: .zero)
        identifier = Self.identifier
        addSubview(flow)
        NSLayoutConstraint.activate([
            top,
            flow.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Rows.inset),
            flow.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Rows.inset),
            flow.heightAnchor.constraint(equalToConstant: Chip.height),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    func configure(_ chips: [ContextFormat.Chip], gap: CGFloat) {
        top.constant = gap
        flow.show(chips, removable: false)
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        flow.hidePeek()
        flow.onOpen = nil
    }
}

@MainActor
final class ReviewCell: NSView {
    static let identifier = NSUserInterfaceItemIdentifier("review")
    static var height: CGFloat { Size.sm.height }
    static let style = TextStyle.base

    var onReview: (() -> Void)?
    private let button = Button("Review Changes", variant: .outline, size: .sm)
    private var summary = ""
    private var counts: (added: Int32, removed: Int32) = (0, 0)
    private var gap: CGFloat = 0

    init() {
        super.init(frame: .zero)
        identifier = Self.identifier
        button.translatesAutoresizingMaskIntoConstraints = true
        button.onPress = { [weak self] in self?.onReview?() }
        addSubview(button)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    func configure(_ summary: String, added: Int32, removed: Int32, gap: CGFloat) {
        self.summary = summary
        counts = (added, removed)
        self.gap = gap
        button.setAccessibilityLabel("Review Changes, \(summary), \(added) added, \(removed) removed")
        needsLayout = true
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        button.frame = NSRect(origin: NSPoint(x: Rows.inset, y: gap), size: NSSize(width: button.fittingSize.width, height: Self.height))
    }

    override func draw(_ dirtyRect: NSRect) {
        let line = NSRect(x: 0, y: gap, width: bounds.width, height: Self.height)
        var x = button.frame.maxX + Space.x2
        let parts: [(String, NSColor)] = [(summary, Palette.contentTertiary)]
            + (counts.added > 0 ? [("+\(counts.added)", Palette.successInk)] : [])
            + (counts.removed > 0 ? [("\u{2212}\(counts.removed)", Palette.dangerInk)] : [])
        for (text, ink) in parts {
            let width = min(Draw.width(of: text, style: Self.style, tabular: true), max(0, bounds.width - Rows.inset - x))
            Draw.text(text, in: NSRect(x: x, y: line.minY, width: width, height: line.height), style: Self.style, ink: ink, tabular: true)
            x += width + StepCell.wordGap
        }
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        onReview = nil
    }
}

@MainActor
final class TextCell: NSView {
    static let identifier = NSUserInterfaceItemIdentifier("text")

    private let card = SurfaceView(fill: Palette.bgElevated, ring: Palette.strokeQuaternary, radius: Radius.card)
    private let storage = NSTextStorage()
    private let layoutManager = ProseLayoutManager()
    private let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
    private let text: NSTextView
    private var gap: CGFloat = 0
    private var carded = false

    init() {
        container.lineFragmentPadding = 0
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        storage.addLayoutManager(layoutManager)
        text = NSTextView(frame: .zero, textContainer: container)
        super.init(frame: .zero)
        identifier = Self.identifier
        text.isEditable = false
        text.isSelectable = true
        text.drawsBackground = false
        text.textContainerInset = .zero
        text.isVerticallyResizable = false
        text.isHorizontallyResizable = false
        text.linkTextAttributes = [.foregroundColor: Palette.accentInk, .cursor: NSCursor.pointingHand]
        card.translatesAutoresizingMaskIntoConstraints = true
        card.isHidden = true
        addSubview(card)
        addSubview(text)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    func configure(_ attributed: NSAttributedString, card: Bool, gap: CGFloat) {
        self.gap = gap
        carded = card
        self.card.isHidden = !card
        if !storage.isEqual(to: attributed) { storage.setAttributedString(attributed) }
        setAccessibilityElement(false)
        needsLayout = true
    }

    override func layout() {
        super.layout()
        let width = bounds.width - Rows.inset * 2
        let height = bounds.height - gap
        guard carded else {
            text.frame = NSRect(x: Rows.inset, y: gap, width: max(0, width), height: max(0, height))
            return
        }
        card.frame = NSRect(x: Rows.inset, y: gap, width: max(0, width), height: max(0, height))
        text.frame = card.frame.insetBy(dx: Rows.cardPadding.width, dy: Rows.cardPadding.height)
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        text.setSelectedRange(NSRange(location: 0, length: 0))
    }
}

@MainActor
final class MarkdownCell: NSView {
    static let identifier = NSUserInterfaceItemIdentifier("markdown")

    let view = MarkdownView(body: .prose)
    private var gap: CGFloat = 0

    init() {
        super.init(frame: .zero)
        identifier = Self.identifier
        addSubview(view)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    func configure(_ markdown: String, ink: NSColor, gap: CGFloat) {
        self.gap = gap
        view.ink = ink
        view.update(markdown)
        needsLayout = true
    }

    override func layout() {
        super.layout()
        view.frame = NSRect(x: Rows.inset, y: gap, width: max(0, bounds.width - Rows.inset * 2), height: max(0, bounds.height - gap))
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        view.clearSelection()
        view.onHeightChange = nil
    }
}

enum AgentMotion {
    static let card = Motion.normal
}
