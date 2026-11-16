import AppKit

@MainActor
struct TableGrid {
    let width: CGFloat
    let columns: [CGFloat]
    let rows: [CGFloat]
    let columnStarts: [CGFloat]
    let rowStarts: [CGFloat]
    let cells: [NSAttributedString]
    let columnCount: Int
    let aligns: [MarkdownDocument.Align]
    let lineHeight: CGFloat

    static let gap = Space.x4
    static let maxColumn: CGFloat = 360
    static let readableColumn: CGFloat = 200
    static let scrollColumn: CGFloat = 960

    var totalWidth: CGFloat { (columnStarts.last ?? 0) + (columns.last ?? 0) }
    var height: CGFloat { (rowStarts.last ?? 0) + (rows.last ?? 0) }
    var padding: CGFloat { max(0, (Metric.row - lineHeight) / 2) }
    var rowCount: Int { rows.count }
    var overflows: Bool { totalWidth > width + Metric.hairline }

    init(document: MarkdownDocument, leaf: Int, style: MarkdownStyle, width: CGFloat) {
        self.width = width
        lineHeight = style.body.lineHeight
        let cellRange = document.infos[leaf]
        let count = max(1, Int(document.values[leaf]))
        columnCount = count
        let body = style.body
        let made: [NSAttributedString] = cellRange.map { cell in
            let header = document.cellRows[cell] == 0
            let text = MarkdownInline.attributed(document, range: document.cellRanges[cell], spans: document.cellSpans[cell],
                                                 text: body, weight: header ? .medium : .regular, ink: style.ink)
            let paragraph = body.paragraph(alignment: Self.alignment(document.cellAligns[cell]))
            text.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: text.length))
            return text
        }
        cells = made
        aligns = cellRange.prefix(count).map { document.cellAligns[$0] }
        var natural = [CGFloat](repeating: 0, count: count)
        let lines = made.map(CellMeasure.line)
        for index in made.indices {
            natural[index % count] = max(natural[index % count], min(lines[index], Self.maxColumn))
        }
        let room = max(0, width - CGFloat(count - 1) * Self.gap)
        var words = [CGFloat](repeating: 0, count: count)
        if natural.reduce(0, +) > room {
            for (index, cell) in made.enumerated() { words[index % count] = max(words[index % count], Self.longestWord(cell)) }
        }
        let least = zip(natural, words).map { whole, word in min(whole, word) }
        let widths: [CGFloat]
        if natural.reduce(0, +) <= room {
            widths = natural
        } else {
            let shared = least.reduce(0, +) < room ? Self.share(room, natural: natural, least: least) : least
            let readable = zip(shared, natural).allSatisfy { given, whole in given >= min(whole, Self.readableColumn) || given * 2 >= whole }
            widths = readable ? shared : zip(natural, lines.indices.reduce(into: [CGFloat](repeating: 0, count: count)) { widest, index in
                widest[index % count] = max(widest[index % count], min(lines[index], Self.scrollColumn))
            }).map { max($0, $1) }
        }
        columns = widths
        columnStarts = widths.indices.map { column in widths.prefix(column).reduce(0, +) + CGFloat(column) * Self.gap }
        let rowCount = (made.count + count - 1) / count
        let pad = max(0, (Metric.row - body.lineHeight) / 2)
        let heights = (0 ..< rowCount).map { row in
            var tallest = body.lineHeight
            for column in 0 ..< count {
                let index = row * count + column
                guard index < made.count, lines[index] > widths[column] else { continue }
                tallest = max(tallest, CellMeasure.size(made[index], width: widths[column]).height)
            }
            return tallest + pad * 2
        }
        rows = heights
        var offset: CGFloat = 0
        rowStarts = heights.map { height in
            defer { offset += height }
            return offset
        }
    }

    static func share(_ room: CGFloat, natural: [CGFloat], least: [CGFloat]) -> [CGFloat] {
        var widths = least
        var spare = room - least.reduce(0, +)
        var open = Array(natural.indices)
        for column in natural.indices.sorted(by: { natural[$0] < natural[$1] }) {
            let want = natural[column] - least[column]
            let others = open.filter { $0 != column }.count
            guard want <= spare / CGFloat(max(1, others + 1)) || others == 0 else { break }
            let granted = min(want, spare)
            widths[column] += granted
            spare -= granted
            open.removeAll { $0 == column }
        }
        let slack = open.reduce(0) { $0 + natural[$1] - least[$1] }
        guard slack > 0 else { return widths }
        for column in open {
            widths[column] += (spare * (natural[column] - least[column]) / slack).rounded(.down)
        }
        return widths
    }

    static func longestWord(_ cell: NSAttributedString) -> CGFloat {
        let string = cell.string as NSString
        var widest: CGFloat = 0
        string.enumerateSubstrings(in: NSRange(location: 0, length: string.length), options: .byWords) { _, range, _, _ in
            widest = max(widest, CellMeasure.line(cell.attributedSubstring(from: range)))
        }
        return widest + MarkdownStyle.chipPadding * 2
    }

    static func alignment(_ align: MarkdownDocument.Align) -> NSTextAlignment {
        switch align {
        case .natural, .left: .natural
        case .center: .center
        case .right: .right
        }
    }

    static func plain(_ document: MarkdownDocument, leaf: Int) -> String {
        let count = max(1, Int(document.values[leaf]))
        let cells = document.infos[leaf].map { document.string(document.cellRanges[$0]) }
        return stride(from: 0, to: cells.count, by: count).map { cells[$0 ..< min(cells.count, $0 + count)].joined(separator: "\t") }
            .joined(separator: "\n")
    }

    func cellRect(_ index: Int) -> NSRect {
        let row = index / columnCount
        let column = index % columnCount
        return NSRect(x: columnStarts[column], y: rowStarts[row], width: columns[column], height: rows[row])
    }

    func rows(in rect: NSRect) -> Range<Int> {
        let first = rowStarts.partition { $0 > rect.minY }
        let last = rowStarts.partition { $0 >= rect.maxY }
        return max(0, first - 1) ..< max(0, last)
    }

    func cellText(_ index: Int) -> String { cells[index].string.replacingOccurrences(of: MarkdownInline.lead, with: "") }
}

