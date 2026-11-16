import AppKit
import NyteCore
import NyteUI

@MainActor
final class VariablesPane: NSView, NSUserInterfaceValidations {
    static let evaluatePlaceholder = "Evaluate expression"
    static let yieldOrder: [RowContent.Part] = [.detailShort, .metaShort, .value, .secondaryMeta, .meta, .detail, .title]

    private let debugger: Debugger
    var onAskAboutStop: (() -> Void)?
    private(set) var tree = VariableTree()
    private var debugFrame: DebugFrame?
    private var generation = 0
    private(set) var loading: Task<Void, Never>?
    private(set) var expanded: Set<String> = []

    let field = Input(placeholder: VariablesPane.evaluatePlaceholder, variant: .strip, size: .sm)
    let list = ListView()
    private let addWatch = Button(symbol: "eyeglasses", label: "Add to watches", size: .xs)

    init(debugger: Debugger) {
        self.debugger = debugger
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func build() {
        field.textStyle = .code
        field.field.setAccessibilityLabel("Evaluate expression")
        field.field.toolTip = "Evaluate (↩), or add to watches (⇧⌘↩)"
        field.onSubmit = { [unowned self] _ in evaluate() }
        addWatch.toolTip = "Add to watches (⇧⌘↩)"
        addWatch.onPress = { [unowned self] in addFieldAsWatch() }
        field.accessory = addWatch
        list.rowHeight = Metric.rowCompact
        list.heightOfRow = { [unowned self] row in rowHeight(row) }
        list.verticalInset = Space.x1
        list.isOutline = true
        list.pinsGroupHeaders = true
        list.rowCount = { [unowned self] in tree.rows.count }
        list.content = { [unowned self] in content(tree.rows[$0]) }
        list.onToggle = { [unowned self] in toggle($0) }
        list.onActivate = { [unowned self] row in activate(row) }
        list.onSelect = { [unowned self] rows in clicked(rows) }
        list.menuForRow = { [unowned self] in menu(for: $0) }
        list.onDelete = { [unowned self] rows in removeWatches(at: rows) }
        list.setAccessibilityLabel("Variables")
        let window = ToolWindowView(header: DebugLayout.stripRole)
        window.headerRule = .always
        Pin.fill(window, in: self)
        Pin.fill(list, in: window.content)
        DebugLayout.place(field, across: window.header)
        setEnabled(false)
    }

    func setEnabled(_ enabled: Bool) {
        field.isEnabled = enabled
        addWatch.isEnabled = enabled
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection([.command, .shift, .option, .control])
        let isReturn = event.specialKey == .carriageReturn || event.specialKey == .enter
        guard isReturn, modifiers == [.command, .shift], field.isEnabled,
              let editor = window?.firstResponder as? NSTextView, editor.delegate === field.field
        else { return super.performKeyEquivalent(with: event) }
        addFieldAsWatch()
        return true
    }

    func show(frame: DebugFrame?) {
        debugFrame = frame
        generation += 1
        let generation = generation
        loading = Task { [weak self] in await self?.load(frame, generation: generation) }
    }

    func clear() {
        debugFrame = nil
        generation += 1
        expanded = []
        tree.clearFrame()
        list.reload()
    }

    func settle() async {
        await loading?.value
    }

    private func load(_ frame: DebugFrame?, generation: Int) async {
        guard let frame else { return clear() }
        var next = tree
        next.frameKey = frame.function
        next.scopes = await debugger.scopes(of: frame)
        next.children = [:]
        next.result = nil
        for scope in next.scopes where scope.reference > 0 && next.isOpen(next.scopePath(scope)) {
            await fill(next.scopePath(scope), reference: scope.reference, indexed: nil, tree: &next)
        }
        var values: [String: Result<DebugVariable, DebugFailure>] = [:]
        for expression in next.watches {
            let value = await debugger.evaluate(expression, in: frame, context: .watch)
            values[expression] = value
            let path = VariableTree.watchPath(expression)
            if case let .success(variable) = value, variable.reference > 0, next.opened.contains(path) {
                await fill(path, reference: variable.reference, indexed: variable.indexedCount, tree: &next)
            }
        }
        next.watchValues = values
        guard generation == self.generation else { return }
        commit(next)
    }

    private func fill(_ path: String, reference: Int, indexed: Int?, tree: inout VariableTree) async {
        let wanted = tree.shown[path] ?? VariableTree.page
        let kids: [DebugVariable]
        if let indexed, indexed > wanted {
            let page = await debugger.children(of: reference, start: 0, count: wanted)
            kids = await debugger.namedChildren(of: reference) + page
            tree.totals[path] = indexed
            tree.indexedLoaded[path] = page.count
        } else {
            kids = await debugger.children(of: reference)
            tree.totals[path] = nil
            tree.indexedLoaded[path] = nil
        }
        tree.children[path] = kids
        for kid in kids.prefix(wanted) where kid.reference > 0 {
            let child = path + "/" + kid.name
            if tree.opened.contains(child) { await fill(child, reference: kid.reference, indexed: kid.indexedCount, tree: &tree) }
        }
    }

    private func commit(_ next: VariableTree) {
        let selected = selectedPlace()
        tree = next
        refresh()
        restoreSelection(selected)
    }

    private func refresh() {
        let selected = selectedPlace()
        tree.rebuild()
        list.reload()
        restoreSelection(selected)
    }

    private func selectedPlace() -> (path: String, kind: VariableRow.Kind)? {
        list.selectedRow.flatMap { tree.rows.indices.contains($0) ? (tree.rows[$0].path, tree.rows[$0].kind) : nil }
    }

    private func restoreSelection(_ place: (path: String, kind: VariableRow.Kind)?) {
        guard let place else { return }
        let more = place.kind == .more
        list.selectedRow = tree.rows.firstIndex { $0.path == place.path && ($0.kind == .more) == more }
            ?? (more ? tree.rows.lastIndex { $0.path.hasPrefix(place.path + "/") } : nil)
    }

    func reveal(_ names: [String]) async {
        await settle()
        guard let scope = tree.scopes.first else { return }
        var path = tree.scopePath(scope)
        for name in names {
            let parent = path
            guard let row = tree.rows.firstIndex(where: { row in
                row.kind != .more && row.path.hasPrefix(parent + "/") && row.path.dropFirst(parent.count + 1) == row.name
                    && DebugText.name(row.name) == name
            }) else { return }
            path = tree.rows[row].path
            if !tree.rows[row].isOpen { await open(row) }
        }
        list.selectedRow = tree.rows.firstIndex { $0.path == path }
    }

    private func toggle(_ row: Int) {
        guard tree.rows.indices.contains(row) else { return }
        let item = tree.rows[row]
        if item.isOpen {
            tree.setOpen(item.path, false)
            refresh()
            return
        }
        Task { await open(row) }
    }

    private func open(_ row: Int) async {
        let item = tree.rows[row]
        guard item.kind == .group || item.reference > 0 else { return }
        let generation = generation
        tree.setOpen(item.path, true)
        if tree.children[item.path] == nil, item.reference > 0 {
            var next = tree
            await fill(item.path, reference: item.reference, indexed: item.indexed, tree: &next)
            guard generation == self.generation else { return }
            tree.totals[item.path] = next.totals[item.path]
            tree.indexedLoaded[item.path] = next.indexedLoaded[item.path]
            for (path, kids) in next.children where tree.children[path] == nil || path == item.path { tree.children[path] = kids }
        }
        refresh()
    }

    private func activate(_ row: Int) {
        let item = tree.rows[row]
        switch item.kind {
        case .more: showMore(item.path)
        case .group: toggle(row)
        default: if item.reference > 0 { toggle(row) } else { toggleFullValue(row) }
        }
    }

    func toggleFullValue(_ row: Int) {
        guard tree.rows.indices.contains(row), !tree.rows[row].value.isEmpty else { return }
        let path = tree.rows[row].path
        if expanded.remove(path) == nil { expanded.insert(path) }
        refresh()
    }

    private func rowHeight(_ row: Int) -> CGFloat {
        guard tree.rows.indices.contains(row), expanded.contains(tree.rows[row].path) else { return Metric.rowCompact }
        return RowCell.Geometry.height(content(tree.rows[row]), width: list.bounds.width)
    }

    private func clicked(_ rows: IndexSet) {
        guard let row = rows.first, rows.count == 1, tree.rows[row].kind == .more,
              let type = NSApp.currentEvent?.type, type == .leftMouseDown || type == .leftMouseUp else { return }
        showMore(tree.rows[row].path)
    }

    private func showMore(_ path: String) {
        Task { await loadMore(path) }
    }

    func loadMore(_ path: String) async {
        let generation = generation
        let limit = tree.shown[path] ?? VariableTree.page
        let unloaded = tree.unloaded(path)
        if unloaded > 0, limit + VariableTree.page > tree.children[path]?.count ?? 0, let reference = tree.reference(at: path) {
            let loaded = tree.indexedLoaded[path] ?? 0
            let next = await debugger.children(of: reference, start: loaded, count: min(VariableTree.page, unloaded))
            guard generation == self.generation else { return }
            tree.children[path, default: []] += next
            tree.indexedLoaded[path] = loaded + next.count
        }
        tree.shown[path] = limit + VariableTree.page
        refresh()
    }

    private func evaluate() {
        let expression = field.stringValue.trimmingCharacters(in: .whitespaces)
        guard !expression.isEmpty else { return }
        Task { await evaluate(expression) }
    }

    func evaluate(_ expression: String) async {
        let generation = generation
        let value = await debugger.evaluate(expression, in: debugFrame, context: .repl)
        guard generation == self.generation else { return }
        tree.result = (expression, value)
        tree.opened.remove(VariableTree.resultPath)
        tree.children[VariableTree.resultPath] = nil
        refresh()
        list.scrollRowToVisible(0)
    }

    private func addFieldAsWatch() {
        let expression = field.stringValue.trimmingCharacters(in: .whitespaces)
        guard !expression.isEmpty else { return }
        field.stringValue = ""
        Task { await addWatch(expression) }
    }

    func addWatch(_ expression: String) async {
        await settle()
        guard !tree.watches.contains(expression) else { return }
        tree.watches.append(expression)
        tree.setOpen(VariableTree.watchesPath, true)
        refresh()
        guard let frame = debugFrame else { return }
        let generation = generation
        let value = await debugger.evaluate(expression, in: frame, context: .watch)
        guard generation == self.generation else { return }
        tree.watchValues[expression] = value
        refresh()
    }

    private func removeWatches(at rows: IndexSet) {
        let expressions = Set(rows.compactMap { row in
            tree.rows[row].depth == 0 && tree.rows[row].path.hasPrefix("watch/") ? String(tree.rows[row].path.dropFirst("watch/".count)) : nil
        })
        guard !expressions.isEmpty else { return }
        tree.watches.removeAll { expressions.contains($0) }
        for expression in expressions { tree.watchValues[expression] = nil }
        refresh()
    }

    func stopLocals() -> [AgentContext.Stop.Local] {
        tree.scopes.flatMap { scope -> [AgentContext.Stop.Local] in
            (tree.children[tree.scopePath(scope)] ?? []).map { variable in
                let value = variable.reference > 0
                    ? DebugText.summary(variable.value, type: variable.type, indexedCount: variable.indexedCount)
                    : DebugText.value(variable.value, type: variable.type)
                return AgentContext.Stop.Local(name: DebugText.name(variable.name), type: DebugText.displayType(variable.type), value: value)
            }
        }
    }

    private func menu(for row: Int) -> NSMenu? {
        let item = tree.rows[row]
        guard item.kind != .more else { return nil }
        guard item.kind != .group else {
            return onAskAboutStop.map { ask in Menu.make([MenuItem(DebugText.askAboutStop) { ask() }]) }
        }
        let expression = self.expression(for: item)
        var items = [
            MenuItem("Copy Value", key: "c", enabled: !item.value.isEmpty) { Self.copy(item.value) },
            MenuItem("Copy Name") { Self.copy(DebugText.name(item.name)) },
            MenuItem("Copy as Expression") { Self.copy(expression) },
        ]
        if item.reference == 0, !item.value.isEmpty {
            let shown = expanded.contains(item.path)
            items += [.separator, MenuItem(shown ? "Hide Full Value" : "Show Full Value") { [weak self] in self?.toggleFullValue(row) }]
        }
        if let onAskAboutStop { items += [.separator, MenuItem(DebugText.askAboutStop) { onAskAboutStop() }] }
        if item.kind == .watch || (item.kind == .failure && item.path.hasPrefix("watch/")) {
            items += [.separator, MenuItem("Remove Watch") { [weak self] in self?.removeWatches(at: IndexSet(integer: row)) }]
        } else {
            items += [.separator, MenuItem("Add to Watches") { [weak self] in Task { await self?.addWatch(expression) } }]
        }
        return Menu.make(items)
    }

    func expression(for item: VariableRow) -> String {
        switch item.kind {
        case .watch, .result: item.name
        case .failure: item.path.hasPrefix("watch/") ? String(item.path.dropFirst("watch/".count)) : item.name
        default: expressionPath(item)
        }
    }

    @objc func copy(_ sender: Any?) {
        guard let row = list.selectedRow, tree.rows.indices.contains(row), !tree.rows[row].value.isEmpty else { return }
        Self.copy(tree.rows[row].value)
    }

    func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        guard item.action == #selector(copy(_:)) else { return false }
        (item as? NSMenuItem)?.title = "Copy Value"
        return list.selectedRow.map { tree.rows.indices.contains($0) && !tree.rows[$0].value.isEmpty } ?? false
    }

