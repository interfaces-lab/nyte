import AppKit
import NyteCore
import NyteUI

@MainActor
final class FindFeature: EditorFeature {
    static let rest = Duration.milliseconds(150)
    static let radius = Radius.indicator

    private unowned let editor: EditorViewController
    private var bar: EditorFindBar { editor.findBar }
    private(set) var query = FindQuery()
    private(set) var matches: [NSRange] = []
    private(set) var current: Int?
    private var scopes: [NSRange]?
    private var searching: Task<Void, Never>?
    private var searchedRevision = -1

    init(editor: EditorViewController) {
        self.editor = editor
        bar.field.onChange = { [weak self] _ in self?.patternChanged() }
        bar.field.onSubmit = { [weak self] _ in self?.step(forward: !NSEvent.modifierFlags.contains(.shift)) }
        bar.field.onCancel = { [weak self] in self?.close() }
        bar.field.onMove = { [weak self] step in self?.step(forward: step > 0) }
        bar.replace.onSubmit = { [weak self] _ in self?.replaceCurrent() }
        bar.replace.onCancel = { [weak self] in self?.close() }
        bar.onToggle = { [weak self] option in self?.toggle(option) }
        bar.previous.onPress = { [weak self] in self?.step(forward: false) }
        bar.next.onPress = { [weak self] in self?.step(forward: true) }
        bar.selectAll.onPress = { [weak self] in self?.selectAllMatches() }
        bar.replaceOne.onPress = { [weak self] in self?.replaceCurrent() }
        bar.replaceAll.onPress = { [weak self] in self?.replaceAll() }
        bar.close.onPress = { [weak self] in self?.close() }
        bar.onFinderAction = { [weak self] action in _ = self?.perform(action) }
    }

    var isOpen: Bool { !bar.isHidden }

    func perform(_ action: NSTextFinder.Action) -> Bool {
        guard editor.shown != nil else { return false }
        switch action {
        case .showFindInterface: open(replacing: false)
        case .showReplaceInterface: open(replacing: true)
        case .hideFindInterface: close()
        case .hideReplaceInterface: bar.setShowsReplace(false)
        case .nextMatch: isOpen || !query.isEmpty ? step(forward: true) : open(replacing: false)
        case .previousMatch: isOpen || !query.isEmpty ? step(forward: false) : open(replacing: false)
        case .setSearchString: useSelection()
        case .replace: replaceCurrent(advancing: false)
        case .replaceAndFind: replaceCurrent()
        case .replaceAll: replaceAll()
        case .replaceAllInSelection:
            scopes = editor.textView.selections.ranges.filter { $0.length > 0 }
            replaceAll()
        case .selectAll: selectAllMatches()
        case .selectAllInSelection:
            scopes = editor.textView.selections.ranges.filter { $0.length > 0 }
            search(selecting: false) { [weak self] in self?.selectAllMatches() }
        @unknown default: return false
        }
        return true
    }

    func canPerform(_ action: NSTextFinder.Action) -> Bool {
        guard editor.shown != nil else { return false }
        switch action {
        case .showFindInterface, .showReplaceInterface, .nextMatch, .previousMatch: return true
        case .hideFindInterface, .hideReplaceInterface: return isOpen
        case .setSearchString, .replaceAllInSelection, .selectAllInSelection: return editor.textView.selectedRange().length > 0
        case .replace, .replaceAndFind, .replaceAll: return editor.textView.isEditable && !matches.isEmpty
        case .selectAll: return !matches.isEmpty
        @unknown default: return false
        }
    }

    func open(replacing: Bool) {
        let selection = editor.textView.selectedRange()
        if selection.length > 0, selection.length <= Self.seedLimit {
            let text = editor.shownText.substring(with: selection)
            if !text.contains("\n") { bar.field.stringValue = text }
        }
        editor.setFindBarShown(true)
        bar.setShowsReplace(replacing || bar.showsReplace)
        bar.window?.makeFirstResponder(bar.field.field)
        bar.field.field.currentEditor()?.selectAll(nil)
        patternChanged()
    }

    static let seedLimit = 512

    func close() {
        searching?.cancel()
        editor.setFindBarShown(false)
        scopes = nil
        bar.setOn(.inSelection, false)
        setMatches([])
        editor.textView.window?.makeFirstResponder(editor.textView)
    }

