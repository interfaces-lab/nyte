import AppKit
@testable import NyteUI

extension KitCheck {
    static let ellipsis = "\u{2026}"

    var signatureRow: RowContent {
        var row = RowContent(title: "send", meta: "Promise<void>", leading: .mark(.code(letter: "m", semanticType: "method")))
        row.detail = "(message: string, attachments: File[])"
        row.detailShort = "(\(Self.ellipsis))"
        row.detailJoinsTitle = true
        row.metaShort = "Promise<\(Self.ellipsis)>"
        return row
    }

    func drawnFit(_ row: RowContent, width: CGFloat, state: RowRenderer.State) -> RowFit? {
        let size = NSSize(width: width, height: Metric.rowDouble)
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap),
              let appearance = NSAppearance(named: .aqua) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        var drawn: RowFit?
        appearance.performAsCurrentDrawingAppearance {
            drawn = RowRenderer.draw(row, in: NSRect(x: 0, y: 0, width: width, height: Metric.row), scale: 1, state: state,
                                     appearance: appearance)
        }
        NSGraphicsContext.restoreGraphicsState()
        return drawn
    }

    func fitMatchesDrawing() {
        var emphasised = signatureRow
        emphasised.emphasizeMatches(of: "sen")
        var changed = RowContent(title: "ChangesModel.swift", detail: "Sources/NyteChanges", meta: "2m", leading: .symbol("doc", .secondary))
        changed.status = GitChange.modified.status
        changed.badge = RowContent.Badge("staged")
        var valued = RowContent(title: "user", meta: "*main.User")
        valued.value = "= &main.User{Name: \"zelda\"}"
        let rows = [signatureRow, emphasised, changed, valued]
        var mismatches: [String] = []
        for (index, row) in rows.enumerated() {
            for width in stride(from: CGFloat(120), through: 480, by: 7) {
                let fitted = row.fitted(width: width)
                for selected in [false, true] {
                    guard let drawn = drawnFit(row, width: width, state: RowRenderer.State(selected: selected)) else { continue }
                    let same = abs(drawn.titleWidth - fitted.titleWidth) < 0.5 && drawn.titleTruncated == fitted.titleTruncated
                        && drawn.detail == fitted.detail && abs(drawn.detailWidth - fitted.detailWidth) < 0.5 && drawn.meta == fitted.meta
                        && drawn.showsValue == fitted.showsValue
                    if !same { mismatches.append("row \(index) at \(Int(width)) selected \(selected): fitted \(fitted) drawn \(drawn)") }
                }
            }
        }
        expect("Width priority: fitted equals what is drawn, selected or not, at every width", mismatches.isEmpty,
               mismatches.prefix(3).joined(separator: "\n     "))
    }

    func shortFormsFirst() {
        let row = signatureRow
        let states = stride(from: CGFloat(480), through: 100, by: -2).map { width -> String in
            let fit = row.fitted(width: width)
            let detail = fit.detail == row.detail ? "full" : fit.detail == row.detailShort ? "short" : fit.detail.isEmpty ? "none" : "cut"
            let meta = fit.meta == row.meta ? "full" : fit.meta == row.metaShort ? "short" : fit.meta.isEmpty ? "none" : "cut"
            return "\(detail)/\(meta)\(fit.titleTruncated ? "/truncated" : "")"
        }
        let observed = states.reduce(into: [String]()) { if $0.last != $1 { $0.append($1) } }
        let order = ["full/full", "short/full", "short/short", "none/short", "none/none", "none/none/truncated"]
        let inOrder = observed.allSatisfy(order.contains) && observed.map { order.firstIndex(of: $0) ?? 0 } == observed.map { order.firstIndex(of: $0) ?? 0 }.sorted()
        expect("Yield order: both short forms come before anything drops, then detail, then meta, then the title",
               inOrder && observed.contains("short/short"), "\(observed)")
        var custom = row
        custom.yieldOrder = [.meta, .detail, .title]
        let reordered = stride(from: CGFloat(480), through: 100, by: -2).map { custom.fitted(width: $0) }
        expect("Yield order: a host can reorder (meta first here)",
               reordered.contains { $0.meta.isEmpty && $0.detail == row.detail || $0.meta.isEmpty && $0.detail == row.detailShort })

        var renamed = RowContent(title: "ChangesModel.swift", leading: .symbol("doc", .secondary))
        renamed.value = "\u{2190} ChangesState.swift"
        renamed.status = GitChange.renamed.status
        let fits = stride(from: CGFloat(100), through: 480, by: 4).map { renamed.fitted(width: $0) }
        expect("Yield order: a value truncates, then gives way, before the title truncates",
               fits.allSatisfy { !$0.titleTruncated || !$0.showsValue } && fits.contains { !$0.showsValue && !$0.titleTruncated }
                   && fits.last?.showsValue == true, "\(fits.filter(\.titleTruncated).prefix(2))")
    }

    func syntaxRuns() {
        var plain = RowContent(title: "limit")
        plain.value = "= 512"
        plain.monospace = true
        var coloured = plain
        coloured.valueSyntax = CodeColors.ranges(in: coloured.value, language: "go")
        let start = Int(RowRenderer.titleStart(plain, reservesDisclosure: false)) + 50
        let valueInk = { (row: RowContent) in self.dominantInk(row, columns: start..<(start + 40)) }
        let titleInk = { (row: RowContent) in self.dominantInk(row, columns: 16..<40) }
        let valueDiffers = valueInk(plain).map { a in valueInk(coloured).map { a != $0 } ?? false } ?? false
        let titleSame = titleInk(plain).map { a in titleInk(coloured).map { a == $0 } ?? false } ?? false
        var described = RowContent(title: "user")
        described.description = "nil"
        described.descriptionMonospace = true
        let size = NSSize(width: 200, height: Metric.rowDouble)
        var tinted = described
        tinted.descriptionSyntax = [(NSRange(location: 0, length: 3), .constant)]
        let second = { (row: RowContent) -> NSColor? in
            guard let bitmap = self.renderRow(row, state: RowRenderer.State(), size: size) else { return nil }
            return (16..<60).flatMap { x in (Int(size.height / 2)..<bitmap.pixelsHigh).compactMap { bitmap.colorAt(x: x, y: $0) } }
                .max { $0.alphaComponent < $1.alphaComponent }
        }
        let descriptionDiffers = second(described).map { a in second(tinted).map { resolved(a) != resolved($0) } ?? false } ?? false
        expect("Row syntax: a value and a description take their own syntax runs; the title is untouched",
               valueDiffers && titleSame && descriptionDiffers, "\(valueDiffers) \(titleSame) \(descriptionDiffers)")
    }

    func segmentBadges() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 80))
        var files = Segmented.Segment(symbol: "folder", label: "Files")
        var changes = Segmented.Segment(symbol: "arrow.triangle.branch", label: "Changes")
        changes.badge = 11
        let control = Segmented([files, changes], size: .sm, sizing: .hug, label: "Navigator")
        window.place(control, at: .zero)
        let elevenWidth = control.intrinsicContentSize.width
        changes.badge = 88
        control.segments = [files, changes]
        let eightyEight = control.intrinsicContentSize.width
        changes.badge = 140
        control.segments = [files, changes]
        let element = control.accessibilityChildren()?.last as? NSAccessibilityElement
        expect("Segmented badge: tabular digits keep the width; past two digits reads 99+",
               elevenWidth == eightyEight && CountBadge.text(140) == "99+" && control.intrinsicContentSize.width > eightyEight,
               "\(elevenWidth) \(eightyEight) \(control.intrinsicContentSize.width)")
        expect("Segmented badge: the count is the segment's value description; the label stays the name",
               element?.accessibilityLabel() == "Changes" && element?.accessibilityValueDescription() == "99+",
               "\(String(describing: element?.accessibilityLabel())) \(String(describing: element?.accessibilityValueDescription()))")
        files.badge = 4
        control.segments = [files, changes]
        control.layoutSubtreeIfNeeded()
        let segment = control.segmentRect(1)
        let pill = control.badgeRect(140, x: segment.minX + segment.height - Segmented.badgeGap, in: segment)
        expect("Segmented badge: the pill sits inside its segment, after the glyph",
               segment.contains(pill) && pill.minX >= segment.minX + segment.height - Segmented.badgeGap, "\(segment) \(pill)")
        var titled = Segmented.Segment("Changes")
        titled.badge = 8
        titled.badgeTone = .danger
        let plain = Segmented([.init("Changes")], size: .sm, label: "Tabs").intrinsicContentSize.width
        let withBadge = Segmented([titled], size: .sm, label: "Tabs").intrinsicContentSize.width
        expect("Segmented badge: a titled segment makes room for it", withBadge >= plain + CountBadge.size(of: "8", size: .xs).width,
               "\(plain) \(withBadge)")
        window.close()
    }
}
