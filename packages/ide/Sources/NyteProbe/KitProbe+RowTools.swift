import AppKit
@testable import NyteUI

extension KitCheck {
    static let stageAction = RowContent.Action("stage", symbol: "plus", label: "Stage", key: "s", modifiers: .command)
    static let discardAction = RowContent.Action("discard", symbol: "arrow.uturn.backward", label: "Discard Changes")

    func rowNumbers() {
        let window = KitProbeWindow(size: NSSize(width: 360, height: 200))
        let list = ListView()
        let numbers = ["7", "41", "1203", ""]
        var asked = 0
        list.rowCount = { numbers.count }
        list.content = { index in
            asked += 1
            var row = RowContent(title: "func send() {", depth: 1)
            row.monospace = true
            row.number = numbers[index]
            return row
        }
        window.place(list, at: .zero, size: NSSize(width: 360, height: 200))
        list.reload()
        list.layoutSubtreeIfNeeded()
        let font = TextStyle.code.tabularFont()
        let widest = ceil(("1203" as NSString).size(withAttributes: [.font: font]).width)
        expect("Row numbers: the list sizes the column from its widest value", list.numberColumn == widest, "\(list.numberColumn) vs \(widest)")
        let starts = numbers.map { number -> CGFloat in
            var row = RowContent(title: "x", depth: 1)
            row.monospace = true
            row.number = number
            return RowRenderer.titleStart(row, reservesDisclosure: false, numberColumn: list.numberColumn)
        }
        expect("Row numbers: numbered titles share one start; a row without a number keeps its own",
               Set(starts.prefix(3)).count == 1 && starts[3] < starts[0], "\(starts)")
        let ends = ["7", "1203"].map { number -> Int? in
            var row = RowContent(title: "", depth: 1)
            row.monospace = true
            row.number = number
            let state = RowRenderer.State(numberColumn: widest)
            return inkColumns(row, state: state, width: 360).max()
        }
        expect("Row numbers: right-aligned in tabular digits", ends[0] != nil && ends[0] == ends[1], "\(ends)")
        let cell = list.cell(atRow: 1)
        expect("Row numbers: the number reaches accessibility", cell?.accessibilityValue() as? String == "41",
               "\(String(describing: cell?.accessibilityValue()))")
        list.widestNumber = { "99999" }
        asked = 0
        list.reload()
        _ = list.numberColumn
        expect("Row numbers: a host's widest value replaces the scan", asked <= numbers.count && list.numberColumn > widest,
               "asked \(asked)")
        window.close()
    }

    func rowActions() {
        let window = KitProbeWindow(size: NSSize(width: 360, height: 200))
        let list = ListView()
        var fired: [(String, IndexSet)] = [], activated: [Int] = []
        list.rowCount = { 6 }
        list.content = { index in
            var row = RowContent(title: "file\(index).swift", meta: "2m")
            row.status = GitChange.modified.status
            row.actions = [Self.stageAction, Self.discardAction]
            return row
        }
        list.onAction = { fired.append(($0, $1)) }
        list.onActivate = { activated.append($0) }
        list.allowsMultipleSelection = true
        list.menuForRows = { _ in Menu.make([MenuItem("Reveal in Finder")]) }
        window.place(list, at: .zero, size: NSSize(width: 360, height: 200))
        list.reload()
        list.layoutSubtreeIfNeeded()
        guard let rest = list.cell(atRow: 2), let selected = list.cell(atRow: 4) else { return expect("Row actions: cells", false) }
        let atRest = rest.showsActions
        list.setHoveredRow(2)
        let hovered = rest.showsActions
        list.selectedRow = 4
        window.makeFirstResponder(nil)
        let unfocused = selected.showsActions
        list.focus()
        let focused = selected.showsActions
        expect("Row actions: shown on the hovered row and the selected row of a focused list, not at rest or unfocused",
               !atRest && hovered && !unfocused && focused, "\(atRest) \(hovered) \(unfocused) \(focused)")
        let fit = rest.content.fitted(width: rest.bounds.width, showsActions: true)
        expect("Row actions: they replace the meta while shown; the status stays", fit.meta.isEmpty
               && rest.content.fitted(width: rest.bounds.width).meta == "2m")
        let slots = rest.actionRects
        expect("Row actions: one slot per action, in reading order, the last clear of the status lane",
               slots.count == 2 && slots[1].minX > slots[0].maxX
                   && slots[1].maxX <= rest.bounds.width - RowCell.Geometry.inset - RowCell.Geometry.padding - RowRenderer.statusWidth(rest.content) + 1,
               "\(slots)")
        let stage = slots[0]
        expect("Row actions: a tooltip names the action and its key", rest.view(rest, stringForToolTip: 0, point: NSPoint(x: stage.midX, y: stage.midY),
                                                                                  userData: nil) == "Stage  ⌘S")
        let table = list.scrollView.documentView ?? list
        click(table, at: table.convert(NSPoint(x: stage.midX, y: stage.midY), from: rest))
        expect("Row actions: a click runs the action on that row alone and leaves the selection",
               fired.count == 1 && fired[0].0 == "stage" && fired[0].1 == [2] && list.selectedRow == 4 && activated.isEmpty,
               "\(fired) \(String(describing: list.selectedRow))")
        let discard = slots[1]
        click(table, at: table.convert(NSPoint(x: discard.midX, y: discard.midY), from: rest),
              releaseAt: table.convert(NSPoint(x: discard.midX, y: rest.bounds.maxY + Metric.row), from: rest))
        expect("Row actions: releasing off the button cancels", fired.count == 1, "\(fired.count)")
        list.selectedRows = [3, 4]
        list.focus()
        press((code: 1, text: "s"), .command, in: window)
        expect("Row actions: the host's key runs the action on the selection", fired.count == 2 && fired[1].1 == [3, 4],
               "\(fired)")
        let names = (rest.accessibilityCustomActions() ?? []).map(\.name)
        _ = rest.accessibilityCustomActions()?.last?.handler?()
        expect("Row actions: each is an accessibility action on its row", names == ["Stage", "Discard Changes"]
               && fired.last?.0 == "discard" && fired.last?.1 == [2], "\(names) \(fired)")
        let menu = list.menu(at: table.convert(NSPoint(x: rest.bounds.midX, y: rest.bounds.midY), from: rest))
        let titles = menu?.items.map(\.title) ?? []
        if let first = menu?.items.first as? RowActionItem { first.fireAction(nil) }
        expect("Row actions: the row's menu leads with them, so the keyboard reaches them",
               titles == ["Stage", "Discard Changes", "", "Reveal in Finder"] && fired.last?.0 == "stage" && fired.last?.1 == [2],
               "\(titles) \(String(describing: fired.last))")
        window.close()
    }

