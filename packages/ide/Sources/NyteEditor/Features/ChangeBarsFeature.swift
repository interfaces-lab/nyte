import AppKit
import NyteCore
import NyteUI

enum ChangeKind: Equatable {
    case added, modified, deleted
}

@MainActor
final class ChangeBarsFeature: EditorFeature {
    static let rest = Duration.milliseconds(400)
    static let panelWidth: CGFloat = 520
    static let panelGap = Space.x2

    private unowned let editor: EditorViewController
    private var base: TextLines?
    private var newStarts: [Int] = []
    private var newCounts: [Int] = []
    private var oldRanges: [Range<Int>] = []
    private var loading: Task<Void, Never>?
    private var diffing: Task<Void, Never>?
    private let panel = FloatingPanel(radius: Radius.card, presentation: .popover)
    private let oldText = DocumentationView()
    private var shownHunk: Int?

    init(editor: EditorViewController) {
        self.editor = editor
        let actions = NSStackView(views: [
            Button("Revert", variant: .ghost, size: .sm) { [weak self] in self?.revertShown() },
            Button("Copy", variant: .ghost, size: .sm) { [weak self] in self?.copyShown() },
        ])
        actions.spacing = Self.panelGap
        actions.edgeInsets = NSEdgeInsets(top: 0, left: DocumentationView.inset, bottom: Self.panelGap, right: DocumentationView.inset)
        let stack = NSStackView(views: [oldText, actions])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 0
        panel.content = stack
    }

    func documentDidChange() {
        if let ruler = editor.scrollView.verticalRulerView as? LineNumberRuler, ruler.onClickChange == nil {
            ruler.change = { [weak self] line in self?.kind(on: line) }
            ruler.onClickChange = { [weak self] line in self?.showHunk(on: line) }
        }
        reload()
    }

    func reload() {
        loading?.cancel()
        diffing?.cancel()
        clear()
        guard editor.preferences.showsChangeBars, let url = editor.url, let provider = editor.baseText else { return }
        loading = Task { [weak self] in
            let text = await provider(url)
            guard let self, !Task.isCancelled, editor.url == url else { return }
            base = text.map(TextLines.init)
            scheduleDiff(after: .zero)
        }
    }

    func textDidChange(in range: NSRange, delta: Int) {
        guard base != nil else { return }
        let change = editor.lastLineChange
        let shift = change.inserted - change.removed
        if shift != 0 {
            for slot in newStarts.indices where newStarts[slot] > change.line { newStarts[slot] = max(change.line + 1, newStarts[slot] + shift) }
        }
        scheduleDiff(after: Self.rest)
    }

    var hunkCount: Int { newStarts.count }

    func kind(on line: Int) -> ChangeKind? {
        guard let slot = hunk(on: line) else { return nil }
        if newCounts[slot] == 0 { return .deleted }
        return oldRanges[slot].isEmpty ? .added : .modified
    }

    func hunk(on line: Int) -> Int? {
        var low = 0
        var high = newStarts.count
        while low < high {
            let middle = (low + high) / 2
            if newStarts[middle] + max(newCounts[middle], 1) <= line { low = middle + 1 } else { high = middle }
        }
        return low < newStarts.count && newStarts[low] <= line ? low : nil
    }

    func nextHunk(after line: Int, forward: Bool) -> Int? {
        guard !newStarts.isEmpty else { return nil }
        if forward { return newStarts.first { $0 > line } ?? newStarts.first }
        return newStarts.last { $0 < line } ?? newStarts.last
    }

    func oldLines(of slot: Int) -> String {
        guard let base, oldRanges.indices.contains(slot), !oldRanges[slot].isEmpty else { return "" }
        let range = oldRanges[slot]
        let bytes = base.bytes[base.range(of: range.lowerBound).lowerBound..<base.range(of: range.upperBound - 1).upperBound]
        return String(decoding: bytes, as: UTF8.self)
    }

    func revert(_ slot: Int) {
        guard let lines = editor.lineIndex, newStarts.indices.contains(slot) else { return }
        let length = editor.shownText.length
        let start = lines.start(of: min(newStarts[slot], lines.count - 1))
        let endLine = newStarts[slot] + newCounts[slot]
        let end = endLine < lines.count ? lines.start(of: endLine) : length
        var old = oldLines(of: slot)
        if end == length, newCounts[slot] > 0, !old.isEmpty, editor.shownText.length > 0,
           editor.shownText.character(at: length - 1) != LineIndex.newline, old.hasSuffix("\n") {
            old.removeLast()
        }
        guard let span = editor.span(of: NSRange(location: start, length: end - start)) else { return }
        editor.edit([TextEdit(range: span, text: old)])
    }

    private func clear() {
        base = nil
        newStarts.removeAll()
        newCounts.removeAll()
        oldRanges.removeAll()
        editor.scrollView.verticalRulerView?.needsDisplay = true
    }

    private func scheduleDiff(after delay: Duration) {
        diffing?.cancel()
        guard let base, let url = editor.url else { return }
        diffing = Task { [weak self] in
            if delay > .zero {
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
            }
            guard let self else { return }
            let revision = editor.revision
            let snapshot = editor.shownText
            let hunks = await Task.detached(priority: .utility) { Diff(from: base, to: TextLines(snapshot.string)).hunks }.value
            guard !Task.isCancelled, editor.url == url, editor.revision == revision else { return }
            newStarts = hunks.map(\.new.lowerBound)
            newCounts = hunks.map(\.new.count)
            oldRanges = hunks.map(\.old)
            editor.scrollView.verticalRulerView?.needsDisplay = true
        }
    }

    private func showHunk(on line: Int) {
        guard let slot = hunk(on: line), let lines = editor.lineIndex,
              let rect = editor.rects(for: NSRange(location: lines.start(of: min(newStarts[slot], lines.count - 1)), length: 0)).first
        else { return }
        shownHunk = slot
        let old = oldLines(of: slot)
        oldText.language = editor.fenceLanguage
        oldText.show(notes: [], markdown: old.isEmpty ? "Added lines" : "```\n" + old + "```")
        let size = oldText.fittingSize(maxWidth: Self.panelWidth)
        panel.show(size: NSSize(width: size.width, height: size.height + Size.sm.height + Self.panelGap),
                   anchoredTo: NSRect(x: rect.minX, y: rect.minY, width: 0, height: rect.height), in: editor.textView)
    }

    private func revertShown() {
        guard let slot = shownHunk else { return }
        panel.dismiss()
        revert(slot)
    }

    private func copyShown() {
        guard let slot = shownHunk else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(oldLines(of: slot), forType: .string)
        panel.dismiss()
    }
}
