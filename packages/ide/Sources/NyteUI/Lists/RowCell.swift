import AppKit

@MainActor
public final class RowCell: NSTableRowView, NSViewToolTipOwner {
    static let identifier = NSUserInterfaceItemIdentifier("NyteRowCell")

    public enum Geometry {
        public static var inset: CGFloat { Metric.rowInset }
        public static var padding: CGFloat { Metric.rowInset }
        public static let indent = Space.x3
        public static let chevron = Glyph.xs.rawValue
        public static let chevronGap = Space.x1
        public static let icon = Glyph.md.rawValue
        public static let check = Metric.checkbox
        public static let gap = Space.x15
        public static let lane = Space.x3
        public static let trailingGap = Space.x3
        public static var badgeHeight: CGFloat { Size.xxs.height }
        public static let treeIndent = chevron + chevronGap

        public static func leading(_ row: RowContent) -> CGFloat {
            inset + padding + CGFloat(row.depth) * (row.layout == .tree ? treeIndent : indent)
        }

        public static func titleX(_ row: RowContent) -> CGFloat {
            leading(row) + (row.layout == .tree ? treeIndent + icon + gap : 0)
        }

        public static func titleRoom(_ row: RowContent, width: CGFloat) -> CGFloat {
            let rowEnd = width - inset - padding
            let lanes = (row.status == nil ? 0 : 1) + (row.changeDot == nil ? 0 : 1)
            let end = lanes == 0 ? rowEnd : rowEnd - CGFloat(lanes) * (lane + Space.x1) - trailingGap
            return end - titleX(row)
        }

        @MainActor public static func height(_ row: RowContent, width: CGFloat) -> CGFloat {
            RowRenderer.wrappedHeight(row, width: width)
        }
    }

    public var content = RowContent() {
        didSet {
            needsDisplay = true
            setAccessibilityLabel(content.accessibilityLabel ?? content.title)
            let checked = content.check.map { $0 == .on ? "Checked" : ($0 == .mixed ? "Partly checked" : "Not checked") }
            let changes = content.diff.map { "\($0.added) added, \($0.removed) removed" } ?? ""
            let value = [checked ?? "", content.number, taskWords, content.detail, content.value, content.badge?.text ?? "", changes, content.meta,
                         content.description, content.descriptionMeta]
                .filter { !$0.isEmpty }.joined(separator: ", ")
            setAccessibilityValue(value.isEmpty ? nil : value)
            setAccessibilityDisclosureLevel(content.depth)
            setAccessibilityDisclosed(content.disclosure == .open)
            setAccessibilityCustomActions(content.actions.isEmpty ? nil : content.actions.enumerated().map { index, action in
                NSAccessibilityCustomAction(name: action.label) { [weak self] in
                    guard let self, let onAction else { return false }
                    onAction(index)
                    return true
                }
            })
            updateTicker()
            needsLayout = true
        }
    }

    var onAction: ((Int) -> Void)?
    var numberColumn: CGFloat = 0 { didSet { if numberColumn != oldValue { needsDisplay = true } } }
    var hoveredAction: Int? { didSet { if hoveredAction != oldValue { needsDisplay = true } } }
    var pressedAction: Int? { didSet { if pressedAction != oldValue { needsDisplay = true } } }

    var showsActions: Bool {
        !content.actions.isEmpty && (isHovering || (isSelected && focus != .none))
    }

    var actionRects: [NSRect] { showsActions ? RowRenderer.actionRects(content, in: bounds) : [] }

    func action(at point: NSPoint) -> Int? {
        actionRects.firstIndex { $0.contains(point) }
    }

    private var ticker: Timer?
    private lazy var gate = FrameGate(self) { [weak self] in self?.updateTicker() }

    private var taskWords: String {
        guard case let .mark(.task(status)) = content.leading, content.badge == nil else { return "" }
        return TaskMark.words[status] ?? ""
    }

