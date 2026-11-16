import AppKit
@testable import NyteUI

extension KitCheck {
    static let tileFloor = 1.4

    func bannerActions() {
        let window = KitProbeWindow(size: NSSize(width: 640, height: 400))
        var ran: [String] = []
        let make = {
            Banner("hub.go changed on disk", detail: "It was rewritten by gofmt.", tone: .warning, actions: [
                Banner.Action("Compare") { ran.append("Compare") }, Banner.Action("Reload", primary: true) { ran.append("Reload") },
                Banner.Action("Keep Mine", primary: true) { ran.append("Keep Mine") }, Banner.Action("Fourth") { ran.append("Fourth") },
            ], onDismiss: { ran.append("dismiss") })
        }
        let wide = make(), narrow = make()
        for (banner, width, y) in [(wide, CGFloat(600), CGFloat(10)), (narrow, CGFloat(300), CGFloat(150))] {
            window.contentView?.addSubview(banner)
            NSLayoutConstraint.activate([
                banner.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
                banner.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: y),
                banner.widthAnchor.constraint(equalToConstant: width),
            ])
        }
        for _ in 0..<3 { window.contentView?.layoutSubtreeIfNeeded() }
        let buttons = { (banner: Banner) in banner.subviews.compactMap { $0 as? NSStackView }.flatMap(\.arrangedSubviews).compactMap { $0 as? Button } }
        let actions = buttons(wide).filter { $0.title != "" }
        let primaries = actions.filter { $0.variant == .solid }
        actions.forEach { $0.performClick(nil) }
        let dismiss = buttons(wide).first { $0.title.isEmpty }
        dismiss?.performClick(nil)
        expect("Banner: at most three actions, one primary, the dismiss button apart and separate",
               actions.map(\.title) == ["Compare", "Reload", "Keep Mine"] && primaries.map(\.title) == ["Reload"]
                   && ran == ["Compare", "Reload", "Keep Mine", "dismiss"], "\(actions.map(\.title)) \(ran)")
        let row = { (banner: Banner) in actions.first.flatMap { _ in buttons(banner).first { $0.title == "Compare" } }.map { banner.convert($0.bounds, from: $0) } }
        let title = { (banner: Banner) in banner.subviews.compactMap { $0 as? Label }.first.map { $0.frame } }
        let wideRow = row(wide), narrowRow = row(narrow)
        expect("Banner: actions sit on the title line when they fit, and wrap under the text inside the banner when narrow",
               !wide.actionsWrap && narrow.actionsWrap && wideRow.map { abs($0.midY - (title(wide)?.midY ?? 0)) < 1 } == true
                   && narrowRow.map { $0.minY > (title(narrow)?.maxY ?? .infinity) && narrow.bounds.contains($0) } == true,
               "\(String(describing: wideRow)) \(String(describing: narrowRow)) \(narrow.frame)")
        window.close()
    }

    func filterGroup() {
        var readings: [String] = []
        var lowest = Double.infinity
        for name in [NSAppearance.Name.aqua, .darkAqua] {
            NSAppearance(named: name)?.performAsCurrentDrawingAppearance {
                for ground in [Palette.bgBase, Palette.bgChrome, Palette.bgElevated] {
                    let track = Palette.composite(Palette.bgMutedTranslucent, over: Palette.composite(ground, over: Palette.bgBase))
                    guard let tile = FilterGroup.tile(on: true, hovered: false) else { continue }
                    let ratio = Palette.contrast(Palette.composite(tile, over: track), track)
                    lowest = min(lowest, ratio)
                    readings.append(String(format: "%.2f", ratio))
                }
            }
        }
        print("     filter tile against track: " + readings.joined(separator: ", "))
        expect("Filter group: an on tile measures against its track in both appearances; off has no tile and a lower label",
               lowest >= Self.tileFloor && FilterGroup.tile(on: false, hovered: false) == nil
                   && FilterGroup.labelInk(on: true) === Palette.contentPrimary && FilterGroup.labelInk(on: false) === Palette.contentSecondary,
               "\(lowest)")
        let window = KitProbeWindow(size: NSSize(width: 400, height: 80))
        var changes: [String] = []
        let group = FilterGroup([.init("Errors", count: 0), .init("Warnings", count: 1), .init("Notes", count: 2)], label: "Severity") {
            changes.append("\($0)\($1)")
        }
        group.alwaysFocusable = true
        window.place(group, at: .zero)
        window.makeFirstResponder(group)
        press(Keys.right, in: window)
        press(Keys.space, in: window)
        press(Keys.right, in: window)
        press(Keys.right, in: window)
        press(Keys.space, in: window)
        let mid = group.filterRect(0)
        click(group, at: NSPoint(x: mid.midX, y: mid.midY))
        let children = group.accessibilityChildren()?.compactMap { $0 as? NSAccessibilityElement } ?? []
        expect("Filter group: one keyboard stop, arrows move, Space toggles, clicks toggle; each filter an accessibility checkbox",
               changes == ["1false", "2false", "0false"] && window.firstResponder === group
                   && children.map { $0.accessibilityRole() } == [.checkBox, .checkBox, .checkBox]
                   && children.compactMap { $0.accessibilityValue() as? Int } == [0, 0, 0]
                   && children.first?.accessibilityLabel() == "Errors, 0", "\(changes)")
        let one = Draw.width(of: "1", style: .sm, tabular: true), eight = Draw.width(of: "8", style: .sm, tabular: true)
        expect("Filter group: counts in tabular digits", one == eight)
        window.close()
    }

    func chipRow() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 200))
        var opened: [String] = []
        let row = ChipRow(maximumLines: 2)
        row.chips = ["hub.go:41-58", "client.go", "Terminal", "stats.go:6-16", "hub_test.go:26", "README.md"].map { name in
            let chip = Chip(name)
            chip.onPress = { opened.append(name) }
            return chip
        }
        window.place(row, at: .zero, size: NSSize(width: 240, height: 60))
        row.layoutSubtreeIfNeeded()
        let shown = row.chips.filter { !$0.isHidden }
        let lines = Set((shown.map(\.frame) + [row.more.frame]).map(\.minY))
        expect("Chip row: past two lines the rest collapse into +N on the second line",
               !row.more.isHidden && lines.count == 2 && shown.count + row.overflowChips.count == row.chips.count
                   && row.more.title == "+\(row.overflowChips.count)" && row.more.frame.maxX <= row.bounds.width,
               "\(shown.count) shown, \(row.overflowChips.count) hidden, lines \(lines.sorted())")
        row.showOverflow()
        let first = row.overflowChips.first?.title
        press(Keys.returnKey, in: row.overflowChips.isEmpty ? window : NSApp.keyWindow ?? window)
        let panelShown = row.isShowingOverflow || opened == [first ?? ""]
        row.maximumLines = nil
        row.layoutSubtreeIfNeeded()
        expect("Chip row: +N opens the rest as a list; without a limit every chip shows",
               panelShown && row.more.isHidden && row.chips.allSatisfy { !$0.isHidden }, "\(opened)")
        window.close()
    }
}
