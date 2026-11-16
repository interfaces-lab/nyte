import AppKit
import NyteUI
@MainActor
final class TranscriptController: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    let scroll = NSScrollView()
    private let table = NSTableView()
    private(set) var model = Transcript()
    private var specs: [RowSpec] = []
    private var expanded: Set<String> = []
    private var outputs: [String: ToolOutput] = [:]
    private var attributed: [String: NSAttributedString] = [:]
    private var pinned = true
    private var moving = false
    private var width: CGFloat = 0
    private var pendingHeights = IndexSet()
    private var canLoadEarlier = false
    var onNeedOutput: ((String, String) -> Void)?
    var onReachTop: (() -> Void)?
    var onOpenLink: ((URL) -> Void)?
    var onOpenFile: ((String, Int?) -> Void)?
    var onRetry: ((String) -> Void)?
    var onReview: ((ReviewTarget) -> Void)?
    var onOpenChip: ((ContextFormat.Chip) -> Void)?
    private var contexts: [String: [ContextFormat.Chip]] = [:]
    private var deadlines: [String: Date] = [:]
    var baseURL: URL?

    private static let cacheLimit = 256
    private static let topReach = Rows.line * 4
    private static let charactersPerPoint = 0.5

    override init() {
        super.init()
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("row"))
        column.resizingMask = .autoresizingMask
        table.addTableColumn(column)
        table.headerView = nil
        table.backgroundColor = .clear
        table.gridStyleMask = []
        table.intercellSpacing = .zero
        table.selectionHighlightStyle = .none
        table.style = .plain
        table.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
        table.usesAutomaticRowHeights = false
        table.allowsEmptySelection = true
        table.focusRingType = .none
        table.dataSource = self
        table.delegate = self
        table.target = self
        table.action = #selector(clicked)
        table.setAccessibilityLabel("Transcript")
        Density.observe(self) { [weak self] in self?.remeasure() }

        scroll.documentView = table
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.automaticallyAdjustsContentInsets = false
        scroll.contentInsets = NSEdgeInsets(top: 0, left: 0, bottom: Space.x3, right: 0)
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.contentView.postsBoundsChangedNotifications = true
        scroll.contentView.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(
            self, selector: #selector(scrolled), name: NSView.boundsDidChangeNotification, object: scroll.contentView
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(resized), name: NSView.frameDidChangeNotification, object: scroll.contentView
        )
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(motionChanged),
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil
        )
    }

    func apply(_ snapshot: TranscriptSnapshot) {
        specs = snapshot.rows
        contexts = snapshot.contexts
        deadlines = snapshot.deadlines
        canLoadEarlier = snapshot.canLoadEarlier
        relayout()
    }
    func reset() {
        specs = []
        expanded = []
        outputs = [:]
        attributed = [:]
        model = Transcript()
        pinned = true
        table.reloadData()
    }

    func stream(part: String, version: Int, text: String, append: Bool) {
        let rows = model.stream(part: part, version: version, text: text, append: append)
        guard !rows.isEmpty else { return }
        keepingPlace {
            let visible = table.rows(in: table.visibleRect)
            let shown = IndexSet(rows.filter { visible.contains($0) || $0 >= table.numberOfRows - 1 })
            for row in rows where !shown.contains(row) { model.heights[row] = estimate(row) }
            for row in shown { measure(row) }
            noteHeights(IndexSet(rows))
            for row in shown { reconfigure(row) }
        }
    }

    func setOutput(_ output: ToolOutput, for key: String) {
        outputs[key] = output
        expanded.insert(key)
        relayout()
    }

    var isEmpty: Bool { model.count == 0 }

    private func relayout() {
        keepingPlace {
            switch model.rebuild(specs, expanded: expanded, outputs: outputs) {
            case .none: return
            case let .rows(changed):
                settle(changed)
            case let .appended(range, changed):
                settle(IndexSet(integersIn: range), insert: true)
                settle(changed)
            case let .prepended(count, changed):
                settle(IndexSet(integersIn: 0 ..< count), insert: true)
                settle(changed)
            case .reload:
                for row in 0 ..< model.count where model.heights[row] == 0 { model.heights[row] = estimate(row) }
                table.reloadData()
            }
        }
    }

    private func remeasure() {
        keepingPlace {
            for row in 0 ..< model.count {
                model.exact[row] = false
                model.heights[row] = estimate(row)
            }
            table.reloadData()
        }
    }

    private func settle(_ rows: IndexSet, insert: Bool = false) {
        guard !rows.isEmpty else { return }
        for row in rows where !model.exact[row] { model.heights[row] = estimate(row) }
        if insert {
            table.insertRows(at: rows, withAnimation: [])
            return
        }
        noteHeights(rows)
        for row in rows { reconfigure(row) }
    }
    private func keepingPlace(_ change: () -> Void) {
        let clip = scroll.contentView
        let top = clip.bounds.minY
        let visible = table.rows(in: clip.bounds).asRange.filter { $0 < model.count }
        let anchors = visible.map { (key: model.keys[$0], offset: top - table.rect(ofRow: $0).minY) }
        change()
        table.layoutSubtreeIfNeeded()
        if pinned {
            scrollToBottom()
            return
        }
        guard let anchor = anchors.first(where: { model.row(key: $0.key) != nil }), let row = model.row(key: anchor.key) else { return }
        moving = true
        clip.scroll(to: NSPoint(x: 0, y: table.rect(ofRow: row).minY + anchor.offset))
        scroll.reflectScrolledClipView(clip)
        moving = false
    }

    private func scrollToBottom() {
        let clip = scroll.contentView
        let bottom = table.frame.height + scroll.contentInsets.bottom - clip.bounds.height
        moving = true
        clip.scroll(to: NSPoint(x: 0, y: max(-scroll.contentInsets.top, bottom)))
        scroll.reflectScrolledClipView(clip)
        moving = false
    }

    private func noteHeights(_ rows: IndexSet) {
        guard !rows.isEmpty else { return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0
            table.noteHeightOfRows(withIndexesChanged: rows)
        }
    }

    private func reconfigure(_ row: Int) {
        guard row < table.numberOfRows, let cell = table.view(atColumn: 0, row: row, makeIfNecessary: false) else { return }
        configure(cell, row: row)
    }

    private func textWidth(_ kind: RowKind) -> CGFloat {
        let width = table.bounds.width - Rows.inset * 2
        return kind == .user ? width - Rows.cardPadding.width * 2 : width
    }

    private func estimate(_ row: Int) -> CGFloat {
        let kind = model.kinds[row]
        if look(row) == .step { return Rows.line }
        if look(row) == .review { return ReviewCell.height }
        if look(row) == .context { return Chip.height }
        let style: TextStyle = kind == .output ? .code : (kind == .ended || kind == .failure ? .base : .prose)
        let perLine = max(1, textWidth(kind) / (style.size * Self.charactersPerPoint))
        let lines = (CGFloat(model.byteCount(row)) / perLine).rounded(.up)
        let body = max(1, lines) * style.lineHeight
        return kind == .user ? body + Rows.cardPadding.height * 2 : body
    }

    private func measure(_ row: Int) {
        let kind = model.kinds[row]
        let body: CGFloat = switch look(row) {
        case .step: Rows.line
        case .review: ReviewCell.height
        case .context: Chip.height
        case .failure: FailureCell.height(lead: model.lead(row), text: model.subject(row),
                                          retryable: model.flags[row].contains(.retryable), width: table.bounds.width)
        case .markdown: MarkdownView.height(for: model.text(row), width: textWidth(kind))
        case .text: ProseMeasure.shared.height(text(for: row), width: textWidth(kind))
        }
        model.heights[row] = kind == .user ? body + Rows.cardPadding.height * 2 : body
        model.exact[row] = true
    }

    private func gap(_ row: Int) -> CGFloat {
        Rows.gap(model.kinds[row], look: look(row), after: row > 0 ? (model.kinds[row - 1], look(row - 1)) : nil)
    }

    private func look(_ row: Int) -> Rows.Look {
        let kind = model.kinds[row]
        if Rows.isLine(kind) { return .step }
        switch kind {
        case .ended: return .step
        case .failure: return .failure
        case .review: return .review
        case .context: return .context
        default: return isMarkdown(row) ? .markdown : .text
        }
    }

    private func isMarkdown(_ row: Int) -> Bool {
        switch model.kinds[row] {
        case .prose: true
        case .output: outputs[String(model.keys[row].dropFirst("out:".count))] == nil
        default: false
        }
    }

    private func text(for row: Int) -> NSAttributedString {
        let flags = model.flags[row]
        let key = "\(model.keys[row])#\(model.versions[row])#\(flags.rawValue)#\(model.spans[row].lowerBound)"
        if let known = attributed[key] { return known }
        let raw = model.text(row)
        let made: NSAttributedString = switch model.kinds[row] {
        case .user: Prose.plain(raw, style: .prose, color: flags.contains(.pending) ? Palette.contentTertiary : Palette.contentPrimary)
        case .output: Prose.code(raw, diff: flags.contains(.diff))
        default: Prose.plain(raw, style: .base, color: Palette.contentTertiary)
        }
        if attributed.count > Self.cacheLimit { attributed = [:] }
        attributed[key] = made
        return made
    }

    func numberOfRows(in tableView: NSTableView) -> Int { model.count }

    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
        guard row < model.count else { return Rows.line }
        if model.heights[row] == 0 { model.heights[row] = estimate(row) }
        return gap(row) + model.heights[row]
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard row < model.count else { return nil }
        if !model.exact[row] {
            let before = model.heights[row]
            measure(row)
            if model.heights[row] != before { later(row) }
        }
        let cell: NSView = switch look(row) {
        case .step: tableView.makeView(withIdentifier: StepCell.identifier, owner: nil) ?? StepCell()
        case .failure: tableView.makeView(withIdentifier: FailureCell.identifier, owner: nil) ?? FailureCell()
        case .review: tableView.makeView(withIdentifier: ReviewCell.identifier, owner: nil) ?? ReviewCell()
        case .context: tableView.makeView(withIdentifier: ContextCell.identifier, owner: nil) ?? ContextCell()
        case .markdown: tableView.makeView(withIdentifier: MarkdownCell.identifier, owner: nil) ?? MarkdownCell()
        case .text: tableView.makeView(withIdentifier: TextCell.identifier, owner: nil) ?? TextCell()
        }
        configure(cell, row: row)
        return cell
    }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool { false }

    private func configure(_ cell: NSView, row: Int) {
        let kind = model.kinds[row]
        if let step = cell as? StepCell {
            let stopped = kind == .ended
            step.configure(kind: stopped ? .note : kind, lead: model.lead(row), text: model.subject(row), glyph: model.glyphs[row],
                           flags: stopped ? [] : model.flags[row], added: model.added[row], removed: model.removed[row], gap: gap(row))
            let key = model.keys[row]
            step.onPress = { [weak self] in self?.toggle(key) }
            step.onReview = { [weak self] in self?.onReview?(.step(part: key)) }
        } else if let chips = cell as? ContextCell {
            chips.configure(contexts[model.keys[row]] ?? [], gap: gap(row))
            chips.flow.onOpen = { [weak self] chip in self?.onOpenChip?(chip) }
        } else if let review = cell as? ReviewCell {
            review.configure(model.text(row), added: model.added[row], removed: model.removed[row], gap: gap(row))
            let key = model.keys[row]
            review.onReview = { [weak self] in self?.onReview?(ReviewTarget(key: key)) }
        } else if let failure = cell as? FailureCell {
            let key = model.keys[row]
            failure.configure(lead: model.lead(row), text: model.subject(row), retryable: model.flags[row].contains(.retryable),
                              until: deadlines[key], gap: gap(row))
            failure.onRetry = { [weak self] in self?.onRetry?(key) }
        } else if let markdown = cell as? MarkdownCell {
            let key = model.keys[row]
            markdown.configure(model.text(row), ink: kind == .prose ? Palette.contentPrimary : Palette.contentTertiary, gap: gap(row))
            markdown.view.baseURL = baseURL
            markdown.view.onOpenLink = onOpenLink
            markdown.view.onOpenFile = onOpenFile
            markdown.view.onHeightChange = { [weak self] in self?.blockResized(key) }
        } else if let text = cell as? TextCell {
            text.configure(self.text(for: row), card: kind == .user, gap: gap(row))
        }
    }

    private func blockResized(_ key: String) {
        guard let row = model.row(key: key) else { return }
        let before = model.heights[row]
        measure(row)
        guard model.heights[row] != before else { return }
        keepingPlace { noteHeights(IndexSet(integer: row)) }
    }
    private func later(_ row: Int) {
        let first = pendingHeights.isEmpty
        pendingHeights.insert(row)
        guard first else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let rows = pendingHeights.filteredIndexSet { $0 < self.model.count }
            pendingHeights = IndexSet()
            keepingPlace { noteHeights(rows) }
        }
    }

    @objc private func clicked() {
        let row = table.clickedRow
        guard row >= 0, row < model.count, model.flags[row].contains(.expandable) else { return }
        toggle(model.keys[row])
    }

    private func toggle(_ key: String) {
        guard let row = model.row(key: key) else { return }
        if expanded.remove(key) != nil {
            relayout()
            return
        }
        if model.kinds[row] == .thinking || outputs[key] != nil {
            expanded.insert(key)
            relayout()
            return
        }
        onNeedOutput?(key, model.parts[row])
    }

    @objc private func scrolled() {
        guard !moving else { return }
        let clip = scroll.contentView
        let distance = table.frame.height + scroll.contentInsets.bottom - clip.bounds.maxY
        pinned = distance <= Space.x1
        if canLoadEarlier, clip.bounds.minY <= Self.topReach { onReachTop?() }
    }

    @objc private func resized() {
        let next = scroll.contentView.bounds.width
        guard next != width else { return }
        width = next
        guard model.count > 0 else { return }
        for row in 0 ..< model.count {
            model.exact[row] = false
            model.heights[row] = estimate(row)
        }
        keepingPlace {
            for row in table.rows(in: table.visibleRect).asRange { measure(row) }
            noteHeights(IndexSet(integersIn: 0 ..< model.count))
        }
    }

    @objc private func motionChanged() {
        for row in table.rows(in: table.visibleRect).asRange {
            (table.view(atColumn: 0, row: row, makeIfNecessary: false) as? StepCell)?.refresh()
        }
    }
}

private extension NSRange {
    var asRange: Range<Int> { location == NSNotFound ? 0 ..< 0 : location ..< location + length }
}
