import Foundation

extension Lexer {
    mutating func code(_ state: UInt8) -> UInt8 {
        let resumed: UInt8 = switch state >> 5 {
        case 1: blockComment(from: 0, depth: Int(state & 0x1F))
        case 2: stringBody(rule: Int(state & 7), hashes: Int(state >> 3 & 3), from: 0, raw: false)
        case 4: tagBody()
        default: LexState.normal
        }
        guard resumed == LexState.normal else { return resumed }
        return codeLoop()
    }

    mutating func codeLoop() -> UInt8 {
        let n = text.count
        while i < n {
            let c = text[i]
            if c == Unit.space || c == Unit.tab {
                i += 1
                continue
            }
            if startsLineComment() {
                add(i, n, .comment)
                i = n
                return LexState.normal
            }
            if !language.blockOpen.isEmpty, matches(language.blockOpen, at: i) {
                let start = i
                i += language.blockOpen.count
                let state = blockComment(from: start, depth: 1)
                if state != LexState.normal { return state }
                continue
            }
            if let state = string() {
                if state != LexState.normal { return state }
                expectsValue = false
                continue
            }
            if Unit.isDigit(c) || (c == Unit.dot && i + 1 < n && Unit.isDigit(text[i + 1]) && !(i > 0 && text[i - 1] == Unit.dot)) {
                number()
                expectsValue = false
                continue
            }
            if Unit.isIdentifierStart(c) {
                identifier()
                continue
            }
            if let state = special(c) {
                if state != LexState.normal { return state }
                continue
            }
            punctuation(c)
        }
        return LexState.normal
    }

    func startsLineComment() -> Bool {
        let marker = language.lineCommentUnits
        guard !marker.isEmpty, matches(marker, at: i) else { return false }
        return !language.commentNeedsSpace || i == 0 || text[i - 1] == Unit.space || text[i - 1] == Unit.tab
    }

    mutating func blockComment(from start: Int, depth: Int) -> UInt8 {
        let n = text.count
        var depth = depth
        while i < n {
            if matches(language.blockClose, at: i) {
                i += language.blockClose.count
                depth -= 1
                if depth == 0 {
                    add(start, i, .comment)
                    return LexState.normal
                }
                continue
            }
            if language.nestedComments, matches(language.blockOpen, at: i) {
                i += language.blockOpen.count
                depth += 1
                continue
            }
            i += 1
        }
        add(start, n, .comment)
        return LexState.comment(depth: max(depth, 1))
    }


    mutating func number() {
        let n = text.count
        let start = i
        if text[i] == Unit.zero, i + 1 < n, [0x78, 0x58, 0x62, 0x42, 0x6F, 0x4F].contains(text[i + 1]) {
            i += 2
            while i < n, Unit.isIdentifierPart(text[i]) { i += 1 }
            return add(start, i, .number)
        }
        if text[i] == Unit.dot { i += 1 }
        while i < n, Unit.isDigit(text[i]) || text[i] == Unit.underscore { i += 1 }
        if i + 1 < n, text[i] == Unit.dot, Unit.isDigit(text[i + 1]) {
            i += 1
            while i < n, Unit.isDigit(text[i]) || text[i] == Unit.underscore { i += 1 }
        }
        if i < n, text[i] == 0x65 || text[i] == 0x45 {
            var j = i + 1
            if j < n, text[j] == Unit.plus || text[j] == Unit.dash { j += 1 }
            if j < n, Unit.isDigit(text[j]) {
                i = j
                while i < n, Unit.isDigit(text[i]) { i += 1 }
            }
        }
        while i < n, Unit.isIdentifierPart(text[i]) || (language.hashRule == .css && text[i] == Unit.percent) { i += 1 }
        add(start, i, .number)
    }

