import GhosttyVt

extension TerminalEngine {
    struct KeyTableReport: Equatable {
        var missing: [TerminalKey]
        var unidentified: [TerminalKey]
        var shared: [TerminalKey]
    }

    func encode(_ input: KeyInput) -> [UInt8] {
        Self.check(ghostty_key_encoder_set_from_terminal(keyEncoder, terminal), "key encoder state")
        var optionAsAlt = switch optionAsMeta {
        case .none: GHOSTTY_OPTION_AS_ALT_FALSE
        case .left: GHOSTTY_OPTION_AS_ALT_LEFT
        case .right: GHOSTTY_OPTION_AS_ALT_RIGHT
        case .both: GHOSTTY_OPTION_AS_ALT_TRUE
        }
        Self.check(ghostty_key_encoder_set(keyEncoder, GHOSTTY_KEY_ENCODER_OPT_MACOS_OPTION_AS_ALT, &optionAsAlt), "option as alt")
        let action = [KeyPhase.press: GHOSTTY_KEY_ACTION_PRESS, .repeating: GHOSTTY_KEY_ACTION_REPEAT, .release: GHOSTTY_KEY_ACTION_RELEASE]
        let fields = [ghostty_key_event_set_action(keyEvent, action[input.phase] ?? GHOSTTY_KEY_ACTION_PRESS),
                      ghostty_key_event_set_key(keyEvent, Self.keys[input.key] ?? GHOSTTY_KEY_UNIDENTIFIED),
                      ghostty_key_event_set_mods(keyEvent, Self.mods(input.modifiers)),
                      ghostty_key_event_set_consumed_mods(keyEvent, Self.mods(input.consumed)),
                      ghostty_key_event_set_unshifted_codepoint(keyEvent, input.unshifted),
                      ghostty_key_event_set_composing(keyEvent, false)]
        guard fields.allSatisfy({ Self.check($0, "key event") }) else { return [] }
        return Array(input.text.utf8).withUnsafeBufferPointer { buffer in
            guard Self.check(ghostty_key_event_set_utf8(keyEvent, GhosttyString(ptr: buffer.baseAddress, len: buffer.count)), "key text")
            else { return [] }
            defer { _ = ghostty_key_event_set_utf8(keyEvent, GhosttyString(ptr: nil, len: 0)) }
            return encode("key") { ghostty_key_encoder_encode(keyEncoder, keyEvent, $0, $1, $2) }
        }
    }

    func paste(_ string: String, confirmed: Bool) -> [UInt8]? {
        let bracketed = mode(2004)
        var data = Array(string.utf8)
        let safe = bracketed ? !string.contains("\u{1B}[201~") : data.withUnsafeBufferPointer {
            $0.withMemoryRebound(to: CChar.self) { ghostty_paste_is_safe($0.baseAddress, $0.count) }
        }
        guard safe || confirmed else { return nil }
        return data.withUnsafeMutableBufferPointer { text in
            text.withMemoryRebound(to: CChar.self) { chars in
                encode("paste") { ghostty_paste_encode(chars.baseAddress, chars.count, bracketed, $0, $1, $2) }
            }
        }
    }

    func encodeFocus(_ gained: Bool) -> [UInt8] {
        guard mode(1004) else { return [] }
        return encode("focus") { ghostty_focus_encode(gained ? GHOSTTY_FOCUS_GAINED : GHOSTTY_FOCUS_LOST, $0, $1, $2) }
    }

    func encodePointer(_ input: PointerInput, anyButtonPressed: Bool) -> [UInt8] {
        Self.check(ghostty_mouse_encoder_set_from_terminal(mouseEncoder, terminal), "mouse encoder state")
        var size = GhosttyMouseEncoderSize()
        size.size = MemoryLayout<GhosttyMouseEncoderSize>.size
        size.screen_width = UInt32(grid.columns) * grid.cellWidth
        size.screen_height = UInt32(grid.rows) * grid.cellHeight
        size.cell_width = grid.cellWidth
        size.cell_height = grid.cellHeight
        var pressed = anyButtonPressed
        guard Self.check(ghostty_mouse_encoder_set(mouseEncoder, GHOSTTY_MOUSE_ENCODER_OPT_SIZE, &size), "mouse size"),
              Self.check(ghostty_mouse_encoder_set(mouseEncoder, GHOSTTY_MOUSE_ENCODER_OPT_ANY_BUTTON_PRESSED, &pressed), "mouse buttons")
        else { return [] }
        let action = input.phase == .press ? GHOSTTY_MOUSE_ACTION_PRESS
            : input.phase == .release ? GHOSTTY_MOUSE_ACTION_RELEASE : GHOSTTY_MOUSE_ACTION_MOTION
        let fields = [ghostty_mouse_event_set_action(mouseEvent, action),
                      input.phase == .motion || input.button == .none ? ghostty_mouse_event_clear_button(mouseEvent)
                          : ghostty_mouse_event_set_button(mouseEvent, Self.buttons[input.button] ?? GHOSTTY_MOUSE_BUTTON_UNKNOWN),
                      ghostty_mouse_event_set_mods(mouseEvent, Self.mods(input.modifiers)),
                      ghostty_mouse_event_set_position(mouseEvent, GhosttyMousePosition(x: Float(input.x), y: Float(input.y)))]
        guard fields.allSatisfy({ Self.check($0, "mouse event") }) else { return [] }
        return encode("pointer") { ghostty_mouse_encoder_encode(mouseEncoder, mouseEvent, $0, $1, $2) }
    }

