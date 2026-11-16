import AppKit

@MainActor
enum TextInk {
    static func matchTextViews() {
        NSGraphicsContext.current?.cgContext.setShouldSmoothFonts(true)
    }
}

@MainActor
class KitTextField: NSTextField {
    override func draw(_ dirtyRect: NSRect) {
        TextInk.matchTextViews()
        super.draw(dirtyRect)
    }
}
