import AppKit

@MainActor
public final class SettingsSidebar: NSView {
    public struct Category: Sendable, Equatable {
        public var title: String
        public var symbol: String
        public var hue: Hue
        public var status: String
        public var keywords: [String]

        public init(_ title: String, symbol: String, hue: Hue, status: String = "", keywords: [String] = []) {
            self.title = title
            self.symbol = symbol
            self.hue = hue
            self.status = status
            self.keywords = keywords
        }
    }

    public static let width = Metric.settingsSidebarWidth
    public static let tileSide = Glyph.lg.rawValue
    public static let tileGlyph = Glyph.xs

    public var categories: [Category] { didSet { filter() } }
    public var onSelect: ((Int) -> Void)?
    public let search = SearchField(placeholder: "Search", size: .sm)
    public let list = ListView()
    public private(set) var shown: [Int] = []

    public var selectedCategory: Int? {
        get { list.selectedRow.map { shown[$0] } }
        set { list.selectedRow = newValue.flatMap { shown.firstIndex(of: $0) } }
    }

    public init(_ categories: [Category]) {
        self.categories = categories
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        list.rowCount = { [unowned self] in shown.count }
        list.content = { [unowned self] in row(categories[shown[$0]]) }
        list.heightOfRow = { [unowned self] in categories[shown[$0]].status.isEmpty ? Metric.row : Metric.rowDouble }
        list.onSelect = { [unowned self] rows in
            guard let row = rows.first, shown.indices.contains(row) else { return }
            onSelect?(shown[row])
        }
        list.verticalInset = Space.x1
        list.acceptsFocus = false
        list.showsFocusAlways = true
        list.setAccessibilityLabel("Settings categories")
        search.onChange = { [weak self] _ in self?.filter() }
        search.onMove = { [weak self] in self?.list.moveSelection(by: $0) }
        for view in [search, list] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            search.topAnchor.constraint(equalTo: topAnchor, constant: Space.x2),
            search.leadingAnchor.constraint(equalTo: leadingAnchor, constant: RowCell.Geometry.inset),
            search.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -RowCell.Geometry.inset),
            list.topAnchor.constraint(equalTo: search.bottomAnchor, constant: Space.x1),
            list.leadingAnchor.constraint(equalTo: leadingAnchor),
            list.trailingAnchor.constraint(equalTo: trailingAnchor),
            list.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        filter()
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public static func tile(symbol: String, hue: Hue) -> NSImage {
        let side = tileSide
        return NSImage(size: NSSize(width: side, height: side), flipped: true) { rect in
            Draw.fill(rect, radius: Radius.small, color: Palette.color(.bgInteractiveStrong, in: hue))
            if let glyph = Symbol.image(symbol, glyph: tileGlyph, weight: .semibold) {
                Draw.glyph(glyph, centeredIn: rect, ink: Palette.color(.contentOnInteractiveStrong, in: hue))
            }
            return true
        }
    }

    private func row(_ category: Category) -> RowContent {
        var row = RowContent(title: category.title, leading: .image(Self.tile(symbol: category.symbol, hue: category.hue)))
        row.description = category.status
        row.descriptionInk = .tertiary
        return row
    }

    private func filter() {
        let query = search.stringValue.trimmingCharacters(in: .whitespaces).lowercased()
        let selected = selectedCategory
        shown = categories.indices.filter { index in
            guard !query.isEmpty else { return true }
            let category = categories[index]
            return ([category.title] + category.keywords).contains { $0.lowercased().contains(query) }
        }
        list.reload()
        selectedCategory = selected.flatMap { shown.contains($0) ? $0 : nil } ?? shown.first
    }
}

@MainActor
public final class SettingsHeader: NSView {
    public let back = Button.header(symbol: "chevron.left", label: "Back")
    public let forward = Button.header(symbol: "chevron.right", label: "Forward")
    private let titleLabel = Label("", style: .lg, color: Palette.contentPrimary, weight: .semibold)
    private var heightConstraint: NSLayoutConstraint?

    public var title: String {
        get { titleLabel.stringValue }
        set {
            titleLabel.stringValue = newValue
            setAccessibilityLabel(newValue)
        }
    }

    public init(title: String = "") {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let buttons = NSStackView(views: [back, forward])
        buttons.spacing = 0
        for view in [buttons, titleLabel] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        let heightConstraint = heightAnchor.constraint(equalToConstant: Metric.paneHeader + Space.x2)
        self.heightConstraint = heightConstraint
        NSLayoutConstraint.activate([
            buttons.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Space.x3),
            buttons.centerYAnchor.constraint(equalTo: centerYAnchor),
            titleLabel.leadingAnchor.constraint(equalTo: buttons.trailingAnchor, constant: Space.x2),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -Space.x3),
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightConstraint,
        ])
        titleLabel.lineBreakMode = .byTruncatingTail
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        self.title = title
        observeDensity(#selector(densityDidChange))
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func densityDidChange() { heightConstraint?.constant = Metric.paneHeader + Space.x2 }
}

