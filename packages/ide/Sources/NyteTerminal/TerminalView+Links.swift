import AppKit
import NyteCore
import NyteUI

extension TerminalView {
    enum ResolvedLink: Equatable {
        case url(URL)
        case file(FileLocation)
    }

    struct HoverLink: Equatable {
        let row: Int
        let columns: Range<Int>
        let target: ResolvedLink
    }

    func updateLinkHover(at windowPoint: NSPoint, commandDown: Bool) {
        guard commandDown, let place = cell(at: windowPoint), let (text, columns) = rowText(place.row) else { return clearHover() }
        let hit = TerminalLinks.detect(in: text).lazy.map { link in (link, Self.columns(of: link.range, in: columns)) }
            .first { $0.1.contains(place.column) }
        guard let (link, span) = hit else { return clearHover() }
        if let hoverLink, hoverLink.row == place.row, hoverLink.columns == span { return }
        hoverRequest += 1
        let request = hoverRequest
        switch link.target {
        case let .url(text):
            guard let url = URL(string: text) else { return clearHover() }
            show(HoverLink(row: place.row, columns: span, target: .url(url)))
        case let .file(path, line, column):
            guard let url = TerminalLinks.resolve(path, against: linkDirectory) else { return clearHover() }
            let position = TextPosition(line: max((line ?? 1) - 1, 0), column: max((column ?? 1) - 1, 0))
            let hover = HoverLink(row: place.row, columns: span, target: .file(FileLocation(url: url, range: TextSpan(at: position))))
            Task {
                let exists = await TerminalLinks.existingFile(at: url)
                guard request == hoverRequest else { return }
                if exists { show(hover) } else { clearHover() }
            }
        }
    }

    func openHoveredLink() -> Bool {
        guard let hoverLink else { return false }
        onOpenLink?(hoverLink.target)
        return true
    }

    func clearHover() {
        hoverRequest += 1
        guard let current = hoverLink else { return }
        hoverLink = nil
        invalidate(rowRect(current.row))
        (mouseTracking ? NSCursor.arrow : NSCursor.iBeam).set()
    }

    private func show(_ hover: HoverLink) {
        if let current = hoverLink { invalidate(rowRect(current.row)) }
        hoverLink = hover
        invalidate(rowRect(hover.row))
        NSCursor.pointingHand.set()
    }

    private func cell(at windowPoint: NSPoint) -> (column: Int, row: Int)? {
        let point = convert(windowPoint, from: nil)
        guard bounds.contains(point) else { return nil }
        let column = Int(((point.x - Self.padding.width) / metrics.cellWidth).rounded(.down))
        let row = Int(((point.y - Self.padding.height) / metrics.cellHeight).rounded(.down))
        guard column >= 0, row >= 0, row < layouts.count else { return nil }
        return (column, row)
    }

    private func rowText(_ row: Int) -> (String, [Int])? {
        guard let source = layouts[safe: row]??.source else { return nil }
        var units: [UInt16] = []
        var columns: [Int] = []
        var column = 0
        for cluster in source.clusterStart.indices {
            let start = Int(source.clusterColumn[cluster])
            while column < start {
                units.append(0x20)
                columns.append(column)
                column += 1
            }
            for unit in source.text[source.utf16Range(first: cluster, count: 1)] {
                units.append(unit)
                columns.append(start)
            }
            column = start + Int(source.clusterWidth[cluster])
        }
        return (String(decoding: units, as: UTF16.self), columns)
    }

    private static func columns(of range: Range<Int>, in columns: [Int]) -> Range<Int> {
        guard range.lowerBound < columns.count, range.upperBound > 0 else { return 0 ..< 0 }
        return columns[range.lowerBound] ..< columns[min(range.upperBound, columns.count) - 1] + 1
    }
}
