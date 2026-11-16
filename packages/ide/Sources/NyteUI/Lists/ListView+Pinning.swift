import AppKit

@MainActor
final class GroupPinning {
    private var scannedTop = -1
    private var header: Int?

    func forget() {
        scannedTop = -1
        header = nil
    }

    enum Boundary { case header, end }

    static let walkLimit = 1_024

    func header(above row: Int, boundary: (Int) -> Boundary?) -> Int? {
        defer { scannedTop = row }
        func resolve(_ found: Int?) -> Int? { found.flatMap { boundary($0) == .header ? $0 : nil } }
        if scannedTop >= 0, row >= scannedTop, row - scannedTop <= Self.walkLimit {
            if let found = stride(from: row, to: scannedTop, by: -1).first(where: { boundary($0) != nil }) { header = resolve(found) }
            return header
        }
        if scannedTop >= 0, let header, row >= header, row <= scannedTop { return header }
        header = resolve(stride(from: row, through: max(0, row - Self.walkLimit), by: -1).first { boundary($0) != nil })
        return header
    }
}

extension ListView {
    public static func header(in sortedHeaders: [Int], forRow row: Int) -> Int? {
        var low = 0, high = sortedHeaders.count
        while low < high {
            let middle = (low + high) / 2
            if sortedHeaders[middle] <= row { low = middle + 1 } else { high = middle }
        }
        return low == 0 ? nil : sortedHeaders[low - 1]
    }

    func updatePinnedHeader() {
        guard let pinning else { return }
        let count = table.numberOfRows
        let top = scrollView.contentView.bounds.minY + scrollView.contentInsets.top
        let row = count == 0 ? -1 : table.row(at: NSPoint(x: 0, y: max(top, 0)))
        let stated = groupHeader
        let boundary = { (row: Int) -> GroupPinning.Boundary? in
            if let stated {
                let header = stated(row)
                return header == row ? .header : (header == nil ? .end : nil)
            }
            let content = self.content(row)
            return content.isHeader || content.isGroupHeader ? .header : (content.endsGroup ? .end : nil)
        }
        let found = stated.map { $0(row) } ?? pinning.header(above: row, boundary: boundary)
        guard row >= 0, let header = found else {
            pinnedHeader?.isHidden = true
            return
        }
        let headerRect = table.rect(ofRow: header)
        guard headerRect.minY < top else {
            pinnedHeader?.isHidden = true
            return
        }
        var push: CGFloat = 0
        var next = row + 1
        while next < count, table.rect(ofRow: next).minY < top + headerRect.height {
            if boundary(next) != nil {
                push = table.rect(ofRow: next).minY - top - headerRect.height
                break
            }
            next += 1
        }
        let view = pinnedHeader ?? makePinnedHeader()
        view.isHidden = false
        view.row = header
        view.ground = pinnedGround
        view.cell.reservesDisclosure = isOutline
        view.cell.content = content(header)
        let inset = scrollView.contentInsets.top
        let strip = NSRect(x: 0, y: top - inset, width: table.bounds.width, height: max(0, inset + headerRect.height + push))
        view.frame = convert(strip, from: table)
        view.cell.frame = NSRect(x: 0, y: inset + push, width: strip.width, height: headerRect.height)
    }

    private func makePinnedHeader() -> PinnedHeaderView {
        let view = PinnedHeaderView()
        view.onPress = { [weak self] row in self?.scrollHeaderToTop(row) }
        addSubview(view, positioned: .above, relativeTo: scrollView)
        pinnedHeader = view
        return view
    }

    func removePinnedHeader() {
        pinnedHeader?.removeFromSuperview()
        pinnedHeader = nil
    }

    func scrollHeaderToTop(_ row: Int) {
        guard row >= 0, row < table.numberOfRows else { return }
        let clip = scrollView.contentView
        clip.scroll(to: NSPoint(x: clip.bounds.minX, y: table.rect(ofRow: row).minY - scrollView.contentInsets.top))
        scrollView.reflectScrolledClipView(clip)
    }
}

@MainActor
final class PinnedHeaderView: NSView {
    let cell = RowCell(frame: .zero)
    var row = -1
    var ground = Palette.bgBase { didSet { needsDisplay = true } }
    var onPress: ((Int) -> Void)?

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.masksToBounds = true
        addSubview(cell)
        setAccessibilityElement(false)
        cell.setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        ground.setFill()
        bounds.fill()
        Palette.strokeQuaternary.setFill()
        NSRect(x: bounds.minX, y: bounds.maxY - Metric.hairline, width: bounds.width, height: Metric.hairline).fill()
    }

    override func mouseDown(with event: NSEvent) { onPress?(row) }
}
