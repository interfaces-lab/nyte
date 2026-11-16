import AppKit
import NyteUI

@MainActor
final class QueryBar: NSView {
    enum Toggle: Int, CaseIterable {
        case matchCase, wholeWord, regex, preserveCase

        var symbol: String {
            switch self {
            case .matchCase: "textformat"
            case .wholeWord: "textformat.abc.dottedunderline"
            case .regex: "asterisk"
            case .preserveCase: "textformat.size"
            }
        }

        var title: String {
            switch self {
            case .matchCase: "Match Case"
            case .wholeWord: "Words"
            case .regex: "Regular Expression"
            case .preserveCase: "Preserve Case"
            }
        }

        var shortcut: String {
            switch self {
            case .matchCase: "\u{2325}\u{2318}C"
            case .wholeWord: "\u{2325}\u{2318}W"
            case .regex: "\u{2325}\u{2318}R"
            case .preserveCase: "\u{2325}\u{2318}P"
            }
        }
    }

    static let fieldMinimum: CGFloat = 200
    static let globMinimum: CGFloat = 120

    let field = SearchField(placeholder: "Search", size: .sm)
    let replace = Input(placeholder: "Replace", variant: .quiet, size: .sm, symbol: "arrow.2.squarepath")
    let include = Input(placeholder: "Files to include", variant: .quiet, size: .sm)
    let exclude = Input(placeholder: "Files to exclude", variant: .quiet, size: .sm)
    let summary = Label("", style: .sm, color: Palette.contentTertiary)
    let loader = Loader(side: Glyph.sm.rawValue)
    let stop = Button(symbol: "stop.circle", label: "Stop Search", size: .sm)
    let disclosure = Button(symbol: "chevron.down", label: "Replace and Filters", size: .sm)
    let replaceAll = Button("Replace All", variant: .outline, size: .sm)
    let scope = Button("Workspace", label: "Scope", size: .sm)
    let folderChip = Chip("", symbol: "folder")
    let grouping = Button(symbol: "folder", label: "Group by Folder", size: .sm)
    let ignored = Checkbox("Ignored Files")
    private(set) var toggles: [Button] = []
    private let options = NSStackView()
    private let rows = NSStackView()

    var onToggle: ((Toggle) -> Void)?
    var onDisclose: ((Bool) -> Void)?

    var isDisclosed: Bool { !options.isHidden }

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        toggles = Toggle.allCases.map { toggle in
            let button = Button(symbol: toggle.symbol, label: toggle.title, size: .sm)
            button.toolTip = "\(toggle.title) \(toggle.shortcut)"
            button.setAccessibilityRole(.checkBox)
            button.setAccessibilityValue(false)
            button.onPress = { [weak self] in self?.onToggle?(toggle) }
            return button
        }
        loader.isHidden = true
        stop.isHidden = true
        stop.toolTip = "Stop Search"
        summary.font = TextStyle.sm.tabularFont()
        summary.lineBreakMode = .byTruncatingTail
        summary.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        summary.setContentHuggingPriority(.required, for: .horizontal)
        disclosure.toolTip = "Replace and Filters"
        disclosure.setAccessibilityRole(.disclosureTriangle)
        disclosure.onPress = { [weak self] in self?.setDisclosed(!(self?.isDisclosed ?? false)) }
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.widthAnchor.constraint(greaterThanOrEqualToConstant: Self.fieldMinimum).isActive = true
        let flags = NSStackView(views: Array(toggles.prefix(3)))
        flags.spacing = Toolbar.gap
        let status = NSStackView(views: [loader, summary, stop])
        status.spacing = Space.x15
        status.alignment = .centerY
        status.heightAnchor.constraint(equalToConstant: Size.sm.height).isActive = true
        scope.trailingSymbol = "chevron.down"
        scope.toolTip = "Where to search"
        folderChip.isHidden = true
        let chipHolder = NSStackView(views: [folderChip])
        chipHolder.alignment = .centerY
        chipHolder.heightAnchor.constraint(equalToConstant: Size.sm.height).isActive = true
        grouping.toolTip = "Group by Folder"
        grouping.setAccessibilityRole(.checkBox)
        grouping.setAccessibilityValue(false)
        let top = NSStackView(views: [field, flags, scope, chipHolder, status, grouping, disclosure])
        top.spacing = Space.x2
        top.alignment = .top
        top.setCustomSpacing(Space.x1, after: scope)
        top.setVisibilityPriority(.detachOnlyIfNecessary, for: status)
        top.setCustomSpacing(Space.x3, after: flags)
        replace.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let preserve = toggles[Toggle.preserveCase.rawValue]
        let second = NSStackView(views: [replace, preserve, replaceAll])
        second.spacing = Space.x2
        second.alignment = .centerY
        for input in [include, exclude] {
            input.setContentHuggingPriority(.defaultLow, for: .horizontal)
            input.widthAnchor.constraint(greaterThanOrEqualToConstant: Self.globMinimum).isActive = true
        }
        let third = NSStackView(views: [include, exclude, ignored])
        third.spacing = Space.x2
        third.alignment = .centerY
        options.setViews([second, third], in: .top)
        options.orientation = .vertical
        options.alignment = .leading
        options.spacing = Space.x1
        options.isHidden = true
        for row in [second, third] { row.widthAnchor.constraint(equalTo: options.widthAnchor).isActive = true }
        rows.setViews([top, options], in: .top)
        rows.orientation = .vertical
        rows.alignment = .leading
        rows.spacing = Space.x1
        rows.translatesAutoresizingMaskIntoConstraints = false
        addSubview(rows)
        NSLayoutConstraint.activate([
            rows.topAnchor.constraint(equalTo: topAnchor),
            rows.leadingAnchor.constraint(equalTo: leadingAnchor),
            rows.trailingAnchor.constraint(equalTo: trailingAnchor),
            rows.bottomAnchor.constraint(equalTo: bottomAnchor),
            top.widthAnchor.constraint(equalTo: rows.widthAnchor),
            options.widthAnchor.constraint(equalTo: rows.widthAnchor),
        ])
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func setDisclosed(_ disclosed: Bool) {
        guard disclosed != isDisclosed else { return }
        options.isHidden = !disclosed
        disclosure.symbol = disclosed ? "chevron.up" : "chevron.down"
        disclosure.setAccessibilityValue(disclosed)
        onDisclose?(disclosed)
    }

    func setOn(_ toggle: Toggle, _ on: Bool) {
        let button = toggles[toggle.rawValue]
        button.isOn = on
        button.setAccessibilityValue(on)
    }

    func setSearching(_ searching: Bool) {
        loader.isHidden = !searching
        stop.isHidden = !searching
    }
}
