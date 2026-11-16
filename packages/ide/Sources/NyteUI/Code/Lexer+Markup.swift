import Foundation

extension Lexer {
    mutating func jsxTag() -> UInt8 {
        let n = text.count
        i += 1
        if i < n, text[i] == Unit.slash { i += 1 }
        let start = i
        while i < n, Unit.isIdentifierPart(text[i]) || text[i] == Unit.dot || text[i] == Unit.dash || text[i] == Unit.colon {
            i += 1
        }
        if i > start { add(start, i, Unit.isUpper(text[start]) ? .type : .tag) }
        let state = tagBody()
        expectsValue = true
        return state
    }

    mutating func tagBody() -> UInt8 {
        let n = text.count
        while i < n {
            let c = text[i]
            switch c {
            case Unit.space, Unit.tab:
                i += 1
            case Unit.greater:
                i += 1
                return LexState.normal
            case Unit.slash where i + 1 < n && text[i + 1] == Unit.greater,
                 Unit.question where i + 1 < n && text[i + 1] == Unit.greater:
                i += 2
                return LexState.normal
            case Unit.quote, Unit.apostrophe:
                let start = i
                i += 1
                while i < n, text[i] != c { i += 1 }
                i = min(i + 1, n)
                add(start, i, .string)
            case Unit.openBrace where language.family == .code:
                let close = matching(Unit.openBrace, Unit.closeBrace, from: i)
                nested(i + 1, close)
                i = min(close + 1, n)
            case Unit.equals:
                add(i, i + 1, .operator)
                i += 1
            default:
                guard Unit.isIdentifierStart(c) || c == Unit.colon || c == Unit.at else {
                    i += 1
                    continue
                }
                let start = i
                i += 1
                while i < n, Unit.isIdentifierPart(text[i]) || [Unit.dash, Unit.colon, Unit.dot].contains(text[i]) { i += 1 }
                add(start, i, .attribute)
            }
        }
        return LexState.tag
    }

    mutating func markup(_ state: UInt8) -> UInt8 {
        let resumed: UInt8 = switch state >> 5 {
        case 1: blockComment(from: 0, depth: 1)
        case 4: tagBody()
        default: LexState.normal
        }
        guard resumed == LexState.normal else { return resumed }
        let n = text.count
        while i < n {
            let c = text[i]
            if c == Unit.amp {
                let start = i
                var j = i + 1
                while j < n, j - start < 12, Unit.isIdentifierPart(text[j]) || text[j] == Unit.hash { j += 1 }
                if j < n, text[j] == Unit.semicolon, j > start + 1 {
                    add(start, j + 1, .escape)
                    i = j + 1
                } else {
                    i += 1
                }
                continue
            }
            guard c == Unit.less, i + 1 < n else {
                i += 1
                continue
            }
            let next = text[i + 1]
            if matches(language.blockOpen, at: i) {
                let start = i
                i += language.blockOpen.count
                let state = blockComment(from: start, depth: 1)
                if state != LexState.normal { return state }
            } else if matches(Array("<![CDATA[".utf16), at: i) {
                let start = i
                while i < n, !matches(Array("]]>".utf16), at: i) { i += 1 }
                i = min(i + 3, n)
                add(start, i, .string)
            } else if next == Unit.bang || next == Unit.question {
                let start = i
                while i < n, text[i] != Unit.greater { i += 1 }
                i = min(i + 1, n)
                add(start, i, .keyword)
            } else if Unit.isIdentifierStart(next) || next == Unit.slash {
                i += next == Unit.slash ? 2 : 1
                let start = i
                while i < n, Unit.isIdentifierPart(text[i]) || [Unit.dash, Unit.colon, Unit.dot].contains(text[i]) { i += 1 }
                add(start, i, .tag)
                let state = tagBody()
                if state != LexState.normal { return state }
            } else {
                i += 1
            }
        }
        return LexState.normal
    }

}
