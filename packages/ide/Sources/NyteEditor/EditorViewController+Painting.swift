import AppKit
import NyteUI
import os

extension EditorViewController: TextEngineDecorator {
    static let syntaxInks = SyntaxColor.allCases.map(\.color)
    static let longestColouredLine = TextStore.longestLexedLine

    func paint() {
        guard let document = shown, !scrollView.isHidden else {
            tokens.removeAll(keepingCapacity: true)
            tokenLines = nil
            return
        }
        let lines = textView.visibleLines
        guard tokenLines != lines || paintedRevision != document.revision else { return }
        tokenLines = lines
        paintedRevision = document.revision
        let signpost = OSSignposter.editor.beginInterval("paint")
        defer { OSSignposter.editor.endInterval("paint", signpost) }
        tokens.removeAll(keepingCapacity: true)
        guard document.language.family != .plain else { return }
        let store = document.store
        for line in lines {
            let range = store.lineRange(line)
            guard range.length <= Self.longestColouredLine else { continue }
            store.buffer.withUnits(range) { units in
                _ = Lexer.line(units, state: store.lines.entryState(of: line), language: document.language, offset: range.location,
                               tokens: &tokens, emit: true)
            }
        }
    }

    func repaint() {
        tokenLines = nil
        paint()
        textView.relayoutAll()
    }

    func isQuoted(_ offset: Int) -> Bool {
        let key = UInt64(truncatingIfNeeded: offset) << 32 | UInt64(UInt32.max)
        var low = 0
        var high = tokens.count
        while low < high {
            let middle = (low + high) / 2
            if tokens[middle] <= key { low = middle + 1 } else { high = middle }
        }
        guard low > 0 else { return false }
        let token = tokens[low - 1]
        guard NSLocationInRange(offset, Token.range(token)) else { return false }
        switch Token.kind(token) {
        case .string, .comment, .escape: return true
        default: return false
        }
    }

    func drawUnderText(in rect: NSRect, of view: TextEngineView) {
        guard shown != nil else { return }
        for feature in features { feature.drawUnderText(in: rect) }
    }

    func drawOverText(in rect: NSRect, of view: TextEngineView) {
        guard shown != nil else { return }
        for feature in features { feature.drawOverText(in: rect) }
    }

    func inlineBoxes(forLine line: Int, of view: TextEngineView) -> [InlineBox] {
        guard shown != nil else { return [] }
        return features.flatMap { $0.inlineBoxes(forLine: line) }
    }

    func colourRuns(forLine line: Int, of view: TextEngineView) -> [(range: NSRange, color: NSColor)] {
        guard shown != nil else { return [] }
        return features.flatMap { $0.colourRuns(forLine: line) }
    }

    func trailingNotes(forLine line: Int, of view: TextEngineView) -> [TrailingNote] {
        guard shown != nil else { return [] }
        return features.flatMap { $0.trailingNotes(forLine: line) }
    }
}