    mutating func identifier() {
        let n = text.count
        let start = i
        i += 1
        while i < n {
            let c = text[i]
            if Unit.isIdentifierPart(c) || (c == Unit.dollar && language.dollarInIdentifiers) {
                i += 1
            } else if c == Unit.dash, language.dashInIdentifiers, i + 1 < n, Unit.isIdentifierPart(text[i + 1]) {
                i += 1
            } else {
                break
            }
        }
        if language.macros, i < n, text[i] == Unit.bang, !(i + 1 < n && text[i + 1] == Unit.equals) {
            i += 1
            add(start, i, .function)
            expectsValue = true
            return
        }
        let calls = i < n && text[i] == Unit.openParen
        if start > 0, text[start - 1] == Unit.dot, !(start > 1 && text[start - 2] == Unit.dot) {
            add(start, i, calls ? .function : .property)
            expectsValue = false
            return
        }
        guard emit || language.jsx || language.regexLiterals else { return expectsValue = false }
        if isKey(start) {
            add(start, i, .property)
            expectsValue = true
            return
        }
        let name = word(start, i)
        let kind: SyntaxColor = if language.keywords.contains(name) {
            .keyword
        } else if language.literals.contains(name) {
            .constant
        } else if language.variables.contains(name) {
            .variable
        } else if language.builtins.contains(name) {
            .builtin
        } else if calls {
            .function
        } else if language.capsConstants, isAllCaps(start, i) {
            .constant
        } else if language.capitalTypes, Unit.isUpper(text[start]) {
            .type
        } else {
            .plain
        }
        expectsValue = kind == .keyword
        add(start, i, kind)
    }

    func isKey(_ start: Int) -> Bool {
        switch language.keyRule {
        case .none, .json:
            return false
        case .colon:
            return colonEndsKey(from: i)
        case .equals:
            for k in 0..<start where text[k] != Unit.space && text[k] != Unit.tab { return false }
            return nextNonSpace(from: i) == Unit.equals
        }
    }

    func colonEndsKey(from start: Int) -> Bool {
        var j = start
        while j < text.count, text[j] == Unit.space { j += 1 }
        guard j < text.count, text[j] == Unit.colon else { return false }
        return j + 1 == text.count || text[j + 1] == Unit.space || text[j + 1] == Unit.tab
    }

    func nextNonSpace(from start: Int) -> UInt16? {
        var j = start
        while j < text.count, text[j] == Unit.space || text[j] == Unit.tab { j += 1 }
        return j < text.count ? text[j] : nil
    }

    mutating func special(_ c: UInt16) -> UInt8? {
        let n = text.count
        let next: UInt16 = i + 1 < n ? text[i + 1] : 0
        switch c {
        case Unit.at where language.atKind != nil && Unit.isIdentifierStart(next):
            let start = i
            i += 1
            while i < n, Unit.isIdentifierPart(text[i]) || (text[i] == Unit.dot && i + 1 < n && Unit.isIdentifierStart(text[i + 1])) {
                i += 1
            }
            add(start, i, language.atKind ?? .attribute)
            expectsValue = true
            return LexState.normal
        case Unit.hash:
            return hash(next)
        case Unit.dollar where language.dollarVariables:
            let end = shellVariableEnd(from: i)
            guard end > i + 1 else { return nil }
            add(i, end, .variable)
            i = end
            expectsValue = false
            return LexState.normal
        case Unit.less where language.jsx && expectsValue
            && (Unit.isIdentifierStart(next) || next == Unit.greater || next == Unit.slash):
            return jsxTag()
        case Unit.slash where language.regexLiterals && expectsValue && next != Unit.slash && next != Unit.star:
            return regex() ? LexState.normal : nil
        case Unit.amp where language.yamlSigils && Unit.isIdentifierStart(next),
             Unit.star where language.yamlSigils && Unit.isIdentifierStart(next):
            let start = i
            i += 1
            while i < n, Unit.isIdentifierPart(text[i]) || text[i] == Unit.dash { i += 1 }
            add(start, i, .variable)
            return LexState.normal
        case Unit.bang where language.yamlSigils:
            let start = i
            while i < n, text[i] != Unit.space { i += 1 }
            add(start, i, .attribute)
            return LexState.normal
        case Unit.dash where language.yamlSigils && i == 0 && matches(Array("---".utf16), at: 0):
            i = 3
            add(0, 3, .keyword)
            return LexState.normal
        case Unit.openBracket where language.tableHeaders && isLineStart(i):
            let start = i
            while i < n, text[i] != Unit.closeBracket { i += 1 }
            while i < n, text[i] == Unit.closeBracket { i += 1 }
            add(start, i, .type)
            return LexState.normal
        default:
            return nil
        }
    }

