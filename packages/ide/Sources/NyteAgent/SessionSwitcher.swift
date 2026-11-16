import AppKit
import NyteUI

@MainActor
final class SessionSwitcher {
    let sessions = SessionsViewController()
    private let panel = FloatingPanel(radius: Radius.card, takesKey: true)

    static let mostHeight: CGFloat = 480
    static let fewestHeight: CGFloat = 160
    static let key = "s"
    static let modifiers: NSEvent.ModifierFlags = [.control, .command]

    var isShown: Bool { panel.isShown }

    func show(under header: NSView) {
        let content = sessions.view
        panel.content = content
        content.layoutSubtreeIfNeeded()
        let height = min(Self.mostHeight, max(Self.fewestHeight, sessions.preferredHeight))
        panel.show(size: NSSize(width: header.bounds.width - Space.x2, height: height),
                   anchoredTo: header.bounds.insetBy(dx: Space.x1, dy: 0), in: header)
        sessions.prepareForSearch()
    }

    func dismiss() {
        panel.dismiss()
    }

    static func matches(_ event: NSEvent) -> Bool {
        event.modifierFlags.intersection([.command, .option, .control, .shift]) == modifiers
            && event.charactersIgnoringModifiers?.lowercased() == key
    }
}
