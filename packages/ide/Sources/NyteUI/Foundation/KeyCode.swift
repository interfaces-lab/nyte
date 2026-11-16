import AppKit

enum KeyCode {
    static let left: UInt16 = 123
    static let right: UInt16 = 124
    static let down: UInt16 = 125
    static let up: UInt16 = 126
    static let escape: UInt16 = 53
    static let returnKey: UInt16 = 36
    static let enter: UInt16 = 76
    static let space: UInt16 = 49
    static let home: UInt16 = 115
    static let end: UInt16 = 119
    static let tab: UInt16 = 48
}

enum KeyLabel {
    static let names: [String: String] = [
        "\u{7F}": "⌫", "\u{8}": "⌫", "\r": "↩", " ": "Space", "\u{1B}": "⎋", "\t": "⇥", "\u{F728}": "⌦",
    ]

    static func text(_ key: String, _ modifiers: NSEvent.ModifierFlags) -> String {
        var text = ""
        if modifiers.contains(.control) { text += "⌃" }
        if modifiers.contains(.option) { text += "⌥" }
        if modifiers.contains(.shift) { text += "⇧" }
        if modifiers.contains(.command) { text += "⌘" }
        return text + (names[key] ?? key.uppercased())
    }

    static func matches(_ event: NSEvent, key: String, modifiers: NSEvent.ModifierFlags) -> Bool {
        guard !key.isEmpty else { return false }
        let pressed = event.modifierFlags.intersection([.command, .option, .control, .shift])
        let wanted = modifiers.intersection([.command, .option, .control, .shift])
        guard let raw = event.charactersIgnoringModifiers else { return false }
        let special = event.specialKey != nil || raw.unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7F || $0.value >= 0xF700 }
        let typed = special ? raw : (event.characters(byApplyingModifiers: []) ?? raw)
        return same(typed, key) && pressed == wanted
    }

    static let aliases: [String: String] = ["\u{8}": "\u{7F}", "\u{19}": "\t"]

    static func same(_ typed: String, _ key: String) -> Bool {
        let canonical = { (text: String) in aliases[text] ?? text.lowercased() }
        return canonical(typed) == canonical(key)
    }
}