    mutating func hash(_ next: UInt16) -> UInt8? {
        let n = text.count
        let start = i
        switch language.hashRule {
        case .swift where Unit.isIdentifierStart(next):
            i += 1
            while i < n, Unit.isIdentifierPart(text[i]) { i += 1 }
            add(start, i, .keyword)
        case .c where isLineStart(i):
            i += 1
            while i < n, text[i] == Unit.space || text[i] == Unit.tab { i += 1 }
            while i < n, Unit.isIdentifierPart(text[i]) { i += 1 }
            add(start, i, .keyword)
            while i < n, text[i] == Unit.space { i += 1 }
            if i < n, text[i] == Unit.less, let close = (i..<n).first(where: { text[$0] == Unit.greater }) {
                add(i, close + 1, .string)
                i = close + 1
            }
        case .rust where next == Unit.openBracket || (next == Unit.bang && i + 2 < n && text[i + 2] == Unit.openBracket):
            let close = matching(Unit.openBracket, Unit.closeBracket, from: next == Unit.bang ? i + 2 : i + 1)
            i = min(close + 1, n)
            add(start, i, .attribute)
        case .css where Unit.isIdentifierPart(next):
            i += 1
            while i < n, Unit.isIdentifierPart(text[i]) || text[i] == Unit.dash { i += 1 }
            let digits = i - start - 1
            let hex = (start + 1..<i).allSatisfy { Unit.isHexDigit(text[$0]) }
            add(start, i, hex && [3, 4, 6, 8].contains(digits) ? .number : .type)
        default:
            return nil
        }
        return LexState.normal
    }

    mutating func punctuation(_ c: UInt16) {
        switch c {
        case Unit.closeParen, Unit.closeBracket, Unit.closeBrace:
            expectsValue = false
            i += 1
        case Unit.openParen, Unit.openBracket, Unit.openBrace, Unit.comma, Unit.semicolon, Unit.colon, Unit.dot:
            expectsValue = true
            i += 1
        default:
            guard Unit.isOperator(c) else {
                i += 1
                return
            }
            let start = i
            i += 1
            while i < text.count, Unit.isOperator(text[i]), !startsComment(at: i) { i += 1 }
            add(start, i, .operator)
            expectsValue = true
        }
    }

    func startsComment(at index: Int) -> Bool {
        (!language.lineCommentUnits.isEmpty && matches(language.lineCommentUnits, at: index))
            || (!language.blockOpen.isEmpty && matches(language.blockOpen, at: index))
    }

    mutating func regex() -> Bool {
        let n = text.count
        var j = i + 1
        var inClass = false
        while j < n {
            let c = text[j]
            if c == Unit.backslash {
                j += 2
                continue
            }
            if c == Unit.openBracket {
                inClass = true
            } else if c == Unit.closeBracket {
                inClass = false
            } else if c == Unit.slash, !inClass {
                j += 1
                while j < n, Unit.isLetter(text[j]) { j += 1 }
                add(i, j, .string)
                i = j
                expectsValue = false
                return true
            }
            j += 1
        }
        return false
    }

    func shellVariableEnd(from start: Int) -> Int {
        let n = text.count
        guard start + 1 < n else { return start + 1 }
        let next = text[start + 1]
        if next == Unit.openBrace { return min(matching(Unit.openBrace, Unit.closeBrace, from: start + 1) + 1, n) }
        if next == Unit.openParen { return start + 2 }
        if Unit.isIdentifierStart(next) {
            var j = start + 2
            while j < n, Unit.isIdentifierPart(text[j]) { j += 1 }
            return j
        }
        if Unit.isDigit(next) || [Unit.at, Unit.star, Unit.hash, Unit.question, Unit.dollar, Unit.bang, Unit.dash].contains(next) {
            return start + 2
        }
        return start + 1
    }
}
