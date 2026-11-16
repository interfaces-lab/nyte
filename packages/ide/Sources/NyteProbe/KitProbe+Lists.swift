import AppKit
@testable import NyteUI

extension KitCheck {
    static let rows = 100_000

    func lists() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 240))
        let list = ListView()
        var activated: [Int] = [], toggled: [Int] = [], selected = 0, menuRows = IndexSet()
        list.rowCount = { Self.rows }
        list.content = { RowContent(title: "Row \($0)") }
        list.onActivate = { activated.append($0) }
        list.onSelect = { _ in selected += 1 }
        list.menuForRows = { menuRows = $0; return Menu.make([MenuItem("Reveal")]) }
        list.allowsMultipleSelection = true
        window.place(list, at: .zero, size: NSSize(width: 320, height: 240))
        list.reload()
        guard let table = list.scrollView.documentView as? NSTableView else { return expect("ListView: a table inside", false) }
        table.layoutSubtreeIfNeeded()
        let before = (views: viewCount(list), layers: layerCount(list))
        list.focus()
        press(Keys.down, in: window)
        press(Keys.down, in: window)
        expect("ListView: Down selects then moves", list.selectedRow == 1, "\(String(describing: list.selectedRow))")
        press(Keys.up, in: window)
        expect("ListView: Up moves back", list.selectedRow == 0)
        let outline = { (table.rowView(atRow: 0, makeIfNecessary: false) as? RowCell)?.focus }
        let focusedOutline = outline(), _ = window.makeFirstResponder(nil), unfocusedOutline = outline(), _ = list.focus()
        expect("ListView: only a focused list's selection carries the accent outline", focusedOutline == .focused && unfocusedOutline == RowCell.Focus.none)
        press(Keys.end, in: window)
        table.layoutSubtreeIfNeeded()
        expect("ListView: End scrolls to the last row", table.rows(in: table.visibleRect).contains(Self.rows - 1))
        press(Keys.home, in: window)
        expect("ListView: Home scrolls to the first row", table.rows(in: table.visibleRect).contains(0))
        press(Keys.pageDown, in: window)
        spin()
        expect("ListView: Page Down scrolls a page", table.visibleRect.minY > 0, "\(table.visibleRect) selected \(String(describing: list.selectedRow))")
        press(Keys.pageUp, in: window)
        press(Keys.down, [.shift], in: window)
        expect("ListView: Shift-Down extends the selection", list.selectedRows == IndexSet(0...1), "\(Array(list.selectedRows))")
        let third = table.rect(ofRow: 3)
        click(table, at: NSPoint(x: third.midX, y: third.midY), modifiers: .command)
        expect("ListView: Command-click adds a row", list.selectedRows == IndexSet([0, 1, 3]), "\(Array(list.selectedRows))")
        list.selectedRow = 5
        selected = 0
        list.reload()
        expect("ListView: selection survives reload without a select callback", list.selectedRow == 5 && selected == 0)
        press(Keys.returnKey, in: window)
        expect("ListView: Return activates the selected row", activated == [5], "\(activated)")
        let rightClick = { (row: Int) in table.menu(for: self.mouse(.rightMouseDown, at: NSPoint(x: third.midX, y: table.rect(ofRow: row).midY), in: table)) }
        let outlined = { (row: Int) in (table.rowView(atRow: row, makeIfNecessary: true) as? RowCell)?.isMenuTarget == true }
        let menu = rightClick(3), outlinedWhileOpen = outlined(3), targetedOutside = menuRows
        NotificationCenter.default.post(name: NSMenu.didEndTrackingNotification, object: menu)
        expect("ListView: a right-click outside the selection targets and outlines that row until the menu closes",
               targetedOutside == [3] && outlinedWhileOpen && !outlined(3) && list.selectedRow == 5, "\(Array(targetedOutside))")
        _ = rightClick(5)
        expect("ListView: a right-click on the selection targets the selection, with no extra outline", menuRows == [5] && !outlined(5))
        for row in [Self.rows / 2, Self.rows - 1, 0] {
            list.scrollRowToVisible(row)
            table.layoutSubtreeIfNeeded()
        }
        let after = (views: viewCount(list), layers: layerCount(list))
        expect("ListView: \(Self.rows) rows scroll without views or layers per row",
               after.views <= before.views + 4 && after.layers <= before.layers + 4, "views \(before.views) to \(after.views), layers \(before.layers) to \(after.layers)")
        print("     list of \(Self.rows): \(after.views) views, \(after.layers) layers after scrolling end to end")
        let rowElements = (table.accessibilityChildren() ?? []).compactMap { $0 as? NSView }
        let describe = { (row: NSView) in
            "\(row.accessibilityIndex()) \(row.accessibilityRole()?.rawValue ?? "") \(row.accessibilityLabel() ?? "") \(row.isAccessibilitySelected() ? 1 : 0)"
        }
        expect("ListView: visible rows are accessibility children with index, label and selected state",
               !rowElements.isEmpty && rowElements.count < 30 && rowElements.map(describe).contains("5 AXRow Row 5 1"),
               rowElements.prefix(3).map(describe).joined(separator: "; ") + " of \(rowElements.count)")

        let tree: [RowContent] = [RowContent(title: "Sources", disclosure: .open), RowContent(title: "alpha.swift", depth: 1),
                                  RowContent(title: "beta.swift", depth: 1), RowContent(title: "Tests", disclosure: .closed)]
        list.isOutline = true
        list.rowCount = { tree.count }
        list.content = { tree[$0] }
        list.onToggle = { toggled.append($0) }
        list.reload()
        list.selectedRow = 2
        press(Keys.left, in: window)
        expect("ListView: Left on a child selects its parent", list.selectedRow == 0)
        press(Keys.left, in: window)
        list.selectedRow = 3
        press(Keys.right, in: window)
        expect("ListView: Left collapses an open row and Right expands a closed one", toggled == [0, 3], "\(toggled)")
        list.selectedRow = 0
        press((code: UInt16(11), text: "b"), in: window)
        expect("ListView: typing selects the row that starts with it", list.selectedRow == 2, "\(String(describing: list.selectedRow))")
        window.close()
    }

    func rowHeights() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 240))
        let list = ListView()
        var asked = Set<Int>()
        list.rowCount = { Self.rows }
        list.content = { RowContent(title: "Row \($0)") }
        list.heightOfRow = { asked.insert($0); return Metric.row }
        window.place(list, at: .zero, size: NSSize(width: 320, height: 240))
        list.reload()
        list.layoutSubtreeIfNeeded()
        print("     NSTableView asked \(asked.count) of \(Self.rows) row heights on reload and first layout")
        expect("ListView: variable heights are asked for (measured above)", !asked.isEmpty)
        window.close()
    }
}

