enum TerminalKey: Sendable, Hashable, CaseIterable {
    case unidentified
    case a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z
    case digit0, digit1, digit2, digit3, digit4, digit5, digit6, digit7, digit8, digit9
    case minus, equal, bracketLeft, bracketRight, backslash, semicolon, quote, backquote, comma, period, slash
    case intlBackslash, intlYen, intlRo
    case enter, tab, space, backspace, escape, delete, insert, home, end, pageUp, pageDown
    case arrowLeft, arrowRight, arrowUp, arrowDown
    case capsLock, numLock, shiftLeft, shiftRight, controlLeft, controlRight, altLeft, altRight, metaLeft, metaRight
    case fn, contextMenu, nonConvert, kanaMode
    case f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20
    case numpad0, numpad1, numpad2, numpad3, numpad4, numpad5, numpad6, numpad7, numpad8, numpad9
    case numpadDecimal, numpadMultiply, numpadAdd, numpadDivide, numpadEnter, numpadSubtract, numpadEqual, numpadComma
    case audioVolumeUp, audioVolumeDown, audioVolumeMute

}

struct TerminalModifiers: OptionSet, Sendable, Hashable {
    let rawValue: UInt16

    static let shift = TerminalModifiers(rawValue: 1 << 0)
    static let control = TerminalModifiers(rawValue: 1 << 1)
    static let option = TerminalModifiers(rawValue: 1 << 2)
    static let command = TerminalModifiers(rawValue: 1 << 3)
    static let capsLock = TerminalModifiers(rawValue: 1 << 4)
    static let numLock = TerminalModifiers(rawValue: 1 << 5)
    static let rightShift = TerminalModifiers(rawValue: 1 << 6)
    static let rightControl = TerminalModifiers(rawValue: 1 << 7)
    static let rightOption = TerminalModifiers(rawValue: 1 << 8)
    static let rightCommand = TerminalModifiers(rawValue: 1 << 9)
}

enum KeyPhase: Sendable { case press, repeating, release }

struct KeyInput: Sendable {
    var phase: KeyPhase
    var key: TerminalKey
    var modifiers: TerminalModifiers
    var consumed: TerminalModifiers
    var text: String
    var unshifted: UInt32
}

enum MouseButton: Sendable { case none, left, right, middle, wheelUp, wheelDown }

struct PointerInput: Sendable {
    enum Phase: Sendable { case press, drag, release, motion }
    var phase: Phase
    var button: MouseButton
    var modifiers: TerminalModifiers
    var column: Int
    var row: Int
    var x: Double
    var y: Double
    var time: UInt64
    var repeatInterval: UInt64
    var forceSelection: Bool
}

struct ScrollInput: Sendable {
    var rows: Int
    var column: Int
    var row: Int
    var x: Double
    var y: Double
    var modifiers: TerminalModifiers
}

enum PasteOutcome: Sendable { case pasted, needsConfirmation }
