import Foundation

extension Lexer {
    mutating func string() -> UInt8? {
        let n = text.count
        let start = i
        var j = i
        if !language.stringPrefixes.isEmpty, Unit.isIdentifierStart(text[j]) {
            while j < n, j - start < 3, Unit.isLetter(text[j]) { j += 1 }
            guard j < n, text[j] == Unit.quote || text[j] == Unit.apostrophe || text[j] == Unit.hash,
                  language.stringPrefixes.contains(word(start, j))
            else { return nil }
        }
        var hashes = 0
        if language.rawHashes != .none {
            var k = j
            while k < n, text[k] == Unit.hash { k += 1 }
            let allowed = language.rawHashes == .swift || j > start
            if allowed, k > j, k < n, text[k] == Unit.quote {
                hashes = k - j
                j = k
            }
        }
        if language.lifetimes, j == start, text[j] == Unit.apostrophe, j + 1 < n, Unit.isIdentifierStart(text[j + 1]) {
            var k = j + 2
            while k < n, Unit.isIdentifierPart(text[k]) { k += 1 }
            if k >= n || text[k] != Unit.apostrophe {
                add(start, k, .variable)
                i = k
                return LexState.normal
            }
        }
        let raw = language.rawHashes == .rust && j > start && text[start] == 0x72
        for (index, rule) in language.strings.enumerated() where matches(rule.open, at: j) {
            i = j + rule.open.count
            let before = tokens.count
            let state = stringBody(rule: index, hashes: hashes, from: start, raw: raw)
            if state == LexState.normal, isKeyString() {
                for index in before..<tokens.count where Token.kind(tokens[index]) == .string {
                    let range = Token.range(tokens[index])
                    tokens[index] = Token.pack(range.location, range.length, .property)
                }
            }
            return state
        }
        return nil
    }

    func isKeyString() -> Bool {
        switch language.keyRule {
        case .json: return nextNonSpace(from: i) == Unit.colon
        case .colon: return colonEndsKey(from: i)
        case .none, .equals: return false
        }
    }

    mutating func stringBody(rule index: Int, hashes: Int, from start: Int, raw: Bool) -> UInt8 {
        guard language.strings.indices.contains(index) else { return LexState.normal }
        let rule = language.strings[index]
        let n = text.count
        var segment = start
        while i < n {
            let c = text[i]
            if c == Unit.backslash, rule.escapes, !raw {
                var j = i + 1
                var marks = 0
                while marks < hashes, j < n, text[j] == Unit.hash {
                    marks += 1
                    j += 1
                }
                guard marks == hashes, j < n else {
                    i = j
                    continue
                }
                if rule.interpolation == .swift, text[j] == Unit.openParen {
                    let close = matching(Unit.openParen, Unit.closeParen, from: j)
                    add(segment, i, .string)
                    add(i, j + 1, .escape)
                    nested(j + 1, close)
                    if close < n { add(close, close + 1, .escape) }
                    i = min(close + 1, n)
                    segment = i
                    continue
                }
                var end = j + 1
                if text[j] == 0x75, end < n, text[end] == Unit.openBrace {
                    while end < n, text[end] != Unit.closeBrace { end += 1 }
                    end = min(end + 1, n)
                }
                add(segment, i, .string)
                add(i, end, .escape)
                i = end
                segment = i
                continue
            }
            if rule.interpolation == .dollarBrace, c == Unit.dollar, i + 1 < n, text[i + 1] == Unit.openBrace {
                let close = matching(Unit.openBrace, Unit.closeBrace, from: i + 1)
                add(segment, i, .string)
                add(i, i + 2, .escape)
                nested(i + 2, close)
                if close < n { add(close, close + 1, .escape) }
                i = min(close + 1, n)
                segment = i
                continue
            }
            if rule.interpolation == .shell, c == Unit.dollar {
                let end = shellVariableEnd(from: i)
                if end > i + 1 {
                    add(segment, i, .string)
                    add(i, end, .variable)
                    i = end
                    segment = i
                    continue
                }
            }
            if matches(rule.close, at: i), hashesFollow(i + rule.close.count, count: hashes) {
                i += rule.close.count + hashes
                add(segment, i, .string)
                return LexState.normal
            }
            i += 1
        }
        add(segment, n, .string)
        return rule.multiline ? LexState.string(rule: index, hashes: hashes) : LexState.normal
    }

    func hashesFollow(_ start: Int, count: Int) -> Bool {
        guard start + count <= text.count else { return false }
        for k in 0..<count where text[start + k] != Unit.hash { return false }
        return true
    }

}
