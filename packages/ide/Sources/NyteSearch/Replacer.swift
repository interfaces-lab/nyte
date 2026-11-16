import Foundation
import NyteCore

public struct ReplacePlan: Sendable {
    public var edit = WorkspaceEdit()
    public var inverse = WorkspaceEdit()
    public var stale: [String] = []

    public var count: Int { edit.editCount }
}

public struct Replacer: Sendable {
    public let query: SearchQuery
    public let replacement: String
    public let preservesCase: Bool
    private let pattern: String?

    public init(query: SearchQuery, replacement: String, preservesCase: Bool) {
        self.query = query
        self.replacement = replacement
        self.preservesCase = preservesCase
        pattern = query.isRegex
            ? (query.wholeWord ? "(?<![\\p{L}\\p{N}_])(?:\(query.text))(?![\\p{L}\\p{N}_])" : query.text)
            : nil
    }

    public func expression() -> NSRegularExpression? {
        pattern.flatMap { try? NSRegularExpression(pattern: $0, options: MatchPlan.options(caseInsensitive: !query.isCaseSensitive)) }
    }

    public func replacement(in line: NSString, at range: NSRange, expression: NSRegularExpression?) -> String? {
        guard NSMaxRange(range) <= line.length else { return nil }
        let matched = line.substring(with: range)
        guard let expression else {
            guard matched.compare(query.text, options: query.isCaseSensitive ? [] : [.caseInsensitive]) == .orderedSame else { return nil }
            return preservesCase ? Self.preservingCase(replacement, like: matched) : replacement
        }
        let searched = NSRange(location: range.location, length: line.length - range.location)
        guard let found = expression.firstMatch(in: line as String, options: [.anchored, .withTransparentBounds, .withoutAnchoringBounds],
                                                range: searched), found.range == range else { return nil }
        let expanded = expression.replacementString(for: found, in: line as String, offset: 0, template: Self.template(replacement))
        return preservesCase ? Self.preservingCase(expanded, like: matched) : expanded
    }

    public func plan(_ results: SearchResults, matches chosen: [Int], root: URL, unsaved: [String: String]) -> ReplacePlan {
        var plan = ReplacePlan()
        let expression = expression()
        let byFile = Dictionary(grouping: chosen.filter { $0 >= 0 && $0 < results.matchCount }) { Int(results.matchFile[$0]) }
        for file in byFile.keys.sorted() {
            let path = results.paths[file]
            let url = root.appendingPathComponent(path)
            let contents = unsaved[path] ?? (try? Data(contentsOf: url)).map { String(decoding: $0, as: UTF8.self) }
            guard let contents else {
                plan.stale.append(path)
                continue
            }
            let text = contents as NSString
            let lines = LineStarts(text)
            var edits: [TextEdit] = []
            var originals: [String] = []
            var fresh = true
            let whole = expression != nil && RegexLiteral.isMultiline(query.text)
            for match in (byFile[file] ?? []).sorted() {
                let span = results.span(of: match)
                guard let start = lines.offset(line: span.start.line, column: span.start.column),
                      let end = lines.offset(line: span.end.line, column: span.end.column), end >= start else {
                    fresh = false
                    break
                }
                let lineRange = whole ? NSRange(location: 0, length: text.length) : lines.range(ofLine: span.start.line, in: text)
                let local = NSRange(location: start - lineRange.location, length: end - start)
                let scope = whole ? text : text.substring(with: lineRange) as NSString
                guard let new = replacement(in: scope, at: local, expression: expression) else {
                    fresh = false
                    break
                }
                let range = TextSpan(start: TextPosition(line: span.start.line, column: span.start.column),
                                     end: TextPosition(line: span.end.line, column: span.end.column))
                edits.append(TextEdit(range: range, text: new))
                originals.append(text.substring(with: NSRange(location: start, length: end - start)))
            }
            guard fresh else {
                plan.stale.append(path)
                continue
            }
            plan.edit.files.append(WorkspaceEdit.File(url: url, edits: edits))
            plan.inverse.files.append(WorkspaceEdit.File(url: url, edits: Self.inverse(of: edits, originals: originals)))
        }
        return plan
    }

    static func inverse(of edits: [TextEdit], originals: [String]) -> [TextEdit] {
        var lineShift = 0
        var anchor: (oldLine: Int, oldColumn: Int, newColumn: Int)?
        var inverted: [TextEdit] = []
        for (edit, original) in zip(edits, originals) {
            let start = edit.range.start
            let newStartLine = start.line + lineShift
            let newStartColumn = anchor.map { $0.oldLine == start.line ? $0.newColumn + start.column - $0.oldColumn : start.column }
                ?? start.column
            let inserted = Array(edit.text.utf16)
            let breaks = inserted.indices.filter { inserted[$0] == UInt16(UInt8(ascii: "\n")) }
            let newEndLine = newStartLine + breaks.count
            let newEndColumn = breaks.last.map { inserted.count - $0 - 1 } ?? newStartColumn + inserted.count
            inverted.append(TextEdit(range: TextSpan(start: TextPosition(line: newStartLine, column: newStartColumn),
                                                     end: TextPosition(line: newEndLine, column: newEndColumn)), text: original))
            lineShift += breaks.count - (edit.range.end.line - start.line)
            anchor = (edit.range.end.line, edit.range.end.column, newEndColumn)
        }
        return inverted
    }

    public static func template(_ replacement: String) -> String {
        var out = ""
        var escaped = false
        for character in replacement {
            if escaped {
                switch character {
                case "n": out += "\n"
                case "t": out += "\t"
                case "\\": out += "\\\\"
                default: out += "\\" + String(character)
                }
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else {
                out.append(character)
            }
        }
        if escaped { out += "\\\\" }
        return out
    }

    public static func preservingCase(_ replacement: String, like matched: String) -> String {
        let letters = matched.unicodeScalars.filter { $0.properties.isAlphabetic }
        guard !letters.isEmpty, !replacement.isEmpty else { return replacement }
        if letters.allSatisfy({ !$0.properties.isLowercase }), letters.count > 1 { return replacement.uppercased() }
        if letters.allSatisfy({ !$0.properties.isUppercase }) { return replacement.lowercased() }
        guard let first = letters.first, first.properties.isUppercase else { return replacement }
        return replacement.prefix(1).uppercased() + replacement.dropFirst()
    }
}

struct LineStarts {
    private let starts: [Int]
    private let length: Int

    init(_ text: NSString) {
        var starts = [0]
        let length = text.length
        var index = 0
        while index < length {
            let found = text.range(of: "\n", options: .literal, range: NSRange(location: index, length: length - index))
            guard found.location != NSNotFound else { break }
            starts.append(found.location + 1)
            index = found.location + 1
        }
        self.starts = starts
        self.length = length
    }

    func offset(line: Int, column: Int) -> Int? {
        guard line >= 0, line < starts.count else { return nil }
        let end = line + 1 < starts.count ? starts[line + 1] - 1 : length
        let offset = starts[line] + column
        return offset <= end ? offset : nil
    }

    func range(ofLine line: Int, in text: NSString) -> NSRange {
        let end = line + 1 < starts.count ? starts[line + 1] - 1 : length
        return NSRange(location: starts[line], length: end - starts[line])
    }
}
