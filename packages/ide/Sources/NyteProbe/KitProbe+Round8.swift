import AppKit
@testable import NyteUI

extension KitCheck {
    static let streamedRows = 10_000
    static let streamBatches = 500

    func wrappedSyntax() {
        var row = RowContent(title: "user")
        row.description = "&main.User{Name: \"zelda\"} // cached"
        row.descriptionWraps = true
        row.descriptionMonospace = true
        row.descriptionSyntax = CodeColors.ranges(in: row.description, language: "go")
        let text = RowRenderer.wrapped(row)
        let quote = (row.description as NSString).range(of: "\"zelda\"").location
        let comment = (row.description as NSString).range(of: "// cached").location
        let ink = text.attribute(.foregroundColor, at: quote, effectiveRange: nil) as? NSColor
        let font = text.attribute(.font, at: comment, effectiveRange: nil) as? NSFont
        let paragraph = text.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle
        expect("Wrapped description: syntax colour and comment slant, still word-wrapping",
               resolved(ink) == resolved(SyntaxColor.string.color) && font == RowRenderer.descriptionStyle(row).slantedFont()
                   && paragraph?.lineBreakMode == .byWordWrapping, "\(String(describing: ink)) \(String(describing: font))")
    }

    func shiftedKeys() {
        let window = KitProbeWindow(size: NSSize(width: 100, height: 100))
        let shiftOne = key((code: 18, text: "!"), [.shift, .command], in: window)
        let optionReturn = key(Keys.returnKey, [.option, .command], in: window)
        expect("Row action keys: Shift-Command-1 and Option-Command-Return match by key and modifiers",
               KeyLabel.matches(shiftOne, key: "1", modifiers: [.shift, .command])
                   && KeyLabel.matches(optionReturn, key: "\r", modifiers: [.option, .command])
                   && !KeyLabel.matches(shiftOne, key: "1", modifiers: .command)
                   && !KeyLabel.matches(optionReturn, key: "\r", modifiers: .command))
        window.close()
    }