extension KitCheck {
    static let groupSize = 1_000

    func pinnedGroups() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 240))
        let list = ListView()
        list.rowCount = { Self.rows }
        list.content = { $0 % Self.groupSize == 0 ? .header("Group \($0 / Self.groupSize)") : RowContent(title: "Row \($0)") }
        window.place(list, at: .zero, size: NSSize(width: 320, height: 240))
        list.reload()
        list.layoutSubtreeIfNeeded()
        let before = (views: viewCount(list), layers: layerCount(list))
        list.pinsGroupHeaders = true
        list.scrollHeaderToTop(0)
        expect("Pinned groups: nothing is pinned while the header is in place, and no view exists yet", list.pinnedHeader == nil)
        list.scrollHeaderToTop(Self.groupSize + 5)
        let pinned = list.pinnedHeader
        expect("Pinned groups: a scrolled-off header stays pinned under the top edge", pinned?.isHidden == false
               && pinned?.row == Self.groupSize && pinned?.cell.content.title == "Group 1" && pinned?.frame.maxY == list.bounds.maxY,
               "\(String(describing: pinned?.row)) \(String(describing: pinned?.frame)) in \(list.bounds)")
        let rowHeight = list.rect(ofRow: 0).height
        list.scrollHeaderToTop(2 * Self.groupSize - 1)
        let clip = list.scrollView.contentView
        clip.scroll(to: NSPoint(x: 0, y: clip.bounds.minY + rowHeight / 2))
        list.scrollView.reflectScrolledClipView(clip)
        expect("Pinned groups: the next header pushes the pinned one out", pinned?.row == Self.groupSize
               && (pinned?.frame.height ?? 0) == rowHeight / 2, "\(String(describing: pinned?.frame))")
        for row in [Self.rows / 2 + 3, Self.rows - 1, 7, Self.rows / 3] { list.scrollHeaderToTop(row) }
        let after = (views: viewCount(list), layers: layerCount(list))
        print("     pinned groups: views \(before.views) to \(after.views), layers \(before.layers) to \(after.layers)")
        expect("Pinned groups: one reused view; \(Self.rows) rows stay within the view and layer budget",
               after.views <= before.views + 4 && after.layers <= before.layers + 4,
               "views \(before.views) to \(after.views), layers \(before.layers) to \(after.layers)")
        list.scrollHeaderToTop(Self.rows / 3 + 9)
        if let pinned { click(pinned) }
        let top = clip.bounds.minY + list.scrollView.contentInsets.top
        expect("Pinned groups: clicking the pinned header scrolls to the real one",
               top == list.table.rect(ofRow: Self.rows / 3 / Self.groupSize * Self.groupSize).minY && pinned?.isHidden == true, "\(top)")
        list.pinsGroupHeaders = false
        expect("Pinned groups: turning it off removes the view", list.pinnedHeader == nil && viewCount(list) == before.views)
        window.close()
    }

    func detailLayout() {
        let font = TextStyle.base.font()
        let path = "Sources/NyteUI/Lists/RowRenderer.swift"
        let width = { (text: String) in (text as NSString).size(withAttributes: [.font: font]).width }
        let room = width("…/Lists/RowRenderer.swift") + 1
        expect("Detail: path truncation drops leading folders first", RowRenderer.fittedPath(path, width: room, font: font) == "…/Lists/RowRenderer.swift")
        expect("Detail: then keeps the basename whole", RowRenderer.fittedPath(path, width: width("RowRenderer.swift") + 1, font: font) == "RowRenderer.swift")
        expect("Detail: a path that fits is left alone", RowRenderer.fittedPath(path, width: width(path) + 1, font: font) == path)
        let firstDetailInk = { (gap: CGFloat) -> Int in
            var row = RowContent(title: "Unused", detail: "gopls")
            row.detailGap = gap
            return self.inkColumns(row).dropFirst().first { $0.gapBefore >= 3 }?.start ?? -1
        }
        let near = firstDetailInk(Space.x1), far = firstDetailInk(Space.x2)
        expect("Detail: the gap before the detail follows RowContent.detailGap", far - near == Int(Space.x2 - Space.x1), "\(near) then \(far)")
    }

    func inkColumns(_ row: RowContent) -> [(start: Int, gapBefore: Int)] {
        let size = NSSize(width: 360, height: Metric.row)
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return [] }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.cgContext.translateBy(x: 0, y: size.height)
        context.cgContext.scaleBy(x: 1, y: -1)
        let appearance = NSAppearance(named: .aqua) ?? NSApp.effectiveAppearance
        appearance.performAsCurrentDrawingAppearance {
            RowRenderer.draw(row, in: NSRect(origin: .zero, size: size), scale: 1, state: RowRenderer.State(), appearance: appearance)
        }
        NSGraphicsContext.restoreGraphicsState()
        let inked = (0..<bitmap.pixelsWide).map { x in (0..<bitmap.pixelsHigh).contains { (bitmap.colorAt(x: x, y: $0)?.alphaComponent ?? 0) > 0.3 } }
        var runs: [(start: Int, gapBefore: Int)] = []
        var gap = 0
        for (x, ink) in inked.enumerated() {
            if ink, gap > 0 || runs.isEmpty { runs.append((x, gap)) }
            gap = ink ? 0 : gap + 1
        }
        return runs
    }
}

