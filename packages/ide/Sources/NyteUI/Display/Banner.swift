import AppKit

@MainActor
public final class Banner: NSView {
    public var tone: Tone { didSet { toneDidChange() } }
    public var onDismiss: (() -> Void)? { didSet { dismiss.isHidden = onDismiss == nil } }

    static let paddingBlock = Space.x15
    static let paddingStart = Space.x3
    static let paddingEnd = Space.x15
    static let gap = Space.x2

    private let glyphView = NSImageView()
    private let titleLabel: Label
    private let detailLabel: Label
    public struct Action {
        public var title: String
        public var isPrimary: Bool
        public var run: () -> Void

        public init(_ title: String, primary: Bool = false, run: @escaping () -> Void) {
            self.title = title
            self.isPrimary = primary
            self.run = run
        }
    }

    public static let mostActions = 3
    static let actionGap = Space.x1

    private let actionButtons: [Button]
    private let actionRow = NSStackView()
    private var actionConstraints: [NSLayoutConstraint] = []
    private var titleRoomInline: NSLayoutConstraint?
    private var titleRoomAlone: NSLayoutConstraint?
    private(set) var actionsWrap = false
    private let dismiss = Button(symbol: "xmark", label: "Dismiss", size: .xs)
    private let more = Button(Banner.showMore, variant: .link, size: .xs)
    private lazy var copy = CodeCopy.button { [weak self] in self?.detail ?? "" }
    private let detail: String
    private var collapsedBottom: NSLayoutConstraint?
    private var disclosedBottom: NSLayoutConstraint?
    public private(set) var isExpanded = false

    static let showMore = "Show more"
    static let showLess = "Show less"

    public convenience init(_ title: String, detail: String = "", tone: Tone = .neutral,
                            action: (title: String, run: () -> Void)?, onDismiss: (() -> Void)? = nil) {
        self.init(title, detail: detail, tone: tone, actions: action.map { [Action($0.title, run: $0.run)] } ?? [], onDismiss: onDismiss)
    }

