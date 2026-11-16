import AppKit
import NyteCore
import NyteUI

@MainActor
final class CommitBox: NSView {
    static let padding = Space.x3

    let field = TextArea(placeholder: "Commit message")
    let amend = Checkbox("Amend")
    let commit = Button("Commit", variant: .solid, tone: .primary, size: .sm)
    let hint = Label("", style: .sm, color: Palette.contentTertiary)
    let count = Label("", style: .sm, color: Palette.warningInk)
    private let column = NSStackView()
    private var banner: Banner?

    var onCommit: (() -> Void)?
    var onAmendChange: ((Bool) -> Void)?
    var onMessageChange: ((String) -> Void)?

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Commit")
        commit.shortcut = "\u{2318}\u{21A9}"
        commit.onPress = { [weak self] in self?.onCommit?() }
        field.returnKey = .newline
        field.onSubmit = { [weak self] _ in self?.onCommit?() }
        field.onChange = { [weak self] in self?.onMessageChange?($0) }
        amend.onChange = { [weak self] in self?.onAmendChange?($0 == .on) }
        count.font = TextStyle.sm.tabularFont()
        count.setContentCompressionResistancePriority(.required, for: .horizontal)
        count.setContentHuggingPriority(.required, for: .horizontal)
        hint.lineBreakMode = .byTruncatingTail
        let notes = NSStackView(views: [hint, count])
        notes.orientation = .horizontal
        notes.spacing = Space.x2
        let buttons = NSStackView(views: [amend, NSView(), commit])
        buttons.orientation = .horizontal
        buttons.spacing = Space.x2
        buttons.alignment = .centerY
        column.orientation = .vertical
        column.alignment = .width
        column.spacing = Space.x2
        column.setViews([field, notes, buttons], in: .top)
        column.translatesAutoresizingMaskIntoConstraints = false
        let rule = Hairline()
        rule.translatesAutoresizingMaskIntoConstraints = false
        addSubview(rule)
        addSubview(column)
        NSLayoutConstraint.activate([
            rule.topAnchor.constraint(equalTo: topAnchor),
            rule.leadingAnchor.constraint(equalTo: leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: trailingAnchor),
            column.topAnchor.constraint(equalTo: topAnchor, constant: Self.padding),
            column.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.padding),
            column.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.padding),
            column.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Self.padding),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func update(readiness: CommitReadiness, message: String, busy: Bool) {
        commit.isLoading = busy
        field.isEnabled = !busy
        amend.isEnabled = !busy
        switch readiness {
        case .ready:
            commit.isEnabled = true
            hint.stringValue = ""
            commit.toolTip = nil
            commit.setAccessibilityHelp(nil)
        case let .blocked(reason):
            commit.isEnabled = false
            hint.stringValue = reason
            commit.toolTip = reason
            commit.setAccessibilityHelp(reason)
        }
        if let overflow = CommitReadiness.subjectOverflow(message) {
            count.stringValue = "\(overflow)/\(CommitReadiness.subjectLimit)"
            count.toolTip = "The first line reads best at \(CommitReadiness.subjectLimit) characters or fewer."
            count.isHidden = false
        } else {
            count.isHidden = true
        }
        hint.isHidden = hint.stringValue.isEmpty && count.isHidden
    }

    func showFailure(_ failure: GitFailure?) {
        if let banner { column.removeView(banner) }
        banner = nil
        guard let failure else { return }
        let title = failure.reason == .timedOut ? "Commit timed out" : "Commit failed"
        let detail = failure.message.isEmpty ? failure.command : failure.message
        let banner = Banner(title, detail: detail, tone: .danger, onDismiss: { [weak self] in self?.showFailure(nil) })
        column.insertView(banner, at: 0, in: .top)
        self.banner = banner
    }
}
