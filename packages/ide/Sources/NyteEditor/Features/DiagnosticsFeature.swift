import AppKit
import NyteCore
import NyteUI

@MainActor
final class DiagnosticsFeature: EditorFeature {
    private unowned let editor: EditorViewController
    private static let wavePeriod = Space.x1
    private static let waveAmplitude: CGFloat = 1
    private static let underlineDrop = Space.x05
    private static let dotStep = Space.x05 + Space.hair
    private static let quadraticToCubic: CGFloat = 2.0 / 3.0
    private static let quiet: Duration = .milliseconds(1500)

    private var starts: [Int] = []
    private var ends: [Int] = []
    private var severities: [Diagnostic.Severity] = []
    private var tags: [Diagnostic.Tags] = []
    private var alive: [Bool] = []
    private var gap = 0
    private var gapDelta = 0
    private var longest = 0
    private var stripeKey = (lines: 0, height: CGFloat(0), pane: CGFloat(0))
    private var stripePass: Task<Void, Never>?
    private var lastEdit: ContinuousClock.Instant?
    private var pendingLoad: Task<Void, Never>?
    private var stripe: ErrorStripe { editor.errorStripe }

    init(editor: EditorViewController) {
        self.editor = editor
        editor.errorStripe.onJump = { [weak self] offset in self?.move(to: offset) }
    }

    func documentDidChange() {
        attachStripe()
        lastEdit = nil
        pendingLoad?.cancel()
        load()
    }

    func intelligenceDidReport(_ event: IntelligenceEvent) {
        guard case let .diagnostics(url) = event, url.standardizedFileURL == editor.url else { return }
        pendingLoad?.cancel()
        guard let lastEdit, ContinuousClock.now - lastEdit < Self.quiet,
              (editor.intelligence?.diagnostics(for: url).count ?? 0) < alive.count(where: \.self)
        else { return load() }
        pendingLoad = Task { [weak self] in
            while let self, let edited = self.lastEdit, ContinuousClock.now - edited < Self.quiet {
                try? await Task.sleep(until: edited + Self.quiet)
                guard !Task.isCancelled else { return }
            }
            guard !Task.isCancelled else { return }
            self?.load()
        }
    }

    func textDidChange(in range: NSRange, delta: Int) {
        lastEdit = .now
        guard !starts.isEmpty else { return }
        let oldEnd = NSMaxRange(range) - delta
        let after = firstIndex(startingAfter: oldEnd)
        moveGap(to: after)
        var index = after - 1
        var dropped = false
        while index >= 0, starts[index] >= range.location - longest {
            if ends[index] >= range.location {
                dropped = dropped || alive[index]
                alive[index] = false
                starts[index] = min(starts[index], range.location)
                ends[index] = starts[index]
            }
            index -= 1
        }
        gapDelta += delta
        if dropped || editor.lineIndex?.count != stripeKey.lines { scheduleStripe() }
    }

    func viewportDidChange() {
        let height = editor.textView.frame.height
        let pane = editor.scrollView.bounds.height
        guard height != stripeKey.height || pane != stripeKey.pane else { return }
        scheduleStripe()
    }

    func canPerform(_ command: EditorCommand) -> Bool {
        (command == .nextProblem || command == .previousProblem) && alive.contains(true)
    }

    func perform(_ command: EditorCommand) -> Bool {
        guard canPerform(command) else { return false }
        let caret = editor.textView.selectedRange().location
        let living = starts.indices.filter { alive[$0] }
        let target = command == .nextProblem
            ? living.first { start($0) > caret } ?? living[0]
            : living.last { start($0) < caret } ?? living[living.count - 1]
        move(to: start(target))
        return true
    }

    func colourRuns(forLine line: Int) -> [(range: NSRange, color: NSColor)] {
        guard !starts.isEmpty else { return [] }
        let span = editor.shownStore.lineRange(line)
        var runs: [(range: NSRange, color: NSColor)] = []
        for index in firstIndex(startingAfter: span.location - longest - 1)..<starts.count {
            guard start(index) < NSMaxRange(span) else { break }
            guard alive[index], tags[index].contains(.unnecessary) else { continue }
            let range = NSIntersectionRange(NSRange(location: start(index), length: end(index) - start(index)), span)
            guard range.length > 0 else { continue }
            runs.append((NSRange(location: range.location - span.location, length: range.length), Palette.contentTertiary))
        }
        return runs
    }

