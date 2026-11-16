import AppKit

@MainActor
public final class PromptRow: NSView {
    public let input = Input(placeholder: "", variant: .bare, size: .sm)
    public static let mark = "\u{203A}"
    public static let style = TextStyle.code

    public var placeholder = "" { didSet { updatePlaceholder() } }
    public var disabledReason: String? {
        didSet {
            input.isEnabled = disabledReason == nil
            updatePlaceholder()
        }
    }
    public var onSubmit: ((String) -> Void)? {
        get { input.onSubmit }
        set { input.onSubmit = newValue }
    }
    public var onCommand: ((Selector) -> Bool)? {
        get { input.onCommand }
        set { input.onCommand = newValue }
    }

    private let markLabel = Label(PromptRow.mark, style: PromptRow.style, color: Palette.contentSecondary)
    private let rule = Hairline()
    private var heightConstraint: NSLayoutConstraint?

    public init(placeholder: String = "") {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        input.textStyle = Self.style
        for view in [rule, markLabel, input] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        let heightConstraint = heightAnchor.constraint(equalToConstant: Metric.rowCompact + Metric.hairline)
        self.heightConstraint = heightConstraint
        NSLayoutConstraint.activate([
            rule.topAnchor.constraint(equalTo: topAnchor),
            rule.leadingAnchor.constraint(equalTo: leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: trailingAnchor),
            markLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: RowCell.Geometry.inset + RowCell.Geometry.padding),
            markLabel.centerYAnchor.constraint(equalTo: input.centerYAnchor),
            input.leadingAnchor.constraint(equalTo: markLabel.trailingAnchor, constant: Space.x05),
            input.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -RowCell.Geometry.inset),
            input.topAnchor.constraint(equalTo: rule.bottomAnchor),
            input.bottomAnchor.constraint(equalTo: bottomAnchor),
            heightConstraint,
        ])
        markLabel.setContentHuggingPriority(.required, for: .horizontal)
        input.height = .flexible
        setAccessibilityElement(false)
        self.placeholder = placeholder
        updatePlaceholder()
        observeDensity(#selector(densityDidChange))
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func densityDidChange() { heightConstraint?.constant = Metric.rowCompact + Metric.hairline }

    private func updatePlaceholder() {
        input.placeholder = disabledReason ?? placeholder
        markLabel.textColor = disabledReason == nil ? Palette.contentSecondary : Palette.contentDisabled
    }

    public func focus() { window?.makeFirstResponder(input.field) }
}