    func toggle(_ option: EditorFindBar.Option) {
        switch option {
        case .matchCase: query.matchesCase.toggle()
        case .wholeWords: query.wholeWords.toggle()
        case .regex: query.isRegex.toggle()
        case .inSelection:
            scopes = scopes == nil ? editor.textView.selections.ranges.filter { $0.length > 0 } : nil
            if scopes?.isEmpty == true { scopes = nil }
        }
        bar.setOn(.matchCase, query.matchesCase)
        bar.setOn(.wholeWords, query.wholeWords)
        bar.setOn(.regex, query.isRegex)
        bar.setOn(.inSelection, scopes != nil)
        search(selecting: true)
    }

    private func patternChanged() {
        query.pattern = bar.field.stringValue
        search(selecting: true)
    }

    private func useSelection() {
        let selection = editor.textView.selectedRange()
        guard selection.length > 0 else { return }
        bar.field.stringValue = editor.shownText.substring(with: selection)
        query.pattern = bar.field.stringValue
        search(selecting: false)
    }

    func search(selecting: Bool, then finished: (() -> Void)? = nil) {
        searching?.cancel()
        bar.field.message = ""
        bar.field.isInvalid = false
        guard let document = editor.shown, !query.isEmpty else {
            setMatches([])
            return
        }
        let buffer = document.store.buffer
        let query = query
        let scopes = scopes
        let revision = document.revision
        let url = document.url
        bar.field.count = "…"
        searching = Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) { FindQuery.search(query, in: buffer, within: scopes) }.value
            guard let self, !Task.isCancelled, let result, editor.url == url, editor.shown?.revision == revision else { return }
            searchedRevision = revision
            switch result {
            case .failure(.invalidPattern(let message)):
                bar.field.message = message
                bar.field.isInvalid = true
                setMatches([])
            case .success(let found):
                setMatches(found.ranges)
                if selecting { jumpToNearest() }
            }
            finished?()
        }
    }

    private func setMatches(_ ranges: [NSRange]) {
        matches = ranges
        current = currentIndex()
        updateCount()
        updateStripe()
        editor.textView.needsDisplay = true
    }

    private func currentIndex() -> Int? {
        let selection = editor.textView.selectedRange()
        return matches.firstIndex { $0 == selection }
    }

    private func updateCount() {
        guard !query.isEmpty, bar.field.message.isEmpty else { return bar.field.count = "" }
        guard !matches.isEmpty else { return bar.field.count = "No matches" }
        let total = matches.count >= FindQuery.largest ? "\(matches.count)+" : "\(matches.count)"
        bar.field.count = current.map { "\($0 + 1) of \(total)" } ?? total
    }

    private func updateStripe() {
        guard let lines = editor.lineIndex, isOpen else { return editor.errorStripe.showMatches([]) }
        let view = editor.textView
        let height = max(view.frame.height, editor.scrollView.contentView.bounds.height)
        let pitch = view.metrics.lineHeight
        var seen = Set<Int>()
        let ratios = matches.compactMap { range -> CGFloat? in
            let row = view.rowMap.row(of: lines.line(at: range.location))
            guard seen.insert(row).inserted else { return nil }
            return min(1, max(0, (TextEngineView.verticalInset + (CGFloat(row) + 0.5) * pitch) / height))
        }
        editor.errorStripe.showMatches(ratios)
    }

    private func jumpToNearest() {
        guard let index = FindQuery.index(after: editor.textView.selectedRange().location, in: matches, forward: true) else { return updateCount() }
        select(index, focusText: false)
    }

    func step(forward: Bool) {
        if matches.isEmpty, !query.isEmpty, searchedRevision != editor.shown?.revision {
            return search(selecting: false) { [weak self] in self?.step(forward: forward) }
        }
        let selection = editor.textView.selectedRange()
        let from = forward ? NSMaxRange(selection) : selection.location
        guard let index = FindQuery.index(after: from, in: matches, forward: forward) else { return NSSound.beep() }
        select(index, focusText: !isOpen)
    }

    private func select(_ index: Int, focusText: Bool) {
        current = index
        let range = matches[index]
        editor.textView.setSelectedRange(range)
        editor.textView.scrollRangeToVisible(range)
        editor.centre(range)
        updateCount()
        if focusText { editor.textView.window?.makeFirstResponder(editor.textView) }
    }

    func selectAllMatches() {
        guard !matches.isEmpty else { return NSSound.beep() }
        editor.textView.select(SelectionSet(ranges: matches, primary: current ?? 0))
        editor.textView.window?.makeFirstResponder(editor.textView)
    }

    func replaceCurrent(advancing: Bool = true) {
        guard let document = editor.shown, editor.textView.isEditable else { return }
        let selection = editor.textView.selectedRange()
        guard let index = matches.firstIndex(of: selection) else { return advancing ? step(forward: true) : () }
        let replacement = replacementText(for: matches[index])
        let transaction = TextCommands.inserting([replacement], SelectionSet([Selection(selection)]), in: document.store, kind: .named("Replace"))
        editor.textView.breakUndoCoalescing()
        editor.textView.perform(transaction)
        editor.textView.breakUndoCoalescing()
        search(selecting: false) { [weak self] in if advancing { self?.step(forward: true) } }
    }

    private func replacementText(for range: NSRange) -> String {
        let template = bar.replace.stringValue
        guard query.isRegex, case .success(let expression) = query.expression() else { return template }
        let text = editor.shownText.substring(with: range)
        guard let result = expression.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) else { return template }
        return expression.replacementString(for: result, in: text, offset: 0, template: template)
    }

    func replaceAll() {
        guard let document = editor.shown, editor.textView.isEditable, !query.isEmpty else { return }
        searching?.cancel()
        let buffer = document.store.buffer
        let query = query
        let scopes = scopes
        let revision = document.revision
        let id = document.id
        let template = bar.replace.stringValue
        searching = Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                FindQuery.search(query, in: buffer, within: scopes, replacingWith: template)
            }.value
            guard let self, !Task.isCancelled, case .success(let found)? = result, let replacements = found.replacements,
                  let document = editor.shown, document.id == id, document.revision == revision, !found.ranges.isEmpty
            else { return }
            let edits = zip(found.ranges, replacements).map { TextReplacement(range: $0, $1) }
            var transaction = TextCommands.through(edits, document.store, document.model.session.selections, kind: .named("Replace All"))
            transaction.kind = .named("Replace All")
            editor.textView.breakUndoCoalescing()
            editor.apply(transaction, to: id)
            editor.textView.breakUndoCoalescing()
            bar.field.count = "\(found.ranges.count) replaced"
            setMatchesKeepingCount([])
        }
    }

    private func setMatchesKeepingCount(_ ranges: [NSRange]) {
        matches = ranges
        current = nil
        updateStripe()
        editor.textView.needsDisplay = true
    }

    func documentDidChange() {
        guard isOpen else { return setMatches([]) }
        scopes = nil
        bar.setOn(.inSelection, false)
        search(selecting: false)
    }

    func textDidChange(in range: NSRange, delta: Int) {
        guard !matches.isEmpty || isOpen else { return }
        let oldEnd = NSMaxRange(range) - delta
        matches = matches.compactMap { match in
            if NSMaxRange(match) <= range.location { return match }
            if match.location >= oldEnd { return NSRange(location: match.location + delta, length: match.length) }
            return nil
        }
        if let scopes {
            self.scopes = scopes.map { scope in
                scope.location >= oldEnd ? NSRange(location: scope.location + delta, length: scope.length)
                    : NSMaxRange(scope) >= range.location ? NSRange(location: scope.location, length: max(0, scope.length + delta)) : scope
            }
        }
        guard isOpen else { return }
        searching?.cancel()
        searching = Task { [weak self] in
            try? await Task.sleep(for: Self.rest)
            guard !Task.isCancelled else { return }
            self?.search(selecting: false)
        }
    }

    func selectionDidChange() {
        guard !matches.isEmpty else { return }
        let next = currentIndex()
        guard next != current else { return }
        current = next
        updateCount()
    }

    func drawUnderText(in rect: NSRect) {
        guard !matches.isEmpty else { return }
        let visible = editor.visibleRange
        guard var index = FindQuery.index(after: visible.location, in: matches, forward: true), matches[index].location >= visible.location
        else { return }
        while index < matches.count, matches[index].location <= NSMaxRange(visible) {
            for box in editor.rects(for: matches[index]) where box.intersects(rect) {
                let shape = NSRect(x: box.minX, y: box.minY + Space.hair, width: max(box.width, Metric.hairline), height: box.height - Space.hair * 2)
                Draw.fill(shape, radius: Self.radius, color: Palette.fillSecondary)
                if index == current { Draw.ring(shape, radius: Self.radius, color: Palette.strokeSecondary) }
            }
            index += 1
        }
    }
}
