import AppKit
import NyteCore
import NyteUI

@MainActor
final class FoldingFeature: EditorFeature {
    static let rest = Duration.milliseconds(300)
    static let label = "⋯"
    static let style = TextStyle.codeSmall
    static let padding = Space.x1
    static let margin = Space.x1
    static let previewWidth: CGFloat = 520
    static let previewRows = 12

    private unowned let editor: EditorViewController
    private(set) var regions: [FoldRegion] = []
    private var detection: Task<Void, Never>?
    private let previewPanel = FloatingPanel(radius: Radius.control, presentation: .hover)
    private let preview = CodeView()
    private var previewed: Int?

    init(editor: EditorViewController) {
        self.editor = editor
        previewPanel.content = preview
    }

    func documentDidChange() {
        if editor.ruler.onClickFold == nil {
            editor.ruler.foldMark = { [weak self] line in self?.mark(forLine: line) }
            editor.ruler.onClickFold = { [weak self] line in self?.toggle(line) }
        }
        regions = []
        hidePreview()
        detect(after: .zero)
    }

    func textDidChange(in range: NSRange, delta: Int) {
        let change = editor.lastLineChange
        if change.inserted != change.removed {
            let shift = change.inserted - change.removed
            regions = regions.compactMap { region in
                if region.last < change.line { return region }
                if region.first > change.line + change.removed { return FoldRegion(first: region.first + shift, last: region.last + shift, kind: region.kind) }
                return nil
            }
        }
        detect(after: Self.rest)
    }

    func intelligenceDidReport(_ event: IntelligenceEvent) {
        guard case let .status(status) = event, status.state == .ready, editor.foldingRanges != nil else { return }
        detect(after: .zero)
    }

    private func detect(after delay: Duration) {
        detection?.cancel()
        guard let document = editor.shown else { return }
        let store = document.store
        let language = document.language
        let url = document.url
        let revision = document.revision
        let provider = editor.foldingRanges
        detection = Task { [weak self] in
            if delay > .zero {
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
            }
            let provided = await provider?(url)
            guard !Task.isCancelled else { return }
            let found = if let provided {
                provided.filter { $0.upperBound > $0.lowerBound }.map { FoldRegion(first: $0.lowerBound, last: $0.upperBound, kind: .block) }
            } else {
                await Task.detached(priority: .utility) {
                    FoldRegions.detect(in: store.buffer.units(NSRange(location: 0, length: store.length)), language: language)
                }.value
            }
            guard let self, !Task.isCancelled, editor.url == url, editor.revision == revision else { return }
            regions = found.sorted { ($0.first, -$0.last) < ($1.first, -$1.last) }
            editor.ruler.needsDisplay = true
        }
    }

    func mark(forLine line: Int) -> FoldMark? {
        if isFoldedHeader(line) { return .folded }
        return region(startingAt: line) != nil ? .foldable : nil
    }

    func region(startingAt line: Int) -> FoldRegion? {
        var low = 0
        var high = regions.count
        while low < high {
            let middle = (low + high) / 2
            if regions[middle].first < line { low = middle + 1 } else { high = middle }
        }
        return low < regions.count && regions[low].first == line ? regions[low] : nil
    }

    func region(around line: Int) -> FoldRegion? {
        regions.filter { $0.first <= line && line <= $0.last && !isFolded($0) }.min { $0.last - $0.first < $1.last - $1.first }
    }

    private func isFolded(_ region: FoldRegion) -> Bool { editor.textView.foldedRanges.contains { $0.contains(region.hidden) } }

    private func isFoldedHeader(_ line: Int) -> Bool { editor.textView.foldedRanges.contains { $0.lowerBound == line + 1 } }

    func toggle(_ line: Int) {
        if isFoldedHeader(line) { return unfold(header: line) }
        guard let region = region(startingAt: line) else { return }
        fold([region])
    }

    func fold(_ chosen: [FoldRegion]) {
        let view = editor.textView
        let headers = chosen.map(\.first)
        view.setFolds(view.foldedRanges + chosen.map(\.hidden))
        for header in headers { view.relayoutLines(header...header) }
        editor.ruler.needsDisplay = true
    }

    func unfold(header line: Int) {
        let view = editor.textView
        view.setFolds(view.foldedRanges.filter { $0.lowerBound != line + 1 })
        view.relayoutLines(line...line)
        editor.ruler.needsDisplay = true
        hidePreview()
    }

