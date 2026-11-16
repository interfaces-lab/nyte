import Foundation
import NyteCore

extension FindResultsViewController {
    static let editGap = "\u{2009}"

    struct Preview {
        var text: String
        var result: String
        var removed: [NSRange]
        var added: [NSRange]
        var kept: [(source: Int, target: Int, length: Int)]
    }

    static func preview(of line: String, column: Int, edits: [TextEdit]) -> Preview {
        let source = line as NSString
        var text = ""
        var result = ""
        var removed: [NSRange] = []
        var added: [NSRange] = []
        var kept: [(source: Int, target: Int, length: Int)] = []
        var cursor = 0
        for edit in edits {
            let start = min(max(0, edit.range.start.column - column), source.length)
            let end = edit.range.end.line == edit.range.start.line ? min(max(start, edit.range.end.column - column), source.length) : source.length
            guard start >= cursor else { continue }
            let between = source.substring(with: NSRange(location: cursor, length: start - cursor))
            kept.append((cursor, (text as NSString).length, start - cursor))
            text += between
            result += between
            let original = source.substring(with: NSRange(location: start, length: end - start))
            let replacement = edit.text.replacingOccurrences(of: "\n", with: " ")
            if !original.isEmpty {
                kept.append((start, (text as NSString).length, end - start))
                removed.append(NSRange(location: (text as NSString).length, length: (original as NSString).length))
                text += original
                if !replacement.isEmpty { text += editGap }
            }
            if !replacement.isEmpty {
                added.append(NSRange(location: (text as NSString).length, length: (replacement as NSString).length))
                text += replacement
            }
            result += replacement
            cursor = end
        }
        let rest = source.substring(from: cursor)
        kept.append((cursor, (text as NSString).length, source.length - cursor))
        return Preview(text: text + rest, result: result + rest, removed: removed, added: added, kept: kept)
    }

    @concurrent
    static func reason(_ url: URL) async -> String {
        let manager = FileManager.default
        guard manager.fileExists(atPath: url.path) else { return "The file no longer exists." }
        guard manager.isWritableFile(atPath: url.path) else { return "The file is read-only." }
        return "Its text no longer matches this preview."
    }
}
