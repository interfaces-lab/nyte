import Foundation

extension Lexer {
    enum Unit {
        static let tab: UInt16 = 9, space: UInt16 = 32, bang: UInt16 = 33, quote: UInt16 = 34, hash: UInt16 = 35
        static let dollar: UInt16 = 36, percent: UInt16 = 37, amp: UInt16 = 38, apostrophe: UInt16 = 39
        static let openParen: UInt16 = 40, closeParen: UInt16 = 41, star: UInt16 = 42, plus: UInt16 = 43
        static let comma: UInt16 = 44, dash: UInt16 = 45, dot: UInt16 = 46, slash: UInt16 = 47, zero: UInt16 = 48
        static let nine: UInt16 = 57, colon: UInt16 = 58, semicolon: UInt16 = 59, less: UInt16 = 60, equals: UInt16 = 61
        static let greater: UInt16 = 62, question: UInt16 = 63, at: UInt16 = 64, openBracket: UInt16 = 91
        static let backslash: UInt16 = 92, closeBracket: UInt16 = 93, underscore: UInt16 = 95, backtick: UInt16 = 96
        static let openBrace: UInt16 = 123, closeBrace: UInt16 = 125, tilde: UInt16 = 126

        static func isDigit(_ c: UInt16) -> Bool { c >= zero && c <= nine }
        static func isUpper(_ c: UInt16) -> Bool { c >= 0x41 && c <= 0x5A }
        static func isLetter(_ c: UInt16) -> Bool { (c >= 0x61 && c <= 0x7A) || isUpper(c) }
        static func isHexDigit(_ c: UInt16) -> Bool { isDigit(c) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46) }
        static func isIdentifierStart(_ c: UInt16) -> Bool { isLetter(c) || c == underscore || c >= 0x80 }
        static func isIdentifierPart(_ c: UInt16) -> Bool { isIdentifierStart(c) || isDigit(c) }

        static func isOperator(_ c: UInt16) -> Bool {
            switch c {
            case 0x21, 0x25, 0x26, 0x2A, 0x2B, 0x2D, 0x2F, 0x3C, 0x3D, 0x3E, 0x3F, 0x5E, 0x7C, 0x7E: true
            default: false
            }
        }
    }
}