    private func updateTicker() {
        var moving = false
        if case let .mark(.task(status)) = content.leading { moving = TaskMark.isMoving(status) }
        guard moving, gate.isOpen, Motion.duration(Motion.spinnerFrame) > 0 else {
            ticker?.invalidate()
            ticker = nil
            return
        }
        guard ticker == nil else { return }
        let timer = Timer(timeInterval: Motion.spinnerFrame, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.needsDisplay = true }
        }
        timer.tolerance = Motion.instant / 2
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    override public func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        gate.viewDidMoveToWindow()
    }

    override public func viewDidHide() {
        super.viewDidHide()
        updateTicker()
    }

    override public func viewDidUnhide() {
        super.viewDidUnhide()
        updateTicker()
    }

    var isHovering = false {
        didSet {
            guard isHovering != oldValue else { return }
            if !isHovering { hoveredAction = nil }
            needsDisplay = true
        }
    }
    var isMenuTarget = false { didSet { if isMenuTarget != oldValue { needsDisplay = true } } }
    var showsGuides = false { didSet { if showsGuides != oldValue { needsDisplay = true } } }
    enum Focus { case none, driven, focused }
    static let focusWidth = Space.x05

    var focus = Focus.none { didSet { if focus != oldValue { needsDisplay = true } } }
    var reservesDisclosure = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        identifier = Self.identifier
        canDrawSubviewsIntoLayer = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }
    override public var isEmphasized: Bool { get { false } set {} }
    override public var interiorBackgroundStyle: NSView.BackgroundStyle { .normal }

    override public func isAccessibilityElement() -> Bool { true }
    override public func accessibilityRole() -> NSAccessibility.Role? { .row }
    override public func accessibilityIndex() -> Int { (superview as? NSTableView)?.row(for: self) ?? -1 }
    override public func isAccessibilitySelected() -> Bool { isSelected }

    var disclosureRect: NSRect {
        guard content.disclosure != .none else { return .zero }
        return NSRect(x: leadingX - Space.x1, y: 0, width: Geometry.chevron + Space.x1 * 2, height: bounds.height)
    }

    var checkRect: NSRect {
        guard content.check != nil else { return .zero }
        let reserves = content.disclosure != .none || reservesDisclosure
        let x = leadingX + (reserves ? Geometry.chevron + Geometry.chevronGap : 0)
        return NSRect(x: x - Space.x1, y: 0, width: Geometry.check + Space.x1 * 2, height: bounds.height)
    }

    private var leadingX: CGFloat { Geometry.leading(content) }

    override public func drawBackground(in dirtyRect: NSRect) {
        if isMenuTarget, !isSelected {
            Draw.ring(fillRect(merged: (false, false)), radius: Radius.control, color: Palette.focus, width: Self.focusWidth)
        }
        guard isHovering, !isSelected, !content.isHeader || content.disclosure != .none else { return }
        Draw.fill(fillRect(merged: (false, false)), radius: Radius.control, color: Palette.fillTertiary)
    }

    override public func drawSelection(in dirtyRect: NSRect) {
        let table = superview as? NSTableView
        let row = table?.row(for: self) ?? -1
        let above = row > 0 && table?.isRowSelected(row - 1) == true
        let below = row >= 0 && table.map { row + 1 < $0.numberOfRows && $0.isRowSelected(row + 1) } == true
        let rect = fillRect(merged: (above, below))
        let radius = Radius.control
        let radii = CornerRadii(
            topLeft: above ? 0 : radius, topRight: above ? 0 : radius,
            bottomLeft: below ? 0 : radius, bottomRight: below ? 0 : radius
        )
        Palette.fillSecondary.setFill()
        Shape.rounded(rect, radii: radii, flipped: true).fill()
        guard focus == .focused else { return }
        let edge = Palette.focus
        let width = Self.focusWidth
        var ring = rect.insetBy(dx: width / 2, dy: width / 2)
        if above { ring.origin.y -= width; ring.size.height += width }
        if below { ring.size.height += width }
        let inner = CornerRadii(
            topLeft: max(0, radii.topLeft - width / 2), topRight: max(0, radii.topRight - width / 2),
            bottomLeft: max(0, radii.bottomLeft - width / 2), bottomRight: max(0, radii.bottomRight - width / 2)
        )
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(rect: rect).addClip()
        let path = Shape.rounded(ring, radii: inner, flipped: true)
        path.lineWidth = width
        edge.setStroke()
        path.stroke()
        NSGraphicsContext.restoreGraphicsState()
    }

    override public func drawSeparator(in dirtyRect: NSRect) {}

    override public func layout() {
        super.layout()
        removeAllToolTips()
        let slots = RowRenderer.actionRects(content, in: bounds)
        guard let first = slots.first else {
            addToolTip(bounds, owner: self, userData: nil)
            return
        }
        addToolTip(NSRect(x: bounds.minX, y: bounds.minY, width: first.minX - bounds.minX, height: bounds.height), owner: self, userData: nil)
        for slot in slots { addToolTip(slot, owner: self, userData: nil) }
    }

    var toolTipText: String? {
        if let own = content.toolTip { return own }
        let fit = content.fitted(width: bounds.width, reservesDisclosure: reservesDisclosure, numberColumn: numberColumn,
                                 showsActions: showsActions)
        return fit.titleTruncated ? content.title : nil
    }

    public func view(_ view: NSView, stringForToolTip tag: NSView.ToolTipTag, point: NSPoint,
                     userData data: UnsafeMutableRawPointer?) -> String {
        if let index = action(at: point) {
            let action = content.actions[index]
            return action.key.isEmpty ? action.label : "\(action.label)  \(KeyLabel.text(action.key, action.modifiers))"
        }
        return toolTipText ?? ""
    }

    private func fillRect(merged: (above: Bool, below: Bool)) -> NSRect {
        var rect = bounds.insetBy(dx: Geometry.inset, dy: 0)
        if !merged.above { rect.origin.y += Space.hair; rect.size.height -= Space.hair }
        if !merged.below { rect.size.height -= Space.hair }
        return rect
    }

    override public func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        RowRenderer.draw(content, in: bounds, scale: window?.backingScaleFactor ?? 2, state: RowRenderer.State(
            selected: isSelected, hovered: isHovering, reservesDisclosure: reservesDisclosure, showsGuides: showsGuides,
            numberColumn: numberColumn, showsActions: showsActions, hoveredAction: hoveredAction, pressedAction: pressedAction
        ), appearance: effectiveAppearance)
    }
}