private extension Array where Element == CGFloat {
    func partition(_ above: (CGFloat) -> Bool) -> Int {
        var low = 0
        var high = count
        while low < high {
            let middle = (low + high) / 2
            if above(self[middle]) { high = middle } else { low = middle + 1 }
        }
        return low
    }
}

@MainActor
enum CellMeasure {
    private static let storage = NSTextStorage()
    private static let manager = NSLayoutManager()
    private static let container: NSTextContainer = {
        let container = NSTextContainer(size: .zero)
        container.lineFragmentPadding = 0
        manager.addTextContainer(container)
        storage.addLayoutManager(manager)
        return container
    }()

    static func line(_ text: NSAttributedString) -> CGFloat {
        var chipped = false
        text.enumerateAttribute(.nyteInlineCode, in: NSRange(location: 0, length: text.length)) { value, _, stop in
            guard value != nil else { return }
            chipped = true
            stop.pointee = true
        }
        guard !chipped else { return size(text, width: nil).width + Metric.hairline }
        return CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(text), nil, nil, nil)).rounded(.up) + Metric.hairline
    }

    static func size(_ text: NSAttributedString, width: CGFloat?) -> CGSize {
        container.size = NSSize(width: width ?? CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        storage.setAttributedString(text)
        manager.ensureLayout(for: container)
        let used = manager.usedRect(for: container)
        return CGSize(width: used.width.rounded(.up), height: used.height.rounded(.up))
    }
}

@MainActor
final class TablePanel: NSView {
    private let scroll = SideScroll()
    private let canvas = TableCanvas()
    var onLink: ((String) -> Void)? {
        get { canvas.onLink }
        set { canvas.onLink = newValue }
    }
    var markdown: (() -> String)?
    private var plain = ""
    private var rowElements: [NSAccessibilityElement]?

    init() {
        super.init(frame: .zero)
        scroll.documentView = canvas
        scroll.onScroll = { [weak self] offset in self?.canvas.pin = offset }
        addSubview(scroll)
        setAccessibilityElement(true)
        setAccessibilityRole(.table)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    var grid: TableGrid? { canvas.grid }

    func show(_ grid: TableGrid, plain: String) {
        self.plain = plain
        canvas.grid = grid
        rowElements = nil
        setAccessibilityLabel("Table, \(grid.rowCount) rows, \(grid.columnCount) columns")
        setAccessibilityRowCount(grid.rowCount)
        setAccessibilityColumnCount(grid.columnCount)
        needsLayout = true
    }

    override func accessibilityRows() -> [Any]? { elements() }
    override func accessibilityChildren() -> [Any]? { elements() }

    private func elements() -> [NSAccessibilityElement] {
        if let rowElements { return rowElements }
        guard let grid else { return [] }
        let made = MarkdownAccess.rows(grid, parent: self, origin: .zero, space: AccessSpace(flippedHeight: bounds.height))
        rowElements = made
        return made
    }

    override func layout() {
        super.layout()
        if scroll.frame != bounds { rowElements = nil }
        scroll.frame = bounds
        guard let grid = canvas.grid else { return }
        canvas.frame = NSRect(x: 0, y: 0, width: max(bounds.width, grid.totalWidth), height: grid.height)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        Menu.make([
            MenuItem("Copy") { [weak self] in MarkdownPasteboard.write(plain: self?.plain ?? "", markdown: self?.markdown?()) },
            MenuItem("Copy as Markdown") { [weak self] in MarkdownPasteboard.write(plain: self?.markdown?() ?? "", markdown: nil) },
        ])
    }
}

@MainActor
final class TableCanvas: NSView {
    var grid: TableGrid? { didSet { needsDisplay = true } }
    var pin: CGFloat = 0 {
        didSet {
            guard pin != oldValue else { return }
            needsDisplay = true
            window?.invalidateCursorRects(for: self)
        }
    }
    var onLink: ((String) -> Void)?
    private static let storage = NSTextStorage()
    private static let manager = ProseLayoutManager()
    private static let container: NSTextContainer = {
        let container = NSTextContainer(size: .zero)
        container.lineFragmentPadding = 0
        manager.addTextContainer(container)
        storage.addLayoutManager(manager)
        return container
    }()

