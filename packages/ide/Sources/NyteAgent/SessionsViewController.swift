import AppKit
import NyteUI

struct SessionLine: Equatable {
    var key: String
    var isHeader = false
    var title: String
    var untitled = false
    var state = SessionState.none
    var age = ""
    var badge: RowContent.Badge?
    var detail = ""
    var changes: ChangeTotals?
    var reachable = true
    var shown = false

    var shape: String { isHeader ? "#" + key : (detail.isEmpty ? key : key + "+") }
}

enum SessionLines {
    static let firstWords = 8
    static let minute: TimeInterval = 60
    static let minutesPerHour = 60
    static let hoursPerDay = 24
    static let daysPerWeek = 7
    static let daysPerYear = 365
    static let newKey = "new:"
    static let newTitle = "New Session"
    static let newSymbol = "square.and.pencil"

    static func build(_ sessions: [SessionSummary], query: String, shown: String?, doing: String?, opening: String?,
                      now: Date, calendar: Calendar) -> [SessionLine] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        let kept = sessions.filter { session in
            guard !needle.isEmpty else { return true }
            return title(session, shown: shown, opening: opening).title.localizedStandardContains(needle)
        }
        var lines = [SessionLine(key: newKey, title: newTitle)]
        var group = ""
        for session in kept.filter(\.pinned) + kept.filter({ !$0.pinned }) {
            let heading = session.pinned ? "Pinned" : day(session.lastActivity, now: now, calendar: calendar)
            if heading != group {
                group = heading
                lines.append(SessionLine(key: heading, isHeader: true, title: heading))
            }
            lines.append(line(session, shown: shown, doing: doing, opening: opening, now: now))
        }
        return lines
    }

    static func line(_ session: SessionSummary, shown: String?, doing: String?, opening: String?, now: Date) -> SessionLine {
        let named = title(session, shown: shown, opening: opening)
        let state = SessionState(session)
        var line = SessionLine(key: session.id, title: named.title, untitled: named.untitled, state: state,
                               reachable: session.reachable, shown: session.id == shown)
        line.badge = state.badge
        line.age = age(session.lastActivity, now: now)
        line.detail = detail(session, doing: session.id == shown ? doing : nil, now: now)
        line.changes = session.changes.flatMap { $0.files > 0 ? $0 : nil }
        return line
    }

    static func title(_ session: SessionSummary, shown: String?, opening: String?) -> (title: String, untitled: Bool) {
        if let title = session.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty { return (title, false) }
        guard session.id == shown, let opening, !opening.isEmpty else { return ("Untitled session", true) }
        let words = opening.split(whereSeparator: \.isWhitespace).prefix(firstWords).joined(separator: " ")
        return (words, false)
    }

    static func detail(_ session: SessionSummary, doing: String?, now: Date) -> String {
        switch session.run {
        case .asking: return session.asked ?? ""
        case let .retrying(reason, until):
            let words = SessionState.retryWords(until: until, now: now)
            return reason.isEmpty ? words : words + " \u{00B7} " + reason
        case let .failed(words) where session.backgroundWaiting == 0: return words
        case .working: return doing ?? ""
        case .idle, .failed: break
        }
        if session.backgroundWaiting > 0 { return "A subagent needs input" }
        if session.backgroundWorking > 0 {
            return session.backgroundWorking == 1 ? "1 subagent working" : "\(session.backgroundWorking) subagents working"
        }
        return ""
    }

    static func age(_ date: Date, now: Date) -> String {
        let minutes = Int(max(0, now.timeIntervalSince(date)) / minute)
        let hours = minutes / minutesPerHour
        let days = hours / hoursPerDay
        if minutes < 1 { return "now" }
        if hours < 1 { return "\(minutes)m" }
        if days < 1 { return "\(hours)h" }
        if days < daysPerWeek { return "\(days)d" }
        if days < daysPerYear { return "\(days / daysPerWeek)w" }
        return "\(days / daysPerYear)y"
    }

    static func day(_ date: Date, now: Date, calendar: Calendar) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        let style = calendar.isDate(date, equalTo: now, toGranularity: .year)
            ? Date.FormatStyle(calendar: calendar).weekday(.wide).month(.abbreviated).day()
            : Date.FormatStyle(calendar: calendar).month(.abbreviated).day().year()
        return date.formatted(style)
    }

    static func content(_ line: SessionLine) -> RowContent {
        guard !line.isHeader else { return .header(line.title) }
        guard line.key != newKey else {
            var row = RowContent(title: line.title, leading: .symbol(newSymbol, .secondary))
            row.meta = "\u{2318}N"
            row.alignsFacts = true
            return row
        }
        var row = RowContent(title: line.title, leading: .mark(.task(line.state.mark)))
        row.titleInk = line.shown ? .primary : (!line.reachable || line.untitled ? .tertiary : .secondary)
        row.meta = line.age
        row.titleWeight = line.state == .unread ? .medium : .regular
        row.badge = line.badge
        row.alignsFacts = true
        row.yieldOrder = [.title]
        if let changes = line.changes {
            row.diff = (changes.added, changes.removed)
            row.showsFrom = [.counts: RowContent.roomForColumns]
            row.toolTip = line.title + "\n+\(changes.added) \u{2212}\(changes.removed)"
        }
        row.description = line.detail
        row.descriptionInk = .tertiary
        return row
    }
}