    public init(_ title: String, detail: String = "", tone: Tone = .neutral, actions: [Action] = [], onDismiss: (() -> Void)? = nil) {
        self.tone = tone
        self.onDismiss = onDismiss
        self.detail = detail
        titleLabel = Label(title, style: .base, color: Palette.contentPrimary, weight: .medium)
        detailLabel = Label(detail, style: .sm, color: Palette.contentSecondary)
        var primaryTaken = false
        actionButtons = actions.prefix(Self.mostActions).map { action in
            let primary = action.isPrimary && !primaryTaken
            primaryTaken = primaryTaken || primary
            let button = Button(action.title, variant: primary ? .solid : .outline, tone: primary ? .primary : .neutral, size: .sm,
                                onPress: action.run)
            return button
        }
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel(detail.isEmpty ? title : "\(title). \(detail)")
        build(hasDetail: !detail.isEmpty)
        toneDidChange()
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    private func build(hasDetail: Bool) {
        glyphView.translatesAutoresizingMaskIntoConstraints = false
        dismiss.isHidden = onDismiss == nil
        dismiss.onPress = { [weak self] in self?.onDismiss?() }
        let trailing = NSStackView(views: [dismiss])
        trailing.orientation = .horizontal
        trailing.spacing = Space.x1
        trailing.setContentHuggingPriority(.required, for: .horizontal)
        trailing.setContentCompressionResistancePriority(.required, for: .horizontal)
        actionRow.orientation = .horizontal
        actionRow.spacing = Self.actionGap
        actionRow.setViews(actionButtons, in: .leading)
        actionRow.setContentHuggingPriority(.required, for: .horizontal)
        actionRow.setContentCompressionResistancePriority(.required, for: .horizontal)
        actionRow.isHidden = actionButtons.isEmpty
        trailingStack = trailing
        for view in [glyphView, titleLabel, trailing, actionRow] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        let glyph = Glyph.md.rawValue
        NSLayoutConstraint.activate([
            glyphView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.paddingStart),
            glyphView.widthAnchor.constraint(equalToConstant: glyph),
            glyphView.heightAnchor.constraint(equalToConstant: glyph),
            glyphView.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            titleLabel.leadingAnchor.constraint(equalTo: glyphView.trailingAnchor, constant: Size.md.gap),
            titleLabel.centerYAnchor.constraint(equalTo: trailing.centerYAnchor),
            trailing.leadingAnchor.constraint(greaterThanOrEqualTo: titleLabel.trailingAnchor, constant: Self.gap),
            bottomAnchor.constraint(greaterThanOrEqualTo: titleLabel.bottomAnchor, constant: Self.paddingBlock),
            trailing.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.paddingEnd),
            trailing.heightAnchor.constraint(greaterThanOrEqualToConstant: Size.sm.height),
        ])
        guard hasDetail else {
            let height = heightAnchor.constraint(equalTo: trailing.heightAnchor, constant: Self.paddingBlock * 2)
            height.priority = .defaultHigh
            NSLayoutConstraint.activate([
                trailing.topAnchor.constraint(equalTo: topAnchor, constant: Self.paddingBlock),
                height,
            ])
            placeActions()
            return
        }
        detailLabel.translatesAutoresizingMaskIntoConstraints = false
        detailLabel.maximumNumberOfLines = Self.detailLines
        detailLabel.lineBreakMode = .byWordWrapping
        detailLabel.cell?.wraps = true
        detailLabel.setContentCompressionResistancePriority(.required, for: .vertical)
        addSubview(detailLabel)
        let underTitle = detailLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor)
        underTitle.priority = .defaultHigh
        NSLayoutConstraint.activate([
            trailing.topAnchor.constraint(equalTo: topAnchor, constant: Self.paddingBlock),
            detailLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            detailLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -Self.paddingEnd),
            detailLabel.topAnchor.constraint(greaterThanOrEqualTo: titleLabel.bottomAnchor),
            underTitle,
        ])
        more.isHidden = true
        copy.isHidden = true
        more.onPress = { [weak self] in self?.setExpanded(!(self?.isExpanded ?? false)) }
        for view in [more, copy] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        let collapsed = bottomAnchor.constraint(equalTo: detailLabel.bottomAnchor, constant: Self.paddingBlock)
        let disclosed = bottomAnchor.constraint(equalTo: more.bottomAnchor, constant: Self.paddingBlock)
        collapsed.priority = .defaultHigh
        disclosed.priority = .defaultHigh
        collapsedBottom = collapsed
        disclosedBottom = disclosed
        NSLayoutConstraint.activate([
            collapsed,
            more.topAnchor.constraint(equalTo: detailLabel.bottomAnchor, constant: Space.x05),
            more.leadingAnchor.constraint(equalTo: detailLabel.leadingAnchor),
            copy.centerYAnchor.constraint(equalTo: more.centerYAnchor),
            copy.leadingAnchor.constraint(equalTo: more.trailingAnchor, constant: Self.gap),
            bottomAnchor.constraint(greaterThanOrEqualTo: detailLabel.bottomAnchor, constant: Self.paddingBlock),
        ])
        placeActions()
    }

    private var trailingStack: NSStackView?

    private func placeActions() {
        NSLayoutConstraint.deactivate(actionConstraints)
        guard !actionButtons.isEmpty, let trailingStack else { return actionConstraints = [] }
        if actionsWrap {
            let above: NSView = detailLabel.superview == nil ? titleLabel : (more.isHidden ? detailLabel : more)
            actionConstraints = [
                actionRow.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
                actionRow.topAnchor.constraint(equalTo: above.bottomAnchor, constant: Self.gap),
                actionRow.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -Self.paddingEnd),
                bottomAnchor.constraint(equalTo: actionRow.bottomAnchor, constant: Self.paddingBlock),
            ]
        } else {
            actionConstraints = [
                actionRow.trailingAnchor.constraint(equalTo: trailingStack.leadingAnchor, constant: onDismiss == nil ? 0 : -Self.actionGap),
                actionRow.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
                actionRow.leadingAnchor.constraint(greaterThanOrEqualTo: titleLabel.trailingAnchor, constant: Self.gap),
                bottomAnchor.constraint(greaterThanOrEqualTo: actionRow.bottomAnchor, constant: Self.paddingBlock),
            ]
            if detailLabel.superview != nil {
                actionConstraints.append(detailLabel.topAnchor.constraint(greaterThanOrEqualTo: actionRow.bottomAnchor))
            }
        }
        NSLayoutConstraint.activate(actionConstraints)
    }

    private func updateActionWrap() {
        guard !actionButtons.isEmpty else { return }
        let dismissWidth = onDismiss == nil ? 0 : Size.xs.height + Self.actionGap
        let title = Draw.width(of: titleLabel.stringValue, style: .base, weight: .medium)
        let needed = Self.detailInset + title + Self.gap + actionRow.fittingSize.width + dismissWidth + Self.paddingEnd
        let wraps = bounds.width > 0 && needed > bounds.width
        guard wraps != actionsWrap else { return }
        actionsWrap = wraps
        placeActions()
        invalidateIntrinsicContentSize()
    }

    var overflowsTwoLines: Bool {
        let width = detailLabel.preferredMaxLayoutWidth
        guard width > 0, !detail.isEmpty else { return false }
        let box = (detail as NSString).boundingRect(with: NSSize(width: width, height: CGFloat.greatestFiniteMagnitude),
                                                    options: [.usesLineFragmentOrigin],
                                                    attributes: [.font: TextStyle.sm.font()])
        let font = TextStyle.sm.font()
        return box.height > ceil(font.ascender - font.descender + font.leading) * CGFloat(Self.detailLines) + Metric.hairline
    }

    public func setExpanded(_ expanded: Bool) {
        isExpanded = expanded
        detailLabel.maximumNumberOfLines = expanded ? 0 : Self.detailLines
        detailLabel.isSelectable = expanded
        more.title = expanded ? Self.showLess : Self.showMore
        copy.isHidden = !expanded
        invalidateIntrinsicContentSize()
        needsLayout = true
    }

    private func updateDisclosure() {
        let shows = isExpanded || overflowsTwoLines
        guard more.isHidden == shows else { return }
        more.isHidden = !shows
        collapsedBottom?.isActive = !shows
        disclosedBottom?.isActive = shows
        if actionsWrap { placeActions() }
    }

    static let detailLines = 2
    static let detailInset = paddingStart + Glyph.md.rawValue + Size.md.gap

    override public func layout() {
        updateActionWrap()
        let width = max(0, bounds.width - Self.detailInset - Self.paddingEnd)
        if detailLabel.superview != nil, detailLabel.preferredMaxLayoutWidth != width {
            detailLabel.preferredMaxLayoutWidth = width
            invalidateIntrinsicContentSize()
        }
        updateDisclosure()
        super.layout()
    }

    private func toneDidChange() {
        let name = switch tone {
        case .neutral, .primary: "info.circle"
        case .success: "checkmark.circle"
        case .warning: "exclamationmark.triangle"
        case .danger: "xmark.octagon"
        }
        glyphView.image = Symbol.image(name, glyph: .md)
        glyphView.contentTintColor = tone == .neutral ? Palette.contentSecondary : Palette.color(.contentAccent, tone: tone)
        needsDisplay = true
    }

    override public func draw(_ dirtyRect: NSRect) {
        Draw.fill(bounds, radius: Radius.control, color: Palette.color(.fillTertiary, tone: tone))
        Draw.ring(bounds, radius: Radius.control, color: Palette.color(.strokeQuaternary, tone: tone))
    }
}
