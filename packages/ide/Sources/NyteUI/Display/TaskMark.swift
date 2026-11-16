import AppKit

@MainActor
public final class TaskMark: NSView {
    public enum Status: Sendable, Equatable {
        case none, working, retrying, waiting, unread, failed

        public static var background: Status { .working }
    }

    public enum Request: Sendable, Equatable {
        case approval, question

        public var word: String {
            switch self {
            case .approval: "Approval"
            case .question: "Question"
            }
        }
    }

    public var status: Status { didSet { if status != oldValue { statusDidChange() } } }
    public let side: CGFloat

    private let spinner = Spinner()
    private let loader = Loader(side: TaskMark.waitSide)

    public static let markSide = Glyph.md.rawValue
    public static let waitSide = Glyph.sm.rawValue

    public init(_ status: Status = .none, side: CGFloat = Glyph.lg.rawValue) {
        self.status = status
        self.side = side
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        for view in [spinner, loader] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
            NSLayoutConstraint.activate([
                view.centerXAnchor.constraint(equalTo: centerXAnchor),
                view.centerYAnchor.constraint(equalTo: centerYAnchor),
            ])
        }
        spinner.ink = Self.ink(.working)
        loader.ink = Self.ink(.retrying)
        setContentHuggingPriority(.required, for: .horizontal)
        setContentHuggingPriority(.required, for: .vertical)
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
        statusDidChange()
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }
    override public var intrinsicContentSize: NSSize { NSSize(width: side, height: side) }

    private func statusDidChange() {
        spinner.isHidden = status != .working
        loader.isHidden = status != .retrying
        setAccessibilityLabel(Self.words[status])
        needsDisplay = true
    }

    static let words: [Status: String] = [
        .none: "", .working: "Working", .retrying: "Retrying", .waiting: Attention.needsInputText, .failed: "Failed", .unread: "Unread",
    ]

    override public func draw(_ dirtyRect: NSRect) {
        guard !Self.isMoving(status) else { return }
        Self.draw(status, in: bounds)
    }

    public static func isMoving(_ status: Status) -> Bool { status == .working || status == .retrying }

    public static func ink(_ status: Status) -> NSColor {
        switch status {
        case .none, .working, .retrying, .unread: Palette.contentSecondary
        case .waiting: Palette.color(.contentAccent, tone: Attention.tone)
        case .failed: Palette.dangerInk
        }
    }

    public static func draw(_ status: Status, in rect: NSRect) {
        switch status {
        case .none: break
        case .working: Spinner.draw(phase: Spinner.currentPhase, ink: ink(status), side: markSide, in: rect)
        case .retrying: Loader.draw(turn: Loader.currentTurn, ink: ink(status), side: waitSide, in: rect)
        case .waiting: glyph(Attention.symbol + ".fill", ink: ink(status), in: rect)
        case .failed: glyph("exclamationmark.triangle.fill", ink: ink(status), in: rect)
        case .unread: Draw.dot(in: rect, diameter: Metric.dot, color: ink(status))
        }
    }

    private static func glyph(_ name: String, ink: NSColor, in rect: NSRect) {
        guard let image = Symbol.image(name, glyph: .sm) else { return }
        Draw.glyph(image, centeredIn: rect, ink: ink)
    }
}
