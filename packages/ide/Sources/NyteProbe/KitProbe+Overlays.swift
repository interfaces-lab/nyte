import AppKit
@testable import NyteUI

extension KitCheck {
    func menus() {
        var opened = 0, deleted = 0
        let menu = Menu.make([MenuItem("Open", key: "o", action: { opened += 1 }), .separator, .header("Danger"),
                              MenuItem("Archive", key: "r", enabled: false, action: { deleted += 1 }),
                              MenuItem("Delete", destructive: true, action: { deleted += 1 })])
        let open = menu.items[0], archive = menu.items[3], delete = menu.items[4]
        expect("Menu: key equivalents and modifiers are set", open.keyEquivalent == "o" && open.keyEquivalentModifierMask == .command)
        expect("Menu: separator and section header", menu.items[1].isSeparatorItem && menu.items[2].isSectionHeader)
        let window = KitProbeWindow(size: NSSize(width: 100, height: 100))
        _ = menu.performKeyEquivalent(with: key(Keys.letterO, .command, in: window))
        _ = menu.performKeyEquivalent(with: key(Keys.letterR, .command, in: window))
        expect("Menu: Command-O fires, a disabled item's key does not", opened == 1 && deleted == 0, "\(opened) \(deleted)")
        expect("Menu: a disabled item validates as disabled", !archive.isEnabled)
        let ink = delete.attributedTitle?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor
        expect("Menu: a destructive item takes the danger ink and still fires", ink == Palette.dangerInk && {
            menu.performActionForItem(at: 4)
            return deleted == 1
        }())
        window.close()
    }

    func floatingPanel() {
        let window = KitProbeWindow(size: NSSize(width: 400, height: 300))
        let opener = Button("Open")
        opener.alwaysFocusable = true
        window.place(opener, at: NSPoint(x: 40, y: 200))
        window.makeFirstResponder(opener)
        let panel = FloatingPanel(takesKey: true)
        var dismissals = 0
        panel.onDismiss = { dismissals += 1 }
        panel.content = NSView()
        let show = { panel.show(size: Self.panelSize, anchoredTo: opener.bounds, in: opener) }
        show()
        let anchor = window.convertToScreen(opener.convert(opener.bounds, to: nil))
        let frame = panel.frame
        expect("FloatingPanel: opens against its anchor", panel.isShown && (frame.maxY == anchor.minY - FloatingPanel.anchorGap
               || frame.minY == anchor.maxY + FloatingPanel.anchorGap), "\(frame) for anchor \(anchor)")
        expect("FloatingPanel: never becomes main, is a child of the opener's window", !panel.window.canBecomeMain && panel.window.parent === window)
        let surface = panel.window.contentView ?? NSView()
        let corners: [CGFloat] = surface.bitmapImageRepForCachingDisplay(in: surface.bounds).map { bitmap in
            surface.cacheDisplay(in: surface.bounds, to: bitmap)
            let (right, bottom) = (bitmap.pixelsWide - 1, bitmap.pixelsHigh - 1)
            return [(0, 0), (right, 0), (0, bottom), (right, bottom)].map { bitmap.colorAt(x: $0.0, y: $0.1)?.alphaComponent ?? 1 }
        } ?? []
        expect("FloatingPanel: a clear, non-opaque window whose rounded corners render with alpha 0",
               !panel.window.isOpaque && panel.window.backgroundColor.alphaComponent == 0 && corners == [0, 0, 0, 0], "\(corners)")
        NSApp.sendEvent(key(Keys.escape, in: window))
        spin()
        expect("FloatingPanel: Escape closes", !panel.isShown && dismissals == 1, "\(dismissals)")
        expect("FloatingPanel: focus is back on the opener", window.firstResponder === opener)
        show()
        spin()
        NSApp.sendEvent(mouse(.leftMouseDown, at: NSPoint(x: 5, y: 5), in: window.contentView ?? opener))
        spin()
        expect("FloatingPanel: a click outside closes", !panel.isShown && dismissals == 2, "\(dismissals)")
        show()
        window.close()
        expect("FloatingPanel: closing the window takes the panel with it", !panel.isShown && panel.window.parent == nil)
    }
}
