import AppKit

extension RowRenderer {
    static let shortestDetail = Space.x8 + Space.x4
    static let shortestTitle = Space.x8 * 2

    static func titleStyle(_ row: RowContent) -> TextStyle { row.monospace ? .code : (row.isHeader ? .sm : .base) }

    static func titleStart(_ row: RowContent, reservesDisclosure: Bool, numberColumn: CGFloat = 0) -> CGFloat {
        let number = row.number.isEmpty || numberColumn <= 0 ? 0 : numberColumn + numberGap
        var x = Geometry.leading(row)
        if row.layout == .tree { return x + Geometry.treeIndent + Geometry.icon + Geometry.gap + number }
        if row.disclosure != .none || reservesDisclosure { x += Geometry.chevron + Geometry.chevronGap }
        if row.check != nil { x += Geometry.check + Geometry.gap }
        if case .none = row.leading {} else { x += Geometry.icon + Geometry.gap }
        return x + number
    }

    static func actionsWidth(_ row: RowContent) -> CGFloat {
        guard !row.actions.isEmpty else { return 0 }
        let count = CGFloat(row.actions.count)
        let shift = statusWidth(row) > 0 ? 0 : Space.x1
        return count * actionSide + (count - 1) * actionGap - shift + Geometry.gap
    }

    static func statusWidth(_ row: RowContent) -> CGFloat {
        (row.changeDot == nil ? 0 : Geometry.lane + Space.x1) + (row.status == nil ? 0 : Geometry.lane + Space.x1)
    }

    static func badgeWidth(_ row: RowContent, compact: Bool) -> CGFloat {
        guard let badge = row.badge else { return 0 }
        if badge.isLabel { return Draw.width(of: badge.text, style: labelStyle, weight: .medium) + Geometry.gap }
        if compact, let name = badge.symbol, Symbol.image(name, glyph: .xs) != nil { return Glyph.md.rawValue + Geometry.gap }
        let mark = badge.symbol.flatMap { Symbol.image($0, glyph: .xs) } == nil ? 0 : Glyph.xs.rawValue + Space.x1
        return Draw.width(of: badge.text, style: .xs, weight: .medium) + Size.xs.padding * 2 + mark + Geometry.gap
    }

    static func countsWidth(_ diff: (added: Int, removed: Int)?, columns: Bool) -> CGFloat {
        guard let diff else { return 0 }
        guard !columns else { return diffColumn + Geometry.gap }
        return Draw.width(of: "+\(diff.added)", style: .sm, tabular: true) + Space.x1
            + Draw.width(of: "\u{2212}\(diff.removed)", style: .sm, tabular: true) + Geometry.gap
    }

    static func metaWidth(_ text: String, row: RowContent?, column: CGFloat) -> CGFloat {
        guard !text.isEmpty else { return 0 }
        let natural = Draw.width(of: text, style: .sm, tabular: true)
        return max(min(natural, row?.metaMaxWidth ?? natural), column) + Geometry.gap
    }

