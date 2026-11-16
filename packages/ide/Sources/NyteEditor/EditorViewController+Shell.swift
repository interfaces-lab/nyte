import AppKit
import NyteCore
import NyteUI

public struct EditorViewState: Codable, Equatable, Sendable {
    public struct Selection: Codable, Equatable, Sendable {
        public var anchorLine: Int
        public var anchorColumn: Int
        public var headLine: Int
        public var headColumn: Int

        public init(anchorLine: Int, anchorColumn: Int, headLine: Int, headColumn: Int) {
            self.anchorLine = anchorLine
            self.anchorColumn = anchorColumn
            self.headLine = headLine
            self.headColumn = headColumn
        }
    }

    public var firstVisibleLine: Int
    public var offsetIntoLine: Double
    public var horizontalOffset: Double
    public var selections: [Selection]
    public var primarySelection: Int
    public var folds: [ClosedRange<Int>]

    public init(firstVisibleLine: Int, offsetIntoLine: Double, horizontalOffset: Double, selections: [Selection],
                primarySelection: Int, folds: [ClosedRange<Int>]) {
        self.firstVisibleLine = firstVisibleLine
        self.offsetIntoLine = offsetIntoLine
        self.horizontalOffset = horizontalOffset
        self.selections = selections
        self.primarySelection = primarySelection
        self.folds = folds
    }
}

extension EditorViewController {
    public func text(of url: URL) -> String? {
        guard let document = document(for: url), document.body.isText else { return nil }
        return document.store.buffer.string
    }

    public func saveAll() async -> [URL] {
        let dirty = documents.filter { $0.isDirty && $0.body.isText }.map { (id: $0.id, url: $0.url) }
        var failed: [URL] = []
        for document in dirty where !(await save(document.id, alerting: false)) { failed.append(document.url) }
        return failed
    }

    public func revert(_ url: URL) async -> Bool {
        guard let document = document(for: url), document.body.isText else { return false }
        let language = document.language
        let file = await Task.detached(priority: .userInitiated) { FileIO.load(url, language: language) }.value
        guard case .text(let decoded) = file.content, let index = row(document.id) else { return false }
        replaceText(of: index, with: decoded, recording: true)
        markSaved(index, as: decoded, modified: file.modified)
        return true
    }

    public func filesDidChange(_ urls: [URL]) {
        let changed = Set(urls.map(\.standardizedFileURL))
        let open = documents.filter { changed.contains($0.url) && $0.body.isText }
        for document in open where document.isDirty { onDiskChange?(document.url) }
        reloadFromDisk(open.filter { !$0.isDirty }.map { (id: $0.id, url: $0.url, modified: $0.modified, language: $0.language) },
                       onlyIfModified: false)
    }

    public func viewState(of url: URL) -> EditorViewState? {
        guard let index = documents.firstIndex(where: { $0.url == url.standardizedFileURL }) else { return nil }
        let document = documents[index]
        guard document.body.isText else { return document.pendingState }
        let viewport = textView.model === document.model ? currentViewport : document.viewport
        let anchor = if case .anchored(let anchor) = viewport { anchor } else { ScrollAnchor(firstVisibleCharacter: 0, distanceFromLeftmost: 0, distanceIntoFirstLine: 0) }
        let lines = document.lines
        let selections = document.model.session.selections
        return EditorViewState(
            firstVisibleLine: lines.line(at: min(anchor.firstVisibleCharacter, document.length)),
            offsetIntoLine: anchor.distanceIntoFirstLine, horizontalOffset: anchor.distanceFromLeftmost,
            selections: selections.selections.map { selection in
                let anchor = lines.position(at: selection.anchor), head = lines.position(at: selection.head)
                return EditorViewState.Selection(anchorLine: anchor.line, anchorColumn: anchor.column, headLine: head.line, headColumn: head.column)
            },
            primarySelection: selections.primary, folds: document.model.rowMap.folds.ranges
        )
    }

    public func restore(_ state: EditorViewState, for url: URL) {
        guard let index = documents.firstIndex(where: { $0.url == url.standardizedFileURL }) else { return }
        guard documents[index].body.isText else {
            documents[index].pendingState = state
            return
        }
        apply(state, to: index)
    }

