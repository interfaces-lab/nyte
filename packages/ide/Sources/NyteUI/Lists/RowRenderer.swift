import AppKit

@MainActor
enum RowRenderer {
    struct State {
        var selected = false
        var hovered = false
        var reservesDisclosure = false
        var showsGuides = false
        var numberColumn: CGFloat = 0
        var showsActions = false
        var hoveredAction: Int?
        var pressedAction: Int?
    }

    typealias Geometry = RowCell.Geometry

    static let ringSide = Glyph.xs.rawValue
    static let kindSide = Glyph.sm.rawValue
    static let progressStart: CGFloat = 90
    static let progressSweep: CGFloat = 270
    static let chipOutset = Space.x05
    static let ageColumn = Space.x8
    static let costColumn = Space.x8 + Space.x3
    static let diffColumn = Space.x8 * 2 + Space.x2
    static let roomForDescriptionMeta = RowContent.roomForColumns
    static let labelStyle = TextStyle.sm

    @discardableResult
    static func draw(_ row: RowContent, in bounds: NSRect, scale: CGFloat, state: State, appearance: NSAppearance) -> RowFit {
        let titleStyle = titleStyle(row)
        let titleFont = titleStyle.font(row.isHeader ? .medium : row.titleWeight)
        let twoLine = !row.description.isEmpty
        let lineCenter = lineCenter(row, bounds: bounds)
        let showsActions = state.showsActions && !row.actions.isEmpty
        let baseline = snap(lineCenter + (titleFont.ascender + titleFont.descender) / 2, scale)

        var x = Geometry.leading(row)
        if row.layout == .tree {
            if state.showsGuides, !state.selected { drawGuides(depth: row.depth, height: bounds.height) }
            if row.disclosure != .none { drawChevron(row.disclosure, x: x, center: lineCenter, state: state) }
            x += Geometry.treeIndent
            _ = drawLeading(row.leading, slot: NSRect(x: x, y: lineCenter - Geometry.icon / 2, width: Geometry.icon,
                                                      height: Geometry.icon), appearance: appearance)
            x += Geometry.icon + Geometry.gap
        } else if row.disclosure != .none || state.reservesDisclosure {
            if row.disclosure != .none { drawChevron(row.disclosure, x: x, center: lineCenter, state: state) }
            x += Geometry.chevron + Geometry.chevronGap
        }
        if let check = row.check {
            Checkbox.drawBox(check, in: NSRect(x: x, y: (lineCenter - Geometry.check / 2).rounded(), width: Geometry.check,
                                               height: Geometry.check))
            x += Geometry.check + Geometry.gap
        }
        if row.layout == .list, drawLeading(row.leading, slot: NSRect(x: x, y: lineCenter - Geometry.icon / 2, width: Geometry.icon,
                                                 height: Geometry.icon), appearance: appearance) {
            x += Geometry.icon + Geometry.gap
        }
        if !row.number.isEmpty, state.numberColumn > 0 {
            let font = titleStyle.tabularFont()
            let width = ceil((row.number as NSString).size(withAttributes: [.font: font]).width)
            let columnEnd = x + state.numberColumn
            line(row.number, x: max(x, columnEnd - width), maxX: columnEnd, baseline: baseline, font: font, ink: Palette.contentSecondary)
            x = columnEnd + numberGap
        }

        if row.showsRuleAbove {
            Palette.strokeQuaternary.setFill()
            NSRect(x: bounds.minX + Geometry.inset, y: bounds.minY, width: bounds.width - Geometry.inset * 2,
                   height: Metric.hairline).fill()
        }
        let rowEnd = bounds.width - Geometry.inset - Geometry.padding
        let narrow = bounds.width < roomForDescriptionMeta
        let columns = row.alignsFacts || (row.diff != nil || !row.descriptionMeta.isEmpty) && !narrow
        let fit = fit(row, width: bounds.width, reservesDisclosure: state.reservesDisclosure, numberColumn: state.numberColumn,
                      showsActions: showsActions)
        var end = row.marksFollowTitle ? rowEnd : drawStatus(row, end: rowEnd, baseline: baseline, center: lineCenter)
        if showsActions {
            let rects = actionRects(row, in: bounds)
            for (index, action) in row.actions.enumerated() where index < rects.count {
                drawAction(action, in: rects[index], hovered: state.hoveredAction == index, pressed: state.pressedAction == index,
                           onSelected: state.selected)
            }
            end = (rects.first?.minX ?? end) - Geometry.gap
        } else if twoLine, !row.descriptionWraps {
            end = drawBadge(row, end: end, baseline: baseline, center: lineCenter, compact: narrow)
        } else if columns {
            end = drawMeta(fit.meta, ink: row.metaInk.color, end: end, baseline: baseline, column: ageColumn, row: row)
            if !row.alignsFacts { end = drawBadge(row, end: end, baseline: baseline, center: lineCenter, compact: narrow) }
        } else {
            end = drawBadge(row, end: end, baseline: baseline, center: lineCenter, compact: narrow)
            end = drawMeta(fit.meta, ink: row.metaInk.color, end: end, baseline: baseline, column: 0, row: row)
        }
        if fit.showsSecondaryMeta, !showsActions {
            end = drawMeta(row.descriptionMeta, ink: row.metaInk.color, end: end, baseline: baseline, column: costColumn)
        }
        if fit.showsCounts, !showsActions { end = drawDiff(row.diff, end: end, baseline: baseline, columns: columns) }
        if row.alignsFacts, !showsActions, !twoLine || row.descriptionWraps {
            end = drawBadge(row, end: end, baseline: baseline, center: lineCenter, compact: narrow)
        }
        let textEnd = end < rowEnd ? end + Geometry.gap - Geometry.trailingGap : end

        var titleInk = row.isHeader ? Palette.contentSecondary : row.titleInk.color
        if state.selected, row.titleInk == .secondary { titleInk = Palette.contentPrimary }
        let titleWidth = drawTitle(row, font: titleFont, ink: titleInk, x: x, maxX: min(textEnd, x + fit.titleWidth),
                                   baseline: baseline, lineCenter: lineCenter, style: titleStyle)
        var cursor = x + titleWidth
        if row.marksFollowTitle, statusWidth(row) > 0 {
            cursor += Geometry.gap
            _ = drawStatus(row, end: cursor + statusWidth(row), baseline: baseline, center: lineCenter)
            cursor += statusWidth(row)
        }
        let detailFont = titleStyle.font()
        let detailGap = row.isHeader ? Geometry.gap : (row.detailJoinsTitle ? 0 : row.detailGap)
        let detailWidth = max(0, min(textEnd - cursor - detailGap, fit.detailWidth))
        let detail: String = switch row.detailTruncation {
        case .tail, .middle: fit.detail
        case .path: fittedPath(fit.detail, width: detailWidth, font: detailFont)
        case .keepingExtension: RowContent.fit(fit.detail, width: detailWidth, font: detailFont, truncation: row.detailTruncation)
        }
        let detailBreak: NSLineBreakMode = row.detailTruncation == .tail ? .byTruncatingTail : .byTruncatingMiddle
        var drawnDetail: CGFloat = 0
        if !detail.isEmpty, detailWidth > 0 {
            cursor += detailGap
            drawnDetail = line(detail, x: cursor, maxX: min(textEnd, cursor + detailWidth), baseline: baseline, font: detailFont,
                               ink: row.detailInk.color, truncation: detailBreak)
            cursor += drawnDetail
        }
        var drawnValue = false
        if fit.showsValue, !row.value.isEmpty, cursor + Space.x1 < textEnd {
            cursor += Space.x1
            let value = styled(row.value, syntax: row.valueSyntax, style: titleStyle, ink: row.valueInk.color,
                               truncation: row.valueTruncation)
            drawnValue = drawStyled(value, x: cursor, maxX: textEnd, baseline: baseline, font: detailFont) > 0
        }
        let drawn = RowFit(titleWidth: titleWidth, titleTruncated: titleWidth < titleNatural(row, font: titleFont, style: titleStyle),
                           detail: drawnDetail > 0 ? fit.detail : "", detailWidth: drawnDetail, meta: fit.meta,
                           showsSecondaryMeta: fit.showsSecondaryMeta, showsCounts: fit.showsCounts, showsValue: drawnValue)

        guard twoLine else { return drawn }
        if row.descriptionWraps {
            let top = lineCenter + titleStyle.lineHeight / 2
            wrapped(row).draw(with: NSRect(x: x, y: top, width: max(0, rowEnd - x), height: max(0, bounds.height - top)),
                              options: [.usesLineFragmentOrigin])
            return drawn
        }
        let descriptionStyle = descriptionStyle(row)
        let small = descriptionStyle.font()
        let second = snap(lineCenter + titleStyle.lineHeight / 2 + descriptionStyle.lineHeight / 2
            + (small.ascender + small.descender) / 2, scale)
        var secondEnd = rowEnd
        if showsActions {
            secondEnd = actionRects(row, in: bounds).first?.minX ?? rowEnd
        } else {
            secondEnd = drawMeta(row.meta, ink: row.metaInk.color, end: rowEnd, baseline: second, column: ageColumn, row: row)
            secondEnd = drawMeta(row.descriptionMeta, ink: row.metaInk.color, end: secondEnd, baseline: second, column: costColumn)
            secondEnd = drawDiff(row.diff, end: secondEnd, baseline: second, columns: true)
        }
        let description = styled(row.description, syntax: row.descriptionSyntax, style: descriptionStyle, ink: row.descriptionInk.color,
                                 truncation: .byTruncatingTail)
        drawStyled(description, x: x, maxX: secondEnd < rowEnd ? secondEnd + Geometry.gap - Geometry.trailingGap : rowEnd,
                   baseline: second, font: small)
        return drawn
    }

