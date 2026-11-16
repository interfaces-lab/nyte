import AppKit
import NyteCore
import NyteUI

@MainActor
final class HighlightsFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private static let rest: Duration = .milliseconds(150)
    private static let radius = Radius.indicator
    private static let bracketRadius = Radius.nested(in: Radius.indicator, padding: Space.x05)
    private static let opens: [UInt16] = [0x28, 0x5B, 0x7B]
    private static let closes: [UInt16] = [0x29, 0x5D, 0x7D]

    private var starts: [Int] = []
    private var lengths: [Int] = []
    private var brackets: [Int] = []
    private var request: Task<Void, Never>?
    private var bracketPass: Task<Void, Never>?

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func documentDidChange() {
        clearOccurrences()
        brackets.removeAll()
        selectionDidChange()
    }

    func textDidChange(in range: NSRange, delta: Int) {
        clearOccurrences()
    }

    func selectionDidChange() {
        let selection = editor.textView.selectedRanges
        let caret = editor.textView.selectedRange()
        let single = selection.count == 1 && caret.length == 0
        if !single || !starts.indices.contains(where: { starts[$0] <= caret.location && caret.location <= starts[$0] + lengths[$0] }) {
            clearOccurrences()
            if single { askAfterRest(at: caret.location) }
        }
        scheduleBrackets()
    }

    func viewportDidChange() {
        scheduleBrackets()
    }

    func drawUnderText(in rect: NSRect) {
        guard !starts.isEmpty || !brackets.isEmpty, editor.shown != nil else { return }
        let visible = editor.visibleRange
        let length = editor.shownText.length
        for index in starts.indices {
            let range = NSRange(location: starts[index], length: lengths[index])
            guard NSMaxRange(range) <= length, NSIntersectionRange(range, visible).length > 0 else { continue }
            fill(range, rect: rect, radius: Self.radius, color: Palette.fillPrimary)
        }
        for offset in brackets where offset < length {
            fill(NSRange(location: offset, length: 1), rect: rect, radius: Self.bracketRadius, color: Palette.fillPrimary)
        }
    }

    private func fill(_ range: NSRange, rect: NSRect, radius: CGFloat, color: NSColor) {
        for box in editor.rects(for: range) {
            let shape = NSRect(x: box.minX, y: box.minY + Space.hair, width: box.width, height: box.height - Space.hair * 2)
            guard shape.intersects(rect) else { continue }
            Draw.fill(shape, radius: radius, color: color)
        }
    }

    private func clearOccurrences() {
        request?.cancel()
        guard !starts.isEmpty else { return }
        starts.removeAll()
        lengths.removeAll()
        editor.textView.needsDisplay = true
    }

    private func askAfterRest(at caret: Int) {
        guard let url = editor.url, let intelligence = editor.intelligence, intelligence.handles(url), editor.shown != nil else { return }
        let text = editor.shownText
        let touching = (caret < text.length && Self.isWord(text.character(at: caret)))
            || (caret > 0 && Self.isWord(text.character(at: caret - 1)))
        guard touching, let position = editor.position(at: caret) else { return }
        request = Task { [weak self] in
            try? await Task.sleep(for: Self.rest)
            guard !Task.isCancelled, let self else { return }
            let revision = editor.revision
            let spans = await intelligence.highlights(at: position, in: url)
            guard !Task.isCancelled, editor.url == url, editor.revision == revision,
                  editor.textView.selectedRange() == NSRange(location: caret, length: 0)
            else { return }
            let ranges = spans.compactMap(editor.range(of:)).filter { $0.length > 0 }.sorted { $0.location < $1.location }
            starts = ranges.map(\.location)
            lengths = ranges.map(\.length)
            editor.textView.needsDisplay = true
        }
    }

    private static func isWord(_ unit: UInt16) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return scalar == "_" || scalar == "$" || CharacterSet.alphanumerics.contains(scalar)
    }

    private func scheduleBrackets() {
        bracketPass?.cancel()
        bracketPass = Task { [weak self] in
            guard !Task.isCancelled, let self else { return }
            let caret = editor.textView.selectedRange()
            matchBrackets(editor.textView.selectedRanges.count == 1 && caret.length == 0 ? caret.location : nil)
        }
    }

    private func matchBrackets(_ caret: Int?) {
        let previous = brackets
        brackets.removeAll()
        defer { if brackets != previous { editor.textView.needsDisplay = true } }
        guard let caret, editor.url != nil, editor.shown != nil else { return }
        let text = editor.shownText
        let visible = editor.visibleRange
        let after = caret < text.length ? text.character(at: caret) : 0
        let before = caret > 0 ? text.character(at: caret - 1) : 0
        let candidates = [
            (caret, Self.opens.contains(after)), (caret - 1, Self.closes.contains(before)),
            (caret, Self.closes.contains(after)), (caret - 1, Self.opens.contains(before)),
        ]
        for (offset, isBracket) in candidates where isBracket && NSLocationInRange(offset, visible) && !editor.isQuoted(offset) {
            guard let partner = partner(of: offset, in: text, within: visible) else { continue }
            brackets = [offset, partner]
            return
        }
    }

    private func partner(of offset: Int, in text: some UnitString, within visible: NSRange) -> Int? {
        let unit = text.character(at: offset)
        if let kind = Self.opens.firstIndex(of: unit) {
            var depth = 0
            for index in offset + 1..<NSMaxRange(visible) {
                let character = text.character(at: index)
                guard character == Self.opens[kind] || character == Self.closes[kind], !editor.isQuoted(index) else { continue }
                if character == Self.opens[kind] { depth += 1 } else if depth == 0 { return index } else { depth -= 1 }
            }
            return nil
        }
        guard let kind = Self.closes.firstIndex(of: unit) else { return nil }
        var depth = 0
        var index = offset - 1
        while index >= visible.location {
            defer { index -= 1 }
            let character = text.character(at: index)
            guard character == Self.opens[kind] || character == Self.closes[kind], !editor.isQuoted(index) else { continue }
            if character == Self.closes[kind] { depth += 1 } else if depth == 0 { return index } else { depth -= 1 }
        }
        return nil
    }
}
