import Foundation
import NyteCore

enum CaretCompletion {
    static func replacements(of primary: NSRange, caret: Int, carets: [NSRange], in text: some UnitString) -> [NSRange]? {
        let before = caret - primary.location
        let after = NSMaxRange(primary) - caret
        guard before >= 0, after >= 0, NSMaxRange(primary) <= text.length, carets.allSatisfy({ $0.length == 0 }) else { return nil }
        let expected = text.substring(with: primary)
        let lead = Identifier.start(before: caret, in: text) - primary.location
        let ranges = carets.map { NSRange(location: $0.location - before, length: before + after) }
        let matching = zip(ranges, carets).allSatisfy { range, caret in
            range.location >= 0 && NSMaxRange(range) <= text.length && text.substring(with: range) == expected
                && Identifier.start(before: caret.location, in: text) - range.location == lead
        }
        guard matching, zip(ranges, ranges.dropFirst()).allSatisfy({ NSMaxRange($0) <= $1.location }) else { return nil }
        return ranges
    }

    struct Plan: Equatable {
        let texts: [String]
        let after: [NSRange]
    }

    static func plan(_ item: CompletionItem, insert: CompletionInsert, at ranges: [NSRange], shiftedBy extra: [(range: NSRange, delta: Int)],
                     in text: some UnitString) -> Plan {
        let pieces = ranges.map { range -> (text: String, stops: [CompletionItem.Stop]) in
            let indentation = Indentation.leadingWhitespace(before: range.location, in: text)
            return switch insert {
            case .snippet: SnippetIndent.indented(item.text, stops: item.stops, by: indentation)
            case .plain(let shown): SnippetIndent.indented(shown, stops: [], by: indentation)
            case .call(let name, _): (name + "()", [])
            }
        }
        var shift = 0
        let after = zip(ranges, pieces).map { range, piece -> NSRange in
            let base = range.location + shift + extra.filter { NSMaxRange($0.range) <= range.location }.reduce(0) { $0 + $1.delta }
            let length = (piece.text as NSString).length
            shift += length - range.length
            return switch insert {
            case .snippet: piece.stops.first.map { NSRange(location: base + $0.utf16Offset, length: $0.utf16Length) }
                ?? NSRange(location: base + length, length: 0)
            case .plain: NSRange(location: base + length, length: 0)
            case .call(_, let takesArguments): NSRange(location: base + length - (takesArguments ? 1 : 0), length: 0)
            }
        }
        return Plan(texts: pieces.map(\.text), after: after)
    }
}
