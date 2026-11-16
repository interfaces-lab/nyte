import AppKit
import NyteCore
@testable import NyteEditor
import NyteUI

extension EditorCheck {
    func preferences() async {
        let body = (0..<200).map { "\tline\($0) := \($0)" }.joined(separator: "\n")
        let editor = await openEditor("package main\n\nfunc main() {\n" + body + "\n}\n", file: "prefs.go")
        editor.select(TextSpan(at: TextPosition(line: 120, column: 0)))
        let topBefore = editor.lineIndex?.line(at: editor.visibleRange.location)
        var bigger = editor.preferences
        bigger.fontSize = 16
        bigger.lineHeight = 24
        editor.apply(bigger)
        let metrics = editor.textView.metrics
        let expected = CGFloat(editor.lineIndex?.count ?? 0) * metrics.lineHeight + TextEngineView.verticalInset * 2
        expect(metrics.font.pointSize == 16 && metrics.lineHeight == 24 && editor.textView.frame.height == expected,
               "a font size change re-derives the line height the frame is sized from", "\(metrics.lineHeight) \(editor.textView.frame.height) \(expected)")
        let topAfter = editor.lineIndex?.line(at: editor.visibleRange.location)
        expect(topBefore == topAfter, "a font size change keeps the first visible line", "\(String(describing: topBefore)) \(String(describing: topAfter))")
        let fragment = editor.rects(for: NSRange(location: 0, length: 0)).first?.height
        expect(fragment == 24, "open documents lay out at the new line height at once", "\(String(describing: fragment))")
        let plain = await openEditor("alpha\nbeta\n", file: "plain.txt")
        var tabs = plain.preferences
        tabs.defaultIndent = Indent(usesTabs: true, width: 8)
        plain.apply(tabs)
        expect(plain.textView.indent == Indent(usesTabs: true, width: 8), "an undetected indent follows the preference")
        expect(editor.textView.indent.usesTabs, "a detected indent keeps the file's own")
        let base = "alpha\nbeta\n"
        plain.baseText = { _ in base }
        plain.replaceUntracked(NSRange(location: 0, length: 0), with: "new\n")
        let changes = plain.features.lazy.compactMap { $0 as? ChangeBarsFeature }.first
        await settle { (changes?.hunkCount ?? 0) > 0 }
        var off = plain.preferences
        off.showsChangeBars = false
        off.showsStickyDeclarations = false
        plain.apply(off)
        expect(plain.ruler.change(0) == nil, "change bars turn off at once")
        plain.baseText = nil
        let messy = "a  \nb\t\nc  " as NSString
        let cleanup = SaveCleanup.edits(in: messy, lines: Array((messy as String).utf16).withUnsafeBufferPointer { LineIndex($0) },
                                        trimsTrailingWhitespace: true, ensuresFinalNewline: true, keepingLine: 1)
        let cleaned = NSMutableString(string: messy as String)
        for edit in cleanup.sorted(by: { $0.range.location > $1.range.location }) { cleaned.replaceCharacters(in: edit.range, with: edit.text) }
        expect(cleaned as String == "a\nb\t\nc\n", "saving trims trailing whitespace except on the caret's line and ends with a newline",
               (cleaned as String).debugDescription)
        editor.apply(EditorPreferences())
    }
}
