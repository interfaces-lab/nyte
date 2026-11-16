import AppKit
@testable import NyteUI

extension KitCheck {
    func drive(_ name: String, _ control: Control, at point: NSPoint? = nil, role: NSAccessibility.Role, fired: () -> Int) {
        guard let window = control.window else { return expect("\(name): placed in a window", false) }
        control.alwaysFocusable = true
        window.makeFirstResponder(nil)
        let start = fired()
        click(control, at: point)
        expect("\(name): a click fires once", fired() == start + 1, "\(fired() - start)")
        expect("\(name): a click leaves keyboard focus where it was, so no focus ring", window.firstResponder !== control)
        click(control, at: point, releaseAt: NSPoint(x: control.bounds.maxX + 60, y: control.bounds.midY))
        expect("\(name): press, drag out and release fires nothing", fired() == start + 1 && !control.isPressed,
               "\(fired() - start) fired, pressed \(control.isPressed)")
        window.makeFirstResponder(control)
        expect("\(name): takes keyboard focus", window.firstResponder === control && control.focusRingType != .none)
        for key in [Keys.space, Keys.returnKey, Keys.enter] {
            press(key, in: window)
            spin()
        }
        expect("\(name): Space, Return and Enter each fire", fired() == start + 4, "\(fired() - start - 1) of 3")
        control.isEnabled = false
        click(control, at: point)
        press(Keys.space, in: window)
        spin()
        let pressedWhileDisabled = control.accessibilityPerformPress()
        spin()
        expect("\(name): disabled ignores click, Space and the press action", fired() == start + 4 && !pressedWhileDisabled
               && !control.isAccessibilityEnabled(), "\(fired() - start - 4) fired")
        control.isEnabled = true
        expect("\(name): accessibility role \(role.rawValue) with a label", control.accessibilityRole() == role
               && !(control.accessibilityLabel() ?? "").isEmpty, "\(String(describing: control.accessibilityRole())) "
               + "\"\(control.accessibilityLabel() ?? "")\"")
        let performed = control.accessibilityPerformPress()
        spin()
        expect("\(name): the press action does what a click does", performed && fired() == start + 5, "\(fired() - start - 4)")
        window.makeFirstResponder(nil)
    }

