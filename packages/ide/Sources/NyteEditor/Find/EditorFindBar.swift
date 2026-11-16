import AppKit
import NyteUI

@MainActor
final class EditorFindBar: NSView {
    enum Option: Int, CaseIterable {
        case matchCase, wholeWords, regex, inSelection

        var symbol: String {
            switch self {
            case .matchCase: "textformat"
            case .wholeWords: "textformat.abc.dottedunderline"
            case .regex: "asterisk"
            case .inSelection: "text.viewfinder"
            }
        }

        var title: String {
            switch self {
            case .matchCase: "Match Case"
            case .wholeWords: "Words"
            case .regex: "Regular Expression"
            case .inSelection: "Find in Selection"
            }
        }

        var shortcut: String {
            switch self {
            case .matchCase: "\u{2325}\u{2318}C"
            case .wholeWords: "\u{2325}\u{2318}W"
            case .regex: "\u{2325}\u{2318}R"
            case .inSelection: ""
            }
        }
    }

    static let fieldMinimum: CGFloat = 220

    let field = SearchField(placeholder: "Find", size: .sm)
    let replace = Input(placeholder: "Replace", variant: .quiet, size: .sm, symbol: "arrow.2.squarepath")
    let previous = Button(symbol: "chevron.up", label: "Find Previous", size: .sm)
    let next = Button(symbol: "chevron.down", label: "Find Next", size: .sm)
    let selectAll = Button("Select All", variant: .ghost, size: .sm)
    let replaceOne = Button("Replace", variant: .outline, size: .sm)
    let replaceAll = Button("Replace All", variant: .outline, size: .sm)
    let disclosure = Button(symbol: "chevron.right", label: "Replace", size: .sm)
    let close = Button(symbol: "xmark", label: "Close Find", size: .sm)
    private(set) var toggles: [Button] = []
    private let replaceRow = NSStackView()

    var onToggle: ((Option) -> Void)?
    var onReplaceShown: ((Bool) -> Void)?

    var showsReplace: Bool { !replaceRow.isHidden }

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        toggles = Option.allCases.map { option in
            let button = Button(symbol: option.symbol, label: option.title, size: .sm)
            button.toolTip = option.shortcut.isEmpty ? option.title : "\(option.title) \(option.shortcut)"
            button.setAccessibilityRole(.checkBox)
            button.setAccessibilityValue(false)
            button.onPress = { [weak self] in self?.onToggle?(option) }
            return button
        }
        for (button, tip) in [(previous, "Find Previous ⇧⌘G"), (next, "Find Next ⌘G"), (close, "Close Find"), (disclosure, "Replace")] {
            button.toolTip = tip
        }
        disclosure.setAccessibilityRole(.disclosureTriangle)
        disclosure.onPress = { [weak self] in self?.setShowsReplace(!(self?.showsReplace ?? false)) }
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.widthAnchor.constraint(greaterThanOrEqualToConstant: Self.fieldMinimum).isActive = true
        replace.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let flags = NSStackView(views: toggles)
        flags.spacing = Toolbar.gap
        let steps = NSStackView(views: [previous, next])
        steps.spacing = Toolbar.gap
        let top = NSStackView(views: [disclosure, field, flags, steps, selectAll, close])
        top.spacing = Space.x2
        top.alignment = .top
        replaceRow.setViews([replace, replaceOne, replaceAll], in: .leading)
        replaceRow.spacing = Space.x2
        replaceRow.alignment = .centerY
        replaceRow.isHidden = true
        let rows = NSStackView(views: [top, replaceRow])
        rows.orientation = .vertical
        rows.alignment = .leading
        rows.spacing = Space.x1
        rows.edgeInsets = NSEdgeInsets(top: Space.x2, left: Space.x2, bottom: Space.x2, right: Space.x2)
        rows.translatesAutoresizingMaskIntoConstraints = false
        addSubview(rows)
        NSLayoutConstraint.activate([
            rows.topAnchor.constraint(equalTo: topAnchor),
            rows.leadingAnchor.constraint(equalTo: leadingAnchor),
            rows.trailingAnchor.constraint(equalTo: trailingAnchor),
            rows.bottomAnchor.constraint(equalTo: bottomAnchor),
            top.widthAnchor.constraint(equalTo: rows.widthAnchor, constant: -Space.x2 * 2),
            replaceRow.leadingAnchor.constraint(equalTo: field.leadingAnchor),
            replaceRow.trailingAnchor.constraint(equalTo: top.trailingAnchor),
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Find")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func draw(_ dirtyRect: NSRect) {
        Palette.strokeTertiary.setFill()
        NSRect(x: bounds.minX, y: bounds.maxY - Metric.hairline, width: bounds.width, height: Metric.hairline).fill()
    }

    override var isFlipped: Bool { true }

    func setShowsReplace(_ shown: Bool) {
        guard shown != showsReplace else { return }
        replaceRow.isHidden = !shown
        disclosure.symbol = shown ? "chevron.down" : "chevron.right"
        disclosure.setAccessibilityValue(shown)
        onReplaceShown?(shown)
    }

    func setOn(_ option: Option, _ on: Bool) {
        let button = toggles[option.rawValue]
        button.isOn = on
        button.setAccessibilityValue(on)
    }

    @objc func toggleMatchCase(_ sender: Any?) { onToggle?(.matchCase) }
    @objc func toggleWholeWord(_ sender: Any?) { onToggle?(.wholeWords) }
    @objc func toggleRegularExpression(_ sender: Any?) { onToggle?(.regex) }

    override func performTextFinderAction(_ sender: Any?) {
        guard let action = TextEngineView.finderAction(sender) else { return }
        onFinderAction?(action)
    }

    var onFinderAction: ((NSTextFinder.Action) -> Void)?
}
