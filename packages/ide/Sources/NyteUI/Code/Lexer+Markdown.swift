import Foundation

extension Lexer {
    mutating func markdown(_ state: UInt8) -> UInt8 {
        let n = text.count
        var indent = 0
        while indent < n, indent < 4, text[indent] == Unit.space { indent += 1 }
        let fence = fenceLength(at: indent)
        if state >> 5 == 3 {
            let tilde = state & 1 == 1
            if fence > 0, (text[indent] == Unit.tilde) == tilde {
                add(indent, n, .comment)
                return LexState.normal
            }
            add(0, n, .string)
            return state
        }
        if fence > 0 {
            add(indent, indent + fence, .comment)
            add(indent + fence, n, .attribute)
            return LexState.fence(tilde: text[indent] == Unit.tilde)
        }
        i = indent
        guard i < n else { return LexState.normal }
        if text[i] == Unit.hash {
            var j = i
            while j < n, text[j] == Unit.hash { j += 1 }
            if j - i <= 6, j == n || text[j] == Unit.space {
                add(i, n, .keyword)
                return LexState.normal
            }
        }
        if text[i] == Unit.greater {
            add(i, n, .comment)
            return LexState.normal
        }
        if isRule(from: i) {
            add(i, n, .comment)
            return LexState.normal
        }
        if i + 1 < n, [Unit.dash, Unit.star, Unit.plus].contains(text[i]), text[i + 1] == Unit.space {
            add(i, i + 1, .operator)
            i += 2
        } else {
            var j = i
            while j < n, Unit.isDigit(text[j]) { j += 1 }
            if j > i, j + 1 < n, text[j] == Unit.dot || text[j] == Unit.closeParen, text[j + 1] == Unit.space {
                add(i, j + 1, .operator)
                i = j + 2
            }
        }
        inline()
        return LexState.normal
    }

    func fenceLength(at start: Int) -> Int {
        guard start < text.count, text[start] == Unit.backtick || text[start] == Unit.tilde else { return 0 }
        var j = start
        while j < text.count, text[j] == text[start] { j += 1 }
        return j - start >= 3 ? j - start : 0
    }

    func isRule(from start: Int) -> Bool {
        let c = text[start]
        guard c == Unit.dash || c == Unit.star || c == Unit.underscore else { return false }
        var marks = 0
        for k in start..<text.count {
            if text[k] == c { marks += 1 } else if text[k] != Unit.space { return false }
        }
        return marks >= 3
    }

    mutating func inline() {
        let n = text.count
        while i < n {
            let c = text[i]
            switch c {
            case Unit.backslash:
                i += 2
            case Unit.backtick:
                let run = runLength(at: i)
                guard let close = findRun(of: c, length: run, from: i + run) else {
                    i += run
                    continue
                }
                add(i, close + run, .string)
                i = close + run
            case Unit.star, Unit.underscore:
                let run = min(runLength(at: i), 3)
                let opensWord = i + run < n && text[i + run] != Unit.space
                let boundary = c == Unit.star || i == 0 || !Unit.isIdentifierPart(text[i - 1])
                guard opensWord, boundary, let close = findRun(of: c, length: run, from: i + run) else {
                    i += run
                    continue
                }
                add(i, close + run, run == 2 ? .keyword : .variable)
                i = close + run
            case Unit.openBracket, Unit.bang:
                let open = c == Unit.bang ? i + 1 : i
                guard open < n, text[open] == Unit.openBracket,
                      let label = (open + 1..<n).first(where: { text[$0] == Unit.closeBracket }) else {
                    i += 1
                    continue
                }
                add(open + 1, label, .function)
                i = label + 1
                if i < n, text[i] == Unit.openParen, let end = (i..<n).first(where: { text[$0] == Unit.closeParen }) {
                    add(i + 1, end, .string)
                    i = end + 1
                }
            case Unit.less:
                guard matches(Array("<http".utf16), at: i), let end = (i..<n).first(where: { text[$0] == Unit.greater }) else {
                    i += 1
                    continue
                }
                add(i, end + 1, .string)
                i = end + 1
            default:
                i += 1
            }
        }
    }

    func runLength(at start: Int) -> Int {
        var j = start
        while j < text.count, text[j] == text[start] { j += 1 }
        return j - start
    }

    func findRun(of c: UInt16, length: Int, from start: Int) -> Int? {
        var j = start
        while j < text.count {
            guard text[j] == c else {
                j += 1
                continue
            }
            let run = runLength(at: j)
            if run >= length, c == Unit.backtick ? run == length : text[j - 1] != Unit.space { return j }
            j += run
        }
        return nil
    }

}
