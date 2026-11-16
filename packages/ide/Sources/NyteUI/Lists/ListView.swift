import AppKit

@MainActor
public final class ListView: NSView {
    public var rowCount: () -> Int = { 0 }
    public var content: (Int) -> RowContent = { _ in RowContent() }
    public var heightOfRow: ((Int) -> CGFloat)? {
        didSet {
            guard (heightOfRow == nil) != (oldValue == nil) else { return }
            driver = heightOfRow == nil ? ListDriver() : VariableHeightListDriver()
            driver.list = self
            table.dataSource = driver
            table.delegate = driver
        }
    }

    public var onSelect: ((IndexSet) -> Void)?
    public var onActivate: ((Int) -> Void)?
    public var onToggle: ((Int) -> Void)?
    public var menuForRow: ((Int) -> NSMenu?)?
    public var menuForRows: ((IndexSet) -> NSMenu?)?
    private var menuTargetRow = -1
    public var onDelete: ((IndexSet) -> Void)?
    public var onReturn: ((Int) -> Void)?
    public var deletesWithCommandOnly = false
    public var onCheck: ((IndexSet) -> Void)?
    public var onPreview: ((Int) -> Void)?
    public var previewsOnClick = false
    public var onAction: ((String, IndexSet) -> Void)?
    public var widestNumber: (() -> String)? { didSet { pushNumberColumn() } }
    var measuredNumberColumn: CGFloat = 0
    var widestDigits = 0
    var knownRowCount = 0

    public enum RowRole: Sendable {
        case regular, compact, double

        @MainActor public var height: CGFloat {
            switch self {
            case .regular: Metric.row
            case .compact: Metric.rowCompact
            case .double: Metric.rowDouble
            }
        }

        @MainActor init?(height: CGFloat) {
            guard let role = [RowRole.regular, .compact, .double].first(where: { $0.height == height }) else { return nil }
            self = role
        }
    }

    public var rowHeight: CGFloat = Metric.row {
        didSet {
            table.rowHeight = rowHeight
            rowRole = RowRole(height: rowHeight)
        }
    }
    public private(set) var rowRole: RowRole? = .regular

    @objc private func densityDidChange() {
        if let rowRole { rowHeight = rowRole.height }
        updateFocus()
    }
    public var isOutline = false {
        didSet { table.setAccessibilityRole(isOutline ? .outline : .table); table.reloadData() }
    }
    public var allowsMultipleSelection: Bool {
        get { table.allowsMultipleSelection }
        set { table.allowsMultipleSelection = newValue }
    }
    public var activatesOnClick = false
    public var showsFocusAlways = false { didSet { updateFocus() } }
    public var acceptsFocus = true
    public var verticalInset: CGFloat = 0 { didSet { updateInsets() } }

    public let scrollView: NSScrollView = QuietScrollView()
    let table = ListTable()
    public var pinsGroupHeaders = false {
        didSet { pinning = pinsGroupHeaders ? (pinning ?? GroupPinning()) : nil; if !pinsGroupHeaders { removePinnedHeader() } }
    }
    public var pinnedGround = Palette.bgBase
    public var groupHeader: ((Int) -> Int?)? { didSet { pinning?.forget(); updatePinnedHeader() } }
    public var selectsHeaders = false
    var pinning: GroupPinning?
    var pinnedHeader: PinnedHeaderView?
    private var driver = ListDriver()
    var hoveredRow = -1
    private var isPointerInside = false
    private var isScrolling = false
    private var lastOffset: CGFloat = 0
    private var suppressesSelect = false

