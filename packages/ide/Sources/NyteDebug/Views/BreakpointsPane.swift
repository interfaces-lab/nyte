import AppKit
import NyteCore
import NyteUI

@MainActor
final class BreakpointsPane: NSView {
    enum Row: Equatable {
        case header(String, count: Int)
        case line(Int)
        case exception(Int)
    }

    var onNavigate: ((FileLocation) -> Void)?

    private let debugger: Debugger
    private(set) var placed: [PlacedBreakpoint] = []
    private(set) var exceptions: [ExceptionBreakpoint] = []
    private(set) var rows: [Row] = []
    let list = ListView()
    private let summary = Label("", style: .sm, color: Palette.contentSecondary)
    private let removeAll = Button("Remove All", symbol: "trash", variant: .ghost, size: .sm)
    private let placeholder = Label("Click the gutter or press F9 to add a breakpoint", style: .sm, color: Palette.contentTertiary)
    private let editorPanel = FloatingPanel(radius: Radius.card, takesKey: true)

    init(debugger: Debugger) {
        self.debugger = debugger
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        build()
        reload()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        removeAll.onPress = { [unowned self] in
            debugger.removeAllBreakpoints()
            reload()
        }
        list.rowHeight = Metric.rowCompact
        list.verticalInset = Space.x1
        list.allowsMultipleSelection = true
        list.pinsGroupHeaders = true
        list.rowCount = { [unowned self] in rows.count }
        list.content = { [unowned self] in content(rows[$0]) }
        list.onCheck = { [unowned self] in toggle($0) }
        list.onActivate = { [unowned self] in goToSource($0) }
        list.onDelete = { [unowned self] in remove($0) }
        list.menuForRows = { [unowned self] in menu(for: $0) }
        list.setAccessibilityLabel("Breakpoints")
        let window = ToolWindowView(header: DebugLayout.stripRole)
        window.headerRule = .always
        window.header.setViews(leading: [summary], trailing: [removeAll])
        Pin.fill(window, in: self)
        Pin.fill(list, in: window.content)
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        window.content.addSubview(placeholder)
        NSLayoutConstraint.activate([
            placeholder.leadingAnchor.constraint(equalTo: window.content.leadingAnchor,
                                                 constant: RowCell.Geometry.inset + RowCell.Geometry.padding),
            placeholder.centerYAnchor.constraint(equalTo: window.content.topAnchor, constant: Space.x1 + Metric.rowCompact / 2),
        ])
    }

    func reload() {
        placed = debugger.placedBreakpoints
        exceptions = debugger.exceptionBreakpoints
        var rows: [Row] = []
        if !placed.isEmpty { rows.append(.header("Line Breakpoints", count: placed.count)) }
        rows += placed.indices.map(Row.line)
        if !exceptions.isEmpty { rows.append(.header("Exception Breakpoints", count: exceptions.count)) }
        rows += exceptions.indices.map(Row.exception)
        self.rows = rows
        placeholder.isHidden = !placed.isEmpty
        removeAll.isEnabled = !placed.isEmpty
        let enabled = placed.filter(\.breakpoint.isEnabled).count
        summary.stringValue = placed.isEmpty ? "" : enabled == placed.count ? "\(placed.count) breakpoints" : "\(enabled) of \(placed.count) enabled"
        list.reload()
    }

    private func content(_ row: Row) -> RowContent {
        switch row {
        case let .header(title, count):
            return RowContent.header(title, detail: "\(count)")
        case let .line(index):
            let item = placed[index]
            let breakpoint = item.breakpoint
            var content = RowContent(title: item.url.lastPathComponent + ":\(breakpoint.line + 1)",
                                     leading: .image(FileIcon.forFile(named: item.url.lastPathComponent).image(for: effectiveAppearance)))
            content.check = breakpoint.isEnabled ? .on : .off
            content.detail = Self.folder(of: item.url, in: debugger.workspace)
            content.value = Self.conditions(breakpoint)
            content.valueInk = .secondary
            content.meta = breakpoint.isEnabled && breakpoint.verification == .unverified ? "not verified" : ""
            content.accessibilityLabel = "Breakpoint at \(item.url.lastPathComponent) line \(breakpoint.line + 1)"
            return content
        case let .exception(index):
            let item = exceptions[index]
            var content = RowContent(title: item.filter.label, detail: item.adapterName)
            content.check = item.isEnabled ? .on : .off
            content.value = item.filter.detail
            content.valueInk = .tertiary
            return content
        }
    }

