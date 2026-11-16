import AppKit

@MainActor
public final class ToolWindowView: NSView {
    public enum Strip: Sendable, Equatable {
        case pane, toolbar, compact, dense, fitting, hidden

        public var height: CGFloat? {
            switch self {
            case .pane: Metric.paneHeader
            case .toolbar: Size.lg.height
            case .compact: Metric.tab
            case .dense: Size.sm.height
            case .fitting: nil
            case .hidden: 0
            }
        }
    }

    public enum Rule: Sendable, Equatable { case always, whenScrolled, never }

    public let header = ToolStrip()
    public let content = NSView()
    public let footer = ToolStrip()
    public var onAppearanceChange: (() -> Void)?
    public var onKey: ((NSEvent) -> Bool)?
    public var onWidthChange: (() -> Void)?

    public var headerStrip: Strip { didSet { if headerStrip != oldValue { applyStrips() } } }
    public var footerStrip: Strip { didSet { if footerStrip != oldValue { applyStrips() } } }
    public var headerRule = Rule.whenScrolled { didSet { headerLine.mode = headerRule } }
    public var footerRule = Rule.whenScrolled { didSet { footerLine.mode = footerRule } }

    let headerLine = ScrollRule()
    let footerLine = ScrollRule()
    private var headerHeight: NSLayoutConstraint?
    private var footerHeight: NSLayoutConstraint?

    public init(header: Strip = .pane, footer: Strip = .hidden) {
        headerStrip = header
        footerStrip = footer
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        for view in [self.header, content, self.footer] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        let headerHeight = self.header.heightAnchor.constraint(equalToConstant: 0)
        let footerHeight = self.footer.heightAnchor.constraint(equalToConstant: 0)
        self.headerHeight = headerHeight
        self.footerHeight = footerHeight
        NSLayoutConstraint.activate([
            self.header.topAnchor.constraint(equalTo: topAnchor),
            self.header.leadingAnchor.constraint(equalTo: leadingAnchor),
            self.header.trailingAnchor.constraint(equalTo: trailingAnchor),
            content.topAnchor.constraint(equalTo: self.header.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: leadingAnchor),
            content.trailingAnchor.constraint(equalTo: trailingAnchor),
            content.bottomAnchor.constraint(equalTo: self.footer.topAnchor),
            self.footer.leadingAnchor.constraint(equalTo: leadingAnchor),
            self.footer.trailingAnchor.constraint(equalTo: trailingAnchor),
            self.footer.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        headerLine.place(atTopOf: content, in: self)
        footerLine.place(atBottomOf: content, in: self)
        applyStrips()
        observeDensity(#selector(densityDidChange))
    }

    @objc private func densityDidChange() { applyStrips() }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public func follow(_ scrollView: NSScrollView?) {
        headerLine.follow(scrollView)
        footerLine.follow(scrollView)
    }

    private func applyStrips() {
        for (strip, kind, height) in [(header, headerStrip, headerHeight), (footer, footerStrip, footerHeight)] {
            strip.isHidden = kind == .hidden
            height?.constant = kind.height ?? 0
            height?.isActive = kind != .fitting
        }
        headerLine.isEnabled = headerStrip != .hidden
        footerLine.isEnabled = footerStrip != .hidden
    }

    override public func setFrameSize(_ newSize: NSSize) {
        let changed = newSize.width != frame.width
        super.setFrameSize(newSize)
        if changed { onWidthChange?() }
    }

    override public func keyDown(with event: NSEvent) {
        if onKey?(event) == true { return }
        super.keyDown(with: event)
    }

    override public func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        onAppearanceChange?()
    }
}

@MainActor
public final class ToolStrip: NSView {
    public let leading = NSStackView()
    public let trailing = NSStackView()
    public var leadingInset: CGFloat {
        get { customLeading ?? RowCell.Geometry.inset + RowCell.Geometry.padding }
        set {
            customLeading = newValue
            leadingEdge?.constant = newValue
        }
    }
    public var trailingInset: CGFloat {
        get { customTrailing ?? RowCell.Geometry.inset }
        set {
            customTrailing = newValue
            trailingEdge?.constant = -newValue
        }
    }
    private var customLeading: CGFloat?
    private var customTrailing: CGFloat?

    @objc private func densityDidChange() {
        leadingEdge?.constant = leadingInset
        trailingEdge?.constant = -trailingInset
    }
    private var leadingEdge: NSLayoutConstraint?
    private var trailingEdge: NSLayoutConstraint?

    public init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        for stack in [leading, trailing] {
            stack.orientation = .horizontal
            stack.alignment = .centerY
            stack.spacing = Space.x05
            stack.translatesAutoresizingMaskIntoConstraints = false
            stack.setHuggingPriority(.defaultHigh, for: .horizontal)
            addSubview(stack)
        }
        leading.spacing = Space.x2
        leading.setClippingResistancePriority(.defaultLow, for: .horizontal)
        trailing.setClippingResistancePriority(.required, for: .horizontal)
        let leadingEdge = leading.leadingAnchor.constraint(equalTo: leadingAnchor, constant: leadingInset)
        let trailingEdge = trailing.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -trailingInset)
        self.leadingEdge = leadingEdge
        self.trailingEdge = trailingEdge
        NSLayoutConstraint.activate([
            leadingEdge, trailingEdge,
            leading.centerYAnchor.constraint(equalTo: centerYAnchor),
            trailing.centerYAnchor.constraint(equalTo: centerYAnchor),
            leading.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -Space.x2),
        ])
        observeDensity(#selector(densityDidChange))
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public func setViews(leading: [NSView], trailing: [NSView] = []) {
        for input in (leading + trailing).compactMap({ $0 as? Input }) where input.variant == .quiet || input.variant == .raised {
            input.variant = .strip
        }
        self.leading.setViews(leading, in: .leading)
        self.trailing.setViews(trailing, in: .trailing)
    }
}

@MainActor
public final class ScrollRule {
    public let line = Hairline()
    public var isEnabled = true { didSet { update() } }
    var mode = ToolWindowView.Rule.whenScrolled { didSet { update() } }
    private var isBottom = false
    private weak var scrollView: NSScrollView?
    private var observers: [NSObjectProtocol] = []

