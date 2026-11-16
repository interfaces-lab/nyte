import AppKit

extension Button {
    public static func header(symbol: String, label: String, onPress: (() -> Void)? = nil) -> Button {
        let button = Button(symbol: symbol, label: label, size: PaneHeader.actionSize, onPress: onPress)
        button.toolTip = label
        return button
    }
}

@MainActor
public final class NavigatorBar: NSView {
    public struct Item: Sendable, Equatable {
        public var symbol: String
        public var label: String

        public init(symbol: String, label: String) {
            self.symbol = symbol
            self.label = label
        }
    }

    public var items: [Item] { didSet { rebuild() } }
    public var selectedIndex: Int { didSet { if selectedIndex != oldValue { updateSelection() } } }
    public var onSelect: ((Int) -> Void)?
    public static let gap = Space.x05

    private(set) var buttons: [Button] = []
    private let stack = NSStackView()
    private var heightConstraint: NSLayoutConstraint?

    public init(_ items: [Item], selectedIndex: Int = 0, label: String = "", onSelect: ((Int) -> Void)? = nil) {
        self.items = items
        self.selectedIndex = selectedIndex
        self.onSelect = onSelect
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .horizontal
        stack.spacing = Self.gap
        stack.alignment = .centerY
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        let heightConstraint = heightAnchor.constraint(equalToConstant: Metric.paneHeader)
        self.heightConstraint = heightConstraint
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: PaneHeader.actionInset),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -PaneHeader.actionInset),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightConstraint,
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.radioGroup)
        setAccessibilityLabel(label)
        rebuild()
        observeDensity(#selector(densityDidChange))
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func densityDidChange() { heightConstraint?.constant = Metric.paneHeader }

    private func rebuild() {
        buttons = items.enumerated().map { index, item in
            let button = Button.header(symbol: item.symbol, label: item.label) { [weak self] in self?.choose(index) }
            button.setAccessibilityRole(.radioButton)
            button.ringsWhenOn = false
            return button
        }
        stack.setViews(buttons, in: .leading)
        updateSelection()
    }

    private func updateSelection() {
        for (index, button) in buttons.enumerated() {
            button.isOn = index == selectedIndex
            button.setAccessibilityValue(index == selectedIndex ? 1 : 0)
        }
    }

    public func choose(_ index: Int) {
        guard items.indices.contains(index) else { return }
        let changed = index != selectedIndex
        selectedIndex = index
        if changed { onSelect?(index) }
    }
}