    static func styled(_ text: String, syntax: [(range: NSRange, color: SyntaxColor)], style: TextStyle, ink: NSColor,
                       truncation: NSLineBreakMode) -> NSAttributedString {
        let paragraph = truncation == .byTruncatingMiddle ? truncatingMiddle : truncating
        let out = NSMutableAttributedString(string: text, attributes: [.font: style.font(), .foregroundColor: ink, .paragraphStyle: paragraph])
        let whole = NSRange(location: 0, length: out.length)
        for token in syntax {
            let range = NSIntersectionRange(token.range, whole)
            guard range.length > 0 else { continue }
            out.addAttribute(.foregroundColor, value: token.color.color, range: range)
            if token.color == .comment { out.addAttribute(.font, value: style.slantedFont(), range: range) }
        }
        return out
    }

    @discardableResult
    private static func drawStyled(_ text: NSAttributedString, x: CGFloat, maxX: CGFloat, baseline: CGFloat, font: NSFont) -> CGFloat {
        guard text.length > 0, maxX > x else { return 0 }
        let width = min(ceil(text.size().width), maxX - x)
        text.draw(with: NSRect(x: x, y: baseline - font.ascender, width: width, height: ceil(font.ascender - font.descender)),
                  options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
        return width
    }

    static func lineCenter(_ row: RowContent, bounds: NSRect) -> CGFloat {
        let titleStyle = titleStyle(row)
        guard !row.description.isEmpty else { return bounds.height / 2 }
        if row.descriptionWraps { return wrapPadding(titleStyle) + titleStyle.lineHeight / 2 }
        return (bounds.height - titleStyle.lineHeight - TextStyle.sm.lineHeight) / 2 + titleStyle.lineHeight / 2
    }

    static let numberGap = Space.x2
    static var actionSide: CGFloat { Size.xs.height }
    static let actionGap = Space.x05

    static func actionRects(_ row: RowContent, in bounds: NSRect) -> [NSRect] {
        guard !row.actions.isEmpty else { return [] }
        let status = statusWidth(row)
        let rowEnd = bounds.width - Geometry.inset - Geometry.padding
        let end = status > 0 ? rowEnd - status : rowEnd + Space.x1
        let center = !row.description.isEmpty && !row.descriptionWraps ? bounds.height / 2 : lineCenter(row, bounds: bounds)
        let top = (center - actionSide / 2).rounded()
        let count = CGFloat(row.actions.count)
        let start = end - count * actionSide - (count - 1) * actionGap
        return row.actions.indices.map { index in
            NSRect(x: start + CGFloat(index) * (actionSide + actionGap), y: top, width: actionSide, height: actionSide)
        }
    }

    private static func drawAction(_ action: RowContent.Action, in rect: NSRect, hovered: Bool, pressed: Bool, onSelected: Bool) {
        if pressed {
            Draw.fill(rect, radius: Size.xs.radius, color: Palette.fillPrimary)
        } else if hovered {
            Draw.fill(rect, radius: Size.xs.radius, color: onSelected ? Palette.fillPrimary : Palette.fillSecondary)
        }
        guard let image = Symbol.image(action.symbol, glyph: .sm) else { return }
        Draw.glyph(image, centeredIn: rect, ink: hovered || pressed ? Palette.contentPrimary : Palette.contentSecondary)
    }

    static func wrapPadding(_ titleStyle: TextStyle) -> CGFloat {
        (Metric.rowDouble - titleStyle.lineHeight - TextStyle.sm.lineHeight) / 2
    }

    static func wrappedHeight(_ row: RowContent, width: CGFloat) -> CGFloat {
        let titleStyle = titleStyle(row)
        guard !row.description.isEmpty else { return Metric.row }
        guard row.descriptionWraps else { return Metric.rowDouble }
        var x = Geometry.leading(row)
        if row.layout == .tree {
            x += Geometry.icon + Geometry.gap
        } else {
            if row.disclosure != .none { x += Geometry.chevron + Geometry.chevronGap }
            if case .none = row.leading {} else { x += Geometry.icon + Geometry.gap }
        }
        if row.check != nil { x += Geometry.check + Geometry.gap }
        let room = max(1, width - Geometry.inset - Geometry.padding - x)
        let box = wrapped(row).boundingRect(with: NSSize(width: room, height: CGFloat.greatestFiniteMagnitude),
                                            options: [.usesLineFragmentOrigin])
        let lineHeight = descriptionStyle(row).lineHeight
        return (wrapPadding(titleStyle) * 2 + titleStyle.lineHeight + max(lineHeight, box.height.rounded(.up))).rounded(.up)
    }

    static func descriptionStyle(_ row: RowContent) -> TextStyle { row.descriptionMonospace ? .codeSmall : .sm }

    static func wrapped(_ row: RowContent) -> NSAttributedString {
        let style = descriptionStyle(row)
        let text = NSMutableAttributedString(attributedString: styled(row.description, syntax: row.descriptionSyntax, style: style,
                                                                      ink: row.descriptionInk.color, truncation: .byWordWrapping))
        text.addAttribute(.paragraphStyle, value: style.paragraph(lineBreak: .byWordWrapping), range: NSRange(location: 0, length: text.length))
        return text
    }

    private static func drawChevron(_ disclosure: RowContent.Disclosure, x: CGFloat, center: CGFloat, state: State) {
        let name = disclosure == .open ? "chevron.down" : "chevron.right"
        guard let image = Symbol.image(name, glyph: .xxs, weight: .semibold) else { return }
        let ink = state.hovered || state.selected ? Palette.contentTertiary : Palette.contentQuaternary
        Draw.glyph(image, centeredIn: NSRect(x: x, y: center - Geometry.chevron / 2, width: Geometry.chevron,
                                             height: Geometry.chevron), ink: ink)
    }

    private static func drawLeading(_ leading: RowContent.Leading, slot: NSRect, appearance: NSAppearance) -> Bool {
        switch leading {
        case .none:
            return false
        case let .symbol(name, ink):
            if let image = Symbol.image(name, glyph: .md) { Draw.glyph(image, centeredIn: slot, ink: ink.color) }
        case let .image(image):
            image.draw(in: slot, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        case let .tinted(image, ink):
            guard let context = NSGraphicsContext.current?.cgContext else { break }
            context.beginTransparencyLayer(in: slot, auxiliaryInfo: nil)
            image.draw(in: slot, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            ink.setFill()
            slot.fill(using: .sourceAtop)
            context.endTransparencyLayer()
        case let .mark(mark):
            drawMark(mark, in: slot)
        }
        return true
    }

    static func drawMark(_ mark: RowContent.Mark, in slot: NSRect) {
        let center = NSPoint(x: slot.midX, y: slot.midY)
        func square(_ side: CGFloat) -> NSRect {
            NSRect(x: center.x - side / 2, y: center.y - side / 2, width: side, height: side)
        }
        switch mark {
        case let .dot(tone):
            Palette.color(.contentAccent, tone: tone).setFill()
            NSBezierPath(ovalIn: square(Metric.dot)).fill()
        case let .ring(tone):
            let path = NSBezierPath(ovalIn: square(ringSide).insetBy(dx: Metric.markStroke / 2, dy: Metric.markStroke / 2))
            path.lineWidth = Metric.markStroke
            (tone == .neutral ? Palette.contentQuaternary : Palette.color(.contentAccent, tone: tone)).setStroke()
            path.stroke()
        case .progress:
            let path = NSBezierPath()
            path.appendArc(withCenter: center, radius: (ringSide - Metric.markStroke) / 2, startAngle: progressStart,
                           endAngle: progressStart + progressSweep)
            path.lineWidth = Metric.markStroke
            path.lineCapStyle = .round
            Palette.contentSecondary.setStroke()
            path.stroke()
        case let .code(letter, syntax):
            drawKind(letter, ink: syntax.color, in: square(kindSide))
        case let .task(status):
            TaskMark.draw(status, in: slot)
        }
    }

    private static func drawKind(_ letter: Character, ink: NSColor, in rect: NSRect) {
        Draw.fill(rect, radius: Radius.indicator, color: Palette.fillSecondary)
        let font = TextStyle.xs.font(.semibold)
        let text = String(letter)
        let width = Draw.width(of: text, style: .xs, weight: .semibold)
        line(text, x: (rect.midX - width / 2).rounded(), maxX: rect.maxX, baseline: (rect.midY + font.capHeight / 2).rounded(),
             font: font, ink: ink)
    }

    private static func drawGuides(depth: Int, height: CGFloat) {
        Palette.strokeTertiary.setFill()
        for level in 0 ..< depth {
            let x = Geometry.inset + Geometry.padding + CGFloat(level) * Geometry.treeIndent + Geometry.chevron / 2 - Metric.hairline / 2
            NSRect(x: x, y: 0, width: Metric.hairline, height: height).fill()
        }
    }

    private static func drawStatus(_ row: RowContent, end: CGFloat, baseline: CGFloat, center: CGFloat) -> CGFloat {
        var end = end
        if let dot = row.changeDot {
            let font = TextStyle.base.font()
            let middle = center + (font.ascender + font.descender - font.xHeight) / 2
            let lane = end - Geometry.lane / 2
            dot.setFill()
            NSBezierPath(ovalIn: NSRect(x: lane - Metric.smallDot / 2, y: middle - Metric.smallDot / 2, width: Metric.smallDot,
                                        height: Metric.smallDot)).fill()
            end -= Geometry.lane + Space.x1
        }
        if let status = row.status {
            let lane = NSRect(x: end - Geometry.lane, y: center - TextStyle.xs.lineHeight / 2, width: Geometry.lane,
                              height: TextStyle.xs.lineHeight)
            let font = TextStyle.xs.font(.semibold)
            let width = Draw.width(of: String(status.letter), style: .xs, weight: .semibold)
            line(String(status.letter), x: (lane.midX - width / 2).rounded(), maxX: lane.maxX + width, baseline: baseline,
                 font: font, ink: status.ink.color)
            end = lane.minX - Space.x1
        }
        return end
    }

    private static func drawBadge(_ row: RowContent, end: CGFloat, baseline: CGFloat, center: CGFloat,
                                  compact: Bool) -> CGFloat {
        var end = end
        if let badge = row.badge, badge.isLabel {
            let width = Draw.width(of: badge.text, style: labelStyle, weight: .medium)
            line(badge.text, x: end - width, maxX: end, baseline: baseline, font: labelStyle.font(.medium),
                 ink: Palette.color(.contentAccent, tone: badge.tone))
            return end - width - Geometry.gap
        }
        if let badge = row.badge, compact, let name = badge.symbol, let image = Symbol.image(name, glyph: .xs) {
            let slot = NSRect(x: end - Glyph.md.rawValue, y: center - Glyph.md.rawValue / 2, width: Glyph.md.rawValue,
                              height: Glyph.md.rawValue)
            Draw.glyph(image, centeredIn: slot, ink: Palette.color(.contentAccent, tone: badge.tone))
            return slot.minX - Geometry.gap
        }
        if let badge = row.badge {
            let image = badge.symbol.flatMap { Symbol.image($0, glyph: .xs) }
            let mark = image == nil ? 0 : Glyph.xs.rawValue + Space.x1
            let width = Draw.width(of: badge.text, style: .xs, weight: .medium) + Size.xs.padding * 2 + mark
            let chip = NSRect(x: end - width, y: (center - Geometry.badgeHeight / 2).rounded(), width: width,
                              height: Geometry.badgeHeight)
            let ink = Palette.color(.contentAccent, tone: badge.tone)
            Draw.fill(chip, radius: Radius.indicator, color: Palette.color(.fillTertiary, tone: badge.tone))
            if let image {
                Draw.glyph(image, centeredIn: NSRect(x: chip.minX + Size.xs.padding, y: chip.minY, width: Glyph.xs.rawValue,
                                                     height: chip.height), ink: ink)
            }
            line(badge.text, x: chip.minX + Size.xs.padding + mark, maxX: chip.maxX, baseline: baseline,
                 font: TextStyle.xs.font(.medium), ink: ink)
            end = chip.minX - Geometry.gap
        }
        return end
    }

    private static func drawMeta(_ text: String, ink: NSColor, end: CGFloat, baseline: CGFloat, column: CGFloat,
                                 row: RowContent? = nil) -> CGFloat {
        guard !text.isEmpty else { return end }
        let font = TextStyle.sm.tabularFont()
        let natural = Draw.width(of: text, style: .sm, tabular: true)
        let limit = min(natural, row?.metaMaxWidth ?? natural)
        let shown = row?.metaTruncation == .path ? fittedPath(text, width: limit, font: font) : text
        let width = min(limit, Draw.width(of: shown, style: .sm, tabular: true))
        let truncation: NSLineBreakMode = row.map { $0.metaTruncation == .tail ? .byTruncatingTail : .byTruncatingMiddle } ?? .byTruncatingTail
        line(shown, x: end - width, maxX: end, baseline: baseline, font: font, ink: ink, truncation: truncation)
        return end - max(width, column) - Geometry.gap
    }

    private static func drawDiff(_ diff: (added: Int, removed: Int)?, end: CGFloat, baseline: CGFloat, columns: Bool) -> CGFloat {
        guard let diff else { return end }
        let font = TextStyle.sm.tabularFont()
        let removed = "\u{2212}\(diff.removed)", added = "+\(diff.added)"
        let removedWidth = Draw.width(of: removed, style: .sm, tabular: true)
        let addedWidth = Draw.width(of: added, style: .sm, tabular: true)
        let pivot = columns ? end - (diffColumn - Space.x1) / 2 : end - removedWidth
        line(removed, x: pivot, maxX: pivot + removedWidth, baseline: baseline, font: font, ink: Palette.dangerInk)
        let addedEnd = pivot - Space.x1
        line(added, x: addedEnd - addedWidth, maxX: addedEnd, baseline: baseline, font: font, ink: Palette.successInk)
        return (columns ? min(end - diffColumn, addedEnd - addedWidth) : addedEnd - addedWidth) - Geometry.gap
    }

    private static func drawTitle(_ row: RowContent, font: NSFont, ink: NSColor, x: CGFloat, maxX: CGFloat,
                                  baseline: CGFloat, lineCenter: CGFloat, style: TextStyle) -> CGFloat {
        guard isStyledTitle(row) else {
            switch row.titleTruncation {
            case .tail: return line(row.title, x: x, maxX: maxX, baseline: baseline, font: font, ink: ink)
            case .middle: return line(row.title, x: x, maxX: maxX, baseline: baseline, font: font, ink: ink, truncation: .byTruncatingMiddle)
            case .path:
                return line(fittedPath(row.title, width: maxX - x, font: font), x: x, maxX: maxX, baseline: baseline, font: font,
                            ink: ink, truncation: .byTruncatingMiddle)
            case .keepingExtension:
                let fitted = RowContent.fit(row.title, width: maxX - x, font: font, truncation: row.titleTruncation)
                return line(fitted, x: x, maxX: maxX, baseline: baseline, font: font, ink: ink)
            }
        }
        let text = titleText(row, font: font, ink: ink, style: style)
        let length = text.length
        let whole = NSRange(location: 0, length: length)
        let removed = row.removed.map { NSIntersectionRange($0, whole) }.filter { $0.length > 0 }
        let added = row.added.map { NSIntersectionRange($0, whole) }.filter { $0.length > 0 }
        let natural = ceil(text.size().width)
        let width = max(0, min(natural, maxX - x))
        NSGraphicsContext.saveGraphicsState()
        let ellipsis = natural > width ? ceil(("\u{2026}" as NSString).size(withAttributes: [.font: font]).width) : 0
        NSBezierPath(rect: NSRect(x: x - chipOutset, y: 0, width: max(0, width - ellipsis) + chipOutset * 2,
                                  height: lineCenter * 2)).addClip()
        let chipHeight = TextStyle.baseCompact.lineHeight
        for (marked, ground) in [(removed, Palette.diffRemovedSpan), (added, Palette.diffAddedSpan)] {
            for range in marked {
                let start = text.attributedSubstring(from: NSRange(location: 0, length: range.location)).size().width
                guard start < width - ellipsis else { continue }
                let span = text.attributedSubstring(from: range).size().width
                Draw.fill(NSRect(x: x + start - chipOutset, y: lineCenter - chipHeight / 2, width: span + chipOutset * 2,
                                 height: chipHeight), radius: Radius.indicator, color: ground)
            }
        }
        NSGraphicsContext.restoreGraphicsState()
        text.addAttribute(.paragraphStyle, value: truncating, range: NSRange(location: 0, length: length))
        text.draw(with: NSRect(x: x, y: baseline - font.ascender, width: width, height: ceil(font.ascender - font.descender)),
                  options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
        return width
    }

    static func isStyledTitle(_ row: RowContent) -> Bool {
        !row.emphasis.isEmpty || !row.removed.isEmpty || !row.added.isEmpty || !row.syntax.isEmpty
    }

    static func titleText(_ row: RowContent, font: NSFont, ink: NSColor, style: TextStyle) -> NSMutableAttributedString {
        let text = NSMutableAttributedString(string: row.title, attributes: [.font: font, .foregroundColor: ink])
        let whole = NSRange(location: 0, length: text.length)
        for token in row.syntax {
            let range = NSIntersectionRange(token.range, whole)
            guard range.length > 0 else { continue }
            text.addAttribute(.foregroundColor, value: token.color.color, range: range)
            if token.color == .comment { text.addAttribute(.font, value: style.slantedFont(), range: range) }
        }
        let strong = style.font(.semibold)
        for range in row.emphasis.map({ NSIntersectionRange($0, whole) }) where range.length > 0 {
            text.addAttribute(.font, value: strong, range: range)
            if row.syntax.isEmpty { text.addAttribute(.foregroundColor, value: Palette.contentPrimary, range: range) }
        }
        for range in row.removed.map({ NSIntersectionRange($0, whole) }) where range.length > 0 {
            text.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: range)
        }
        return text
    }

    static func titleNatural(_ row: RowContent, font: NSFont, style: TextStyle) -> CGFloat {
        guard isStyledTitle(row) else { return ceil((row.title as NSString).size(withAttributes: [.font: font]).width) }
        return ceil(titleText(row, font: font, ink: Palette.contentPrimary, style: style).size().width)
    }

    @discardableResult
    private static func line(_ text: String, x: CGFloat, maxX: CGFloat, baseline: CGFloat, font: NSFont,
                             ink: NSColor, truncation: NSLineBreakMode = .byTruncatingTail) -> CGFloat {
        guard !text.isEmpty, maxX > x else { return 0 }
        let style = truncation == .byTruncatingMiddle ? truncatingMiddle : truncating
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: ink, .paragraphStyle: style]
        let string = text as NSString
        let width = min(ceil(string.size(withAttributes: attributes).width), maxX - x)
        string.draw(with: NSRect(x: x, y: baseline - font.ascender, width: width, height: ceil(font.ascender - font.descender)),
                    options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attributes)
        return width
    }

    static let ellipsis = "\u{2026}"
    static let separator: Character = "/"

    static func fittedPath(_ path: String, width: CGFloat, font: NSFont) -> String {
        let fits = { (text: String) in (text as NSString).size(withAttributes: [.font: font]).width <= width }
        guard !fits(path) else { return path }
        var parts = path.split(separator: separator, omittingEmptySubsequences: false).map(String.init)
        while parts.count > 1 {
            parts.removeFirst()
            let candidate = ellipsis + String(separator) + parts.joined(separator: String(separator))
            if fits(candidate) { return candidate }
        }
        return parts.last ?? path
    }

    private static let truncatingMiddle: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingMiddle
        return style
    }()

    private static let truncating: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingTail
        return style
    }()

    private static func snap(_ value: CGFloat, _ scale: CGFloat) -> CGFloat { (value * scale).rounded() / scale }
}
