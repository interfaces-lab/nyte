import AppKit
import NyteCore
import NyteUI

@MainActor
final class NoteView: SurfaceView {
    static let padding = Space.x2
    static let gap = Space.x05
    static let style = TextStyle.base
    static let measure: CGFloat = 640
    static let narrowest: CGFloat = 128
    static let pointing = "Pointing at these lines"

    let place = Label("", style: .sm, color: Palette.contentTertiary)
    let words = Label("", style: NoteView.style, color: Palette.contentPrimary)
    let edit = Button("Edit", size: .xs)
    let remove = Button("Remove", size: .xs)

    init() {
        super.init(fill: Palette.bgElevated, ring: Palette.strokeTertiary, radius: Radius.control)
        translatesAutoresizingMaskIntoConstraints = true
        words.maximumNumberOfLines = 0
        words.lineBreakMode = .byWordWrapping
        words.cell?.wraps = true
        words.alignment = .natural
        words.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let top = NSStackView(views: [place, NSView(), edit, remove])
        top.orientation = .horizontal
        top.spacing = Space.x1
        top.translatesAutoresizingMaskIntoConstraints = false
        addSubview(top)
        addSubview(words)
        NSLayoutConstraint.activate([
            top.topAnchor.constraint(equalTo: topAnchor, constant: Self.padding),
            top.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.padding),
            top.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.padding),
            top.heightAnchor.constraint(equalToConstant: Size.xs.height),
            words.topAnchor.constraint(equalTo: top.bottomAnchor, constant: Self.gap),
            words.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.padding),
            words.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.padding),
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layout() {
        let width = max(0, bounds.width - Self.padding * 2)
        if words.preferredMaxLayoutWidth != width { words.preferredMaxLayoutWidth = width }
        super.layout()
    }

    func show(_ note: DiffNote, numbered lines: ClosedRange<Int>) {
        let range = lines.count == 1 ? "Line \(lines.lowerBound)" : "Lines \(lines.lowerBound)–\(lines.upperBound)"
        place.stringValue = note.side == .old ? range + ", before" : range
        words.stringValue = note.comment.isEmpty ? Self.pointing : note.comment
        words.textColor = note.comment.isEmpty ? Palette.contentTertiary : Palette.contentPrimary
        setAccessibilityLabel("Comment on \(place.stringValue.lowercased()): \(words.stringValue)")
    }

    static func height(_ note: DiffNote, width: CGFloat) -> CGFloat {
        let text = note.comment.isEmpty ? pointing : note.comment
        let box = (text as NSString).boundingRect(with: NSSize(width: max(1, width - padding * 2), height: .greatestFiniteMagnitude),
                                                  options: [.usesLineFragmentOrigin], attributes: [.font: style.font()])
        return (padding * 2 + Size.xs.height + gap + max(style.lineHeight, box.height)).rounded(.up)
    }
}

@MainActor
final class NoteComposer: SurfaceView {
    static let padding = Space.x2
    static let lines = 2
    static let hint = "Return to add, Esc to cancel, ⇧Return for a new line"

    let field = TextArea(placeholder: "Comment for the agent, or leave empty to point at the lines", minimumLines: NoteComposer.lines)
    let add = Button("Add Comment", variant: .solid, tone: .primary, size: .xs)
    let cancel = Button("Cancel", size: .xs)
    let help = Label(NoteComposer.hint, style: .sm, color: Palette.contentTertiary)

    init() {
        super.init(fill: Palette.bgElevated, ring: Palette.strokeTertiary, radius: Radius.control)
        translatesAutoresizingMaskIntoConstraints = true
        help.lineBreakMode = .byTruncatingTail
        let row = NSStackView(views: [help, NSView(), cancel, add])
        row.orientation = .horizontal
        row.spacing = Space.x1
        let column = NSStackView(views: [field, row])
        column.orientation = .vertical
        column.alignment = .width
        column.spacing = Space.x2
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: topAnchor, constant: Self.padding),
            column.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.padding),
            column.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.padding),
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("New comment")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    static var height: CGFloat { (padding * 2 + TextArea.height(lines: lines) + Space.x2 + Size.xs.height).rounded(.up) }
}