@MainActor
final class KeyedView: NSView {
    var onKeyEquivalent: ((NSEvent) -> Bool)?

    override var isFlipped: Bool { true }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if !isHiddenOrHasHiddenAncestor, onKeyEquivalent?(event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }
}

@MainActor
final class SessionsViewController: NSViewController {
    var onOpen: ((String, Bool) -> Void)?
    var onNew: (() -> Void)?
    var onRename: ((String, String) -> Void)?
    var onRetry: (() -> Void)?
    var onVisible: (([String]) -> Void)?
    var onArchive: ((String) -> Void)?
    var onOpenInWindow: ((String) -> Void)?

    let list = ListView()
    let search = SearchField(placeholder: "Search")
    private let stateSlot = NSView()
    private let noticeSlot = NSView()
    private var state = NavigatorState.list
    private var renaming: (id: String, input: Input)?
    private var clock: Timer?
    private var observingScroll = false
    private var visibleKeys: [String] = []
    private var reveal = Reveal.calm

    private var sessions: [SessionSummary] = []
    private var connection = ConnectionState.connecting
    private var shown: String?
    private var doing: String?
    private var opening: String?
    private var query = ""
    private(set) var lines: [SessionLine] = []

    static let findKey = "f"
    static let clockInterval: TimeInterval = 30
    static let countdownInterval: TimeInterval = 1
    static let tolerance = 0.25

    isolated deinit {
        clock?.invalidate()
        reveal.settle()
    }