    func apply(_ state: EditorViewState, to index: Int) {
        let document = documents[index]
        let lines = document.lines
        let length = document.length
        let offset = { (line: Int, column: Int) in
            lines.offset(of: TextPosition(line: min(max(0, line), lines.count - 1), column: column), length: length) ?? 0
        }
        let selections = state.selections.map { Selection(anchor: offset($0.anchorLine, $0.anchorColumn), head: offset($0.headLine, $0.headColumn)) }
        let set = selections.isEmpty ? SelectionSet(caret: 0) : SelectionSet(selections, primary: min(max(0, state.primarySelection), selections.count - 1))
        restoreFolds(state.folds, in: document.url)
        let anchor = ScrollAnchor(firstVisibleCharacter: offset(state.firstVisibleLine, 0), distanceFromLeftmost: state.horizontalOffset,
                                  distanceIntoFirstLine: state.offsetIntoLine)
        documents[index].viewport = .anchored(anchor)
        guard textView.model === document.model else { return document.model.session.select(set) }
        textView.select(set, scrolls: false)
        restore(.anchored(anchor))
    }

    func reloadFromDisk(_ candidates: [(id: Int, url: URL, modified: Date?, language: Language)], onlyIfModified: Bool) {
        guard !candidates.isEmpty else { return }
        Task {
            let changed = await Task.detached(priority: .utility) {
                candidates.compactMap { candidate -> (Int, LoadedFile)? in
                    if onlyIfModified {
                        guard let date = FileIO.modificationDate(candidate.url), date != candidate.modified else { return nil }
                    }
                    return (candidate.id, FileIO.load(candidate.url, language: candidate.language))
                }
            }.value
            for (id, file) in changed {
                guard let index = row(id), !documents[index].isDirty, documents[index].body.isText else { continue }
                guard case .text(let decoded) = file.content else {
                    fill(id, with: file)
                    continue
                }
                replaceText(of: index, with: decoded, recording: false)
                markSaved(index, as: decoded, modified: file.modified)
            }
        }
    }

    private func replaceText(of index: Int, with decoded: DecodedText, recording: Bool) {
        let document = documents[index]
        let old = document.store.buffer.units(NSRange(location: 0, length: document.length))
        let new = decoded.store.buffer.units(NSRange(location: 0, length: decoded.store.length))
        guard old != new else { return }
        let changed = Self.changedRange(old, new)
        let inserted = String(decoding: new[changed.new], as: UTF16.self)
        let replacement = TextReplacement(range: NSRange(location: changed.old.lowerBound, length: changed.old.count), inserted)
        let transaction = TextCommands.through([replacement], document.store, document.model.session.selections, kind: .named("Revert"))
        let isShown = textView.model === document.model
        if !recording { documents[index].undo.removeAllActions() }
        guard isShown else {
            let applied = document.model.session.apply(transaction, recording: recording)
            if !recording { document.model.session.forgetHistory() }
            didEdit(index, applied.changes)
            if case .opened(let step) = applied.recorded { register(.undo, step: step.id, title: step.title, document: document.id) }
            return
        }
        let origin = scrollView.contentView.bounds.origin
        textView.breakUndoCoalescing()
        textView.perform(transaction, scrolls: false, recording: recording)
        textView.breakUndoCoalescing()
        if !recording { document.model.session.forgetHistory() }
        textView.fitFrame()
        scroll(to: origin)
    }

    private func markSaved(_ index: Int, as decoded: DecodedText, modified: Date?) {
        documents[index].format = decoded.format
        documents[index].modified = modified
        documents[index].savedDigest = decoded.digest
        documents[index].savedLength = decoded.store.length
        guard documents[index].isDirty else { return }
        documents[index].isDirty = false
        onTabsChange?()
    }

    static func changedRange(_ old: [UInt16], _ new: [UInt16]) -> (old: Range<Int>, new: Range<Int>) {
        let shorter = min(old.count, new.count)
        var prefix = 0
        while prefix < shorter, old[prefix] == new[prefix] { prefix += 1 }
        if prefix > 0, UTF16.isLeadSurrogate(old[prefix - 1]) { prefix -= 1 }
        var suffix = 0
        while suffix < shorter - prefix, old[old.count - 1 - suffix] == new[new.count - 1 - suffix] { suffix += 1 }
        if suffix > 0, UTF16.isTrailSurrogate(old[old.count - suffix]) { suffix -= 1 }
        return (prefix..<(old.count - suffix), prefix..<(new.count - suffix))
    }
}
