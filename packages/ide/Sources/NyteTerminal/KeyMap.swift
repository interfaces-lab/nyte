import AppKit

enum KeyMap {
    static func key(for keyCode: UInt16) -> TerminalKey {
        table[keyCode] ?? .unidentified
    }

    private static let table: [UInt16: TerminalKey] = [
        0x00: .a, 0x01: .s, 0x02: .d, 0x03: .f, 0x04: .h, 0x05: .g, 0x06: .z, 0x07: .x, 0x08: .c, 0x09: .v,
        0x0A: .intlBackslash, 0x0B: .b, 0x0C: .q, 0x0D: .w, 0x0E: .e, 0x0F: .r, 0x10: .y, 0x11: .t,
        0x12: .digit1, 0x13: .digit2, 0x14: .digit3, 0x15: .digit4, 0x16: .digit6, 0x17: .digit5, 0x18: .equal,
        0x19: .digit9, 0x1A: .digit7, 0x1B: .minus, 0x1C: .digit8, 0x1D: .digit0, 0x1E: .bracketRight, 0x1F: .o,
        0x20: .u, 0x21: .bracketLeft, 0x22: .i, 0x23: .p, 0x24: .enter, 0x25: .l, 0x26: .j, 0x27: .quote,
        0x28: .k, 0x29: .semicolon, 0x2A: .backslash, 0x2B: .comma, 0x2C: .slash, 0x2D: .n, 0x2E: .m, 0x2F: .period,
        0x30: .tab, 0x31: .space, 0x32: .backquote, 0x33: .backspace, 0x35: .escape, 0x36: .metaRight,
        0x37: .metaLeft, 0x38: .shiftLeft, 0x39: .capsLock, 0x3A: .altLeft, 0x3B: .controlLeft, 0x3C: .shiftRight,
        0x3D: .altRight, 0x3E: .controlRight, 0x3F: .fn, 0x40: .f17, 0x41: .numpadDecimal, 0x43: .numpadMultiply,
        0x45: .numpadAdd, 0x47: .numLock, 0x48: .audioVolumeUp, 0x49: .audioVolumeDown, 0x4A: .audioVolumeMute,
        0x4B: .numpadDivide, 0x4C: .numpadEnter, 0x4E: .numpadSubtract, 0x4F: .f18, 0x50: .f19, 0x51: .numpadEqual,
        0x52: .numpad0, 0x53: .numpad1, 0x54: .numpad2, 0x55: .numpad3, 0x56: .numpad4, 0x57: .numpad5,
        0x58: .numpad6, 0x59: .numpad7, 0x5A: .f20, 0x5B: .numpad8, 0x5C: .numpad9, 0x5D: .intlYen, 0x5E: .intlRo,
        0x5F: .numpadComma, 0x60: .f5, 0x61: .f6, 0x62: .f7, 0x63: .f3, 0x64: .f8, 0x65: .f9, 0x66: .nonConvert,
        0x67: .f11, 0x68: .kanaMode, 0x69: .f13, 0x6A: .f16, 0x6B: .f14, 0x6D: .f10, 0x6E: .contextMenu, 0x6F: .f12,
        0x71: .f15, 0x72: .insert, 0x73: .home, 0x74: .pageUp, 0x75: .delete, 0x76: .f4, 0x77: .end, 0x78: .f2,
        0x79: .pageDown, 0x7A: .f1, 0x7B: .arrowLeft, 0x7C: .arrowRight, 0x7D: .arrowDown, 0x7E: .arrowUp,
    ]

    private static let rightShift: UInt = 0x04
    private static let rightCommand: UInt = 0x10
    private static let leftOption: UInt = 0x20
    private static let rightOption: UInt = 0x40
    private static let rightControl: UInt = 0x2000

    static func modifiers(_ flags: NSEvent.ModifierFlags) -> TerminalModifiers {
        var modifiers: TerminalModifiers = []
        let raw = flags.rawValue
        if flags.contains(.shift) { modifiers.formUnion(raw & rightShift != 0 ? [.shift, .rightShift] : .shift) }
        if flags.contains(.control) { modifiers.formUnion(raw & rightControl != 0 ? [.control, .rightControl] : .control) }
        if flags.contains(.option) {
            modifiers.insert(.option)
            if raw & rightOption != 0, raw & leftOption == 0 { modifiers.insert(.rightOption) }
        }
        if flags.contains(.command) { modifiers.formUnion(raw & rightCommand != 0 ? [.command, .rightCommand] : .command) }
        if flags.contains(.capsLock) { modifiers.insert(.capsLock) }
        return modifiers
    }

    static func heldFlag(for key: TerminalKey) -> NSEvent.ModifierFlags {
        switch key {
        case .shiftLeft, .shiftRight: .shift
        case .controlLeft, .controlRight: .control
        case .altLeft, .altRight: .option
        case .metaLeft, .metaRight: .command
        case .capsLock: .capsLock
        default: []
        }
    }

    static func isOptionMeta(_ flags: NSEvent.ModifierFlags, _ setting: TerminalPreferences.OptionKey) -> Bool {
        guard flags.contains(.option) else { return false }
        switch setting {
        case .none: return false
        case .left: return flags.rawValue & leftOption != 0
        case .right: return flags.rawValue & rightOption != 0
        case .both: return true
        }
    }

    static func printable(_ text: String?) -> String {
        guard let text, let first = text.unicodeScalars.first else { return "" }
        if first.value < 0x20 || first.value == 0x7F || (0xF700...0xF8FF).contains(first.value) { return "" }
        return text
    }
}
