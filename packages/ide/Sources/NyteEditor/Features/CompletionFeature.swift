import AppKit
import NyteCore
import NyteUI

@MainActor
final class CompletionFeature: EditorFeature {
    static let visibleRows = 10
    static let measuredRows = 60
    static let minWidth: CGFloat = 220
    static let maxWidth: CGFloat = 560
    static let listInset = Space.x1
    static let documentationRest = Duration.milliseconds(300)

    private unowned let editor: EditorViewController
    private let panel = FloatingPanel(radius: Radius.card, presentation: .popover)
    private let list = ListView()
    private let documentationPanel = FloatingPanel(radius: Radius.card, presentation: .hover)
    private let documentation = DocumentationView()

    private var items: [CompletionItem] = []
    private var resolved: [Bool] = []
    private var details: [String] = []
    private var ranking = CompletionRanking()
    private var isIncomplete = false
    private var isOpen = false
    private var anchor = 0
    private var answerCaret = 0
    private var query = ""
    private var queryUnits: [UInt16] = []
    private var width: CGFloat = 0
    private var request: Task<Void, Never>?
    private var resolving: Task<Void, Never>?
    private var documentedItem: Int?
    private var hidingDocumentation = false
    private var isApplying = false
    private var keyInFlight = false
    private var snippet: SnippetStops?

    init(editor: EditorViewController) {
        self.editor = editor
        list.rowHeight = Metric.rowCompact
        list.verticalInset = Self.listInset
        list.showsFocusAlways = true
        list.acceptsFocus = false
        list.activatesOnClick = true
        list.setAccessibilityLabel("Completions")
        list.rowCount = { [unowned self] in ranking.visible.count }
        list.content = { [unowned self] in row($0) }
        list.onActivate = { [unowned self] in accept(row: $0) }
        list.onSelect = { [unowned self] _ in selectionMoved() }
        panel.content = list
        panel.onDismiss = { [weak self] in self?.panelDismissed() }
        documentationPanel.content = documentation
        documentationPanel.onDismiss = { [weak self] in self?.documentationDismissed() }
    }

    func documentDidChange() {
        close()
        endSnippet()
    }

    func textDidChange(in range: NSRange, delta: Int) {
        guard !isApplying, var stops = snippet else { return }
        if stops.follow(edit: range, delta: delta) {
            snippet = stops
            editor.textView.needsDisplay = true
        } else {
            endSnippet()
        }
    }

    func selectionDidChange() {
        guard !isApplying else { return }
        if isOpen { refilter() }
        if let snippet, !snippet.contains(editor.caretRange) { endSnippet() }
    }

    func viewportDidChange() {
        guard isOpen else { return }
        if keyInFlight { present() } else { close() }
    }

    func didType(_ text: String) {
        guard !isApplying, !editor.isEditingInPlace, let url = editor.url, let intelligence = editor.intelligence, editor.isAssisted
        else { return }
        if intelligence.triggers(for: url).completion.contains(text) {
            close()
            return start(.character(text))
        }
        guard Identifier.isPart(text) else { return close() }
        if isOpen {
            if isIncomplete { start(.incomplete) }
            return
        }
        let shown = editor.shownText
        let start = Identifier.start(before: editor.caretRange.location, in: shown)
        guard start < shown.length, !CompletionRow.isDigit(shown.character(at: start)) else { return }
        self.start(.invoked)
    }

    func handleKey(_ event: NSEvent) -> Bool {
        if isOpen { markKeyInFlight() }
        let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
        if isOpen, panel.isShown, let handled = handleListKey(event, modifiers: modifiers) { return handled }
        guard snippet != nil, modifiers.subtracting(.shift).isEmpty else { return false }
        switch event.specialKey {
        case .tab? where modifiers.isEmpty:
            walkSnippet(by: 1)
            return true
        case .backTab?, .tab?:
            walkSnippet(by: -1)
            return true
        default:
            guard event.charactersIgnoringModifiers == "\u{1B}" else { return false }
            endSnippet()
            return true
        }
    }

    private func handleListKey(_ event: NSEvent, modifiers: NSEvent.ModifierFlags) -> Bool? {
        guard modifiers.isEmpty else { return nil }
        switch event.specialKey {
        case .downArrow?: move(by: 1, wraps: true)
        case .upArrow?: move(by: -1, wraps: true)
        case .pageDown?: move(by: Self.visibleRows - 1, wraps: false)
        case .pageUp?: move(by: 1 - Self.visibleRows, wraps: false)
        case .carriageReturn?, .enter?, .tab?:
            guard let row = list.selectedRow else { return nil }
            accept(row: row)
        default:
            if event.charactersIgnoringModifiers == "\u{1B}" {
                close()
                return true
            }
            guard let typed = event.characters, let row = list.selectedRow, ranking.visible.indices.contains(row),
                  CompletionCommit.decide(items[Int(ranking.visible[row])], typed: typed) == .acceptAsTextThenType
            else { return nil }
            accept(row: row, committing: true)
            return false
        }
        return true
    }

