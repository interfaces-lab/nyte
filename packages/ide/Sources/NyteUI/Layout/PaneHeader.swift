import AppKit

@MainActor
public final class PaneHeader: NSView {
    public static var height: CGFloat { Metric.paneHeader }
    public static var titleInset: CGFloat { Metric.paneInset }
    public static let actionInset = Space.x1
    public static let actionGap = Space.x05
    public static let middleGap = Space.x2
    public static let actionSize = Size.sm
    public static let titleStyle = TextStyle.base
    public static let dividerGap = Space.x3
    public static let dividerLength = Space.x4

    public var title: String {
        get { titleLabel.stringValue }
        set {
            titleLabel.stringValue = newValue
            titleLabel.isHidden = newValue.isEmpty
            setAccessibilityLabel(newValue)
            updateDivider()
        }
    }

    public var middle: NSView? {
        didSet {
            oldValue?.removeFromSuperview()
            updateDivider()
            guard let middle else { return }
            middle.translatesAutoresizingMaskIntoConstraints = false
            middleSlot.addSubview(middle)
            let fill = middle.trailingAnchor.constraint(equalTo: middleSlot.trailingAnchor)
            fill.priority = .defaultLow
            NSLayoutConstraint.activate([
                middle.leadingAnchor.constraint(equalTo: middleSlot.leadingAnchor),
                middle.trailingAnchor.constraint(lessThanOrEqualTo: middleSlot.trailingAnchor),
                fill,
                middle.centerYAnchor.constraint(equalTo: middleSlot.centerYAnchor),
                middle.topAnchor.constraint(greaterThanOrEqualTo: middleSlot.topAnchor),
                middle.bottomAnchor.constraint(lessThanOrEqualTo: middleSlot.bottomAnchor),
            ])
        }
    }

    public var actions: [NSView] {
        get { actionStack.arrangedSubviews }
        set {
            actionStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            newValue.forEach(actionStack.addArrangedSubview)
        }
    }

    public var rowHeight: CGFloat {
        get { customHeight ?? Metric.paneHeader }
        set {
            customHeight = newValue
            heightConstraint?.constant = newValue
        }
    }
    private var customHeight: CGFloat?
    private var heightConstraint: NSLayoutConstraint?
    private var titleLeading: NSLayoutConstraint?

    @objc private func densityDidChange() {
        heightConstraint?.constant = rowHeight
        titleLeading?.constant = Self.titleInset
    }

    public var showsHairline: Bool {
        get { !rule.isHidden }
        set { rule.isHidden = !newValue }
    }

    private let titleLabel = Label("", style: PaneHeader.titleStyle, color: Palette.contentPrimary, weight: .semibold)
    private let divider = Hairline(.vertical)
    private var afterTitle: NSLayoutConstraint?
    private let middleSlot = NSView()
    private let actionStack = NSStackView()
    private let rule = Hairline()
    private weak var followed: NSClipView?

    public init(title: String = "", actions: [NSView] = []) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        actionStack.orientation = .horizontal
        actionStack.spacing = Self.actionGap
        actionStack.setHuggingPriority(.required, for: .horizontal)
        titleLabel.setContentHuggingPriority(.required, for: .horizontal)
        rule.isHidden = true
        divider.isHidden = true
        for view in [titleLabel, divider, middleSlot, actionStack, rule] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        let afterTitle = middleSlot.leadingAnchor.constraint(equalTo: titleLabel.trailingAnchor, constant: Self.middleGap)
        afterTitle.priority = .defaultHigh
        self.afterTitle = afterTitle
        let heightConstraint = heightAnchor.constraint(equalToConstant: Self.height)
        self.heightConstraint = heightConstraint
        let titleLeading = titleLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.titleInset)
        self.titleLeading = titleLeading
        observeDensity(#selector(densityDidChange))
        NSLayoutConstraint.activate([
            divider.leadingAnchor.constraint(equalTo: titleLabel.trailingAnchor, constant: Self.dividerGap),
            divider.centerYAnchor.constraint(equalTo: centerYAnchor),
            divider.heightAnchor.constraint(equalToConstant: Self.dividerLength),
            heightConstraint,
            titleLeading,
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            afterTitle,
            middleSlot.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: Self.titleInset),
            middleSlot.topAnchor.constraint(equalTo: topAnchor),
            middleSlot.bottomAnchor.constraint(equalTo: bottomAnchor),
            middleSlot.trailingAnchor.constraint(equalTo: actionStack.leadingAnchor, constant: -Self.middleGap),
            actionStack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.actionInset),
            actionStack.centerYAnchor.constraint(equalTo: centerYAnchor),
            rule.leadingAnchor.constraint(equalTo: leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: trailingAnchor),
            rule.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        self.title = title
        self.actions = actions
    }

    private func updateDivider() {
        let shows = !titleLabel.isHidden && middle != nil
        divider.isHidden = !shows
        afterTitle?.constant = shows ? Self.dividerGap * 2 + Metric.hairline : Self.middleGap
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public func follow(_ scrollView: NSScrollView) {
        let center = NotificationCenter.default
        if let followed { center.removeObserver(self, name: NSView.boundsDidChangeNotification, object: followed) }
        let clip = scrollView.contentView
        clip.postsBoundsChangedNotifications = true
        center.addObserver(self, selector: #selector(scrolled), name: NSView.boundsDidChangeNotification, object: clip)
        followed = clip
        scrolled()
    }

    @objc private func scrolled() {
        guard let clip = followed else { return }
        let top = (clip.enclosingScrollView?.contentInsets.top ?? 0)
        showsHairline = clip.bounds.minY + top > 0
    }
}
