import AppKit

@MainActor
public final class ChipRow: NSView {
    public var chips: [Chip] = [] {
        didSet {
            oldValue.forEach { $0.removeFromSuperview() }
            for chip in chips {
                chip.translatesAutoresizingMaskIntoConstraints = true
                addSubview(chip)
            }
            overflow.dismiss()
            needsLayout = true
            invalidateIntrinsicContentSize()
        }
    }

    public var maximumLines: Int? { didSet { needsLayout = true; invalidateIntrinsicContentSize() } }
    public static let gap = Space.x1
    public static let listWidth = Space.x8 * 9
    public static let visibleRows = 8

    let more = Chip("+0")
    private let overflow = FloatingPanel(radius: Radius.control, takesKey: true)
    private let list = ListView()
    private(set) var overflowChips: [Chip] = []
    private var laidHeight: CGFloat = 0

    public init(maximumLines: Int? = nil) {
        self.maximumLines = maximumLines
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        more.translatesAutoresizingMaskIntoConstraints = true
        more.alwaysFocusable = true
        more.isHidden = true
        more.onPress = { [weak self] in self?.showOverflow() }
        addSubview(more)
        list.rowHeight = Metric.rowCompact
        list.verticalInset = Space.x1
        list.activatesOnClick = true
        list.rowCount = { [unowned self] in overflowChips.count }
        list.content = { [unowned self] in row(overflowChips[$0]) }
        list.onActivate = { [unowned self] in
            let chip = overflowChips[$0]
            overflow.dismiss()
            chip.onPress?()
        }
        list.onDelete = { [unowned self] rows in
            let removable = rows.compactMap { overflowChips.indices.contains($0) ? overflowChips[$0].onRemove : nil }
            removable.forEach { $0() }
            if overflowChips.isEmpty { overflow.dismiss() } else { list.reload() }
        }
        list.setAccessibilityLabel("More context")
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override public var isFlipped: Bool { true }

    override public var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: chips.isEmpty ? 0 : max(Chip.height, laidHeight))
    }

    override public func layout() {
        super.layout()
        var x: CGFloat = 0, line = 0
        var placed: [(Chip, NSRect)] = []
        overflowChips = []
        for (index, chip) in chips.enumerated() {
            let width = min(chip.intrinsicContentSize.width, bounds.width)
            if x > 0, x + width > bounds.width {
                line += 1
                x = 0
            }
            if let maximumLines, line >= maximumLines {
                overflowChips = Array(chips[index...])
                break
            }
            placed.append((chip, NSRect(x: x, y: CGFloat(line) * (Chip.height + Self.gap), width: width, height: Chip.height)))
            x += width + Self.gap
        }
        more.isHidden = true
        if let maximumLines, !overflowChips.isEmpty { makeRoomForMore(&placed, lastLine: maximumLines - 1) }
        let shown = Set(placed.map { ObjectIdentifier($0.0) })
        for chip in chips { chip.isHidden = !shown.contains(ObjectIdentifier(chip)) }
        for (chip, frame) in placed { chip.frame = frame }
        let lines = (placed.map(\.1.maxY).max() ?? 0)
        let height = max(lines, more.isHidden ? 0 : more.frame.maxY)
        guard height != laidHeight else { return }
        laidHeight = height
        invalidateIntrinsicContentSize()
    }

    private func makeRoomForMore(_ placed: inout [(Chip, NSRect)], lastLine: Int) {
        let lastY = CGFloat(lastLine) * (Chip.height + Self.gap)
        more.isHidden = false
        more.title = "+\(overflowChips.count)"
        while let last = placed.last, last.1.minY == lastY, last.1.maxX + Self.gap + more.intrinsicContentSize.width > bounds.width {
            overflowChips.insert(last.0, at: 0)
            placed.removeLast()
            more.title = "+\(overflowChips.count)"
        }
        let x = placed.last.map { $0.1.minY == lastY ? $0.1.maxX + Self.gap : 0 } ?? 0
        more.frame = NSRect(x: x, y: lastY, width: more.intrinsicContentSize.width, height: Chip.height)
        more.setAccessibilityLabel("\(overflowChips.count) more")
        more.toolTip = overflowChips.map(\.title).joined(separator: ", ")
    }

    private func row(_ chip: Chip) -> RowContent {
        let leading: RowContent.Leading = chip.image.map { .image($0) }
            ?? chip.symbol.map { .symbol($0, chip.symbolTone.map { .tone($0) } ?? .tertiary) } ?? .none
        var row = RowContent(title: chip.title, detail: chip.detail, leading: leading)
        row.toolTip = chip.toolTip
        return row
    }

    func showOverflow() {
        guard !overflowChips.isEmpty else { return }
        list.reload()
        overflow.content = list
        let height = CGFloat(min(overflowChips.count, Self.visibleRows)) * Metric.rowCompact + Space.x1 * 2
        overflow.show(size: NSSize(width: Self.listWidth, height: height), anchoredTo: more.frame, in: self)
        list.focus()
        list.selectedRow = 0
    }

    var isShowingOverflow: Bool { overflow.isShown }
}