extension KitCheck {
    static let codeLine: CGFloat = 18

    func pinnedLines() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 300))
        let scroll = NSScrollView()
        let document = NSView(frame: NSRect(x: 0, y: 0, width: 400, height: 2_000))
        scroll.documentView = document
        window.place(scroll, at: .zero, size: NSSize(width: 400, height: 300))
        let pinned = PinnedLinesView()
        var pressed: [Int] = []
        pinned.onPressLine = { pressed.append($0) }
        let code = ["func (h *Hub) Run() {", "\tfor {", "\t\tselect {"].map {
            NSAttributedString(string: $0, attributes: TextStyle.code.attributes(Palette.contentPrimary))
        }
        pinned.show([], lineHeight: Self.codeLine, leadingInset: Space.x3, baseline: Space.x3, in: scroll)
        expect("Pinned lines: with no lines it is not installed and adds nothing", pinned.superview == nil && pinned.isHidden)
        pinned.show(code, lineHeight: Self.codeLine, leadingInset: Space.x3, baseline: Space.x3, in: scroll)
        pinned.layoutSubtreeIfNeeded()
        let layers = pinned.layer?.sublayers?.first?.sublayers?.count ?? 0
        expect("Pinned lines: three lines, one layer each, at the top of the clip, no shadow before scrolling",
               pinned.frame.height == Self.codeLine * 3 && layers == 3 && (pinned.layer?.shadowOpacity ?? 1) == 0,
               "\(pinned.frame) \(layers) layers, shadow \(pinned.layer?.shadowOpacity ?? -1)")
        scroll.contentView.scroll(to: NSPoint(x: 0, y: 200))
        pinned.show(Array(code.prefix(2)), lineHeight: Self.codeLine, leadingInset: Space.x3, baseline: Space.x3, push: Space.x2, in: scroll)
        pinned.show(code, lineHeight: Self.codeLine, leadingInset: Space.x3, baseline: Space.x3, push: Space.x2, in: scroll)
        pinned.layoutSubtreeIfNeeded()
        pinned.updateLayer()
        expect("Pinned lines: a pushed last line shortens the strip, layers are reused, the shadow shows over scrolled content",
               pinned.frame.height == Self.codeLine * 3 - Space.x2 && pinned.layer?.sublayers?.first?.sublayers?.count == 3
                   && (pinned.layer?.shadowOpacity ?? 0) > 0)
        click(pinned, at: NSPoint(x: Space.x8, y: Self.codeLine * 1.5))
        expect("Pinned lines: a click reports the line's index", pressed == [1], "\(pressed)")
        pinned.show([], lineHeight: Self.codeLine, leadingInset: Space.x3, baseline: Space.x3, in: scroll)
        expect("Pinned lines: emptied, it hides", pinned.isHidden)
        window.close()
    }
}