    override func loadView() {
        let root = KeyedView()
        root.onKeyEquivalent = { [weak self] event in self?.keyEquivalent(event) ?? false }
        view = root
        search.onChange = { [weak self] text in self?.filter(text) }
        search.onMove = { [weak self] delta in self?.list.moveSelection(by: delta) }
        search.onSubmit = { [weak self] _ in
            guard let self, let row = list.selectedRow else { return }
            activate(row, focus: true)
        }
        search.field.setAccessibilityLabel("Search sessions")
        search.onCommand = { [weak self] selector in
            guard let self, search.stringValue.isEmpty, onArchive != nil,
                  selector == #selector(NSResponder.deleteBackward(_:)) || selector == #selector(NSResponder.deleteForward(_:)),
                  let row = list.selectedRow, row < lines.count, !lines[row].isHeader, lines[row].key != SessionLines.newKey
            else { return false }
            onArchive?(lines[row].key)
            return true
        }

        list.verticalInset = Space.x1
        list.rowCount = { [weak self] in self?.lines.count ?? 0 }
        list.content = { [weak self] row in
            guard let self, row < lines.count else { return RowContent() }
            return SessionLines.content(lines[row])
        }
        list.heightOfRow = { [weak self] row in
            guard let self, row < lines.count, !lines[row].detail.isEmpty, !lines[row].isHeader else { return Metric.row }
            return Metric.rowDouble
        }
        list.activatesOnClick = true
        list.onActivate = { [weak self] row in
            self?.activate(row, focus: NSApp.currentEvent?.type == .keyDown)
        }
        list.menuForRow = { [weak self] row in self?.menu(for: row) }
        list.onDelete = { [weak self] rows in
            guard let self, let row = rows.first, row < lines.count, !lines[row].isHeader, lines[row].key != SessionLines.newKey else { return }
            onArchive?(lines[row].key)
        }
        list.setAccessibilityLabel("Sessions")

        stateSlot.translatesAutoresizingMaskIntoConstraints = false
        noticeSlot.translatesAutoresizingMaskIntoConstraints = false
        noticeSlot.isHidden = true
        [search, list, stateSlot, noticeSlot].forEach(root.addSubview)
        NSLayoutConstraint.activate([
            search.topAnchor.constraint(equalTo: root.topAnchor, constant: Space.x1),
            search.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: RowCell.Geometry.inset),
            search.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -RowCell.Geometry.inset),
            list.topAnchor.constraint(equalTo: search.bottomAnchor, constant: Space.x2),
            list.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            list.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            stateSlot.topAnchor.constraint(equalTo: list.topAnchor),
            stateSlot.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            stateSlot.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            stateSlot.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            noticeSlot.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: RowCell.Geometry.inset),
            noticeSlot.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -RowCell.Geometry.inset),
            noticeSlot.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -RowCell.Geometry.inset),
        ])
        refresh()
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        tick()
        reportVisible()
        guard !observingScroll else { return }
        observingScroll = true
        list.scrollView.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(listScrolled), name: NSView.boundsDidChangeNotification,
                                               object: list.scrollView.contentView)
    }

    @objc private func listScrolled() { reportVisible() }

    private func tick() {
        guard view.window != nil else { return }
        let interval = lines.contains { $0.state.ticks } ? Self.countdownInterval : Self.clockInterval
        guard clock?.timeInterval != interval else { return }
        clock?.invalidate()
        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        timer.tolerance = interval * Self.tolerance
        RunLoop.main.add(timer, forMode: .common)
        clock = timer
    }

    private func reportVisible() {
        guard view.window != nil else { return }
        let rows = list.visibleRows.clamped(to: 0 ..< lines.count)
        let ids = lines[rows].filter { !$0.isHeader && $0.key != SessionLines.newKey }.map(\.key)
        guard ids != visibleKeys else { return }
        visibleKeys = ids
        onVisible?(ids)
    }

    override func viewDidDisappear() {
        super.viewDidDisappear()
        clock?.invalidate()
        clock = nil
        visibleKeys = []
        reveal.settle()
    }

    func update(sessions: [SessionSummary]) {
        self.sessions = sessions
        refresh()
    }

    func update(connection: ConnectionState) {
        guard connection != self.connection else { return }
        self.connection = connection
        if connection != .connecting { reveal.settle() }
        refresh()
    }

    func show(session: String?) {
        shown = session
        if session == nil {
            doing = nil
            opening = nil
        }
        refresh()
        selectShown()
    }

    func update(doing: String?, opening: String?) {
        guard doing != self.doing || opening != self.opening else { return }
        self.doing = doing
        self.opening = opening
        refresh()
    }

    private func filter(_ text: String) {
        query = text
        refresh()
        if let first = lines.firstIndex(where: { !$0.isHeader && $0.key != SessionLines.newKey }), !query.isEmpty, list.selectedRow == nil {
            list.selectedRow = first
        }
    }

    private func refresh() {
        guard isViewLoaded else { return }
        let next = SessionLines.build(sessions, query: query, shown: shown, doing: doing, opening: opening, now: .now,
                                      calendar: .current)
        if next.map(\.shape) == lines.map(\.shape) {
            let changed = IndexSet(next.indices.filter { next[$0] != lines[$0] })
            lines = next
            list.reloadRows(changed)
        } else {
            let selectedKey = list.selectedRow.flatMap { $0 < lines.count ? lines[$0].key : nil }
            list.selectedRows = []
            lines = next
            list.reload()
            if let row = lines.firstIndex(where: { !$0.isHeader && $0.key == selectedKey }) {
                list.selectedRow = row
            } else {
                selectShown()
            }
            placeRename()
        }
        updateState()
        tick()
        reportVisible()
    }

    private func selectShown() {
        guard let shown, let row = lines.firstIndex(where: { !$0.isHeader && $0.key == shown }) else { return }
        if list.selectedRow != row { list.selectedRow = row }
    }

    func show(problem: String) {
        noticeSlot.subviews.forEach { $0.removeFromSuperview() }
        let banner = Banner("Couldn't rename the session", detail: problem, tone: .warning) { [weak self] in
            self?.noticeSlot.subviews.forEach { $0.removeFromSuperview() }
            self?.noticeSlot.isHidden = true
        }
        noticeSlot.addSubview(banner)
        NSLayoutConstraint.activate([
            banner.leadingAnchor.constraint(equalTo: noticeSlot.leadingAnchor),
            banner.trailingAnchor.constraint(equalTo: noticeSlot.trailingAnchor),
            banner.topAnchor.constraint(equalTo: noticeSlot.topAnchor),
            banner.bottomAnchor.constraint(equalTo: noticeSlot.bottomAnchor),
        ])
        noticeSlot.isHidden = false
    }

    private func updateState() {
        let next = NavigatorState.decide(connection: connection, hasSessions: !sessions.isEmpty,
                                         hasLines: lines.contains { !$0.isHeader && $0.key != SessionLines.newKey },
                                         query: query, patient: reveal.hasElapsed)
        list.isHidden = next != .list
        if next == .quiet {
            reveal.wait(AgentStates.connectingDelay) { [weak self] in
                self?.reveal = .elapsed
                self?.updateState()
            }
        }
        guard next != state else { return }
        state = next
        stateSlot.subviews.forEach { $0.removeFromSuperview() }
        guard let view = stateView(next) else { return }
        view.translatesAutoresizingMaskIntoConstraints = false
        stateSlot.addSubview(view)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: stateSlot.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: stateSlot.trailingAnchor),
            view.topAnchor.constraint(equalTo: stateSlot.topAnchor),
            view.bottomAnchor.constraint(equalTo: stateSlot.bottomAnchor),
        ])
    }

    private func stateView(_ state: NavigatorState) -> NSView? {
        switch state {
        case .list, .quiet: return nil
        case .connecting: return AgentStates.connecting()
        case .missing: return AgentStates.problem(.missing) { [weak self] in self?.onRetry?() }
        case let .incompatible(mismatch): return AgentStates.problem(.incompatible(mismatch)) { [weak self] in self?.onRetry?() }
        case let .failed(reason): return AgentStates.problem(.failed(reason)) { [weak self] in self?.onRetry?() }
        case .empty:
            return EmptyState(title: "No sessions yet", description: "Sessions you start in this folder show up here.",
                              actions: [("New Session", { [weak self] in self?.onNew?() })])
        case let .noMatch(query):
            return EmptyState(title: "No matches", description: "No session title contains \u{201C}\(query)\u{201D}.")
        }
    }

    private func activate(_ row: Int, focus: Bool) {
        guard row < lines.count, !lines[row].isHeader else { return }
        let key = lines[row].key
        guard key != SessionLines.newKey else { return onNew?() ?? () }
        if let onOpenInWindow, NSApp.currentEvent?.modifierFlags.contains(.command) == true { return onOpenInWindow(key) }
        onOpen?(key, focus)
        show(session: key)
    }

    func prepareForSearch() {
        if !query.isEmpty {
            search.field.stringValue = ""
            filter("")
        }
        selectShown()
        if list.selectedRow == nil { list.selectedRow = lines.firstIndex { !$0.isHeader && $0.key != SessionLines.newKey } }
        view.window?.makeFirstResponder(search.field)
    }

    var preferredHeight: CGFloat {
        let rows = lines.indices.reduce(CGFloat(0)) { $0 + (list.heightOfRow?($1) ?? Metric.row) }
        return Space.x1 + search.fittingSize.height + Space.x2 + rows + Space.x1 * 2
    }

    private func menu(for row: Int) -> NSMenu? {
        guard row < lines.count, !lines[row].isHeader, lines[row].key != SessionLines.newKey else { return nil }
        let id = lines[row].key
        return Menu.make([
            MenuItem("Open") { [weak self] in self?.activate(row, focus: false) },
            MenuItem("Rename\u{2026}") { [weak self] in self?.beginRename(id) },
            MenuItem("Archive\u{2026}") { [weak self] in self?.onArchive?(id) },
            .separator,
            MenuItem("Copy Session ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(id, forType: .string)
            },
        ])
    }

    private func keyEquivalent(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        guard modifiers == .command, event.charactersIgnoringModifiers == Self.findKey, let responder = view.window?.firstResponder as? NSView, responder.isDescendant(of: view) else {
            return false
        }
        view.window?.makeFirstResponder(search.field)
        return true
    }

    func beginRename(_ id: String) {
        guard let row = lines.firstIndex(where: { !$0.isHeader && $0.key == id }), let document = list.scrollView.documentView else {
            return
        }
        endRename(commit: false)
        list.scrollRowToVisible(row)
        let current = sessions.first { $0.id == id }?.title ?? ""
        let input = Input(current, placeholder: "Session name", height: .flexible)
        input.field.setAccessibilityLabel("Session name")
        input.translatesAutoresizingMaskIntoConstraints = true
        input.onSubmit = { [weak self] _ in self?.endRename(commit: true) }
        input.onCancel = { [weak self] in self?.endRename(commit: false) }
        input.onEndEditing = { [weak self] _ in self?.endRename(commit: true) }
        document.addSubview(input)
        renaming = (id, input)
        placeRename()
        view.window?.makeFirstResponder(input.field)
        input.field.currentEditor()?.selectAll(nil)
    }

    private func placeRename() {
        guard let renaming, let document = list.scrollView.documentView else { return }
        guard let row = lines.firstIndex(where: { !$0.isHeader && $0.key == renaming.id }) else { return endRename(commit: false) }
        let rect = document.convert(list.rect(ofRow: row), from: list)
        let start = RowCell.Geometry.inset + RowCell.Geometry.padding + RowCell.Geometry.icon + RowCell.Geometry.gap - Space.x2
        renaming.input.frame = NSRect(x: rect.minX + start, y: rect.minY + Space.hair,
                                      width: rect.width - start - RowCell.Geometry.inset, height: rect.height - Space.hair * 2)
    }

    private func endRename(commit: Bool) {
        guard let renaming else { return }
        self.renaming = nil
        let name = renaming.input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let focused = view.window?.firstResponder.map { ($0 as? NSView)?.isDescendant(of: renaming.input) ?? false } ?? false
        renaming.input.removeFromSuperview()
        if focused { list.focus() }
        guard commit, !name.isEmpty, let index = sessions.firstIndex(where: { $0.id == renaming.id }),
              name != sessions[index].title else { return }
        sessions[index].title = name
        refresh()
        onRename?(renaming.id, name)
    }
}

enum NavigatorState: Equatable {
    case list, quiet, connecting, missing, empty
    case incompatible(HostMismatch)
    case failed(String)
    case noMatch(String)

    static func decide(connection: ConnectionState, hasSessions: Bool, hasLines: Bool, query: String, patient: Bool) -> Self {
        switch connection {
        case .missing: hasSessions ? .list : .missing
        case let .incompatible(reason): .incompatible(reason)
        case let .failed(reason): .failed(reason)
        case .connecting: hasSessions ? .list : (patient ? .connecting : .quiet)
        case .ready: hasSessions ? (hasLines ? .list : .noMatch(query)) : .empty
        }
    }
}
