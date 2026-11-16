import AppKit
import NyteUI

@MainActor
final class BreakpointEditor: NSView {
    static let width: CGFloat = 420
    static let labelWidth: CGFloat = 92
    static let inset = Space.x3

    var onDone: ((Breakpoint?) -> Void)?

    private var breakpoint: Breakpoint
    private let heading: Label
    private let enabled = Checkbox("Enabled")
    let condition = Input(placeholder: "Stop only when this is true", size: .md)
    let hitCount = Input(placeholder: "Such as > 2", size: .md)
    let logMessage = Input(placeholder: "Log instead of stopping, such as {x}", size: .md)
    private let remove = Button("Remove", variant: .ghost, tone: .danger, size: .md)
    private let done = Button("Done", variant: .solid, tone: .primary, size: .md)

    init(_ breakpoint: Breakpoint, place: String) {
        self.breakpoint = breakpoint
        heading = Label("Breakpoint at " + place, style: .base, color: Palette.contentPrimary, weight: .semibold)
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Breakpoint at " + place)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        enabled.state = breakpoint.isEnabled ? .on : .off
        for (input, value, label) in [(condition, breakpoint.condition, "Condition"), (hitCount, breakpoint.hitCondition, "Hit count"),
                                      (logMessage, breakpoint.logMessage, "Log message")] {
            input.textStyle = .code
            input.stringValue = value
            input.field.setAccessibilityLabel(label)
            input.onSubmit = { [weak self] _ in self?.finish() }
            input.onCancel = { [weak self] in self?.onDone?(nil) }
        }
        remove.onPress = { [weak self] in
            guard let self else { return }
            var removed = breakpoint
            removed.line = -1
            onDone?(removed)
        }
        done.onPress = { [weak self] in self?.finish() }
        let rows = [("Condition", condition), ("Hit count", hitCount), ("Log message", logMessage)].map { title, input -> NSView in
            let label = Label(title, style: .base, color: Palette.contentSecondary)
            label.alignment = .right
            label.widthAnchor.constraint(equalToConstant: Self.labelWidth).isActive = true
            let row = NSStackView(views: [label, input])
            row.orientation = .horizontal
            row.spacing = Space.x2
            return row
        }
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let buttons = NSStackView(views: [remove, spacer, done])
        buttons.orientation = .horizontal
        buttons.spacing = Space.x2
        let enabledRow = NSStackView(views: [heading, NSView(), enabled])
        enabledRow.orientation = .horizontal
        let stack = NSStackView(views: [enabledRow] + rows + [buttons])
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = Space.x2
        stack.edgeInsets = NSEdgeInsets(top: Self.inset, left: Self.inset, bottom: Self.inset, right: Self.inset)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            widthAnchor.constraint(equalToConstant: Self.width),
        ])
    }

    var edited: Breakpoint {
        var changed = breakpoint
        changed.isEnabled = enabled.state == .on
        changed.condition = condition.stringValue.trimmingCharacters(in: .whitespaces)
        changed.hitCondition = hitCount.stringValue.trimmingCharacters(in: .whitespaces)
        changed.logMessage = logMessage.stringValue.trimmingCharacters(in: .whitespaces)
        return changed
    }

    private func finish() {
        onDone?(edited)
    }
}