extension KitCheck {
    func groupExtents() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 240))
        let list = ListView()
        let rows: [RowContent] = (0..<200).map { row in
            if row % 50 == 0 { return .header("Group \(row / 50)") }
            var content = RowContent(title: "Row \(row)")
            content.endsGroup = row % 50 == 10
            return content
        }
        list.rowCount = { rows.count }
        list.content = { rows[$0] }
        list.verticalInset = Space.x1
        list.pinsGroupHeaders = true
        window.place(list, at: .zero, size: NSSize(width: 320, height: 240))
        list.reload()
        list.layoutSubtreeIfNeeded()
        list.scrollHeaderToTop(55)
        let pinned = list.pinnedHeader
        expect("Pinned groups: the pinned header covers the list's vertical inset",
               pinned?.isHidden == false && pinned?.frame.maxY == list.bounds.maxY
                   && pinned?.frame.height == Space.x1 + list.table.rect(ofRow: 0).height,
               "\(String(describing: pinned?.frame)) in \(list.bounds)")
        list.scrollHeaderToTop(62)
        expect("Pinned groups: after its end marker a group no longer pins its header", pinned?.isHidden == true)
        list.selectsHeaders = true
        list.selectedRow = 49
        list.moveSelection(by: 1)
        expect("Pinned groups: a host can let the keyboard select a header row", list.selectedRow == 50,
               "\(String(describing: list.selectedRow))")
        window.close()

        var code = RowContent(title: "x", meta: "internal/server/realtime/client.go:88")
        code.descriptionMonospace = true
        code.metaMaxWidth = Self.metaLimit
        code.metaTruncation = .path
        let runs = inkColumns(code)
        let metaStart = runs.last { $0.gapBefore >= 3 }?.start ?? 0
        expect("RowContent: a code-font description, and meta held to its maximum width",
               RowRenderer.descriptionStyle(code) == .codeSmall && metaStart >= Int(Self.inkCanvas - Space.x2 * 2 - Self.metaLimit),
               "meta starts at \(metaStart)")
    }

    static let metaLimit: CGFloat = 120
    static let inkCanvas: CGFloat = 360
}