    public init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        driver.list = self
        build()
        observeDensity(#selector(densityDidChange))
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("row"))
        column.resizingMask = .autoresizingMask
        table.addTableColumn(column)
        table.headerView = nil
        table.style = .plain
        table.rowHeight = rowHeight
        table.intercellSpacing = .zero
        table.backgroundColor = .clear
        table.focusRingType = .none
        table.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
        table.selectionHighlightStyle = .regular
        table.dataSource = driver
        table.delegate = driver
        table.target = self
        table.action = #selector(click)
        table.doubleAction = #selector(doubleClick)
        table.list = self
        table.setAccessibilityRole(.table)
        table.addTrackingArea(NSTrackingArea(
            rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect], owner: self
        ))

        scrollView.documentView = table
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.contentView.postsBoundsChangedNotifications = true
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scrollView)
        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        NotificationCenter.default.addObserver(
            self, selector: #selector(clipScrolled), name: NSView.boundsDidChangeNotification, object: scrollView.contentView
        )
    }

    private func updateInsets() {
        scrollView.contentInsets = NSEdgeInsets(top: verticalInset, left: 0, bottom: verticalInset, right: 0)
        lastOffset = -verticalInset
    }

    public func reload() {
        let selection = table.selectedRowIndexes
        suppressesSelect = true
        let count = rowCount()
        if count < knownRowCount { forgetNumbers() }
        knownRowCount = count
        table.reloadData()
        table.selectRowIndexes(selection.filteredIndexSet { $0 < count }, byExtendingSelection: false)
        suppressesSelect = false
        pinning?.forget()
        updatePinnedHeader()
    }

    override public func layout() {
        super.layout()
        updatePinnedHeader()
    }

    public func reloadRows(_ rows: IndexSet) {
        for row in rows {
            guard let cell = table.rowView(atRow: row, makeIfNecessary: false) as? RowCell else { continue }
            configure(cell, row: row)
        }
    }

    public func insertRows(_ rows: IndexSet, animated: Bool = true) {
        animate(animated) { table.insertRows(at: rows, withAnimation: $0) }
        knownRowCount += rows.count
        if widestNumber == nil, rows.contains(where: { noteNumber(content($0)) }) { pushNumberColumn() }
    }

    public func removeRows(_ rows: IndexSet, animated: Bool = true) {
        animate(animated) { table.removeRows(at: rows, withAnimation: $0) }
        knownRowCount = max(0, knownRowCount - rows.count)
    }

    private func animate(_ animated: Bool, _ change: (NSTableView.AnimationOptions) -> Void) {
        let duration = animated ? Motion.duration(Motion.normal) : 0
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = Motion.easeOut
            change(duration > 0 ? .effectFade : [])
        }
        updateHover()
    }

    public func rect(ofRow row: Int) -> NSRect {
        guard row >= 0, row < table.numberOfRows else { return .zero }
        return convert(table.rect(ofRow: row), from: table)
    }

    public var visibleRows: Range<Int> {
        let range = table.rows(in: table.visibleRect)
        return range.location ..< range.location + range.length
    }

    public func scrollRowToVisible(_ row: Int) {
        guard row >= 0, row < table.numberOfRows else { return }
        table.scrollRowToVisible(row)
    }

    public var selectedRow: Int? {
        get { table.selectedRow >= 0 ? table.selectedRow : nil }
        set { selectedRows = newValue.map { IndexSet(integer: $0) } ?? [] }
    }

    public var selectedRows: IndexSet {
        get { table.selectedRowIndexes }
        set {
            suppressesSelect = true
            table.selectRowIndexes(newValue, byExtendingSelection: false)
            suppressesSelect = false
            if window != nil, let first = newValue.first { scrollRowToVisible(first) }
        }
    }

    public func focus() { window?.makeFirstResponder(table) }

    public func moveSelection(by delta: Int) {
        let count = table.numberOfRows
        guard count > 0 else { return }
        var row = table.selectedRow < 0 ? (delta > 0 ? -1 : count) : table.selectedRow
        repeat { row += delta } while row >= 0 && row < count && content(row).isHeader && !selectsHeaders
        guard row >= 0, row < count else { return }
        table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        table.scrollRowToVisible(row)
    }

    func configure(_ cell: RowCell, row: Int) {
        cell.reservesDisclosure = isOutline
        let content = content(row)
        if widestNumber == nil, noteNumber(content) { pushNumberColumn() }
        cell.numberColumn = numberColumn
        cell.onAction = { [weak self] index in self?.performAction(index, ofRow: row, on: IndexSet(integer: row)) }
        cell.content = content
        cell.isHovering = row == hoveredRow
        cell.isMenuTarget = row == menuTargetRow
        cell.showsGuides = isPointerInside
        cell.focus = focus(tableIsFirstResponder: window?.firstResponder === table)
    }

    func selectionDidChange() {
        if menuTargetRow >= 0 { setMenuTarget(-1) }
        table.enumerateAvailableRowViews { view, _ in view.needsDisplay = true }
        guard !suppressesSelect else { return }
        onSelect?(table.selectedRowIndexes)
    }

    private func isFocused(tableIsFirstResponder: Bool) -> Bool {
        KeyFocus.shows(holdsFocus: showsFocusAlways || tableIsFirstResponder, windowIsKey: window?.hasKeyFocus ?? false)
    }

    func focus(tableIsFirstResponder: Bool) -> RowCell.Focus {
        guard isFocused(tableIsFirstResponder: tableIsFirstResponder) else { return .none }
        return tableIsFirstResponder ? .focused : .driven
    }

    func updateFocus(tableIsFirstResponder: Bool? = nil) {
        let responding = tableIsFirstResponder ?? (window?.firstResponder === table)
        let focus = focus(tableIsFirstResponder: responding)
        table.enumerateAvailableRowViews { view, _ in (view as? RowCell)?.focus = focus }
    }

    override public func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        observeKeyFocus(moving: newWindow, #selector(windowKeyChanged))
    }

    @objc private func windowKeyChanged() { updateFocus() }

    override public func mouseMoved(with event: NSEvent) { updateHover() }
    override public func mouseEntered(with event: NSEvent) {
        setPointerInside(true)
        updateHover()
    }

    override public func mouseExited(with event: NSEvent) {
        setPointerInside(false)
        setHoveredRow(-1)
    }

    func setPointerInside(_ inside: Bool) {
        guard inside != isPointerInside else { return }
        isPointerInside = inside
        table.enumerateAvailableRowViews { view, _ in (view as? RowCell)?.showsGuides = inside }
    }

    @objc private func clipScrolled() {
        let offset = scrollView.contentView.bounds.minY
        guard offset != lastOffset else { return }
        lastOffset = offset
        updatePinnedHeader()
        guard window != nil else { return }
        isScrolling = true
        setHoveredRow(-1)
        NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(scrollingEnded), object: nil)
        perform(#selector(scrollingEnded), with: nil, afterDelay: Motion.normal)
    }

    @objc private func scrollingEnded() {
        isScrolling = false
        updateHover()
    }

    private func updateHover() {
        guard !isScrolling, let window, NSApp.isActive else { return setHoveredRow(-1) }
        let point = table.convert(window.mouseLocationOutsideOfEventStream, from: nil)
        setHoveredRow(table.visibleRect.contains(point) ? table.row(at: point) : -1)
        updateHoveredAction(at: point)
    }

    func setHoveredRow(_ row: Int) {
        guard row != hoveredRow else { return }
        hoveredRow = row
        table.enumerateAvailableRowViews { view, index in (view as? RowCell)?.isHovering = index == row }
    }

    func handleMouseDown(at point: NSPoint) -> Bool {
        let row = table.row(at: point)
        guard row >= 0, let cell = table.rowView(atRow: row, makeIfNecessary: false) as? RowCell else { return false }
        let local = cell.convert(point, from: table)
        if let index = cell.action(at: local) {
            trackAction(index, in: cell, row: row)
            return true
        }
        if let onCheck, cell.checkRect.contains(local) {
            onCheck(IndexSet(integer: row))
            return true
        }
        let toggles = cell.content.disclosure != .none && (cell.content.isHeader || cell.disclosureRect.contains(local))
        if toggles { onToggle?(row) }
        return toggles || cell.content.isHeader
    }

    @objc private func click() {
        let row = table.clickedRow
        guard row >= 0, !content(row).isHeader else { return }
        if previewsOnClick, let onPreview { onPreview(row) }
        guard activatesOnClick else { return }
        onActivate?(row)
    }

    @objc private func doubleClick() {
        let row = table.clickedRow
        guard !activatesOnClick, row >= 0, !content(row).isHeader else { return }
        onActivate?(row)
    }

    func handleKey(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        if performActionKey(event) { return true }
        if event.charactersIgnoringModifiers == " ", modifiers.isEmpty, let row = selectedRow {
            let checks = onCheck != nil && content(row).check != nil
            if let onPreview, !checks {
                onPreview(row)
                return true
            }
            if let onCheck {
                onCheck(table.selectedRowIndexes)
                return true
            }
        }
        guard let key = event.specialKey else { return false }
        let row = table.selectedRow
        if key == .delete || key == .deleteForward || key == .backspace {
            let allowed = deletesWithCommandOnly ? modifiers == .command : modifiers.subtracting(.command).isEmpty
            guard let onDelete, !table.selectedRowIndexes.isEmpty, allowed else { return false }
            onDelete(table.selectedRowIndexes)
            return true
        }
        if modifiers.isEmpty, key == .pageDown || key == .pageUp {
            scrollPage(down: key == .pageDown)
            return true
        }
        guard modifiers.isEmpty, row >= 0 else { return false }
        let current = content(row)
        switch key {
        case .carriageReturn, .enter:
            if let onReturn, !current.isHeader {
                onReturn(row)
                return true
            }
            guard let onActivate, !current.isHeader else { return false }
            onActivate(row)
        case .rightArrow:
            switch current.disclosure {
            case .closed: onToggle?(row)
            case .open: if row + 1 < table.numberOfRows, content(row + 1).depth > current.depth { select(row + 1) }
            case .none: return false
            }
        case .leftArrow:
            if current.disclosure == .open { onToggle?(row); return true }
            guard current.depth > 0 else { return false }
            var parent = row - 1
            while parent >= 0, content(parent).depth >= current.depth { parent -= 1 }
            if parent >= 0 { select(parent) }
        default:
            return false
        }
        return true
    }

    private func scrollPage(down: Bool) {
        let clip = scrollView.contentView
        let page = max(rowHeight, clip.bounds.height - rowHeight)
        let top = -scrollView.contentInsets.top
        let bottom = max(top, table.frame.height - clip.bounds.height + scrollView.contentInsets.bottom)
        let y = min(max(clip.bounds.minY + (down ? page : -page), top), bottom)
        clip.scroll(to: NSPoint(x: clip.bounds.minX, y: y))
        scrollView.reflectScrolledClipView(clip)
    }

    private func select(_ row: Int) {
        table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        table.scrollRowToVisible(row)
    }

    func menu(at point: NSPoint) -> NSMenu? {
        let row = table.row(at: point)
        guard row >= 0 else { return nil }
        let selection = table.selectedRowIndexes
        let targets = selection.contains(row) ? selection : IndexSet(integer: row)
        guard let menu = withActions(menuForRows.map({ $0(targets) }) ?? menuForRow?(row), row: row, targets: targets) else { return nil }
        setMenuTarget(selection.contains(row) ? -1 : row)
        NotificationCenter.default.addObserver(self, selector: #selector(menuDidEndTracking(_:)),
                                               name: NSMenu.didEndTrackingNotification, object: menu)
        return menu
    }

    @objc private func menuDidEndTracking(_ notification: Notification) {
        NotificationCenter.default.removeObserver(self, name: NSMenu.didEndTrackingNotification, object: notification.object)
        setMenuTarget(-1)
    }

    private func setMenuTarget(_ row: Int) {
        menuTargetRow = row
        table.enumerateAvailableRowViews { view, index in (view as? RowCell)?.isMenuTarget = index == row }
    }
}

