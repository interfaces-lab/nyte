import AppKit
import NyteUI

@MainActor
final class FramesPane: NSView {
    enum Row: Equatable {
        case frame(Int)
        case group(start: Int, count: Int, isOpen: Bool)
    }

    var onSelectFrame: ((DebugFrame) -> Void)?
    var onSelectThread: ((Int) -> Void)?
    var onAskAboutFrame: ((Int) -> Void)?

    private(set) var frames: [DebugFrame] = []
    private(set) var rows: [Row] = []
    private var openGroups: Set<Int> = []
    private var threads: [DebugThread] = []
    private var thread: Int?
    var pause: (thread: Int, reason: String)? { didSet { showThreads() } }

    let list = ListView()
    private let tool = ToolWindowView(header: DebugLayout.stripRole)
    private let picker = Button(variant: .ghost, size: .sm)
    private let threadLabel = Label("", style: .base, color: Palette.contentSecondary)
    private let placeholder = Label("", style: .sm, color: Palette.contentTertiary)

    static let placeholderWaiting = "Frames show here when the program pauses"

    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        picker.trailingSymbol = "chevron.down"
        picker.restInk = Palette.contentPrimary
        picker.setAccessibilityLabel("Thread")
        picker.menuProvider = { [weak self] in self?.threadMenu() }
        picker.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        threadLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        list.rowHeight = Metric.rowCompact
        list.verticalInset = Space.x1
        list.rowCount = { [unowned self] in rows.count }
        list.content = { [unowned self] in content(rows[$0]) }
        list.onSelect = { [unowned self] _ in selectionChanged() }
        list.onToggle = { [unowned self] in toggle($0) }
        list.onActivate = { [unowned self] row in
            if case .group = rows[row] { toggle(row) } else { selectionChanged() }
        }
        list.setAccessibilityLabel("Frames")
        list.menuForRow = { [unowned self] row in menu(for: row) }
        placeholder.stringValue = Self.placeholderWaiting
        tool.headerRule = .always
        tool.header.leadingInset = RowCell.Geometry.inset
        tool.header.setViews(leading: [picker, threadLabel])
        Pin.fill(tool, in: self)
        Pin.fill(list, in: tool.content)
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        tool.content.addSubview(placeholder)
        NSLayoutConstraint.activate([
            placeholder.leadingAnchor.constraint(equalTo: tool.content.leadingAnchor,
                                                 constant: RowCell.Geometry.inset + RowCell.Geometry.padding),
            placeholder.trailingAnchor.constraint(lessThanOrEqualTo: tool.content.trailingAnchor, constant: -Metric.paneInset),
            placeholder.centerYAnchor.constraint(equalTo: tool.content.topAnchor, constant: Space.x1 + Metric.rowCompact / 2),
        ])
        showThreads()
    }

    func show(threads: [DebugThread], selected: Int?) {
        self.threads = threads
        thread = selected
        showThreads()
    }

    private func showThreads() {
        let current = threads.first { $0.id == thread }
        let name = current.map(DebugText.threadTitle) ?? ""
        let stoppedHere = current != nil && current?.id == pause?.thread
        let detail = stoppedHere ? pause.map { DebugText.reasonWord($0.reason) } ?? "" : current?.state ?? ""
        let picks = threads.count > 1
        picker.isHidden = !picks
        tool.header.leadingInset = picks ? RowCell.Geometry.inset : RowCell.Geometry.inset + RowCell.Geometry.padding
        threadLabel.isHidden = picks || name.isEmpty
        picker.title = name
        picker.detail = detail
        picker.toolTip = picks ? "Choose a thread" : nil
        threadLabel.stringValue = [name, detail].filter { !$0.isEmpty }.joined(separator: " · ")
        threadLabel.setAccessibilityLabel("Thread " + threadLabel.stringValue)
    }

    private func threadMenu() -> NSMenu {
        Menu.make(threads.map { item in
            MenuItem(DebugText.threadTitle(item), checked: item.id == thread, subtitle: item.state) { [weak self] in
                guard let self, item.id != thread else { return }
                thread = item.id
                showThreads()
                onSelectThread?(item.id)
            }
        }, title: "Threads")
    }

    func show(frames: [DebugFrame], selected: Int?) {
        self.frames = frames
        openGroups = []
        let hasUser = frames.contains(where: \.isUserCode)
        if !hasUser { openGroups = Set(frames.indices) }
        rebuild()
        placeholder.isHidden = !frames.isEmpty
        list.reload()
        select(frame: selected)
    }

    func clear(message: String = FramesPane.placeholderWaiting) {
        frames = []
        rows = []
        placeholder.stringValue = message
        placeholder.isHidden = message.isEmpty
        list.reload()
    }

    func clearThreads() {
        show(threads: [], selected: nil)
    }

    private func rebuild() {
        var rows: [Row] = []
        var index = 0
        while index < frames.count {
            guard !frames[index].isUserCode, !frames[index].isLabel else {
                rows.append(.frame(index))
                index += 1
                continue
            }
            let start = index
            while index < frames.count, !frames[index].isUserCode, !frames[index].isLabel { index += 1 }
            let open = openGroups.contains(start)
            rows.append(.group(start: start, count: index - start, isOpen: open))
            if open { rows += (start..<index).map(Row.frame) }
        }
        self.rows = rows
    }

    var selectedFrameIndex: Int? {
        guard let row = list.selectedRow, rows.indices.contains(row), case let .frame(index) = rows[row] else { return nil }
        return index
    }

    func select(frame index: Int?) {
        guard let index else {
            list.selectedRow = nil
            return
        }
        if !rows.contains(.frame(index)), let group = rows.first(where: { row in
            if case let .group(start, count, _) = row { (start..<start + count).contains(index) } else { false }
        }), case let .group(start, _, _) = group {
            openGroups.insert(start)
            rebuild()
            list.reload()
        }
        list.selectedRow = rows.firstIndex(of: .frame(index))
    }

    private func selectionChanged() {
        guard let index = selectedFrameIndex, !frames[index].isLabel else { return }
        onSelectFrame?(frames[index])
    }

    private func menu(for row: Int) -> NSMenu? {
        guard let onAskAboutFrame, rows.indices.contains(row), case let .frame(index) = rows[row], !frames[index].isLabel else { return nil }
        return Menu.make([MenuItem(DebugText.askAboutStop) { onAskAboutFrame(index) }])
    }

    private func toggle(_ row: Int) {
        guard case let .group(start, _, open) = rows[row] else { return }
        let selected = selectedFrameIndex
        if open { openGroups.remove(start) } else { openGroups.insert(start) }
        rebuild()
        list.reload()
        list.selectedRow = selected.flatMap { rows.firstIndex(of: .frame($0)) }
    }

    private func content(_ row: Row) -> RowContent {
        switch row {
        case let .group(_, count, open):
            var content = RowContent.header("Library frames", detail: "\(count)", disclosure: open ? .open : .closed)
            content.detailInk = .tertiary
            return content
        case let .frame(index):
            let frame = frames[index]
            let parts = DebugText.frameParts(frame)
            if frame.isLabel {
                var content = RowContent.header(DebugText.asyncLabel(frame.function))
                content.showsRuleAbove = true
                return content
            }
            var content = RowContent(title: parts.function, detail: DebugText.location(frame),
                                     depth: frame.isUserCode ? 0 : 1)
            content.value = parts.module
            content.valueInk = .tertiary
            if !frame.isUserCode { content.titleInk = .secondary }
            return content
        }
    }
}