    func buttons() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 120))
        var presses = 0
        let button = Button("Save", variant: .solid, tone: .primary) { presses += 1 }
        window.place(button, at: NSPoint(x: 20, y: 20))
        drive("Button", button, role: .button) { presses }
        let icon = IconButton(symbol: "xmark", label: "Close")
        window.place(icon, at: NSPoint(x: 120, y: 20))
        expect("Button: an icon-only button is labelled", icon.accessibilityLabel() == "Close" && icon.toolTip == "Close")
        button.isLoading = true
        expect("Button: loading shows a Loader, is unavailable and says so", button.subviews.contains { $0 is Loader }
               && !button.isAccessibilityEnabled() && (button.accessibilityValue() as? String) == "Loading")
        button.isLoading = false
        expect("Button: the Loader leaves when loading ends", !button.subviews.contains { $0 is Loader })
        window.close()
    }

    func splitButton() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 120))
        var presses = 0, menus = 0
        let split = SplitButton("Run", onPress: { presses += 1 }, menu: {
            menus += 1
            return Menu.make([MenuItem("Debug")])
        })
        window.place(split, at: NSPoint(x: 20, y: 20))
        drive("SplitButton", split, at: NSPoint(x: Space.x3, y: split.bounds.midY), role: .button) { presses }
        expect("SplitButton: the press action never opens the menu", menus == 0, "\(menus)")
        expect("SplitButton: exposes Show Menu", split.isAccessibilitySelectorAllowed(#selector(NSAccessibilityProtocol.accessibilityPerformShowMenu)))
        window.close()
    }

    func segmented() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 120))
        var chosen: [Int] = []
        let control = Segmented([.init("One"), .init("Two"), .init("Three")], label: "Count") { chosen.append($0) }
        window.place(control, at: NSPoint(x: 20, y: 20))
        let second = control.segmentRect(1)
        click(control, at: NSPoint(x: second.midX, y: second.midY))
        expect("Segmented: a click selects that segment", control.selectedIndex == 1 && chosen == [1], "\(chosen)")
        let third = control.segmentRect(2)
        click(control, at: NSPoint(x: third.midX, y: third.midY), releaseAt: NSPoint(x: third.midX, y: third.maxY + 60))
        expect("Segmented: press, drag out and release selects nothing", control.selectedIndex == 1 && chosen == [1], "\(chosen)")
        expect("Segmented: a click leaves keyboard focus", window.firstResponder !== control)
        control.alwaysFocusable = true
        window.makeFirstResponder(control)
        press(Keys.right, in: window)
        press(Keys.right, in: window)
        press(Keys.left, in: window)
        expect("Segmented: arrows move the selection and stop at the ends", chosen == [1, 2, 1], "\(chosen)")
        control.isEnabled = false
        click(control, at: NSPoint(x: third.midX, y: third.midY))
        press(Keys.right, in: window)
        expect("Segmented: disabled ignores click and arrows", chosen == [1, 2, 1], "\(chosen)")
        control.isEnabled = true
        let children = control.accessibilityChildren()?.compactMap { $0 as? NSAccessibilityElement } ?? []
        expect("Segmented: a radio group of labelled radio buttons, the selected one valued 1",
               control.accessibilityRole() == .radioGroup && children.map { $0.accessibilityRole() } == Array(repeating: .radioButton, count: 3)
               && children.map { $0.accessibilityLabel() ?? "" } == ["One", "Two", "Three"]
               && children.map { ($0.accessibilityValue() as? Int) ?? -1 } == [0, 1, 0])
        _ = children.first?.accessibilityPerformPress()
        expect("Segmented: pressing a segment's element selects it", control.selectedIndex == 0 && chosen.last == 0, "\(chosen)")
        window.close()
    }

    func toggles() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 120))
        var checks = 0, flips = 0
        let checkbox = Checkbox("Wrap lines") { _ in checks += 1 }
        window.place(checkbox, at: NSPoint(x: 20, y: 20))
        drive("Checkbox", checkbox, role: .checkBox) { checks }
        expect("Checkbox: value follows the state", (checkbox.accessibilityValue() as? Int) == checkbox.state.rawValue
               && checkbox.isOn == (checkbox.state != .off))
        let toggle = Switch(label: "Autosave") { _ in flips += 1 }
        window.place(toggle, at: NSPoint(x: 200, y: 20))
        drive("Switch", toggle, role: .checkBox) { flips }
        expect("Switch: subrole switch, value follows isOn", toggle.accessibilitySubrole() == .switch
               && (toggle.accessibilityValue() as? Int) == (toggle.isOn ? 1 : 0))
        window.close()
    }

    func tabOrder() {
        let window = KitProbeWindow(size: NSSize(width: 600, height: 120))
        let controls: [Control] = [Button("First"), Checkbox("Second"), Switch(label: "Third"),
                                   Segmented([.init("A"), .init("B")], label: "Fourth")]
        for (index, control) in controls.enumerated() {
            control.alwaysFocusable = true
            window.place(control, at: NSPoint(x: 20 + CGFloat(index) * 130, y: 40))
        }
        window.recalculateKeyViewLoop()
        var order: [String] = []
        var current: NSView = controls[0]
        for _ in 1..<controls.count {
            current = current.nextValidKeyView ?? current
            order.append(current.accessibilityLabel() ?? "nil")
        }
        order.append(current.previousValidKeyView?.accessibilityLabel() ?? "nil")
        window.makeFirstResponder(controls[0])
        press(Keys.tab, in: window)
        expect("Tab order: a focused control passes Tab on rather than pressing", (controls[0] as? Button)?.isPressed == false)
        expect("Tab order: Tab walks the controls left to right and Shift-Tab steps back",
               order == ["Second", "Third", "Fourth", "Third"], "\(order)")
        expect("Tab order: a control is in the loop exactly when Full Keyboard Access is on", Button("Plain").acceptsFirstResponder == NSApp.isFullKeyboardAccessEnabled)
        window.close()
    }

    func linkButton() {
        let window = KitProbeWindow(size: NSSize(width: 300, height: 80))
        let link = Button("main.go:18:45", variant: .link)
        link.alwaysFocusable = true
        window.place(link, at: NSPoint(x: 10, y: 20))
        let rest = link.showsUnderline([]), hovered = link.showsUnderline([.hovered])
        window.makeFirstResponder(link)
        let focused = link.showsUnderline([])
        expect("Link button: no ground, underline on hover and keyboard focus, no focus ring",
               !rest && hovered && focused && link.focusRingType == .none && link.accessibilityRole() == .button)
        window.close()
    }
}
