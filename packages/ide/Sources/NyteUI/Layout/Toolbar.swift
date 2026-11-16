import AppKit

@MainActor
public final class Toolbar: NSView {
    public enum Axis: Sendable { case horizontal, vertical }

    public static let gap = Space.x05
    public static let separatorLength = Space.x4
    public static let separatorMargin = Space.x1

    public let axis: Axis
    private let stack = NSStackView()

    public init(axis: Axis = .horizontal, items: [NSView] = []) {
        self.axis = axis
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setAccessibilityElement(true)
        setAccessibilityRole(.toolbar)
        stack.orientation = axis == .horizontal ? .horizontal : .vertical
        stack.alignment = axis == .horizontal ? .centerY : .centerX
        stack.spacing = Self.gap
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        items.forEach(add)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public func add(_ item: NSView) { stack.addArrangedSubview(item) }

    public func addSeparator() {
        if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(Self.separatorMargin, after: last) }
        let line = Hairline(axis == .horizontal ? .vertical : .horizontal)
        let length = axis == .horizontal ? line.heightAnchor : line.widthAnchor
        length.constraint(equalToConstant: Self.separatorLength).isActive = true
        stack.addArrangedSubview(line)
        stack.setCustomSpacing(Self.separatorMargin, after: line)
    }
}
