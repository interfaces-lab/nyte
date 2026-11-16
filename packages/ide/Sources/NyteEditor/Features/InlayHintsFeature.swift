import AppKit
import NyteCore
import NyteUI

@MainActor
final class InlayHintsFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private static let typingRest: Duration = .milliseconds(200)
    private static let style = TextStyle.codeSmall
    private static let padding = Space.x05
    private static let chipHeight: CGFloat = 14
    private static let margin = Space.x05
    private static let paddedMargin = Space.x1
    private static let cacheLimit = 8

    private var anchors: [Int] = []
    private var leads: [CGFloat] = []
    private var trails: [CGFloat] = []
    private var widths: [CGFloat] = []
    private var labels: [String] = []
    private var covered = NSRange(location: 0, length: 0)
    private var cacheURLs: [URL] = []
    private var cacheRevisions: [Int] = []
    private var cacheHints: [(anchors: [Int], leads: [CGFloat], trails: [CGFloat], widths: [CGFloat], labels: [String], covered: NSRange)] = []
    private var request: Task<Void, Never>?
    private var requested = NSRange(location: 0, length: 0)

    init(editor: EditorViewController) {
        self.editor = editor
    }

    func documentDidChange() {
        request?.cancel()
        clearHints()
        guard let url = editor.url else { return }
        guard editor.preferences.showsInlayHints else {
            cacheURLs.removeAll()
            cacheRevisions.removeAll()
            cacheHints.removeAll()
            return
        }
        if let slot = cacheURLs.firstIndex(of: url), cacheRevisions[slot] == editor.revision {
            (anchors, leads, trails, widths, labels, covered) = cacheHints[slot]
            editor.textView.relayoutVisible()
        }
        refresh(after: .zero, force: true)
    }

    private func clearHints() {
        anchors.removeAll()
        leads.removeAll()
        trails.removeAll()
        widths.removeAll()
        labels.removeAll()
        covered = NSRange(location: 0, length: 0)
    }

    func intelligenceDidReport(_ event: IntelligenceEvent) {
        switch event {
        case let .diagnostics(url) where url.standardizedFileURL == editor.url: refresh(after: Self.typingRest, force: true)
        case let .status(status) where status.state == .ready: refresh(after: Self.typingRest, force: true)
        default: break
        }
    }

    func textDidChange(in range: NSRange, delta: Int) {
        let oldEnd = NSMaxRange(range) - delta
        var kept = 0
        for index in anchors.indices {
            let anchor = anchors[index]
            if anchor > range.location, anchor < oldEnd { continue }
            anchors[kept] = anchor > range.location ? anchor + delta : anchor
            leads[kept] = leads[index]
            trails[kept] = trails[index]
            widths[kept] = widths[index]
            labels[kept] = labels[index]
            kept += 1
        }
        let dropped = anchors.count - kept
        anchors.removeLast(dropped)
        leads.removeLast(dropped)
        trails.removeLast(dropped)
        widths.removeLast(dropped)
        labels.removeLast(dropped)
        if covered.location > range.location {
            covered.location = max(range.location, covered.location + delta)
        } else if NSMaxRange(covered) >= range.location {
            covered.length = max(0, covered.length + delta)
        }
        refresh(after: Self.typingRest, force: true)
    }

    func viewportDidChange() {
        guard editor.preferences.showsInlayHints, let wanted = band(), !covers(covered, wanted.needed), !covers(requested, wanted.needed) else { return }
        refresh(after: .zero, force: false)
    }

    func inlineBoxes(forLine line: Int) -> [InlineBox] {
        guard !anchors.isEmpty else { return [] }
        let span = editor.shownStore.lineRange(line)
        var index = lowerBound(span.location)
        var boxes: [InlineBox] = []
        while index < anchors.count, anchors[index] <= NSMaxRange(span) {
            let lead = leads[index]
            let width = widths[index]
            let label = labels[index]
            boxes.append(InlineBox(column: anchors[index] - span.location, width: lead + width + trails[index]) { rect in
                let chip = NSRect(x: rect.minX + lead, y: (rect.midY - Self.chipHeight / 2).rounded(), width: width, height: Self.chipHeight)
                Draw.fill(chip, radius: Radius.indicator, color: Palette.fillSecondary)
                Draw.text(label, in: chip.insetBy(dx: Self.padding, dy: 0), style: Self.style, ink: Palette.contentTertiary, lineBreak: .byClipping)
            })
            index += 1
        }
        return boxes
    }

    var shownLabels: [String] { labels }

    private func refresh(after delay: Duration, force: Bool) {
        request?.cancel()
        guard editor.preferences.showsInlayHints else { return }
        requested = NSRange(location: 0, length: 0)
        request = Task { [weak self] in
            if delay > .zero {
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
            }
            await self?.ask(force: force)
        }
    }

    private func band() -> (wanted: NSRange, needed: NSRange)? {
        guard let lines = editor.lineIndex, editor.shown != nil else { return nil }
        let length = editor.shownText.length
        let visible = editor.visibleRange
        let first = lines.line(at: visible.location)
        let last = lines.line(at: NSMaxRange(visible))
        let reach = last - first + 1
        let low = lines.start(of: max(0, first - reach))
        let high = NSMaxRange(lines.range(of: min(lines.count - 1, last + reach), length: length))
        let near = lines.start(of: max(0, first - reach / 2))
        let far = NSMaxRange(lines.range(of: min(lines.count - 1, last + reach / 2), length: length))
        return (NSRange(location: low, length: high - low), NSRange(location: near, length: far - near))
    }

    private func covers(_ outer: NSRange, _ inner: NSRange) -> Bool {
        outer.location <= inner.location && NSMaxRange(outer) >= NSMaxRange(inner)
    }

    private func ask(force: Bool) async {
        guard let url = editor.url, let intelligence = editor.intelligence, intelligence.handles(url),
              let (wanted, needed) = band()
        else { return }
        if !force, covers(covered, needed) { return }
        guard let span = editor.span(of: wanted) else { return }
        let revision = editor.revision
        requested = wanted
        let hints = await intelligence.inlayHints(in: span, of: url)
        guard !Task.isCancelled, editor.url == url, editor.revision == revision else { return }
        requested = NSRange(location: 0, length: 0)
        accept(hints, covering: wanted, for: url, revision: revision)
    }

    private func accept(_ hints: [InlayHint], covering range: NSRange, for url: URL, revision: Int) {
        guard let lines = editor.lineIndex else { return }
        var newAnchors: [Int] = []
        var newLeads: [CGFloat] = []
        var newTrails: [CGFloat] = []
        var newWidths: [CGFloat] = []
        var newLabels: [String] = []
        for hint in hints {
            guard let offset = editor.offset(of: hint.position), hint.position.line < lines.count, NSLocationInRange(offset, range) || offset == NSMaxRange(range),
                  let label = InlayLabel.shown(hint, argumentAt: offset, in: editor.shownText)
            else { continue }
            let lead = hint.padsLeading ? Self.paddedMargin : Self.margin
            let trail = hint.padsTrailing ? Self.paddedMargin : Self.margin
            if newAnchors.last == offset {
                let last = newAnchors.count - 1
                newLabels[last] += " " + label
                newTrails[last] = trail
                newWidths[last] = Self.chipWidth(newLabels[last])
                continue
            }
            newAnchors.append(offset)
            newLabels.append(label)
            newLeads.append(lead)
            newTrails.append(trail)
            newWidths.append(Self.chipWidth(label))
        }
        let changed = newLabels != labels || newAnchors != anchors || newLeads != leads || newTrails != trails
        let scope = NSUnionRange(covered, range)
        anchors = newAnchors
        leads = newLeads
        trails = newTrails
        widths = newWidths
        labels = newLabels
        covered = range
        remember(url, revision: revision)
        guard changed else { return }
        let length = editor.shownText.length
        editor.textView.relayoutLines(lines.line(at: min(scope.location, length))...lines.line(at: min(NSMaxRange(scope), length)))
    }

    private func remember(_ url: URL, revision: Int) {
        if let slot = cacheURLs.firstIndex(of: url) {
            cacheURLs.remove(at: slot)
            cacheRevisions.remove(at: slot)
            cacheHints.remove(at: slot)
        }
        cacheURLs.insert(url, at: 0)
        cacheRevisions.insert(revision, at: 0)
        cacheHints.insert((anchors, leads, trails, widths, labels, covered), at: 0)
        if cacheURLs.count > Self.cacheLimit {
            cacheURLs.removeLast()
            cacheRevisions.removeLast()
            cacheHints.removeLast()
        }
    }

    private func lowerBound(_ offset: Int) -> Int {
        var low = 0
        var high = anchors.count
        while low < high {
            let middle = (low + high) / 2
            if anchors[middle] < offset { low = middle + 1 } else { high = middle }
        }
        return low
    }

    private static func chipWidth(_ label: String) -> CGFloat {
        Draw.width(of: label, style: style) + padding * 2
    }
}