@MainActor
final class ListTable: NSTableView {
    weak var list: ListView?

    override var acceptsFirstResponder: Bool { list?.acceptsFocus ?? true }

    override func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        list?.updateFocus(tableIsFirstResponder: became)
        return became
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        list?.updateFocus(tableIsFirstResponder: !resigned)
        return resigned
    }

    override func keyDown(with event: NSEvent) {
        if list?.handleKey(event) == true { return }
        super.keyDown(with: event)
    }

    override func mouseDown(with event: NSEvent) {
        if list?.handleMouseDown(at: convert(event.locationInWindow, from: nil)) == true { return }
        super.mouseDown(with: event)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        list?.menu(at: convert(event.locationInWindow, from: nil))
    }

    override func accessibilityChildren() -> [Any]? {
        let visible = rows(in: visibleRect)
        return (visible.lowerBound..<visible.upperBound).compactMap { rowView(atRow: $0, makeIfNecessary: false) }
    }
}

@MainActor
private class ListDriver: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    weak var list: ListView?

    func numberOfRows(in tableView: NSTableView) -> Int { list?.rowCount() ?? 0 }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? { nil }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        let cell = tableView.makeView(withIdentifier: RowCell.identifier, owner: nil) as? RowCell ?? RowCell(frame: .zero)
        list?.configure(cell, row: row)
        return cell
    }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
        list.map { $0.selectsHeaders || !$0.content(row).isHeader } ?? false
    }

    func tableView(_ tableView: NSTableView, typeSelectStringFor tableColumn: NSTableColumn?, row: Int) -> String? {
        list?.content(row).title
    }

    func tableViewSelectionDidChange(_ notification: Notification) { list?.selectionDidChange() }
}

@MainActor
private final class VariableHeightListDriver: ListDriver {
    @objc(tableView:heightOfRow:)
    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
        list?.heightOfRow?(row) ?? tableView.rowHeight
    }
}