    func streamedNumbers() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 240))
        let list = ListView()
        var count = 0, asked = 0
        list.rowCount = { count }
        list.content = { index in
            asked += 1
            var row = RowContent(title: "match", depth: 1)
            row.number = String(index + 1)
            return row
        }
        window.place(list, at: .zero, size: NSSize(width: 320, height: 240))
        list.reload()
        let batch = Self.streamedRows / Self.streamBatches
        for _ in 0 ..< Self.streamBatches {
            let start = count
            count += batch
            list.insertRows(IndexSet(start ..< count), animated: false)
        }
        list.layoutSubtreeIfNeeded()
        let visible = Int(240 / Metric.row) + 2
        let widest = Draw.width(of: String(Self.streamedRows), style: .base, tabular: true)
        expect("Row numbers: streaming 10,000 rows in 500 batches measures each row once and grows to the widest",
               asked <= Self.streamedRows + visible * 4 && list.numberColumn == widest, "asked \(asked), column \(list.numberColumn)")
        window.close()
    }

    func folderIcons() {
        let closed = FileIcon.folder(open: false), open = FileIcon.folder(open: true)
        guard case let .tinted(image, ink) = FileIcon.folderLeading(open: true, ink: .tertiary) else {
            return expect("Folders: a tinted leading", false)
        }
        expect("Folders: open and closed are distinct 16 pt images, tinted with the label's ink",
               closed !== open && closed.size == NSSize(width: FileIcon.size, height: FileIcon.size) && image === open
                   && ink === Palette.contentTertiary && closed.tiffRepresentation != open.tiffRepresentation)
    }

    func sidebarSessions() {
        var row = RowContent(title: "Port the hub to context cancellation", meta: "2m", leading: .mark(.task(.working)))
        row.diff = (added: 42, removed: 7)
        row.alignsFacts = true
        row.yieldOrder = [.title]
        row.showsFrom = [.counts: RowContent.roomForColumns]
        var waiting = row
        waiting.badge = .request(.approval)
        let narrow = [256, 320].map { row.fitted(width: CGFloat($0)) }
        let wide = row.fitted(width: 400)
        let asking = waiting.fitted(width: 256)
        expect("Sessions: under 360 pt no totals, the age stays and the title takes the rest; from 360 the totals return",
               narrow.allSatisfy { !$0.showsCounts && $0.meta == "2m" } && !narrow[1].titleTruncated && wide.showsCounts
                   && wide.meta == "2m" && !asking.showsCounts && asking.meta == "2m",
               "\(narrow) / \(wide)")
        let cell = RowCell(frame: NSRect(x: 0, y: 0, width: 256, height: Metric.row))
        cell.content = row
        expect("Sessions: the hidden totals stay in the accessibility value",
               (cell.accessibilityValue() as? String)?.contains("42 added, 7 removed") == true)
    }

    func headerHitAreas() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 200))
        var measured: [String] = []
        var steady = true
        for height in [Metric.paneHeader, Size.lg.height] {
            let button = Button(symbol: "plus", label: "New", size: PaneHeader.actionSize)
            let header = PaneHeader(title: "Agent", actions: [button])
            header.rowHeight = height
            let tabs = TabBar(style: .file, label: "Editor")
            tabs.items = [TabBar.Item("hub.go"), TabBar.Item("client.go")]
            window.place(header, at: NSPoint(x: 0, y: 0), size: NSSize(width: 400, height: height))
            window.place(tabs, at: NSPoint(x: 0, y: 100), size: NSSize(width: 400, height: height))
            header.translatesAutoresizingMaskIntoConstraints = false
            header.widthAnchor.constraint(equalToConstant: 400).isActive = true
            window.contentView?.layoutSubtreeIfNeeded()
            let frame = header.convert(button.frame, from: button.superview)
            let corners = [NSPoint(x: frame.minX + 1, y: frame.minY + 1), NSPoint(x: frame.maxX - 1, y: frame.maxY - 1)]
            let hits = corners.allSatisfy { header.hitTest(header.convert($0, to: header.superview)) === button }
            let close = tabs.closeRect(0)
            let tab = tabs.tabRect(0)
            measured.append("\(Int(height)): action \(Int(frame.width))×\(Int(frame.height)) hit \(hits), close \(Int(close.width))×\(Int(close.height)), tab \(Int(tab.height)) inside \(tabs.bounds.contains(tab))")
            steady = steady && hits && frame.size == NSSize(width: Size.sm.height, height: Size.sm.height) && header.frame.height == height
                && close.size == NSSize(width: Glyph.md.rawValue, height: Glyph.md.rawValue) && tabs.bounds.contains(tab)
            header.removeFromSuperview()
            tabs.removeFromSuperview()
        }
        print("     header hit areas: " + measured.joined(separator: "; "))
        expect("Header rows: at 32 pt the actions keep 24×24, the close buttons 16×16, and the tabs fit", steady, measured.joined(separator: "; "))
        window.close()
    }
}

extension KitCheck {
    func stripField() {
        let window = KitProbeWindow(size: NSSize(width: 300, height: 100))
        let field = SearchField(placeholder: "Evaluate", size: .sm, variant: .strip)
        window.place(field, at: NSPoint(x: 10, y: 10), size: NSSize(width: 200, height: Size.sm.height))
        let render = { () -> (rest: Bool, edges: Bool) in
            guard let rep = field.bitmapImageRepForCachingDisplay(in: field.bounds) else { return (false, false) }
            field.cacheDisplay(in: field.bounds, to: rep)
            let inked = { (y: Int) in (0..<rep.pixelsWide).contains { (rep.colorAt(x: $0, y: y)?.alphaComponent ?? 0) > 0.02 } }
            let inset = Int(Input.stripInset * CGFloat(rep.pixelsHigh) / field.bounds.height)
            let edges = (0..<inset).contains(where: inked) || ((rep.pixelsHigh - inset)..<rep.pixelsHigh).contains(where: inked)
            let middle = (0..<rep.pixelsWide).filter { x in
                (inset + 2 ..< rep.pixelsHigh - inset - 2).contains { (rep.colorAt(x: x, y: $0)?.alphaComponent ?? 0) > 0.02 } }
            return (middle.count > rep.pixelsWide / 2, edges)
        }
        let rest = render()
        field.isHovered = true
        let hovered = render()
        field.isHovered = false
        window.makeFirstResponder(field.field)
        field.layoutSubtreeIfNeeded()
        let focused = render()
        expect("Strip field: no ground or ring at rest, a ground on hover, the focus ring inside, never on the top or bottom 2 pt",
               !rest.rest && hovered.rest && focused.rest && !rest.edges && !hovered.edges && !focused.edges && field.isFocused,
               "\(rest) \(hovered) \(focused)")
        window.makeFirstResponder(nil)
        window.close()
    }
}
