import Foundation
import NyteCore

enum LocalFixes {
    static let unusedCode = "6133"
    static var declaration: Regex<(Substring, Substring, Substring)> {
        #/^\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*([^;]*);?\s*$/#
    }

    static var sideEffectFree: Regex<Substring> { #/^[A-Za-z0-9_$.\s"'`\[\]?!:-]*$/# }

    static func removingUnused(_ diagnostics: [Diagnostic], in text: String, of url: URL) -> [(CodeAction, ActionPlan)] {
        let lines = LineDiff.lines(text)
        var seen: Set<Int> = []
        return diagnostics.compactMap { diagnostic in
            let line = diagnostic.range.start.line
            guard diagnostic.code == unusedCode, diagnostic.range.end.line == line, line < lines.count, seen.insert(line).inserted,
                  let match = lines[line].wholeMatch(of: declaration),
                  String(match.1) == name(at: diagnostic.range, in: lines[line]),
                  match.2.wholeMatch(of: sideEffectFree) != nil
            else { return nil }
            let edit = WorkspaceEdit(files: [WorkspaceEdit.File(url: url, edits: [
                TextEdit(range: TextSpan(start: .init(line: line, column: 0), end: .init(line: line + 1, column: 0)), text: ""),
            ])])
            let action = CodeAction(title: "Remove unused declaration for: '\(match.1)'", kind: .quickFix)
            return (action, ActionPlan(edit: .success(edit), command: nil, needsResolve: false))
        }
    }

    private static func name(at range: TextSpan, in line: Substring) -> String {
        let units = Array(line.utf16)
        guard range.start.column <= range.end.column, range.end.column <= units.count else { return "" }
        return String(decoding: units[range.start.column..<range.end.column], as: UTF16.self)
    }
}
