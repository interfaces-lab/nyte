import AppKit
@testable import NyteUI

extension KitCheck {
    static let jumpRows = 100_000
    static let headerEvery = 1_000
    static let jumpTarget = 54_321
    static let rowCost: UInt64 = 50_000

    func specialKeys() {
        let window = KitProbeWindow(size: NSSize(width: 100, height: 100))
        let keys: [(name: String, code: UInt16, text: String)] = [
            ("Return", Keys.returnKey.code, Keys.returnKey.text), ("Enter", Keys.enter.code, Keys.enter.text),
            ("Escape", Keys.escape.code, Keys.escape.text), ("Tab", Keys.tab.code, Keys.tab.text), ("Space", Keys.space.code, Keys.space.text),
            ("Left", Keys.left.code, Keys.left.text), ("Right", Keys.right.code, Keys.right.text), ("Up", Keys.up.code, Keys.up.text),
            ("Down", Keys.down.code, Keys.down.text), ("Home", Keys.home.code, Keys.home.text), ("End", Keys.end.code, Keys.end.text),
            ("Page Up", Keys.pageUp.code, Keys.pageUp.text), ("Page Down", Keys.pageDown.code, Keys.pageDown.text),
            ("Delete", 51, "\u{7F}"), ("Forward Delete", 117, "\u{F728}"),
        ]
        let modifierSets: [NSEvent.ModifierFlags] = [[], .shift, .control, .option, .command]
        var misses: [String] = []
        for entry in keys {
            for modifiers in modifierSets {
                let event = key((code: entry.code, text: entry.text), modifiers, in: window)
                if !KeyLabel.matches(event, key: entry.text, modifiers: modifiers) { misses.append("\(entry.name) \(modifiers.rawValue)") }
                let wrong = modifierSets.first { $0 != modifiers } ?? .command
                if KeyLabel.matches(event, key: entry.text, modifiers: wrong) { misses.append("\(entry.name) also matched \(wrong.rawValue)") }
            }
        }
        expect("Row action keys: every special key the kit names matches itself, with and without each modifier, and only then",
               misses.isEmpty, misses.prefix(6).joined(separator: "; "))
        let delete = key((code: 51, text: "\u{7F}"), .command, in: window)
        let forward = key((code: 117, text: "\u{F728}"), .command, in: window)
        expect("Row action keys: Backspace, U+0008 and U+007F are one key; forward Delete is its own",
               KeyLabel.matches(delete, key: "\u{7F}", modifiers: .command) && KeyLabel.matches(delete, key: "\u{8}", modifiers: .command)
                   && !KeyLabel.matches(forward, key: "\u{7F}", modifiers: .command) && KeyLabel.matches(forward, key: "\u{F728}", modifiers: .command)
                   && !KeyLabel.matches(delete, key: "\u{F728}", modifiers: .command))
        window.close()
    }

    func pinnedJumps() {
        let window = KitProbeWindow(size: NSSize(width: 320, height: 240))
        let list = ListView()
        var asked = Set<Int>()
        list.rowCount = { Self.jumpRows }
        list.content = { row in
            asked.insert(row)
            let start = DispatchTime.now().uptimeNanoseconds
            while DispatchTime.now().uptimeNanoseconds - start < Self.rowCost {}
            var content = RowContent(title: "Row \(row)", depth: row % Self.headerEvery == 0 ? 0 : 1)
            content.isGroupHeader = row % Self.headerEvery == 0
            return content
        }
        list.pinsGroupHeaders = true
        list.groupHeader = { row in row - row % Self.headerEvery }
        window.place(list, at: .zero, size: NSSize(width: 320, height: 240))
        list.reload()
        list.layoutSubtreeIfNeeded()
        guard let table = list.scrollView.documentView as? NSTableView else { return expect("Pinned jumps: table", false) }
        let jump = { (row: Int) -> TimeInterval in
            asked = []
            let start = Date()
            list.scrollView.contentView.scroll(to: NSPoint(x: 0, y: table.rect(ofRow: row).minY - list.scrollView.contentInsets.top))
            list.scrollView.reflectScrolledClipView(list.scrollView.contentView)
            list.layoutSubtreeIfNeeded()
            table.displayIfNeeded()
            return Date().timeIntervalSince(start)
        }
        let stated = jump(Self.jumpTarget)
        let visible = table.rows(in: table.visibleRect)
        let drawn = Set(visible.location ..< visible.location + visible.length)
        let header = Self.jumpTarget - Self.jumpTarget % Self.headerEvery
        let extra = asked.subtracting(drawn)
        print(String(format: "     pinned jump with stated headers: %.1f ms, %d rows asked", stated * 1000, asked.count))
        expect("Pinned groups: a jump across 100,000 rows asks only for the rows drawn and the one header",
               extra == [header] && list.pinnedHeader?.row == header && list.pinnedHeader?.isHidden == false,
               "extra \(extra.sorted().prefix(8)), header \(String(describing: list.pinnedHeader?.row))")
        list.groupHeader = nil
        _ = jump(0)
        let walked = jump(Self.jumpTarget)
        print(String(format: "     pinned jump with the bounded walk: %.1f ms, %d rows asked", walked * 1000, asked.count))
        expect("Pinned groups: without stated headers the walk back is bounded",
               asked.count <= drawn.count + GroupPinning.walkLimit + 2, "\(asked.count)")
        expect("Pinned groups: the header search over a sorted array", ListView.header(in: [0, 10, 20], forRow: 15) == 10
               && ListView.header(in: [0, 10, 20], forRow: 20) == 20 && ListView.header(in: [5], forRow: 2) == nil)
        window.close()
    }
}
