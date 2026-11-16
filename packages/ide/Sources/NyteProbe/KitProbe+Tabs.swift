import AppKit
@testable import NyteUI

extension KitCheck {
    func tabBar() {
        let window = KitProbeWindow(size: NSSize(width: 700, height: 80))
        let bar = TabBar(style: .file, label: "Editor tabs")
        var selections: [Int] = [], closes: [Int] = []
        bar.onSelect = { selections.append($0); bar.selectedIndex = $0 }
        bar.onClose = { closes.append($0) }
        bar.menuForTab = { Menu.make([MenuItem("Close tab \($0)")]) }
        bar.items = [TabBar.Item("main.swift"), TabBar.Item("App.swift", isDirty: true), TabBar.Item("README.md")]
        bar.selectedIndex = 0
        window.place(bar, at: NSPoint(x: 0, y: 20), size: NSSize(width: 600, height: Metric.tab))
        let tabs = { bar.accessibilityChildren()?.compactMap { $0 as? NSAccessibilityElement } ?? [] }
        let rect = { (index: Int) in bar.tabRect(index) }
        click(bar, at: NSPoint(x: rect(2).midX, y: rect(2).midY))
        expect("TabBar: a click selects", selections == [2] && bar.selectedIndex == 2, "\(selections)")
        let dirtyClose = bar.closeRect(1)
        click(bar, at: NSPoint(x: dirtyClose.midX, y: dirtyClose.midY))
        expect("TabBar: a dirty tab shows its dot, not the x, until hovered, so a click there selects", closes.isEmpty && selections.last == 1)
        bar.mouseMoved(with: mouse(.mouseMoved, at: NSPoint(x: dirtyClose.midX, y: dirtyClose.midY), in: bar))
        click(bar, at: NSPoint(x: dirtyClose.midX, y: dirtyClose.midY))
        expect("TabBar: the x on the right closes", closes == [1], "\(closes)")
        bar.otherMouseUp(with: middleButton(.otherMouseUp, at: NSPoint(x: rect(0).midX, y: rect(0).midY), in: bar))
        expect("TabBar: a middle click closes", closes == [1, 0], "\(closes)")
        bar.alwaysFocusable = true
        window.makeFirstResponder(bar)
        press(Keys.right, in: window)
        press(Keys.left, in: window)
        press(Keys.left, in: window)
        expect("TabBar: arrows move the selection", Array(selections.suffix(3)) == [2, 1, 0], "\(selections)")
        let menu = bar.menu(for: mouse(.rightMouseDown, at: NSPoint(x: rect(2).midX, y: rect(2).midY), in: bar))
        expect("TabBar: the context menu targets the tab under the pointer", menu?.items.first?.title == "Close tab 2")
        let elements = tabs()
        expect("TabBar: tab group of tab buttons, selected valued 1, dirty one says so",
               bar.accessibilityRole() == .tabGroup && elements.count == 3 && elements.allSatisfy { $0.accessibilitySubrole() == .tabButtonSubrole }
               && (elements[0].accessibilityValue() as? Int) == 1 && (elements[1].accessibilityValue() as? String ?? elements[1].accessibilityLabel() ?? "").contains("dited"),
               elements.map { "\($0.accessibilityLabel() ?? "") \(String(describing: $0.accessibilityValue()))" }.joined(separator: "; "))
        _ = elements[2].accessibilityPerformPress()
        let closeAction = elements[1].accessibilityCustomActions()?.first
        _ = closeAction?.handler?()
        expect("TabBar: pressing a tab selects it and its Close action closes it", selections.last == 2 && closes.last == 1, "\(selections) \(closes)")
        bar.items = (0..<30).map { TabBar.Item("File\($0).swift") }
        bar.layoutSubtreeIfNeeded()
        expect("TabBar: overflow shows the tab list button, exposed to accessibility",
               !bar.listButton.isHidden && tabs().count == 30 && bar.accessibilityChildren()?.contains { ($0 as? NSView) === bar.listButton } == true)
        window.close()
    }
}