    public init(following scrollView: NSScrollView? = nil) {
        line.isHidden = true
        follow(scrollView)
    }

    isolated deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    public func follow(_ scrollView: NSScrollView?) {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        self.scrollView = scrollView
        defer { update() }
        guard let scrollView else { return }
        scrollView.contentView.postsBoundsChangedNotifications = true
        observers = [(NSView.boundsDidChangeNotification, scrollView.contentView as NSView),
                     (NSView.frameDidChangeNotification, scrollView.contentView as NSView)].map { name, object in
            NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.update() }
            }
        }
        if let document = scrollView.documentView {
            document.postsFrameChangedNotifications = true
            observers.append(NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: document,
                                                                    queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.update() }
            })
        }
    }

    public func place(atTopOf view: NSView, in container: NSView) {
        isBottom = false
        attach(to: container, edge: line.topAnchor.constraint(equalTo: view.topAnchor))
    }

    public func place(atBottomOf view: NSView, in container: NSView) {
        isBottom = true
        attach(to: container, edge: line.bottomAnchor.constraint(equalTo: view.bottomAnchor))
    }

    private func attach(to container: NSView, edge: NSLayoutConstraint) {
        line.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(line)
        NSLayoutConstraint.activate([
            line.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            line.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            edge,
        ])
        update()
    }

    public func update() {
        line.isHidden = !shows
    }

    var shows: Bool {
        guard isEnabled, mode != .never else { return false }
        guard mode == .whenScrolled else { return true }
        guard let scrollView else { return false }
        let clip = scrollView.contentView.bounds
        guard isBottom else { return clip.minY + scrollView.contentInsets.top > 0 }
        let height = scrollView.documentView?.frame.height ?? 0
        return clip.maxY - scrollView.contentInsets.bottom < height
    }
}

@MainActor
public enum Pin {
    public static func fill(_ view: NSView, in container: NSView, insets: NSEdgeInsets = NSEdgeInsetsZero) {
        view.translatesAutoresizingMaskIntoConstraints = false
        if view.superview !== container { container.addSubview(view) }
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: insets.left),
            view.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -insets.right),
            view.topAnchor.constraint(equalTo: container.topAnchor, constant: insets.top),
            view.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -insets.bottom),
        ])
    }

    public static func center(_ view: NSView, in container: NSView) {
        view.translatesAutoresizingMaskIntoConstraints = false
        if view.superview !== container { container.addSubview(view) }
        NSLayoutConstraint.activate([
            view.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            view.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            view.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: Metric.paneInset),
            view.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -Metric.paneInset),
        ])
    }
}