    static func fit(_ row: RowContent, width: CGFloat, reservesDisclosure: Bool, numberColumn: CGFloat = 0,
                    showsActions: Bool = false) -> RowFit {
        let showsActions = showsActions && !row.actions.isEmpty
        let twoLine = !row.description.isEmpty
        let oneLine = !twoLine
        let titleLine = oneLine || row.descriptionWraps
        let narrow = width < roomForDescriptionMeta
        let columns = row.alignsFacts || (row.diff != nil || !row.descriptionMeta.isEmpty) && !narrow
        let start = titleStart(row, reservesDisclosure: reservesDisclosure, numberColumn: numberColumn)
        let rowEnd = width - Geometry.inset - Geometry.padding
        let fixed = statusWidth(row) + (showsActions ? actionsWidth(row) : badgeWidth(row, compact: narrow))
        let style = titleStyle(row)
        let titleFont = style.font(row.isHeader ? .medium : row.titleWeight)
        let detailFont = style.font()
        let measure = { (text: String, font: NSFont) in ceil((text as NSString).size(withAttributes: [.font: font]).width) }

        var fit = RowFit(titleWidth: titleNatural(row, font: titleFont, style: style), titleTruncated: false, detail: row.detail,
                         detailWidth: row.detail.isEmpty ? 0 : measure(row.detail, detailFont),
                         meta: titleLine && !showsActions ? row.meta : "",
                         showsSecondaryMeta: oneLine && !showsActions && !row.descriptionMeta.isEmpty,
                         showsCounts: oneLine && !showsActions && row.diff != nil, showsValue: !row.value.isEmpty)
        for (part, threshold) in row.showsFrom where width < threshold {
            switch part {
            case .counts: fit.showsCounts = false
            case .meta, .metaShort: fit.meta = ""
            case .secondaryMeta: fit.showsSecondaryMeta = false
            case .value: fit.showsValue = false
            case .detail, .detailShort:
                fit.detail = ""
                fit.detailWidth = 0
            case .title: break
            }
        }
        let detailGap = row.detail.isEmpty ? 0 : (row.isHeader ? Geometry.gap : (row.detailJoinsTitle ? 0 : row.detailGap))
        var valueWidth = row.value.isEmpty ? 0
            : Space.x1 + ceil(styled(row.value, syntax: row.valueSyntax, style: style, ink: Palette.contentPrimary,
                                     truncation: row.valueTruncation).size().width)
        func trailing() -> CGFloat {
            let parts = fixed + metaWidth(fit.meta, row: row, column: columns ? ageColumn : 0)
                + (fit.showsSecondaryMeta ? metaWidth(row.descriptionMeta, row: nil, column: costColumn) : 0)
                + (fit.showsCounts ? countsWidth(row.diff, columns: columns) : 0)
            return parts > 0 ? parts + Geometry.trailingGap - Geometry.gap : 0
        }
        func overflow() -> CGFloat {
            fit.titleWidth + (fit.detailWidth > 0 ? detailGap + fit.detailWidth : 0) + (fit.showsValue ? valueWidth : 0) + trailing()
                - (rowEnd - start)
        }
        func shortenDetail() {
            guard fit.detailWidth > 0, !row.detailShort.isEmpty else { return }
            let short = measure(row.detailShort, detailFont)
            guard short < fit.detailWidth else { return }
            fit.detail = row.detailShort
            fit.detailWidth = short
        }
        func shortenMeta() {
            guard !fit.meta.isEmpty, !row.metaShort.isEmpty else { return }
            fit.meta = row.metaShort
        }
        for part in row.yieldOrder where overflow() > 0 {
            switch part {
            case .detailShort:
                shortenDetail()
            case .metaShort:
                shortenMeta()
            case .detail:
                guard fit.detailWidth > 0 else { continue }
                shortenDetail()
                let excess = overflow()
                guard excess > 0 else { continue }
                let left = fit.detailWidth - excess
                fit.detailWidth = left >= shortestDetail ? left : 0
                if fit.detailWidth == 0 { fit.detail = "" }
            case .meta:
                guard !fit.meta.isEmpty else { continue }
                shortenMeta()
                if overflow() <= 0 { continue }
                fit.meta = ""
            case .value:
                guard fit.showsValue else { continue }
                let left = valueWidth - overflow()
                if left >= shortestDetail + Space.x1 { valueWidth = left } else { fit.showsValue = false }
            case .secondaryMeta:
                fit.showsSecondaryMeta = false
            case .counts:
                fit.showsCounts = false
            case .title:
                let floor = min(fit.titleWidth, shortestTitle)
                let shortened = max(floor, fit.titleWidth - overflow())
                fit.titleTruncated = fit.titleTruncated || shortened < fit.titleWidth
                fit.titleWidth = shortened
            }
        }
        let excess = overflow()
        if excess > 0 {
            fit.titleWidth = max(0, fit.titleWidth - excess)
            fit.titleTruncated = true
        }
        return fit
    }
}
