import AppKit

@MainActor
public final class CommandView: NSView, NSTextFieldDelegate {
    public static let width: CGFloat = 560
    public static let wideWidth: CGFloat = 880
    public static let previewWidth: CGFloat = 340
    public static var rowHeight: CGFloat { Metric.row }
    public static var scopeRowHeight: CGFloat { Size.sm.height + Space.x2 }
    public static let visibleRows = 8
    public static let listInset = Space.x2
    public static let fieldInset = Space.x4
    public static let glyphGap = Space.x25
    public static let glyph = Glyph.md
    public static let text = Input.entryStyle

    public var results: (@MainActor (String) async -> [RowContent])?
    public var onActivate: ((Int, RowContent) -> Void)?
    public var onDismiss: (() -> Void)?
    public var onActivateBeside: ((Int, RowContent) -> Void)?
    public var scopedResults: (@MainActor (String, Int) async -> [RowContent])?
    public var preview: ((Int, RowContent) -> NSView?)? { didSet { previewDidChange() } }
    public var scopes: [String] = [] {
        didSet {
            scopeTabs.titles = scopes
            scopeTabs.isHidden = scopes.isEmpty
            scopeHeight?.constant = scopes.isEmpty ? 0 : Self.scopeRowHeight
            scopeTabs.selectedIndex = min(scopeTabs.selectedIndex, max(0, scopes.count - 1))
        }
    }
    public var scope: Int {
        get { scopeTabs.selectedIndex }
        set { scopeTabs.choose(newValue) }
    }
    public var showsPreview: Bool { preview != nil && bounds.width >= Self.width + Self.previewWidth / 2 }
    public var onHeightChange: ((CGFloat) -> Void)?
    public var emptyText = "No matches" { didSet { empty.stringValue = emptyText } }
    public private(set) var rows: [RowContent] = []
    public var query: String { field.stringValue }

    let field = KitTextField()
    let list = ListView()
    let scopeTabs = TextTabs([], label: "Scope")
    private let previewHost = NSView()
    private let previewRule = Hairline(.vertical)
    private var scopeHeight: NSLayoutConstraint?
    private var previewWidthConstraint: NSLayoutConstraint?
    private let rule = Hairline()
    private let empty = Label("", style: .base, color: Palette.contentTertiary)
    private var search: Task<Void, Never>?

    public init(placeholder: String) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        build(placeholder: placeholder)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public func reset() {
        field.stringValue = ""
        apply([], for: "")
        runSearch()
    }

    public func focus() { window?.makeFirstResponder(field) }

    public func setQuery(_ query: String) {
        field.stringValue = query
        runSearch()
    }

    public var selectedRow: Int? {
        get { list.selectedRow }
        set { list.selectedRow = newValue }
    }