    func handleClick(at offset: Int, event: NSEvent) -> Bool {
        close()
        return false
    }

    func focusDidLeave() { close() }

    func drawUnderText(in rect: NSRect) {
        guard let snippet else { return }
        for (index, stop) in snippet.ranges.enumerated() where index != snippet.ranges.count - 1 {
            for box in editor.rects(for: stop) where box.intersects(rect) {
                let ring = box.width > 0 ? box : NSRect(x: box.minX, y: box.minY, width: Metric.hairline, height: box.height)
                Draw.ring(ring, radius: Radius.indicator,
                          color: index == snippet.current ? Palette.focus : Palette.strokeTertiary)
            }
        }
    }

    func canPerform(_ command: EditorCommand) -> Bool {
        command == .showCompletions && editor.isAssisted
    }

    func perform(_ command: EditorCommand) -> Bool {
        guard command == .showCompletions, editor.isAssisted else { return false }
        close()
        start(.invoked)
        return true
    }

    private func start(_ trigger: CompletionTrigger) {
        let caret = editor.caretRange
        guard let url = editor.url, let intelligence = editor.intelligence, caret.length == 0,
              let position = editor.position(at: caret.location)
        else { return }
        if editor.textView.selections.hasSeveral {
            let carets = editor.textView.selections
            let start = Identifier.start(before: caret.location, in: editor.shownText)
            let prefix = NSRange(location: start, length: caret.location - start)
            guard CaretCompletion.replacements(of: prefix, caret: caret.location, carets: carets.ranges, in: editor.shownText) != nil
            else { return close() }
        }
        let revision = editor.revision
        request?.cancel()
        request = Task { [weak self] in
            let answer = await intelligence.completions(at: position, in: url, trigger: trigger)
            guard let self, !Task.isCancelled, editor.revision == revision, editor.url == url,
                  editor.caretRange == caret
            else { return }
            request = nil
            receive(answer, caret: caret.location, keepsAnchor: trigger == .incomplete && isOpen)
        }
    }

    private func receive(_ answer: CompletionList, caret: Int, keepsAnchor: Bool) {
        let selected = list.selectedRow.flatMap { ranking.visible.indices.contains($0) ? items[Int(ranking.visible[$0])].label : nil }
        items = answer.items
        resolved = [Bool](repeating: false, count: items.count)
        details = [String](repeating: "", count: items.count)
        ranking = CompletionRanking(filters: items.map(\.filter), sorts: items.map(\.sort))
        isIncomplete = answer.isIncomplete
        if !keepsAnchor {
            anchor = Identifier.start(before: caret, in: editor.shownText)
            width = 0
        }
        answerCaret = caret
        documentedItem = nil
        isOpen = !items.isEmpty
        guard isOpen else { return close() }
        refilter(force: true, keeping: keepsAnchor ? selected : nil)
    }

    private func refilter(force: Bool = false, keeping label: String? = nil) {
        let caret = editor.caretRange
        let shown = editor.shownText
        guard caret.length == 0, caret.location >= anchor, caret.location <= shown.length else { return close() }
        let typed = shown.substring(with: NSRange(location: anchor, length: caret.location - anchor))
        guard typed.isEmpty || Identifier.isPart(typed) else { return close() }
        guard force || typed != query else { return }
        query = typed
        queryUnits.removeAll(keepingCapacity: true)
        queryUnits.append(contentsOf: typed.utf16)
        ranking.rank(queryUnits)
        guard !ranking.visible.isEmpty else { return close() }
        list.reload()
        list.selectedRow = label.flatMap { label in ranking.visible.firstIndex { items[Int($0)].label == label } }
            ?? preselectedRow()
        present()
        selectionMoved()
    }

    private func preselectedRow() -> Int {
        guard let first = ranking.visible.first, let best = ranking.match(ofItem: Int(first)) else { return 0 }
        for (row, item) in ranking.visible.enumerated() {
            guard ranking.match(ofItem: Int(item)) == best else { break }
            if items[Int(item)].isPreselected { return row }
        }
        return 0
    }

