import AppKit

@MainActor
open class QuietScrollView: NSScrollView {
    private var wantsVertical = false
    private var wantsHorizontal = false
    private(set) var hasScrolled = false

    override public init(frame: NSRect) {
        super.init(frame: frame)
        NotificationCenter.default.addObserver(self, selector: #selector(styleChanged),
                                               name: NSScroller.preferredScrollerStyleDidChangeNotification, object: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var hasVerticalScroller: Bool {
        get { wantsVertical }
        set {
            wantsVertical = newValue
            applyScrollers()
        }
    }

    override public var hasHorizontalScroller: Bool {
        get { wantsHorizontal }
        set {
            wantsHorizontal = newValue
            applyScrollers()
        }
    }

    override public var scrollerStyle: NSScroller.Style {
        didSet { applyScrollers() }
    }

    var showsScrollers: Bool { hasScrolled || scrollerStyle != .overlay }

    private func applyScrollers() {
        let shows = showsScrollers
        if super.hasVerticalScroller != (wantsVertical && shows) { super.hasVerticalScroller = wantsVertical && shows }
        if super.hasHorizontalScroller != (wantsHorizontal && shows) { super.hasHorizontalScroller = wantsHorizontal && shows }
    }

    override public func scrollWheel(with event: NSEvent) {
        if !hasScrolled {
            hasScrolled = true
            applyScrollers()
        }
        super.scrollWheel(with: event)
    }

    override public func flashScrollers() {
        guard hasScrolled else { return }
        super.flashScrollers()
    }

    @objc private func styleChanged() { applyScrollers() }
}
