import AppKit

enum SwitcherKey: Equatable, Sendable {
    case next, previous, commit, pass

    static func decide(_ type: NSEvent.EventType, modifiers: NSEvent.ModifierFlags, character: String?, isArmed: Bool) -> SwitcherKey {
        let held = modifiers.intersection([.control, .shift, .option, .command])
        switch type {
        case .flagsChanged: return isArmed && !held.contains(.control) ? .commit : .pass
        case .keyDown where character == "\t" && held.contains(.control): return held.contains(.shift) ? .previous : .next
        default: return .pass
        }
    }
}