    private func row(_ row: Int) -> RowContent {
        guard ranking.visible.indices.contains(row) else { return RowContent() }
        let item = items[Int(ranking.visible[row])]
        let columns = CompletionRow.columns(item)
        var content = RowContent(title: item.label, detail: columns.tail, meta: CompletionRow.fitting(columns.type),
                                 leading: .mark(CompletionRow.mark(item.kind)))
        content.monospace = true
        content.detailJoinsTitle = columns.tail.first.map { "(<[".contains($0) } ?? false
        content.emphasis = CompletionRanking.matchedRanges(of: query, in: item.label)
        if item.isDeprecated { content.titleInk = .tertiary }
        return content
    }

    private func present() {
        guard let rect = editor.caretRect(at: anchor) else { return close() }
        let rows = min(ranking.visible.count, Self.visibleRows)
        let measured = ranking.visible.prefix(Self.measuredRows).reduce(CGFloat(0)) { widest, item in
            max(widest, CompletionRow.width(of: items[Int(item)]))
        }
        width = min(max(width, measured, Self.minWidth), Self.maxWidth).rounded(.up)
        let size = NSSize(width: width, height: CGFloat(rows) * Metric.rowCompact + Self.listInset * 2)
        let anchorRect = NSRect(x: rect.minX - CompletionRow.leading, y: rect.minY, width: 0, height: rect.height)
        panel.show(size: size, anchoredTo: anchorRect, in: editor.textView)
        if documentationPanel.isShown { showDocumentation() }
    }

    private func move(by step: Int, wraps: Bool) {
        let count = ranking.visible.count
        guard count > 0 else { return }
        let current = list.selectedRow ?? 0
        let target = current + step
        list.selectedRow = wraps ? (target % count + count) % count : min(max(target, 0), count - 1)
        selectionMoved()
    }

    private func markKeyInFlight() {
        keyInFlight = true
        DispatchQueue.main.async { [weak self] in self?.keyInFlight = false }
    }

    private func selectionMoved() {
        resolving?.cancel()
        guard isOpen, let row = list.selectedRow, ranking.visible.indices.contains(row) else { return hideDocumentation() }
        let index = Int(ranking.visible[row])
        if resolved[index], documentationPanel.isShown {
            documentedItem = index
            return showDocumentation()
        }
        guard let intelligence = editor.intelligence else { return }
        let item = items[index]
        resolving = Task { [weak self] in
            try? await Task.sleep(for: Self.documentationRest)
            guard !Task.isCancelled else { return }
            let answer = await intelligence.resolve(item)
            guard let self, !Task.isCancelled, isOpen, index < items.count, items[index].token == item.token,
                  items[index].label == item.label
            else { return }
            items[index] = Self.merge(items[index], answer)
            details[index] = answer.type
            resolved[index] = true
            if let row = list.selectedRow, ranking.visible.indices.contains(row), Int(ranking.visible[row]) == index {
                documentedItem = index
                showDocumentation()
            }
        }
    }

    private static func merge(_ item: CompletionItem, _ answer: CompletionItem) -> CompletionItem {
        var item = item
        if !answer.documentation.isEmpty { item.documentation = answer.documentation }
        if item.additionalEdits.isEmpty { item.additionalEdits = answer.additionalEdits }
        return item
    }

    private func showDocumentation() {
        guard let index = documentedItem, index < items.count, panel.isShown else { return hideDocumentation() }
        let item = items[index]
        guard !item.documentation.isEmpty else { return hideDocumentation() }
        let columns = CompletionRow.columns(item)
        let joined = columns.tail.first.map { "(<[".contains($0) } ?? false
        let detail = details.indices.contains(index) ? details[index] : ""
        let named = detail.contains(item.label + "(") || detail.contains(item.label + ":")
        let head = named ? detail : item.label + (columns.tail.isEmpty ? "" : (joined ? "" : " ") + columns.tail)
            + (columns.type.isEmpty ? "" : " " + columns.type)
        let signature = head == item.label ? "" : "```\n" + head + "\n```\n\n"
        documentation.language = editor.fenceLanguage
        documentation.show(notes: [], markdown: signature + item.documentation)
        documentationPanel.show(size: documentation.fittingSize(), beside: panel)
    }

    private func hideDocumentation() {
        documentedItem = nil
        guard documentationPanel.isShown else { return }
        hidingDocumentation = true
        documentationPanel.dismiss()
    }

    private func documentationDismissed() {
        defer { hidingDocumentation = false }
        if !hidingDocumentation, isOpen { close() }
    }

