import Foundation
import NyteUI

struct EditContext: Sendable {
    var indent: Indent
    var lineComment: String?
    var blockComment: (open: String, close: String)?
    var words: WordRule
    var pairsBrackets: Bool

    init(indent: Indent = Indent(usesTabs: false, width: Indent.defaultWidth), language: Language = .plain) {
        self.indent = indent
        lineComment = language.lineComment
        blockComment = language.blockComment
        words = language.family == .code || language.family == .markup ? .identifier : .natural
        pairsBrackets = true
    }
}

struct ColumnMeasure {
    let x: (_ line: Int, _ column: Int) -> CGFloat
    let column: (_ line: Int, _ x: CGFloat) -> Int
    let pageRows: Int
    var step: (_ line: Int, _ rows: Int) -> Int? = { _, _ in nil }

    static func monospace(_ store: TextStore, tabWidth: Int, pageRows: Int = 1) -> ColumnMeasure {
        ColumnMeasure(
            x: { line, column in
                let span = store.lineRange(line)
                var x = 0
                for offset in span.location..<span.location + min(column, span.length) {
                    x = store[offset] == TextCommands.tab ? (x / tabWidth + 1) * tabWidth : x + 1
                }
                return CGFloat(x)
            },
            column: { line, target in
                let span = store.lineRange(line)
                var x = 0
                var column = 0
                while column < span.length {
                    let next = store[span.location + column] == TextCommands.tab ? (x / tabWidth + 1) * tabWidth : x + 1
                    if CGFloat(x + next) / 2 >= target { break }
                    x = next
                    column += 1
                }
                return column
            },
            pageRows: pageRows,
            step: { line, rows in
                let target = line + rows
                return target >= 0 && target < store.lineCount ? target : nil
            }
        )
    }
}

enum TextCommands {
    static let tab = UInt16(UInt8(ascii: "\t"))
    static let space = UInt16(UInt8(ascii: " "))
    static let newline = LineIndex.newline

    struct Piece {
        var range: NSRange
        var text: [UInt16]
        var anchor: Int
        var head: Int

        static func keeping(_ selection: Selection) -> Piece {
            Piece(range: NSRange(location: selection.lower, length: 0), text: [],
                  anchor: selection.anchor - selection.lower, head: selection.head - selection.lower)
        }

        static func caret(after range: NSRange, inserting text: [UInt16]) -> Piece {
            Piece(range: range, text: text, anchor: text.count, head: text.count)
        }
    }

    static func perSelection(_ store: TextStore, _ set: SelectionSet, kind: EditKind,
                             _ body: (Selection) -> Piece?) -> TextTransaction {
        var pieces = set.selections.enumerated().map { index, selection in (index, body(selection) ?? .keeping(selection)) }
        pieces.sort { $0.1.range.location < $1.1.range.location }
        var merged: [(index: Int, piece: Piece)] = []
        for (index, piece) in pieces {
            guard let last = merged.last, piece.range.location < NSMaxRange(last.piece.range) else {
                merged.append((index, piece))
                continue
            }
            let union = NSUnionRange(last.piece.range, piece.range)
            let text = last.piece.text + piece.text
            merged[merged.count - 1] = (index == set.primary ? index : last.index, .caret(after: union, inserting: text))
        }
        var shift = 0
        var replacements: [TextReplacement] = []
        var after: [Selection] = []
        var primary = 0
        for (index, piece) in merged {
            let base = piece.range.location + shift
            if index == set.primary { primary = after.count }
            after.append(Selection(anchor: base + piece.anchor, head: base + piece.head))
            if piece.range.length > 0 || !piece.text.isEmpty { replacements.append(TextReplacement(range: piece.range, text: piece.text)) }
            shift += piece.text.count - piece.range.length
        }
        return TextTransaction(replacements, before: set, after: SelectionSet(after, primary: primary), kind: kind)
    }

    static func through(_ replacements: [TextReplacement], _ store: TextStore, _ set: SelectionSet, kind: EditKind) -> TextTransaction {
        let sorted = replacements.sorted { $0.range.location < $1.range.location }
        let probe = TextTransaction(sorted, before: set, after: set, kind: kind)
        let after = set.mapping { selection in
            Selection(anchor: probe.mapped(selection.anchor), head: probe.mapped(selection.head))
        }
        return TextTransaction(sorted, before: set, after: after, kind: kind)
    }

    static func lineBlocks(_ store: TextStore, _ set: SelectionSet, joiningAdjacent: Bool) -> [ClosedRange<Int>] {
        var blocks: [ClosedRange<Int>] = []
        for selection in set.selections {
            let first = store.line(at: selection.lower)
            var last = store.line(at: selection.upper)
            if !selection.isEmpty, last > first, store.lineRange(last).location == selection.upper { last -= 1 }
            if let previous = blocks.last, first <= previous.upperBound + (joiningAdjacent ? 1 : 0) {
                blocks[blocks.count - 1] = previous.lowerBound...max(previous.upperBound, last)
                continue
            }
            blocks.append(first...last)
        }
        return blocks
    }

    static func leadingWhitespace(ofLine line: Int, upTo offset: Int? = nil, in store: TextStore) -> [UInt16] {
        let span = store.lineRange(line)
        let limit = min(offset ?? NSMaxRange(span), NSMaxRange(span))
        var end = span.location
        while end < limit, store[end] == space || store[end] == tab { end += 1 }
        return store.units(NSRange(location: span.location, length: end - span.location))
    }
}
