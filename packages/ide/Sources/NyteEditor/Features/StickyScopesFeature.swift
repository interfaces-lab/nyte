import AppKit
import NyteCore
import NyteUI

@MainActor
final class StickyScopesFeature: EditorFeature {
    static let deepest = 3

    private unowned let editor: EditorViewController
    private let pinned = PinnedLinesView()
    private var pinnedSymbols: [DocumentSymbol] = []
    private var shownKey: [Int] = []
    private var tokens: [UInt64] = []
    private var units: [UInt16] = []

    init(editor: EditorViewController) {
        self.editor = editor
        pinned.onPressLine = { [weak self] index in self?.jump(to: index) }
    }

    private var pinnedPush: CGFloat = 0

    func documentDidChange() {
        editor.ruler.pinnedLines = { [weak self] in
            guard let self, !pinnedSymbols.isEmpty else { return nil }
            return (pinnedSymbols.map(\.range.start.line), editor.textView.metrics.lineHeight, pinnedPush)
        }
        update()
    }
    func viewportDidChange() { update() }
    func outlineDidChange() { update() }

    var shownNames: [String] { pinnedSymbols.map(\.name) }

    func update() {
        guard editor.preferences.showsStickyDeclarations, let lines = editor.lineIndex, editor.url != nil, !editor.scrollView.isHidden
        else { return hide() }
        let visible = editor.visibleRange
        let top = lines.line(at: visible.location)
        let rows = editor.textView.rowMap
        let topRow = rows.row(of: top)
        let lastRow = max(0, editor.textView.rowCount - 1)
        let under = { (count: Int) in rows.line(atRow: min(topRow + count, lastRow)) }
        var chain = enclosing(line: top)
        for _ in 0..<Self.deepest where enclosing(line: under(chain.count)).count != chain.count {
            chain = enclosing(line: under(chain.count))
        }
        let key = chain.map(\.range.start.line)
        guard !chain.isEmpty else { return hide() }
        let lineHeight = editor.textView.metrics.lineHeight
        let push = pushUp(for: chain, top: top, lineHeight: lineHeight)
        pinnedSymbols = chain
        pinnedPush = push
        editor.ruler.needsDisplay = true
        let origin = editor.textView.textOrigin
        let leading = origin.x - editor.scrollView.contentView.bounds.minX
        if key != shownKey {
            shownKey = key
            pinned.show(chain.map(line(for:)), lineHeight: lineHeight, leadingInset: leading, baseline: baseline(lineHeight),
                        push: push, in: editor.scrollView)
        } else {
            pinned.show(pinned.lines, lineHeight: lineHeight, leadingInset: leading, baseline: baseline(lineHeight), push: push,
                        in: editor.scrollView)
        }
    }

    private func hide() {
        if !pinnedSymbols.isEmpty { editor.ruler.needsDisplay = true }
        pinnedSymbols = []
        shownKey = []
        if !pinned.isHidden { pinned.show([], lineHeight: 0, leadingInset: 0, baseline: 0, in: editor.scrollView) }
    }

    private func enclosing(line: Int) -> [DocumentSymbol] {
        let (symbols, ends) = editor.outline
        var chain: [DocumentSymbol] = []
        var index = 0
        while index < symbols.count, index < ends.count {
            let range = symbols[index].range
            if range.start.line < line, line <= range.end.line {
                chain.append(symbols[index])
                index += 1
            } else {
                index = ends[index]
            }
        }
        return Array(chain.suffix(Self.deepest))
    }

    private func pushUp(for chain: [DocumentSymbol], top: Int, lineHeight: CGFloat) -> CGFloat {
        guard let innermost = chain.last, let lines = editor.lineIndex, innermost.range.end.line + 1 < lines.count else { return 0 }
        let view = editor.textView
        let height = CGFloat(chain.count) * lineHeight
        let distance = view.top(ofRow: view.rowMap.row(of: innermost.range.end.line) + 1) - view.visibleRect.minY
        return distance < height ? height - distance : 0
    }

    private func baseline(_ lineHeight: CGFloat) -> CGFloat { editor.textView.metrics.baseline }

    private func line(for symbol: DocumentSymbol) -> NSAttributedString {
        guard let lines = editor.lineIndex, let document = editor.shown, symbol.range.start.line < lines.count else {
            return NSAttributedString()
        }
        let text = editor.shownText
        let range = lines.range(of: symbol.range.start.line, length: text.length)
        let shown = NSMutableAttributedString(string: text.substring(with: range), attributes: editor.textView.metrics.attributes)
        units = Array(shown.string.utf16)
        tokens.removeAll(keepingCapacity: true)
        _ = units.withUnsafeBufferPointer { buffer in
            Lexer.line(buffer, state: lines.entryState(of: symbol.range.start.line), language: document.language, offset: 0,
                       tokens: &tokens, emit: true)
        }
        for token in tokens {
            let kind = Token.kind(token)
            shown.addAttribute(.foregroundColor, value: EditorViewController.syntaxInks[Int(kind.rawValue)], range: Token.range(token))
            if kind == .comment { shown.addAttribute(.obliqueness, value: TextStyle.commentSlant, range: Token.range(token)) }
        }
        return shown
    }

    private func jump(to index: Int) {
        guard pinnedSymbols.indices.contains(index) else { return }
        editor.select(pinnedSymbols[index].selection)
    }
}