    static func conditions(_ breakpoint: Breakpoint) -> String {
        [breakpoint.condition.isEmpty ? "" : "when " + breakpoint.condition,
         breakpoint.hitCondition.isEmpty ? "" : "hit count " + breakpoint.hitCondition,
         breakpoint.logMessage.isEmpty ? "" : "logs \u{201C}" + breakpoint.logMessage + "\u{201D}"]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func folder(of url: URL, in workspace: Workspace) -> String {
        let folder = url.deletingLastPathComponent()
        return folder.path == workspace.root.path ? "" : workspace.relativePath(of: folder)
    }

    private func toggle(_ selection: IndexSet) {
        for row in selection {
            switch rows[row] {
            case let .line(index):
                var breakpoint = placed[index].breakpoint
                breakpoint.isEnabled.toggle()
                debugger.setBreakpoint(breakpoint, in: placed[index].url)
            case let .exception(index):
                let item = exceptions[index]
                debugger.setExceptionBreakpoint(item.filter.id, adapter: item.adapter, enabled: !item.isEnabled)
            case .header:
                break
            }
        }
        reload()
    }

    private func goToSource(_ row: Int) {
        guard case let .line(index) = rows[row] else { return }
        let place = TextPosition(line: placed[index].breakpoint.line, column: 0)
        onNavigate?(FileLocation(url: placed[index].url, range: TextSpan(start: place, end: place)))
    }

    private func remove(_ selection: IndexSet) {
        let targets = selection.compactMap { row -> PlacedBreakpoint? in
            if case let .line(index) = rows[row] { placed[index] } else { nil }
        }
        for item in targets { debugger.removeBreakpoint(line: item.breakpoint.line, in: item.url) }
        reload()
    }

    private func menu(for selection: IndexSet) -> NSMenu? {
        let lines = selection.compactMap { row -> Int? in if case let .line(index) = rows[row] { index } else { nil } }
        guard let first = lines.first else { return nil }
        let item = placed[first]
        let row = selection.first { rows[$0] == .line(first) } ?? 0
        let enabling = !lines.allSatisfy { placed[$0].breakpoint.isEnabled }
        return Menu.make([
            MenuItem("Edit Breakpoint…", enabled: lines.count == 1) { [weak self] in self?.edit(item, anchoredTo: row) },
            MenuItem("Go to Source", enabled: lines.count == 1) { [weak self] in self?.goToSource(row) },
            .separator,
            MenuItem(enabling ? "Enable" : "Disable") { [weak self] in self?.toggle(selection) },
            MenuItem(lines.count == 1 ? "Remove" : "Remove \(lines.count) Breakpoints") { [weak self] in self?.remove(selection) },
            MenuItem("Remove All Breakpoints", destructive: true) { [weak self] in
                self?.debugger.removeAllBreakpoints()
                self?.reload()
            },
        ])
    }

    private func edit(_ item: PlacedBreakpoint, anchoredTo row: Int) {
        let rect = list.rect(ofRow: row)
        edit(line: item.breakpoint.line, in: item.url, anchoredTo: convert(rect, from: list), in: self)
    }

    func edit(line: Int, in url: URL, anchoredTo rect: NSRect, in view: NSView) {
        let breakpoint = debugger.breakpoint(line: line, in: url) ?? Breakpoint(line: line)
        let editor = BreakpointEditor(breakpoint, place: url.lastPathComponent + ":\(line + 1)")
        editor.onDone = { [weak self] edited in
            self?.editorPanel.dismiss()
            guard let self, let edited else { return }
            if edited.line < 0 {
                debugger.removeBreakpoint(line: line, in: url)
            } else {
                debugger.setBreakpoint(edited, in: url)
            }
            reload()
        }
        editorPanel.content = editor
        editorPanel.show(size: editor.fittingSize, anchoredTo: rect, in: view)
        editorPanel.window.makeFirstResponder(editor.condition.field)
    }
}