    private func build(placeholder: String) {
        let root = self
        let glyph = NSImageView()
        glyph.image = Symbol.image("magnifyingglass", glyph: Self.glyph)
        glyph.contentTintColor = Palette.contentTertiary

        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = Self.text.font()
        field.textColor = Palette.contentPrimary
        field.placeholderAttributedString = NSAttributedString(string: placeholder, attributes: [
            .font: Self.text.font(), .foregroundColor: Input.placeholderInk,
        ])
        field.cell?.usesSingleLineMode = true
        field.delegate = self
        field.setAccessibilityLabel(placeholder)

        list.rowHeight = Self.rowHeight
        list.showsFocusAlways = true
        list.acceptsFocus = false
        list.activatesOnClick = true
        list.verticalInset = Self.listInset
        list.rowCount = { [unowned self] in rows.count }
        list.content = { [unowned self] in rows[$0] }
        list.onActivate = { [unowned self] in activate($0) }
        list.onSelect = { [unowned self] _ in updatePreview() }
        empty.stringValue = emptyText
        scopeTabs.isHidden = true
        scopeTabs.onSelect = { [unowned self] _ in runSearch() }
        previewHost.isHidden = true
        previewRule.isHidden = true

        for view in [glyph, field, scopeTabs, rule, list, empty, previewRule, previewHost] {
            view.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(view)
        }
        let rowText = RowCell.Geometry.inset + RowCell.Geometry.padding
        let scopeHeight = scopeTabs.heightAnchor.constraint(equalToConstant: 0)
        self.scopeHeight = scopeHeight
        let previewWidthConstraint = previewHost.widthAnchor.constraint(equalToConstant: 0)
        self.previewWidthConstraint = previewWidthConstraint
        NSLayoutConstraint.activate([
            glyph.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Self.fieldInset),
            glyph.centerYAnchor.constraint(equalTo: root.topAnchor, constant: Metric.commandBar / 2),
            glyph.widthAnchor.constraint(equalToConstant: Self.glyph.rawValue),
            field.leadingAnchor.constraint(equalTo: glyph.trailingAnchor, constant: Self.glyphGap),
            field.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Self.fieldInset),
            field.centerYAnchor.constraint(equalTo: glyph.centerYAnchor),
            scopeTabs.topAnchor.constraint(equalTo: root.topAnchor, constant: Metric.commandBar),
            scopeTabs.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: RowCell.Geometry.inset),
            scopeHeight,
            rule.topAnchor.constraint(equalTo: scopeTabs.bottomAnchor),
            rule.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            list.topAnchor.constraint(equalTo: rule.bottomAnchor),
            list.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: previewRule.leadingAnchor),
            list.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            previewRule.topAnchor.constraint(equalTo: rule.bottomAnchor),
            previewRule.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            previewRule.trailingAnchor.constraint(equalTo: previewHost.leadingAnchor),
            previewHost.topAnchor.constraint(equalTo: rule.bottomAnchor),
            previewHost.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            previewHost.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            previewWidthConstraint,
            empty.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: rowText),
            empty.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -rowText),
            empty.centerYAnchor.constraint(equalTo: list.centerYAnchor),
        ])
    }

    public var height: CGFloat {
        guard !scopes.isEmpty else { return Self.height(results: rows.count, query: field.stringValue) }
        return Metric.commandBar + Self.scopeRowHeight + Metric.hairline + CGFloat(Self.visibleRows) * Self.rowHeight + Self.listInset * 2
    }

    public var width: CGFloat { preview == nil ? Self.width : Self.wideWidth }

    private func previewDidChange() {
        needsLayout = true
        updatePreview()
    }

    override public func layout() {
        let shows = showsPreview
        previewWidthConstraint?.constant = shows ? Self.previewWidth : 0
        previewHost.isHidden = !shows
        previewRule.isHidden = !shows
        super.layout()
    }

    func updatePreview() {
        previewHost.subviews.forEach { $0.removeFromSuperview() }
        guard let preview, let row = list.selectedRow, rows.indices.contains(row), let view = preview(row, rows[row]) else { return }
        Pin.fill(view, in: previewHost)
    }

    override public func performKeyEquivalent(with event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        guard modifiers == .command else { return super.performKeyEquivalent(with: event) }
        if event.keyCode == KeyCode.returnKey || event.keyCode == KeyCode.enter {
            guard let row = list.selectedRow, rows.indices.contains(row) else { return true }
            let chosen = rows[row]
            onDismiss?()
            (onActivateBeside ?? onActivate)?(row, chosen)
            return true
        }
        if let digit = event.charactersIgnoringModifiers.flatMap({ Int($0) }), !scopes.isEmpty, (1...scopes.count).contains(digit) {
            scope = digit - 1
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    public static func height(results: Int, query: String) -> CGFloat {
        let shown = min(results, visibleRows)
        guard shown > 0 || !query.isEmpty else { return Metric.commandBar }
        return Metric.commandBar + Metric.hairline + CGFloat(max(shown, 1)) * rowHeight + listInset * 2
    }

    public func controlTextDidChange(_ notification: Notification) { runSearch() }

    private func runSearch() {
        search?.cancel()
        let query = field.stringValue
        let scope = self.scope
        let scoped = scopedResults
        let plain = results
        guard scoped != nil || plain != nil else { return apply([], for: query) }
        search = Task { @MainActor [weak self] in
            let found = if let scoped { await scoped(query, scope) } else { await plain?(query) ?? [] }
            guard !Task.isCancelled, let self else { return }
            self.apply(found, for: query)
        }
    }

    func cancelSearch() {
        search?.cancel()
        search = nil
    }

    private func apply(_ found: [RowContent], for query: String) {
        rows = found
        list.reload()
        list.selectedRow = found.firstIndex { !$0.isHeader }
        rule.isHidden = found.isEmpty && query.isEmpty
        list.isHidden = found.isEmpty
        empty.isHidden = !found.isEmpty || query.isEmpty
        updatePreview()
        onHeightChange?(height)
    }

    public func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        guard !textView.hasMarkedText() else { return false }
        switch selector {
        case #selector(NSResponder.moveDown(_:)): list.moveSelection(by: 1)
        case #selector(NSResponder.moveUp(_:)): list.moveSelection(by: -1)
        case #selector(NSResponder.insertNewline(_:)): if let row = list.selectedRow { activate(row) }
        case #selector(NSResponder.cancelOperation(_:)): onDismiss?()
        case #selector(NSResponder.insertTab(_:)) where !scopes.isEmpty: scope = (scope + 1) % scopes.count
        case #selector(NSResponder.insertBacktab(_:)) where !scopes.isEmpty: scope = (scope + scopes.count - 1) % scopes.count
        default: return false
        }
        return true
    }

    private func activate(_ row: Int) {
        guard rows.indices.contains(row) else { return }
        let chosen = rows[row]
        onDismiss?()
        onActivate?(row, chosen)
    }
}

@MainActor
public final class CommandPanel {
    public let view: CommandView
    private let panel = FloatingPanel(radius: Radius.surface, takesKey: true)

    public init(placeholder: String) {
        view = CommandView(placeholder: placeholder)
        panel.content = view
        view.onDismiss = { [weak self] in self?.dismiss() }
        panel.onDismiss = { [weak view] in view?.cancelSearch() }
        view.onHeightChange = { [weak self] height in
            guard let self, self.panel.isShown else { return }
            self.panel.resize(to: NSSize(width: self.view.width, height: height))
        }
    }

    public var results: (@MainActor (String) async -> [RowContent])? {
        get { view.results }
        set { view.results = newValue }
    }

    public var onActivate: ((Int, RowContent) -> Void)? {
        get { view.onActivate }
        set { view.onActivate = newValue }
    }

    public var isShown: Bool { panel.isShown }

    public func show(in window: NSWindow) {
        view.reset()
        panel.show(size: NSSize(width: view.width, height: view.height), centredIn: window)
        view.focus()
    }

    public func dismiss() { panel.dismiss() }
}
