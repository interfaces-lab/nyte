import AppKit

@MainActor
public final class EmptyState: NSView {
    static let measure: CGFloat = 320
    static let blockGap = Space.x3
    static let glyphSize: CGFloat = 28

    private var paragraph: NSTextField?

    public init(symbol: String? = nil, loading: Bool = false, title: String, description: String = "", command: String? = nil,
                actions: [(title: String, run: () -> Void)] = [], hints: [(title: String, shortcut: String)] = []) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        var blocks: [NSView] = []
        if loading {
            let loader = Loader(side: Glyph.lg.rawValue)
            loader.ink = Palette.contentTertiary
            blocks.append(loader)
        } else if let symbol, let image = Symbol.image(symbol, size: Self.glyphSize, weight: .light) {
            let glyph = NSImageView(image: image)
            glyph.contentTintColor = Palette.contentTertiary
            blocks.append(glyph)
        }
        let words = NSStackView(views: [Label(title, style: .base, color: Palette.contentSecondary, weight: .medium)])
        words.orientation = .vertical
        words.alignment = .centerX
        words.spacing = Space.x1
        if !description.isEmpty {
            let text = KitTextField(wrappingLabelWithString: description)
            text.font = TextStyle.sm.font()
            text.textColor = Palette.contentTertiary
            text.alignment = .center
            text.isSelectable = false
            text.preferredMaxLayoutWidth = Self.measure
            words.addArrangedSubview(text)
            paragraph = text
        }
        blocks.append(words)
        if let command { blocks.append(Self.commandLine(command)) }
        if !actions.isEmpty {
            let buttons = actions.prefix(2).enumerated().map { index, action in
                Button(action.title, variant: index == 0 ? .outline : .ghost, size: .sm, onPress: action.run)
            }
            blocks.append(Self.row(buttons, spacing: Space.x2))
        }
        if !hints.isEmpty {
            let rows = hints.map { hint in
                Self.row([Label(hint.title, style: .sm, color: Palette.contentTertiary), Kbd(hint.shortcut)], spacing: Space.x2)
            }
            let column = NSStackView(views: rows)
            column.orientation = .vertical
            column.alignment = .centerX
            column.spacing = Space.x15
            blocks.append(column)
        }
        let stack = NSStackView(views: blocks)
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = Self.blockGap
        if blocks.count > 1 { stack.setCustomSpacing(Space.x2, after: blocks[0]) }
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: Metric.paneInset),
            stack.topAnchor.constraint(greaterThanOrEqualTo: topAnchor, constant: Metric.paneInset),
        ])
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func layout() {
        if let paragraph {
            let width = min(Self.measure, bounds.width - Metric.paneInset * 2)
            if width > 0, paragraph.preferredMaxLayoutWidth != width { paragraph.preferredMaxLayoutWidth = width }
        }
        super.layout()
    }

    private static func commandLine(_ command: String) -> NSView {
        let box = SurfaceView(fill: Palette.bgBase, ring: Palette.strokeQuaternary, radius: Radius.control)
        let text = Label(command, style: .code, color: Palette.contentPrimary)
        text.isSelectable = true
        let copy = Button(symbol: "doc.on.doc", label: "Copy Command", size: .xs) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(command, forType: .string)
        }
        let line = row([text, copy], spacing: Space.x2)
        line.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(line)
        NSLayoutConstraint.activate([
            line.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: Space.x25),
            line.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -Space.x1),
            line.topAnchor.constraint(equalTo: box.topAnchor, constant: Space.x1),
            line.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -Space.x1),
        ])
        return box
    }

    private static func row(_ views: [NSView], spacing: CGFloat) -> NSStackView {
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = spacing
        return row
    }
}