    func drawOverText(in rect: NSRect) {
        guard !starts.isEmpty, let lines = editor.lineIndex else { return }
        let visible = editor.visibleRange
        let text = editor.shownText
        let scale = editor.textView.window?.backingScaleFactor ?? 2
        for index in firstIndex(startingAfter: visible.location - longest - 1)..<starts.count {
            let problem = NSRange(location: start(index), length: end(index) - start(index))
            guard problem.location <= NSMaxRange(visible) else { break }
            let deprecated = tags[index].contains(.deprecated)
            guard alive[index], NSMaxRange(problem) >= visible.location, deprecated || !tags[index].contains(.unnecessary) else { continue }
            let first = lines.line(at: max(problem.location, visible.location))
            let last = lines.line(at: min(NSMaxRange(problem), NSMaxRange(visible)))
            for line in first...last {
                let content = lines.range(of: line, length: text.length)
                let start = max(problem.location, content.location)
                let end = min(NSMaxRange(problem), NSMaxRange(content))
                guard end > start else { continue }
                let segment = NSRange(location: start, length: end - start)
                guard let box = editor.rects(for: segment).first else { continue }
                let span = box
                guard span.intersects(rect) else { continue }
                let baseline = box.minY + editor.textView.metrics.baseline
                if deprecated {
                    let font = editor.textView.metrics.font
                    let y = ((baseline - font.xHeight / 2) * scale).rounded(.down) / scale
                    Palette.contentSecondary.setFill()
                    NSRect(x: span.minX, y: y, width: span.width, height: Metric.hairline).fill()
                    continue
                }
                let y = ((baseline + Self.underlineDrop) * scale).rounded() / scale
                switch severities[index] {
                case .error: wave(from: span.minX, to: span.maxX, y: y, ink: Palette.dangerInk)
                case .warning: wave(from: span.minX, to: span.maxX, y: y, ink: Palette.warningInk)
                case .information, .hint: dots(from: span.minX, to: span.maxX, y: y)
                }
            }
        }
    }

    private func wave(from start: CGFloat, to end: CGFloat, y: CGFloat, ink: NSColor) {
        let path = NSBezierPath()
        let half = Self.wavePeriod / 2
        var x = start
        var up = true
        path.move(to: NSPoint(x: x, y: y))
        while x < end {
            let next = min(x + half, end)
            let peak = NSPoint(x: (x + next) / 2, y: y + (up ? -1 : 1) * Self.waveAmplitude * 2 * (next - x) / half)
            let from = NSPoint(x: x, y: y)
            let to = NSPoint(x: next, y: y)
            path.curve(
                to: to,
                controlPoint1: NSPoint(x: from.x + (peak.x - from.x) * Self.quadraticToCubic, y: from.y + (peak.y - from.y) * Self.quadraticToCubic),
                controlPoint2: NSPoint(x: to.x + (peak.x - to.x) * Self.quadraticToCubic, y: to.y + (peak.y - to.y) * Self.quadraticToCubic)
            )
            x = next
            up.toggle()
        }
        path.lineWidth = Metric.hairline
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        ink.setStroke()
        path.stroke()
    }

    private func dots(from start: CGFloat, to end: CGFloat, y: CGFloat) {
        Palette.contentTertiary.setFill()
        var x = start.rounded(.down)
        while x + Space.hair <= end {
            NSRect(x: x, y: y, width: Space.hair, height: Space.hair).fill()
            x += Self.dotStep
        }
    }

    private func load() {
        starts.removeAll(keepingCapacity: true)
        ends.removeAll(keepingCapacity: true)
        severities.removeAll(keepingCapacity: true)
        tags.removeAll(keepingCapacity: true)
        alive.removeAll(keepingCapacity: true)
        gap = 0
        gapDelta = 0
        longest = 0
        defer {
            gap = starts.count
            scheduleStripe()
            editor.textView.needsDisplay = true
            editor.repaint()
        }
        guard let url = editor.url, let intelligence = editor.intelligence, intelligence.handles(url), editor.shown != nil else {
            editor.onProblemsChange?(nil)
            return
        }
        let text = editor.shownText
        var counts = ProblemCounts()
        let found = intelligence.diagnostics(for: url).compactMap { diagnostic -> (NSRange, Diagnostic)? in
            switch diagnostic.severity {
            case .error: counts.errors += 1
            case .warning: counts.warnings += 1
            case .information, .hint: counts.notes += 1
            }
            return editor.range(of: diagnostic.range).map { (widen($0, in: text), diagnostic) }
        }.sorted { $0.0.location < $1.0.location }
        for (range, diagnostic) in found {
            starts.append(range.location)
            ends.append(NSMaxRange(range))
            severities.append(diagnostic.severity)
            tags.append(diagnostic.tags)
            alive.append(true)
            longest = max(longest, range.length)
        }
        editor.onProblemsChange?(counts)
    }