    private func accept(row: Int, committing: Bool = false) {
        guard ranking.visible.indices.contains(row) else { return }
        let item = items[Int(ranking.visible[row])]
        let caret = editor.caretRange.location
        let shown = editor.shownText
        var start = Identifier.start(before: caret, in: shown)
        var end = caret
        if let replace = item.replace, let range = editor.range(of: replace) {
            start = range.location
            let old = NSMaxRange(range)
            end = max(caret, old >= answerCaret ? old + caret - answerCaret : old)
        }
        guard start <= caret, end <= shown.length, let main = editor.span(of: NSRange(location: start, length: end - start)) else {
            return close()
        }
        let shift = item.additionalEdits.reduce(0) { shift, edit in
            guard let range = editor.range(of: edit.range), NSMaxRange(range) <= start else { return shift }
            return shift + (edit.text as NSString).length - range.length
        }
        let insert = CompletionInsert.decide(item, committing: committing)
        if editor.textView.selections.hasSeveral {
            let carets = editor.textView.selections
            return acceptAtCarets(item, insert: insert, replacing: NSRange(location: start, length: end - start), caret: caret, carets: carets)
        }
        let indentation = Indentation.leadingWhitespace(before: start, in: shown)
        let (text, stops) = switch insert {
        case .snippet: SnippetIndent.indented(item.text, stops: item.stops, by: indentation)
        case .plain(let text): SnippetIndent.indented(text, stops: [], by: indentation)
        case .call(let name, _): (name + "()", [])
        }
        close()
        isApplying = true
        let applied = editor.edit([TextEdit(range: main, text: text)] + item.additionalEdits)
        isApplying = false
        guard applied else { return }
        let base = start + shift
        let length = (text as NSString).length
        endSnippet()
        switch insert {
        case .snippet:
            guard let stops = SnippetStops(base: base, length: length, stops: stops) else {
                return select(NSRange(location: base + length, length: 0))
            }
            snippet = stops
            select(stops.selection)
            editor.textView.needsDisplay = true
        case .plain:
            select(NSRange(location: base + length, length: 0))
        case .call(_, let takesArguments):
            select(NSRange(location: base + length - (takesArguments ? 1 : 0), length: 0))
            if takesArguments { editor.perform(.showParameterInfo) }
        }
    }

    private func acceptAtCarets(_ item: CompletionItem, insert: CompletionInsert, replacing main: NSRange, caret: Int, carets: SelectionSet) {
        let shown = editor.shownText
        guard let ranges = CaretCompletion.replacements(of: main, caret: caret, carets: carets.ranges, in: shown) else { return close() }
        let extra = item.additionalEdits.compactMap { edit in
            editor.range(of: edit.range).map { (range: $0, delta: (edit.text as NSString).length - $0.length) }
        }
        let plan = CaretCompletion.plan(item, insert: insert, at: ranges, shiftedBy: extra, in: shown)
        let edits = zip(ranges, plan.texts).compactMap { range, text in editor.span(of: range).map { TextEdit(range: $0, text: text) } }
        let overlaps = extra.contains { edit in ranges.contains { NSIntersectionRange($0, edit.range).length > 0 } }
        guard edits.count == ranges.count, extra.count == item.additionalEdits.count, !overlaps else { return close() }
        close()
        isApplying = true
        let applied = editor.edit(edits + item.additionalEdits)
        isApplying = false
        guard applied else { return }
        endSnippet()
        isApplying = true
        editor.textView.select(SelectionSet(ranges: plan.after, primary: carets.primary))
        isApplying = false
        if case .call(_, true) = insert { editor.perform(.showParameterInfo) }
    }

    private func walkSnippet(by step: Int) {
        guard var stops = snippet else { return }
        guard let range = stops.move(by: step) else { return }
        snippet = stops
        select(range)
        if stops.isAtLast { endSnippet() }
        editor.textView.needsDisplay = true
    }

    private func select(_ range: NSRange) {
        isApplying = true
        editor.textView.setSelectedRange(range)
        editor.textView.scrollRangeToVisible(range)
        isApplying = false
    }

    private func endSnippet() {
        guard snippet != nil else { return }
        snippet = nil
        editor.textView.needsDisplay = true
    }

    private func close() {
        request?.cancel()
        request = nil
        resolving?.cancel()
        isOpen = false
        items = []
        resolved = []
        details = []
        ranking = CompletionRanking()
        query = ""
        width = 0
        documentedItem = nil
        if panel.isShown { panel.dismiss() }
        hideDocumentation()
    }

    private func panelDismissed() {
        if isOpen { close() }
    }
}
