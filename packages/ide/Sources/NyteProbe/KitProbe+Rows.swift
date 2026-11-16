import AppKit
@testable import NyteUI

extension KitCheck {
    static let changesFile = (name: "ChangesModel.swift", folder: "Sources/NyteChanges")
    static let narrowRow: CGFloat = 256
    static let wideRow: CGFloat = 480

    func rowParts() {
        var code = RowContent(title: "func Run() {")
        code.monospace = true
        code.syntax = CodeColors.ranges(in: code.title, language: "go")
        code.emphasis = [NSRange(location: 0, length: 4)]
        let keywordInk = dominantInk(code, columns: 16..<44)
        expect("Row syntax: a matched keyword keeps its syntax colour and only gains weight",
               keywordInk.map { $0.red > $0.green + 0.2 } ?? false, "\(String(describing: keywordInk))")

        var changed = RowContent(title: Self.changesFile.name, detail: Self.changesFile.folder, leading: .symbol("doc", .secondary))
        changed.diff = (added: 128, removed: 14)
        changed.status = GitChange.modified.status
        let narrow = changed.fitted(width: Self.narrowRow), wide = changed.fitted(width: Self.wideRow)
        expect("Width priority: the folder goes before the counts, which stay in a narrow row",
               narrow.detail.isEmpty && narrow.showsCounts && wide.detail == Self.changesFile.folder && wide.showsCounts,
               "\(narrow) / \(wide)")
        var signature = RowContent(title: "submit", detail: "(message: string, attachments: File[])", meta: "Promise<void>")
        signature.detailShort = "(...)"
        let fitted = signature.fitted(width: Self.narrowRow)
        expect("Width priority: a detail takes its short form before it truncates, and the title stays whole",
               fitted.detail == "(...)" && !fitted.titleTruncated, "\(fitted)")

        let cell = RowCell(frame: NSRect(x: 0, y: 0, width: 160, height: Metric.row))
        cell.content = RowContent(title: "a title far too long to fit in a hundred and sixty points of row")
        let truncated = cell.toolTipText
        cell.content.toolTip = "func send(message: string): Promise<void>"
        let own = cell.toolTipText
        cell.content = RowContent(title: "short")
        expect("Row tooltip: a truncated title offers its full text; a host's own tooltip wins; a short title has none",
               truncated == "a title far too long to fit in a hundred and sixty points of row"
                   && own == "func send(message: string): Promise<void>" && cell.toolTipText == nil)
    }

    func dominantInk(_ row: RowContent, columns: Range<Int>) -> (red: CGFloat, green: CGFloat)? {
        let size = NSSize(width: 200, height: Metric.row)
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap),
              let appearance = NSAppearance(named: .aqua) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.cgContext.translateBy(x: 0, y: size.height)
        context.cgContext.scaleBy(x: 1, y: -1)
        appearance.performAsCurrentDrawingAppearance {
            RowRenderer.draw(row, in: NSRect(origin: .zero, size: size), scale: 1, state: RowRenderer.State(), appearance: appearance)
        }
        NSGraphicsContext.restoreGraphicsState()
        let strongest = columns.flatMap { x in (0..<bitmap.pixelsHigh).compactMap { bitmap.colorAt(x: x, y: $0) } }
            .max { $0.alphaComponent < $1.alphaComponent }
        return strongest.map { ($0.redComponent, $0.greenComponent) }
    }

    func groupHeaderStyling() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 200))
        let list = ListView()
        let rows: [RowContent] = (0..<120).map { row in
            guard row % 40 == 0 else { return RowContent(title: "Problem \(row)", depth: 1) }
            var file = RowContent(title: "hub\(row / 40).go", detail: "internal/server", leading: .symbol("doc", .secondary),
                                  disclosure: .open)
            file.isGroupHeader = true
            return file
        }
        list.rowCount = { rows.count }
        list.content = { rows[$0] }
        list.pinsGroupHeaders = true
        window.place(list, at: .zero, size: NSSize(width: 320, height: 200))
        list.reload()
        list.layoutSubtreeIfNeeded()
        list.scrollHeaderToTop(45)
        let pinned = list.pinnedHeader
        expect("Pinned groups: a group header pins with the row's own styling, not a section label's",
               pinned?.isHidden == false && pinned?.cell.content.title == "hub1.go" && pinned?.cell.content.isHeader == false)
        list.selectedRow = 39
        list.moveSelection(by: 1)
        expect("Pinned groups: a group header is an ordinary selectable row", list.selectedRow == 40)
        window.close()
    }
}
