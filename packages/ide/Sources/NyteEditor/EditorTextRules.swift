import Foundation
import NyteCore
import NyteUI

enum Indentation {
    static func leadingWhitespace(before location: Int, in text: some UnitString) -> String {
        var start = min(location, text.length)
        while start > 0, text.character(at: start - 1) != LineIndex.newline { start -= 1 }
        var end = start
        while end < location, text.character(at: end) == TextCommands.space || text.character(at: end) == TextCommands.tab { end += 1 }
        return text.substring(with: NSRange(location: start, length: end - start))
    }
}

enum GoToLine {
    static func parse(_ input: String) -> TextPosition? {
        let parts = input.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), let line = Int(parts[0]), line > 0 else { return nil }
        guard parts.count == 2 else { return TextPosition(line: line - 1, column: 0) }
        guard let column = Int(parts[1]), column > 0 else { return nil }
        return TextPosition(line: line - 1, column: column - 1)
    }
}

enum SelectionScope {
    static let reach = 100_000
    private static let opens: [UInt16] = [0x28, 0x5B, 0x7B]
    private static let closes: [UInt16] = [0x29, 0x5D, 0x7D]

    static func expand(_ selection: NSRange, in text: some UnitString, isQuoted: (Int) -> Bool) -> NSRange? {
        if let word = Identifier.range(at: selection.location, in: text), NSIntersectionRange(word, selection) == selection,
           word != selection {
            return word
        }
        guard let (open, close) = enclosingPair(of: selection, in: text, isQuoted: isQuoted) else {
            let all = NSRange(location: 0, length: text.length)
            return selection == all ? nil : all
        }
        let inside = NSRange(location: open + 1, length: close - open - 1)
        if NSIntersectionRange(inside, selection) == selection, inside != selection, inside.length > 0 { return inside }
        return NSRange(location: open, length: close - open + 1)
    }

    private static func enclosingPair(of selection: NSRange, in text: some UnitString, isQuoted: (Int) -> Bool) -> (Int, Int)? {
        var depth = 0
        var index = selection.location - 1
        let floor = max(0, selection.location - reach)
        while index >= floor {
            defer { index -= 1 }
            let unit = text.character(at: index)
            guard !isQuoted(index) else { continue }
            if closes.contains(unit) { depth += 1 }
            guard let kind = opens.firstIndex(of: unit) else { continue }
            if depth > 0 {
                depth -= 1
                continue
            }
            if let close = partner(of: index, kind: kind, in: text, isQuoted: isQuoted), close >= NSMaxRange(selection) {
                return (index, close)
            }
        }
        return nil
    }

    private static func partner(of open: Int, kind: Int, in text: some UnitString, isQuoted: (Int) -> Bool) -> Int? {
        var depth = 0
        var index = open + 1
        let ceiling = min(text.length, open + reach)
        while index < ceiling {
            defer { index += 1 }
            let unit = text.character(at: index)
            guard unit == opens[kind] || unit == closes[kind], !isQuoted(index) else { continue }
            if unit == opens[kind] { depth += 1 } else if depth == 0 { return index } else { depth -= 1 }
        }
        return nil
    }
}

enum SaveCleanup {
    static func edits(in text: some UnitString, lines: LineIndex, trimsTrailingWhitespace: Bool, ensuresFinalNewline: Bool,
                      keepingLine kept: Int?) -> [(range: NSRange, text: String)] {
        var edits: [(range: NSRange, text: String)] = []
        if trimsTrailingWhitespace {
            for line in 0..<lines.count where line != kept {
                let range = lines.range(of: line, length: text.length)
                var end = NSMaxRange(range)
                while end > range.location, [UInt16(UInt8(ascii: " ")), UInt16(UInt8(ascii: "\t"))].contains(text.character(at: end - 1)) {
                    end -= 1
                }
                if end < NSMaxRange(range) { edits.append((NSRange(location: end, length: NSMaxRange(range) - end), "")) }
            }
        }
        if ensuresFinalNewline, text.length > 0, text.character(at: text.length - 1) != LineIndex.newline {
            edits.append((NSRange(location: text.length, length: 0), "\n"))
        }
        return edits
    }
}