    private func expressionPath(_ item: VariableRow) -> String {
        var names: [String] = [DebugText.name(item.name)]
        var depth = item.depth
        guard let index = tree.rows.firstIndex(where: { $0.path == item.path }) else { return item.name }
        var cursor = index - 1
        while cursor >= 0, depth > 0 {
            let row = tree.rows[cursor]
            if row.kind != .group, row.depth == depth - 1 {
                names.insert(DebugText.name(row.name), at: 0)
                depth = row.depth
            }
            cursor -= 1
        }
        return names.dropFirst().reduce(names[0]) { path, name in
            name.first?.isNumber == true || name.hasPrefix("[") ? path + (name.hasPrefix("[") ? name : "[\(name)]") : path + "." + name
        }
    }

    private static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func content(_ row: VariableRow) -> RowContent {
        switch row.kind {
        case .group:
            var content = RowContent.header(row.name, disclosure: row.isOpen ? .open : .closed)
            if row.count > 0 { content.detail = row.count.formatted() }
            content.detailInk = .tertiary
            return content
        case .more:
            var content = RowContent(title: "Load next \(min(VariableTree.page, row.count))", depth: row.depth)
            content.titleInk = .tone(.primary)
            content.detail = "\(row.count.formatted()) more"
            content.detailInk = .secondary
            content.accessibilityLabel = "Load next \(min(VariableTree.page, row.count)), \(row.count) more"
            return content
        case .failure:
            var content = RowContent(title: DebugText.budgeted(row.name, DebugText.nameBudget), detail: "=", depth: row.depth)
            content.detailInk = .tertiary
            content.value = DebugText.failureText(row.value)
            content.valueInk = .tone(.danger)
            content.meta = "error"
            content.metaInk = .tone(.danger)
            return expanded.contains(row.path) ? showingFullValue(content, row.value) : content
        case .variable, .watch, .result:
            let name = DebugText.budgeted(DebugText.name(row.name), DebugText.nameBudget)
            let value = row.reference > 0
                ? DebugText.summary(row.value, type: row.type, indexedCount: row.indexed)
                : DebugText.value(row.value, type: row.type)
            var content = RowContent(title: name, detail: "=", depth: row.depth,
                                     disclosure: row.reference > 0 ? (row.isOpen ? .open : .closed) : .none)
            content.detailInk = .tertiary
            content.value = value
            content.valueTruncation = .byTruncatingTail
            content.yieldOrder = Self.yieldOrder
            content.meta = DebugText.displayType(row.type)
            if row.kind == .result { content.meta = content.meta.isEmpty ? "result" : content.meta + " · result" }
            content.metaInk = .secondary
            content.metaTruncation = .middle
            content.metaMaxWidth = (list.bounds.width * DebugLayout.typeShare).rounded()
            content.isGroupHeader = row.pins
            content.endsGroup = row.endsGroup
            if row.isChanged {
                content.valueInk = .tone(.primary)
                content.changeDot = Palette.color(.contentAccent, tone: .primary)
            } else {
                content.valueSyntax = DebugText.valueSyntax(value, language: debugger.codeLanguage)
            }
            let words = [DebugText.name(row.name), value, row.type, row.isChanged ? "changed" : ""]
            content.accessibilityLabel = words.filter { !$0.isEmpty }.joined(separator: ", ")
            guard expanded.contains(row.path) else { return content }
            let full = DebugText.value(row.value, type: row.type)
            var shown = showingFullValue(content, full)
            if !row.isChanged { shown.descriptionSyntax = CodeColors.ranges(in: full, language: debugger.codeLanguage) }
            return shown
        }
    }

    private func showingFullValue(_ content: RowContent, _ value: String) -> RowContent {
        var shown = content
        shown.description = value
        shown.descriptionInk = content.valueInk == .tone(.danger) ? .tone(.danger) : .primary
        shown.descriptionWraps = true
        shown.descriptionMonospace = true
        shown.value = ""
        shown.valueSyntax = []
        return shown
    }
}
