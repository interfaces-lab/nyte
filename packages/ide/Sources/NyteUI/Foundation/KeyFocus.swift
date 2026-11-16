import AppKit

public enum KeyFocus {
    public static func shows(holdsFocus: Bool, windowIsKey: Bool) -> Bool { holdsFocus && windowIsKey }
}

extension NSWindow {
    var hasKeyFocus: Bool { isKeyWindow || (!canBecomeKey && parent?.isKeyWindow == true) }
}

extension NSView {
    func observeKeyFocus(moving newWindow: NSWindow?, _ selector: Selector) {
        let center = NotificationCenter.default
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            center.removeObserver(self, name: name, object: nil)
            guard let newWindow else { continue }
            center.addObserver(self, selector: selector, name: name, object: newWindow.canBecomeKey ? newWindow : nil)
        }
    }
}