    static func checkKeyTable() -> KeyTableReport {
        let mapped = TerminalKey.allCases.compactMap { key in keys[key].map { (key, $0.rawValue) } }
        let counts = Dictionary(mapped.map { ($0.1, 1) }, uniquingKeysWith: +)
        return KeyTableReport(
            missing: TerminalKey.allCases.filter { keys[$0] == nil },
            unidentified: mapped.filter { $0.0 != .unidentified && $0.1 == GHOSTTY_KEY_UNIDENTIFIED.rawValue }.map(\.0),
            shared: mapped.filter { (counts[$0.1] ?? 0) > 1 }.map(\.0)
        )
    }

    static func mods(_ modifiers: TerminalModifiers) -> GhosttyMods {
        let pairs: [(TerminalModifiers, Int32)] = [
            (.shift, GHOSTTY_MODS_SHIFT), (.control, GHOSTTY_MODS_CTRL), (.option, GHOSTTY_MODS_ALT), (.command, GHOSTTY_MODS_SUPER),
            (.capsLock, GHOSTTY_MODS_CAPS_LOCK), (.numLock, GHOSTTY_MODS_NUM_LOCK), (.rightShift, GHOSTTY_MODS_SHIFT_SIDE),
            (.rightControl, GHOSTTY_MODS_CTRL_SIDE), (.rightOption, GHOSTTY_MODS_ALT_SIDE), (.rightCommand, GHOSTTY_MODS_SUPER_SIDE),
        ]
        return pairs.reduce(0) { mods, pair in modifiers.contains(pair.0) ? mods | GhosttyMods(pair.1) : mods }
    }

    static let buttons: [MouseButton: GhosttyMouseButton] = [
        .none: GHOSTTY_MOUSE_BUTTON_UNKNOWN, .left: GHOSTTY_MOUSE_BUTTON_LEFT, .right: GHOSTTY_MOUSE_BUTTON_RIGHT,
        .middle: GHOSTTY_MOUSE_BUTTON_MIDDLE, .wheelUp: GHOSTTY_MOUSE_BUTTON_FOUR, .wheelDown: GHOSTTY_MOUSE_BUTTON_FIVE,
    ]