    override var isFlipped: Bool { true }

    private var held: CGFloat { pin > 0 && (grid?.columnCount ?? 0) > 1 ? pin : 0 }

    func shown(_ rect: NSRect, column: Int) -> NSRect { column == 0 ? rect.offsetBy(dx: held, dy: 0) : rect }

    override func draw(_ dirtyRect: NSRect) {
        guard let grid else { return }
        let width = max(bounds.width, grid.totalWidth)
        let rows = grid.rows(in: dirtyRect)
        for row in rows where row < grid.rowCount - 1 {
            (row == 0 ? Palette.strokeTertiary : Palette.strokeQuaternary).setFill()
            NSRect(x: dirtyRect.minX, y: grid.rowStarts[row] + grid.rows[row] - Metric.hairline,
                   width: min(width, dirtyRect.width), height: Metric.hairline).fill()
        }
        let edge = held + (grid.columns.first ?? 0) + TableGrid.gap / 2
        NSGraphicsContext.saveGraphicsState()
        if held > 0 { NSRect(x: edge, y: dirtyRect.minY, width: max(0, dirtyRect.maxX - edge), height: dirtyRect.height).clip() }
        for row in rows {
            for column in (held > 0 ? 1 : 0) ..< grid.columnCount { drawCell(row * grid.columnCount + column, grid: grid, dirty: dirtyRect) }
        }
        NSGraphicsContext.restoreGraphicsState()
        guard held > 0 else { return }
        for row in rows { drawCell(row * grid.columnCount, grid: grid, dirty: dirtyRect) }
        Palette.strokeQuaternary.setFill()
        NSRect(x: edge - Metric.hairline, y: dirtyRect.minY, width: Metric.hairline, height: dirtyRect.height).fill()
    }

    private func drawCell(_ index: Int, grid: TableGrid, dirty: NSRect) {
        guard index < grid.cells.count else { return }
        let rect = shown(grid.cellRect(index), column: index % grid.columnCount)
        guard rect.intersects(dirty) else { return }
        let glyphs = lay(grid.cells[index], width: rect.width)
        let origin = NSPoint(x: rect.minX, y: rect.minY + grid.padding)
        Self.manager.drawBackground(forGlyphRange: glyphs, at: origin)
        Self.manager.drawGlyphs(forGlyphRange: glyphs, at: origin)
    }

    private func lay(_ text: NSAttributedString, width: CGFloat) -> NSRange {
        Self.container.size = NSSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        Self.storage.setAttributedString(text)
        Self.manager.ensureLayout(for: Self.container)
        return Self.manager.glyphRange(for: Self.container)
    }

    func cell(at point: NSPoint) -> Int? {
        guard let grid else { return nil }
        let row = grid.rows(in: NSRect(x: point.x, y: point.y, width: 0, height: 0)).lowerBound
        guard row < grid.rowCount else { return nil }
        return (0 ..< grid.columnCount).map { row * grid.columnCount + $0 }.first { index in
            index < grid.cells.count && shown(grid.cellRect(index), column: index % grid.columnCount).contains(point)
        }
    }

