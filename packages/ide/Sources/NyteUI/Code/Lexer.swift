import Foundation

public enum Token {
    public static func pack(_ start: Int, _ length: Int, _ kind: SyntaxColor) -> UInt64 {
        UInt64(truncatingIfNeeded: start) << 32 | UInt64(min(length, 0xFF_FFFF)) << 8 | UInt64(kind.rawValue)
    }

    public static func range(_ token: UInt64) -> NSRange {
        NSRange(location: Int(token >> 32), length: Int(token >> 8 & 0xFF_FFFF))
    }

    public static func kind(_ token: UInt64) -> SyntaxColor { SyntaxColor(rawValue: UInt8(token & 0xFF)) ?? .plain }
}

public enum LexState {
    public static let normal: UInt8 = 0
    static let tag: UInt8 = 4 << 5

    static func comment(depth: Int) -> UInt8 { 1 << 5 | UInt8(min(depth, 31)) }
    static func string(rule: Int, hashes: Int) -> UInt8 { 2 << 5 | UInt8(min(hashes, 3)) << 3 | UInt8(rule & 7) }
    static func fence(tilde: Bool) -> UInt8 { 3 << 5 | (tilde ? 1 : 0) }
}

public struct Lexer {
    let language: Language
    let text: UnsafeBufferPointer<UInt16>
    let offset: Int
    let emit: Bool
    var tokens: [UInt64] = []
    var i = 0
    var expectsValue = true

    public static func line(_ text: UnsafeBufferPointer<UInt16>, state: UInt8, language: Language, offset: Int,
                     tokens: inout [UInt64], emit: Bool) -> UInt8 {
        var lexer = Lexer(language: language, text: text, offset: offset, emit: emit)
        swap(&lexer.tokens, &tokens)
        let end = lexer.run(state)
        swap(&lexer.tokens, &tokens)
        return end
    }

    private mutating func run(_ state: UInt8) -> UInt8 {
        switch language.family {
        case .plain: LexState.normal
        case .markdown: markdown(state)
        case .markup: markup(state)
        case .code: code(state)
        }
    }


    mutating func nested(_ start: Int, _ end: Int) {
        guard emit, end > start else { return }
        var inner = Lexer(
            language: language, text: UnsafeBufferPointer(rebasing: text[start..<end]), offset: offset + start, emit: true
        )
        swap(&inner.tokens, &tokens)
        _ = inner.codeLoop()
        swap(&inner.tokens, &tokens)
    }

    func matching(_ open: UInt16, _ close: UInt16, from start: Int) -> Int {
        var depth = 0
        var j = start
        while j < text.count {
            let c = text[j]
            if (c == Unit.quote || c == Unit.apostrophe || c == Unit.backtick) && c != open {
                j += 1
                while j < text.count, text[j] != c {
                    j += text[j] == Unit.backslash ? 2 : 1
                }
            } else if c == open {
                depth += 1
            } else if c == close {
                depth -= 1
                if depth == 0 { return j }
            }
            j += 1
        }
        return text.count
    }

    mutating func add(_ start: Int, _ end: Int, _ kind: SyntaxColor) {
        guard emit, end > start, kind != .plain else { return }
        tokens.append(Token.pack(offset + start, end - start, kind))
    }

    func matches(_ pattern: [UInt16], at index: Int) -> Bool {
        guard !pattern.isEmpty, index + pattern.count <= text.count else { return false }
        for k in 0..<pattern.count where text[index + k] != pattern[k] { return false }
        return true
    }

    func word(_ start: Int, _ end: Int) -> String {
        String(decoding: UnsafeBufferPointer(rebasing: text[start..<end]), as: UTF16.self)
    }

    func isLineStart(_ index: Int) -> Bool {
        for k in 0..<index where text[k] != Unit.space && text[k] != Unit.tab { return false }
        return true
    }

    func isAllCaps(_ start: Int, _ end: Int) -> Bool {
        guard end - start > 1 else { return false }
        var letters = 0
        for k in start..<end {
            let c = text[k]
            if c >= 0x61 && c <= 0x7A { return false }
            if Unit.isUpper(c) { letters += 1 }
        }
        return letters > 0
    }
}