    private static let keys: [TerminalKey: GhosttyKey] = [
        .unidentified: GHOSTTY_KEY_UNIDENTIFIED, .a: GHOSTTY_KEY_A, .b: GHOSTTY_KEY_B, .c: GHOSTTY_KEY_C, .d: GHOSTTY_KEY_D,
        .e: GHOSTTY_KEY_E, .f: GHOSTTY_KEY_F, .g: GHOSTTY_KEY_G, .h: GHOSTTY_KEY_H, .i: GHOSTTY_KEY_I, .j: GHOSTTY_KEY_J,
        .k: GHOSTTY_KEY_K, .l: GHOSTTY_KEY_L, .m: GHOSTTY_KEY_M, .n: GHOSTTY_KEY_N, .o: GHOSTTY_KEY_O, .p: GHOSTTY_KEY_P,
        .q: GHOSTTY_KEY_Q, .r: GHOSTTY_KEY_R, .s: GHOSTTY_KEY_S, .t: GHOSTTY_KEY_T, .u: GHOSTTY_KEY_U, .v: GHOSTTY_KEY_V,
        .w: GHOSTTY_KEY_W, .x: GHOSTTY_KEY_X, .y: GHOSTTY_KEY_Y, .z: GHOSTTY_KEY_Z, .digit0: GHOSTTY_KEY_DIGIT_0,
        .digit1: GHOSTTY_KEY_DIGIT_1, .digit2: GHOSTTY_KEY_DIGIT_2, .digit3: GHOSTTY_KEY_DIGIT_3, .digit4: GHOSTTY_KEY_DIGIT_4,
        .digit5: GHOSTTY_KEY_DIGIT_5, .digit6: GHOSTTY_KEY_DIGIT_6, .digit7: GHOSTTY_KEY_DIGIT_7, .digit8: GHOSTTY_KEY_DIGIT_8,
        .digit9: GHOSTTY_KEY_DIGIT_9, .minus: GHOSTTY_KEY_MINUS, .equal: GHOSTTY_KEY_EQUAL, .bracketLeft: GHOSTTY_KEY_BRACKET_LEFT,
        .bracketRight: GHOSTTY_KEY_BRACKET_RIGHT, .backslash: GHOSTTY_KEY_BACKSLASH, .semicolon: GHOSTTY_KEY_SEMICOLON,
        .quote: GHOSTTY_KEY_QUOTE, .backquote: GHOSTTY_KEY_BACKQUOTE, .comma: GHOSTTY_KEY_COMMA, .period: GHOSTTY_KEY_PERIOD,
        .slash: GHOSTTY_KEY_SLASH, .intlBackslash: GHOSTTY_KEY_INTL_BACKSLASH, .intlYen: GHOSTTY_KEY_INTL_YEN,
        .intlRo: GHOSTTY_KEY_INTL_RO, .enter: GHOSTTY_KEY_ENTER, .tab: GHOSTTY_KEY_TAB, .space: GHOSTTY_KEY_SPACE,
        .backspace: GHOSTTY_KEY_BACKSPACE, .escape: GHOSTTY_KEY_ESCAPE, .delete: GHOSTTY_KEY_DELETE, .insert: GHOSTTY_KEY_INSERT,
        .home: GHOSTTY_KEY_HOME, .end: GHOSTTY_KEY_END, .pageUp: GHOSTTY_KEY_PAGE_UP, .pageDown: GHOSTTY_KEY_PAGE_DOWN,
        .arrowLeft: GHOSTTY_KEY_ARROW_LEFT, .arrowRight: GHOSTTY_KEY_ARROW_RIGHT, .arrowUp: GHOSTTY_KEY_ARROW_UP,
        .arrowDown: GHOSTTY_KEY_ARROW_DOWN, .capsLock: GHOSTTY_KEY_CAPS_LOCK, .numLock: GHOSTTY_KEY_NUM_LOCK,
        .shiftLeft: GHOSTTY_KEY_SHIFT_LEFT, .shiftRight: GHOSTTY_KEY_SHIFT_RIGHT, .controlLeft: GHOSTTY_KEY_CONTROL_LEFT,
        .controlRight: GHOSTTY_KEY_CONTROL_RIGHT, .altLeft: GHOSTTY_KEY_ALT_LEFT, .altRight: GHOSTTY_KEY_ALT_RIGHT,
        .metaLeft: GHOSTTY_KEY_META_LEFT, .metaRight: GHOSTTY_KEY_META_RIGHT, .fn: GHOSTTY_KEY_FN,
        .contextMenu: GHOSTTY_KEY_CONTEXT_MENU, .nonConvert: GHOSTTY_KEY_NON_CONVERT, .kanaMode: GHOSTTY_KEY_KANA_MODE,
        .f1: GHOSTTY_KEY_F1, .f2: GHOSTTY_KEY_F2, .f3: GHOSTTY_KEY_F3, .f4: GHOSTTY_KEY_F4, .f5: GHOSTTY_KEY_F5,
        .f6: GHOSTTY_KEY_F6, .f7: GHOSTTY_KEY_F7, .f8: GHOSTTY_KEY_F8, .f9: GHOSTTY_KEY_F9, .f10: GHOSTTY_KEY_F10,
        .f11: GHOSTTY_KEY_F11, .f12: GHOSTTY_KEY_F12, .f13: GHOSTTY_KEY_F13, .f14: GHOSTTY_KEY_F14, .f15: GHOSTTY_KEY_F15,
        .f16: GHOSTTY_KEY_F16, .f17: GHOSTTY_KEY_F17, .f18: GHOSTTY_KEY_F18, .f19: GHOSTTY_KEY_F19, .f20: GHOSTTY_KEY_F20,
        .numpad0: GHOSTTY_KEY_NUMPAD_0, .numpad1: GHOSTTY_KEY_NUMPAD_1, .numpad2: GHOSTTY_KEY_NUMPAD_2,
        .numpad3: GHOSTTY_KEY_NUMPAD_3, .numpad4: GHOSTTY_KEY_NUMPAD_4, .numpad5: GHOSTTY_KEY_NUMPAD_5,
        .numpad6: GHOSTTY_KEY_NUMPAD_6, .numpad7: GHOSTTY_KEY_NUMPAD_7, .numpad8: GHOSTTY_KEY_NUMPAD_8,
        .numpad9: GHOSTTY_KEY_NUMPAD_9, .numpadDecimal: GHOSTTY_KEY_NUMPAD_DECIMAL, .numpadMultiply: GHOSTTY_KEY_NUMPAD_MULTIPLY,
        .numpadAdd: GHOSTTY_KEY_NUMPAD_ADD, .numpadDivide: GHOSTTY_KEY_NUMPAD_DIVIDE, .numpadEnter: GHOSTTY_KEY_NUMPAD_ENTER,
        .numpadSubtract: GHOSTTY_KEY_NUMPAD_SUBTRACT, .numpadEqual: GHOSTTY_KEY_NUMPAD_EQUAL,
        .numpadComma: GHOSTTY_KEY_NUMPAD_COMMA, .audioVolumeUp: GHOSTTY_KEY_AUDIO_VOLUME_UP,
        .audioVolumeDown: GHOSTTY_KEY_AUDIO_VOLUME_DOWN, .audioVolumeMute: GHOSTTY_KEY_AUDIO_VOLUME_MUTE,
    ]
}