    private func start(_ index: Int) -> Int { starts[index] + (index >= gap ? gapDelta : 0) }
    private func end(_ index: Int) -> Int { ends[index] + (index >= gap ? gapDelta : 0) }

    private func firstIndex(startingAfter offset: Int) -> Int {
        var low = 0
        var high = starts.count
        while low < high {
            let middle = (low + high) / 2
            if start(middle) <= offset { low = middle + 1 } else { high = middle }
        }
        return low
    }

    private func moveGap(to index: Int) {
        if index < gap {
            for slot in index..<gap {
                starts[slot] -= gapDelta
                ends[slot] -= gapDelta
            }
        } else if index > gap {
            for slot in gap..<index {
                starts[slot] += gapDelta
                ends[slot] += gapDelta
            }
        }
        gap = index
    }

    private func widen(_ range: NSRange, in text: some UnitString) -> NSRange {
        guard range.length == 0, text.length > 0 else { return range }
        var start = range.location
        var end = range.location
        while start > 0, Self.isWord(text.character(at: start - 1)) { start -= 1 }
        while end < text.length, Self.isWord(text.character(at: end)) { end += 1 }
        if end > start { return NSRange(location: start, length: end - start) }
        if range.location < text.length, text.character(at: range.location) != 0x0A { return NSRange(location: range.location, length: 1) }
        if range.location > 0, text.character(at: range.location - 1) != 0x0A { return NSRange(location: range.location - 1, length: 1) }
        return range
    }

    private static func isWord(_ unit: UInt16) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }
        return scalar == "_" || CharacterSet.alphanumerics.contains(scalar)
    }

    private func move(to offset: Int) {
        let target = NSRange(location: offset, length: 0)
        editor.textView.setSelectedRange(target)
        editor.textView.scrollRangeToVisible(target)
        editor.textView.window?.makeFirstResponder(editor.textView)
    }

    private func attachStripe() {
        guard stripe.superview == nil, editor.isViewLoaded else { return }
        let root = editor.view
        stripe.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stripe, positioned: .above, relativeTo: editor.scrollView)
        NSLayoutConstraint.activate([
            stripe.topAnchor.constraint(equalTo: editor.scrollView.topAnchor),
            stripe.bottomAnchor.constraint(equalTo: editor.scrollView.bottomAnchor),
            stripe.trailingAnchor.constraint(equalTo: editor.scrollView.trailingAnchor),
            stripe.widthAnchor.constraint(equalToConstant: ErrorStripe.width),
        ])
    }

    private func scheduleStripe() {
        stripePass?.cancel()
        stripePass = Task { [weak self] in
            guard !Task.isCancelled else { return }
            self?.updateStripe()
        }
    }

    private func updateStripe() {
        stripeKey = (editor.lineIndex?.count ?? 0, editor.textView.frame.height, editor.scrollView.bounds.height)
        let living = starts.indices.filter { alive[$0] }
        guard let lines = editor.lineIndex, !living.isEmpty, let pitch = editor.rects(for: NSRange(location: 0, length: 0)).first?.height
        else { return stripe.show(ratios: [], severities: [], targets: []) }
        let inset = editor.textView.textOrigin.y
        let height = max(editor.textView.frame.height, editor.scrollView.contentView.bounds.height)
        let targets = living.map(start)
        let ratios = targets.map { offset in
            min(1, max(0, (inset + (CGFloat(editor.textView.rowMap.row(of: lines.line(at: offset))) + 0.5) * pitch) / height))
        }
        stripe.show(ratios: ratios, severities: living.map { severities[$0] }, targets: targets)
    }
}