    private func link(at point: NSPoint) -> String? {
        guard let grid, let index = cell(at: point) else { return nil }
        let rect = shown(grid.cellRect(index), column: index % grid.columnCount)
        _ = lay(grid.cells[index], width: rect.width)
        let local = NSPoint(x: point.x - rect.minX, y: point.y - rect.minY - grid.padding)
        var fraction: CGFloat = 0
        let glyph = Self.manager.glyphIndex(for: local, in: Self.container, fractionOfDistanceThroughGlyph: &fraction)
        guard Self.manager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: Self.container).contains(local) else {
            return nil
        }
        let character = Self.manager.characterIndexForGlyph(at: glyph)
        guard character < Self.storage.length else { return nil }
        return Self.storage.attribute(.link, at: character, effectiveRange: nil) as? String
    }

    override func mouseUp(with event: NSEvent) {
        guard let target = link(at: convert(event.locationInWindow, from: nil)) else { return super.mouseUp(with: event) }
        onLink?(target)
    }

    override func mouseDown(with event: NSEvent) {
        if link(at: convert(event.locationInWindow, from: nil)) == nil { super.mouseDown(with: event) }
    }

    override func resetCursorRects() {
        guard let grid else { return }
        for row in grid.rows(in: visibleRect) {
            for column in 0 ..< grid.columnCount {
                let index = row * grid.columnCount + column
                guard index < grid.cells.count else { continue }
                let rect = shown(grid.cellRect(index), column: column)
                _ = lay(grid.cells[index], width: rect.width)
                Self.storage.enumerateAttribute(.link, in: NSRange(location: 0, length: Self.storage.length)) { value, range, _ in
                    guard value != nil else { return }
                    let glyphs = Self.manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                    let box = Self.manager.boundingRect(forGlyphRange: glyphs, in: Self.container)
                    addCursorRect(box.offsetBy(dx: rect.minX, dy: rect.minY + grid.padding), cursor: .pointingHand)
                }
            }
        }
    }
}

@MainActor
enum MarkdownTable {
    static func attributed(_ document: MarkdownDocument, leaf: Int, style: MarkdownStyle, indent: CGFloat,
                           before: CGFloat) -> NSMutableAttributedString {
        let count = max(1, Int(document.values[leaf]))
        let table = NSTextTable()
        table.numberOfColumns = count
        table.layoutAlgorithm = .automaticLayoutAlgorithm
        table.collapsesBorders = true
        table.hidesEmptyCells = false
        table.setWidth(indent, type: .absoluteValueType, for: .margin, edge: .minX)
        table.setWidth(before, type: .absoluteValueType, for: .margin, edge: .minY)
        let cells = Array(document.infos[leaf])
        let lastRow = cells.last.map { document.cellRows[$0] } ?? 0
        var natural = [CGFloat](repeating: 0, count: count)
        let vertical = max(0, (Metric.row - style.body.lineHeight) / 2)
        let out = NSMutableAttributedString()
        for (index, cell) in cells.enumerated() {
            let row = document.cellRows[cell]
            let column = index % count
            let block = NSTextTableBlock(table: table, startingRow: Int(row), rowSpan: 1, startingColumn: column, columnSpan: 1)
            block.setWidth(column == 0 ? 0 : TableGrid.gap / 2, type: .absoluteValueType, for: .padding, edge: .minX)
            block.setWidth(column == count - 1 ? 0 : TableGrid.gap / 2, type: .absoluteValueType, for: .padding, edge: .maxX)
            block.setWidth(vertical, type: .absoluteValueType, for: .padding, edge: .minY)
            block.setWidth(vertical, type: .absoluteValueType, for: .padding, edge: .maxY)
            if row < lastRow {
                block.setWidth(Metric.hairline, type: .absoluteValueType, for: .border, edge: .maxY)
                block.setBorderColor(row == 0 ? Palette.strokeTertiary : Palette.strokeQuaternary, for: .maxY)
            }
            let text = MarkdownInline.attributed(document, range: document.cellRanges[cell], spans: document.cellSpans[cell],
                                                 text: style.body, weight: row == 0 ? .medium : .regular, ink: style.ink)
            natural[column] = max(natural[column], min(CellMeasure.line(text), TableGrid.maxColumn))
            if text.length == 0 { text.append(NSAttributedString(string: "\u{200B}", attributes: style.body.attributes(style.ink))) }
            let paragraph = style.body.paragraph(alignment: TableGrid.alignment(document.cellAligns[cell])).mutableCopy()
                as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
            paragraph.textBlocks = [block]
            if index < cells.count - 1 { text.append(NSAttributedString(string: "\n", attributes: style.body.attributes(style.ink))) }
            text.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: text.length))
            out.append(text)
        }
        out.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: out.length)) { value, _, _ in
            guard let block = (value as? NSParagraphStyle)?.textBlocks.first as? NSTextTableBlock, block.startingColumn < count - 1 else { return }
            block.setValue(natural[block.startingColumn], type: .absoluteValueType, for: .width)
        }
        return out
    }
}