    func inlineBoxes(forLine line: Int) -> [InlineBox] {
        guard isFoldedHeader(line) else { return [] }
        let width = Self.chipWidth
        return [InlineBox(column: editor.shownStore.lineRange(line).length, width: width + Self.margin) { rect in
            let chip = NSRect(x: rect.minX + Self.margin, y: rect.minY + Space.hair, width: width, height: rect.height - Space.hair * 2)
            Draw.fill(chip, radius: Radius.indicator, color: Palette.fillSecondary)
            Draw.text(Self.label, in: chip.insetBy(dx: Self.padding, dy: 0), style: Self.style, ink: Palette.contentSecondary, alignment: .center)
        }]
    }

    static var chipWidth: CGFloat { Draw.width(of: label, style: style) + padding * 2 }

    func chipRect(onLine line: Int) -> NSRect? {
        guard isFoldedHeader(line) else { return nil }
        let view = editor.textView
        let end = view.layout(line: line).x(ofColumn: editor.shownStore.lineRange(line).length)
        return NSRect(x: end + Self.margin, y: view.top(ofLine: line), width: Self.chipWidth, height: view.metrics.lineHeight)
    }

    func handleClick(at point: NSPoint, event: NSEvent) -> Bool {
        let view = editor.textView
        guard view.rowMap.folds.hiddenCount > 0 else { return false }
        let line = view.line(atY: point.y)
        guard let chip = chipRect(onLine: line), chip.contains(point) else { return false }
        unfold(header: line)
        return true
    }

    func pointerMoved(to point: NSPoint, offset: Int?, modifiers: NSEvent.ModifierFlags) {
        let view = editor.textView
        guard view.rowMap.folds.hiddenCount > 0 else { return hidePreview() }
        let line = view.line(atY: point.y)
        guard let chip = chipRect(onLine: line), chip.contains(point) else { return hidePreview() }
        NSCursor.pointingHand.set()
        guard previewed != line, let document = editor.shown, let hidden = view.foldedRanges.first(where: { $0.lowerBound == line + 1 }) else { return }
        previewed = line
        let store = document.store
        let count = min(hidden.count, Self.previewRows)
        preview.show(CodeViewSource(name: document.url.lastPathComponent, language: document.language, firstLine: hidden.lowerBound,
                                    lineCount: hidden.count, entryState: store.lines.entryState(of: hidden.lowerBound)) { index in
            store.string(store.lineRange(hidden.lowerBound + index))
        })
        let size = NSSize(width: Self.previewWidth, height: CGFloat(count) * TextStyle.code.lineHeight + Space.x2 * 2)
        previewPanel.show(size: size, anchoredTo: chip, in: view)
    }

    func pointerExited() { hidePreview() }
    func viewportDidChange() { hidePreview() }
    func focusDidLeave() { hidePreview() }

    private func hidePreview() {
        previewed = nil
        if previewPanel.isShown { previewPanel.dismiss() }
    }

    func run(_ command: FoldCommand) {
        let view = editor.textView
        let caretLine = editor.shownStore.line(at: view.selections.primarySelection.head)
        switch command {
        case .fold:
            if let region = region(around: caretLine) { fold([region]) }
        case .unfold:
            if let header = view.foldedRanges.first(where: { $0.lowerBound - 1 == caretLine || $0.contains(caretLine) })?.lowerBound {
                unfold(header: header - 1)
            }
        case .toggle:
            if isFoldedHeader(caretLine) { unfold(header: caretLine) } else { run(.fold) }
        case .foldAll: fold(regions)
        case .unfoldAll:
            view.setFolds([])
            view.relayoutAll()
            editor.ruler.needsDisplay = true
        case .foldComments: fold(regions.filter { $0.kind == .comment })
        case .foldImports: fold(regions.filter { $0.kind == .imports })
        }
    }

    func canRun(_ command: FoldCommand) -> Bool {
        guard editor.shown != nil else { return false }
        let view = editor.textView
        let caretLine = editor.shownStore.line(at: view.selections.primarySelection.head)
        return switch command {
        case .fold: region(around: caretLine) != nil
        case .unfold: view.foldedRanges.contains { $0.lowerBound - 1 == caretLine || $0.contains(caretLine) }
        case .toggle: isFoldedHeader(caretLine) || region(around: caretLine) != nil
        case .foldAll: !regions.isEmpty
        case .unfoldAll: !view.foldedRanges.isEmpty
        case .foldComments: regions.contains { $0.kind == .comment }
        case .foldImports: regions.contains { $0.kind == .imports }
        }
    }
}

enum FoldCommand: CaseIterable {
    case fold, unfold, toggle, foldAll, unfoldAll, foldComments, foldImports
}