    func rowPreview() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 200))
        let list = ListView()
        var previewed: [Int] = [], activated: [Int] = [], checked: [IndexSet] = []
        list.rowCount = { 5 }
        list.content = { index in
            var row = RowContent(title: "Result \(index)")
            if index == 3 { row.check = .on }
            return row
        }
        list.onPreview = { previewed.append($0) }
        list.onActivate = { activated.append($0) }
        list.onCheck = { checked.append($0) }
        window.place(list, at: .zero, size: NSSize(width: 320, height: 200))
        list.reload()
        list.focus()
        list.selectedRow = 1
        press(Keys.space, in: window)
        press(Keys.returnKey, in: window)
        expect("Row preview: Space previews and Return opens", previewed == [1] && activated == [1], "\(previewed) \(activated)")
        list.selectedRow = 3
        press(Keys.space, in: window)
        expect("Row preview: Space still checks a row that has a check box", checked == [[3]] && previewed == [1])
        guard let table = list.scrollView.documentView as? NSTableView else { return expect("Row preview: table", false) }
        let row = table.rect(ofRow: 2)
        click(table, at: NSPoint(x: row.midX, y: row.midY))
        let quiet = previewed == [1]
        list.previewsOnClick = true
        click(table, at: NSPoint(x: row.midX, y: row.midY))
        expect("Row preview: a single click previews only when the host asks", quiet && previewed == [1, 2] && activated == [1],
               "\(previewed) \(activated)")
        window.close()
    }

    func changedSpans() {
        var row = RowContent(title: "h.broadcastsend <- msg", depth: 1)
        row.monospace = true
        row.removed = [NSRange(location: 2, length: 9)]
        row.added = [NSRange(location: 11, length: 4)]
        let size = NSSize(width: 320, height: Metric.row)
        guard let bitmap = renderRow(row, state: RowRenderer.State(), size: size), let appearance = NSAppearance(named: .aqua) else {
            return expect("Changed spans: render", false)
        }
        let start = RowRenderer.titleStart(row, reservesDisclosure: false)
        let font = TextStyle.code.font()
        let width = { (text: String) in (text as NSString).size(withAttributes: [.font: font]).width }
        let top = Int((size.height - TextStyle.baseCompact.lineHeight) / 2) + 1
        let removedX = Int(start + width("h.") + 2), addedX = Int(start + width("h.broadcast") + 2)
        func expected(_ role: NSColor) -> CGFloat {
            var alpha: CGFloat = 0
            appearance.performAsCurrentDrawingAppearance { alpha = role.usingColorSpace(.deviceRGB)?.alphaComponent ?? 0 }
            return alpha
        }
        let removed = bitmap.colorAt(x: removedX, y: top), added = bitmap.colorAt(x: addedX, y: top)
        let removedMatches = removed.map { abs($0.alphaComponent - expected(Palette.diffRemovedSpan)) < 0.03 && $0.redComponent > $0.greenComponent } ?? false
        let addedMatches = added.map { abs($0.alphaComponent - expected(Palette.diffAddedSpan)) < 0.03 && $0.greenComponent > $0.redComponent } ?? false
        expect("Changed spans: removed and added text sit on the diff view's span roles", removedMatches && addedMatches,
               "\(String(describing: removed)) \(String(describing: added))")
    }

    func renderRow(_ row: RowContent, state: RowRenderer.State, size: NSSize) -> NSBitmapImageRep? {
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
            RowRenderer.draw(row, in: NSRect(origin: .zero, size: size), scale: 1, state: state, appearance: appearance)
        }
        NSGraphicsContext.restoreGraphicsState()
        return bitmap
    }

    func inkColumns(_ row: RowContent, state: RowRenderer.State, width: CGFloat) -> [Int] {
        guard let bitmap = renderRow(row, state: state, size: NSSize(width: width, height: Metric.row)) else { return [] }
        return (0..<bitmap.pixelsWide).filter { x in
            (0..<bitmap.pixelsHigh).contains { (bitmap.colorAt(x: x, y: $0)?.alphaComponent ?? 0) > 0.2 }
        }
    }
}

extension ListView {
    func cell(atRow row: Int) -> RowCell? {
        (scrollView.documentView as? NSTableView)?.rowView(atRow: row, makeIfNecessary: true) as? RowCell
    }
}