@MainActor
public final class SettingsGroup: NSView {
    public static let radius = Radius.pane
    public static let headingGap = Space.x1

    public let box = SurfaceView(fill: Palette.bgElevated, ring: Palette.strokeQuaternary, radius: SettingsGroup.radius)
    public private(set) var rows: [SettingsRow] = []
    private let headingLabel = Label("", style: .sm, color: Palette.contentSecondary, weight: .medium)
    private let stack = NSStackView()

    public init(heading: String = "", rows: [SettingsRow] = []) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        headingLabel.stringValue = heading
        headingLabel.isHidden = heading.isEmpty
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = 0
        let column = NSStackView(views: [headingLabel, box])
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = Self.headingGap
        column.setHuggingPriority(.defaultLow, for: .horizontal)
        stack.setHuggingPriority(.defaultLow, for: .horizontal)
        Pin.fill(column, in: self)
        Pin.fill(stack, in: box)
        box.widthAnchor.constraint(equalTo: column.widthAnchor).isActive = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel(heading)
        setRows(rows)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public func setRows(_ rows: [SettingsRow]) {
        self.rows = rows
        for (index, row) in rows.enumerated() { row.showsRule = index > 0 }
        stack.setViews(rows, in: .top)
    }
}

@MainActor
public final class SettingsRow: NSView {
    public static let paddingBlock = Space.x2
    public static var paddingInline: CGFloat { Metric.paneInset }
    public static let controlGap = Space.x4

    private let titleLabel = Label("", style: .base, color: Palette.contentPrimary)
    private let descriptionLabel = Label("", style: .sm, color: Palette.contentSecondary)
    private let rule = Hairline()
    public let control: NSView?

    var showsRule: Bool {
        get { !rule.isHidden }
        set { rule.isHidden = !newValue }
    }

    public init(_ title: String, description: String = "", control: NSView? = nil) {
        self.control = control
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        titleLabel.stringValue = title
        descriptionLabel.stringValue = description
        descriptionLabel.isHidden = description.isEmpty
        descriptionLabel.maximumNumberOfLines = 0
        descriptionLabel.lineBreakMode = .byWordWrapping
        descriptionLabel.cell?.wraps = true
        descriptionLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let text = NSStackView(views: [titleLabel, descriptionLabel])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = Space.x05
        let centered = text.centerYAnchor.constraint(equalTo: centerYAnchor)
        centered.priority = .defaultHigh
        let snug = heightAnchor.constraint(equalToConstant: 0)
        snug.priority = .fittingSizeCompression
        snug.isActive = true
        var views: [NSView] = [rule, text]
        if let control { views.append(control) }
        for view in views {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        var constraints = [
            rule.topAnchor.constraint(equalTo: topAnchor),
            rule.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.paddingInline),
            rule.trailingAnchor.constraint(equalTo: trailingAnchor),
            text.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Self.paddingInline),
            text.topAnchor.constraint(greaterThanOrEqualTo: topAnchor, constant: Self.paddingBlock),
            text.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -Self.paddingBlock),
            centered,
            heightAnchor.constraint(greaterThanOrEqualToConstant: Metric.row + Self.paddingBlock),
        ]
        if let control {
            control.setContentCompressionResistancePriority(.required, for: .horizontal)
            control.setContentHuggingPriority(.required, for: .horizontal)
            constraints += [
                control.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.paddingInline),
                control.centerYAnchor.constraint(equalTo: centerYAnchor),
                text.trailingAnchor.constraint(lessThanOrEqualTo: control.leadingAnchor, constant: -Self.controlGap),
                control.topAnchor.constraint(greaterThanOrEqualTo: topAnchor, constant: Self.paddingBlock),
            ]
        } else {
            constraints.append(text.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -Self.paddingInline))
        }
        NSLayoutConstraint.activate(constraints)
        rule.isHidden = true
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel(title)
        setAccessibilityHelp(description.isEmpty ? nil : description)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public func layout() {
        let room = bounds.width - Self.paddingInline * 2 - (control.map { $0.fittingSize.width + Self.controlGap } ?? 0)
        if room > 0, descriptionLabel.preferredMaxLayoutWidth != room {
            descriptionLabel.preferredMaxLayoutWidth = room
            invalidateIntrinsicContentSize()
        }
        super.layout()
    }
}
