import AppKit
import NyteCore
import NyteUI

extension FindInFilesViewController {
    static let codeAdvance = TextStyle.code.font().maximumAdvancement.width
    static let editGap = "\u{2009}"
    static let failureSymbol = "exclamationmark.triangle"
    static let rowAllowance: CGFloat = 160

    func configureList() {
        list.rowHeight = Metric.rowCompact
        list.isOutline = true
        list.pinsGroupHeaders = true
        list.verticalInset = Space.x1
        list.allowsMultipleSelection = true
        list.rowCount = { [weak self] in self?.rowKind.count ?? 0 }
        list.content = { [weak self] in self?.row($0) ?? RowContent() }
        list.onSelect = { [weak self] _ in
            self?.noteInteraction()
            self?.selectionChanged()
        }
        list.onActivate = { [weak self] in self?.open(row: $0, intent: .focusEditor) }
        list.onToggle = { [weak self] in self?.toggleGroup(at: $0) }
        list.onAction = { [weak self] in self?.perform($0, on: $1) }
        list.groupHeader = { [weak self] row in self?.fileHeader(forRow: row) }
        list.onPreview = { [weak self] _ in self?.selectionChanged() }
        list.previewsOnClick = true
        list.widestNumber = { [weak self] in self.map { ($0.widestLine + 1).formatted() } ?? "" }
        NotificationCenter.default.addObserver(self, selector: #selector(listScrolled), name: NSView.boundsDidChangeNotification,
                                               object: list.scrollView.contentView)
        list.menuForRows = { [weak self] in self?.menu(for: $0) }
        list.setAccessibilityLabel("Results")
    }

    func fileHeader(forRow row: Int) -> Int? {
        guard rowKind.indices.contains(row), rowKind[row] == .file || rowKind[row] == .match else { return nil }
        return ListView.header(in: fileHeaderRows, forRow: row)
    }

    var fileHeaderRows: [Int] {
        if headerRowsStale {
            headerRows = rowKind.indices.filter { rowKind[$0] == .file }
            headerRowsStale = false
        }
        return headerRows
    }

    @objc func listScrolled() {
        noteInteraction()
    }

    func row(_ index: Int) -> RowContent {
        let depth = Int(rowDepth[index])
        switch rowKind[index] {
        case .folder: return folderRow(Int(rowIndex[index]), depth: depth)
        case .file: return fileRow(Int(rowIndex[index]), depth: depth)
        case .match: return matchRow(Int(rowIndex[index]), depth: depth)
        case .failures: return failuresRow()
        case .failure: return failureRow(Int(rowIndex[index]))
        }
    }

    private func folderRow(_ folder: Int, depth: Int) -> RowContent {
        let entry = folderRows[folder]
        let closed = closedFolders.contains(entry.path)
        var row = RowContent(title: entry.title, meta: entry.count.formatted(), leading: FileIcon.folderLeading(open: !closed, ink: .secondary),
                             depth: depth, disclosure: closed ? .closed : .open)
        row.titleWeight = .medium
        row.actions = actions(for: .folder)
        row.toolTip = entry.path
        row.accessibilityLabel = "\(entry.path), \(entry.count.formatted()) \(entry.count == 1 ? "result" : "results")"
        return row
    }

    private func fileRow(_ file: Int, depth: Int) -> RowContent {
        let path = results.paths[file]
        let name = (path as NSString).lastPathComponent
        let count = Int(fileShown[file]).formatted() + (results.fileTruncated[file] ? "+" : "")
        var row = RowContent(title: name, detail: groupsByFolder ? "" : (path as NSString).deletingLastPathComponent, meta: count,
                             leading: .image(FileIcon.forFile(named: name).image(for: view.effectiveAppearance)), depth: depth,
                             disclosure: fileOpen[file] ? .open : .closed)
        row.titleWeight = .medium
        row.isGroupHeader = true
        row.actions = actions(for: .file)
        row.detailTruncation = .path
        row.toolTip = path
        row.accessibilityLabel = "\(path), \(count) \(fileShown[file] == 1 ? "result" : "results")"
        return row
    }

    private func matchRow(_ match: Int, depth: Int) -> RowContent {
        let slot = Int(results.matchSlot[match])
        let raw = results.text(ofSlot: slot)
        let line = Int(results.matchLine[match]) + 1
        var trimmed = 0
        if results.slotStartsLine[slot] {
            for unit in raw.utf16 {
                guard unit == 0x20 || unit == 0x09 else { break }
                trimmed += 1
            }
        }
        var text = ((raw as NSString).substring(from: trimmed) as NSString).replacingOccurrences(of: "\t", with: " ")
        let length = (text as NSString).length
        let start = min(max(0, Int(results.matchColumn[match] - results.slotColumn[slot]) - trimmed), length)
        let sameLine = results.matchEndLine[match] == results.matchLine[match]
        let end = sameLine ? min(max(start, Int(results.matchEndColumn[match] - results.slotColumn[slot]) - trimmed), length) : length
        var row = RowContent(title: text, depth: depth)
        row.number = line.formatted()
        row.actions = actions(for: .match)
        row.monospace = true
        row.yieldOrder = [.title]
        let found = NSRange(location: start, length: end - start)
        var colours = syntax(ofSlot: Int32(slot), file: Int(results.matchFile[match]), raw: raw).compactMap { token -> (range: NSRange, color: SyntaxColor)? in
            let moved = NSRange(location: token.range.location - trimmed, length: token.range.length)
            return moved.location >= 0 ? (moved, token.color) : nil
        }
        var changed = found
        if let replacement = inlineReplacement(match: match, slotText: raw, local: found, trimmed: trimmed) {
            let source = text as NSString
            let gap = replacement.isEmpty || found.length == 0 ? "" : Self.editGap
            text = source.substring(to: end) + gap + replacement + source.substring(from: end)
            let added = NSRange(location: end + (gap as NSString).length, length: (replacement as NSString).length)
            let inserted = added.length + (gap as NSString).length
            colours = colours.compactMap { token in
                if token.range.location >= end { return (NSRange(location: token.range.location + inserted, length: token.range.length), token.color) }
                return NSMaxRange(token.range) <= end ? token : nil
            }
            row.removed = found.length > 0 ? [found] : []
            row.added = added.length > 0 ? [added] : []
            changed = NSUnionRange(found, added)
            row.accessibilityLabel = "Line \(line): \(raw.trimmingCharacters(in: .whitespaces)), becomes \(replacement)"
        } else {
            row.emphasis = [found]
            row.accessibilityLabel = "Line \(line): \(raw.trimmingCharacters(in: .whitespaces))"
        }
        row.title = text
        let surelyFits = CGFloat((row.title as NSString).length) * Self.codeAdvance < list.bounds.width - Self.rowAllowance
        let shift = surelyFits ? 0 : fitShift(changed, row)
        guard shift > 0 else {
            row.syntax = colours
            return row
        }
        let cutting = signposter.beginInterval("row cut")
        row.title = Excerpt.cut(text, shift: shift)
        signposter.endInterval("row cut", cutting)
        let move = { (range: NSRange) in NSRange(location: range.location - shift, length: range.length) }
        row.emphasis = row.emphasis.map(move)
        row.removed = row.removed.map(move)
        row.added = row.added.map(move)
        row.syntax = colours.compactMap { token in token.range.location - shift >= 1 ? (move(token.range), token.color) : nil }
        return row
    }

    private func syntax(ofSlot slot: Int32, file: Int, raw: String) -> [(range: NSRange, color: SyntaxColor)] {
        if let cached = syntaxCache[slot] { return cached }
        let lexing = signposter.beginInterval("row lex")
        defer { signposter.endInterval("row lex", lexing) }
        let language = Language.detect(fileName: (results.paths[file] as NSString).lastPathComponent)
        var tokens: [UInt64] = []
        let units = Array(raw.utf16)
        units.withUnsafeBufferPointer { line in
            _ = Lexer.line(line, state: LexState.normal, language: language, offset: 0, tokens: &tokens, emit: true)
        }
        let colours = tokens.map { (range: Token.range($0), color: Token.kind($0)) }.filter { $0.color != .plain }
        syntaxCache[slot] = colours
        return colours
    }

    private func failuresRow() -> RowContent {
        var row = RowContent.header("Could not read", meta: failures.count.formatted(),
                                    leading: .symbol(Self.failureSymbol, .tertiary), disclosure: failuresOpen ? .open : .closed)
        row.titleInk = .secondary
        row.accessibilityLabel = "Could not read \(failures.count) \(failures.count == 1 ? "file" : "files")"
        return row
    }

    private func failureRow(_ index: Int) -> RowContent {
        var row = RowContent(title: failures[index].path, detail: failures[index].reason, depth: 1)
        row.titleInk = .secondary
        row.titleTruncation = .path
        row.toolTip = "\(failures[index].path): \(failures[index].reason)"
        return row
    }

    private func fitShift(_ changed: NSRange, _ row: RowContent) -> Int {
        let fitting = signposter.beginInterval("row fit")
        defer { signposter.endInterval("row fit", fitting) }
        return Excerpt.shift(for: changed, columns: columns(of: row))
    }

    func columns(of row: RowContent) -> Int {
        let fit = row.fitted(width: list.bounds.width, reservesDisclosure: true)
        return fit.titleTruncated ? Int(fit.titleWidth / Self.codeAdvance) : Int.max
    }

    func render() {
        guard isViewLoaded else { return }
        let searching: Bool
        let summary: String
        switch phase {
        case .idle:
            searching = false
            summary = ""
        case let .searching(progress):
            searching = true
            summary = progress.matches > 0 ? Tally.results(progress.matches, files: progress.filesMatched, capped: false)
                : Tally.files(progress)
        case let .done(done):
            searching = false
            let shown = dismissed.lazy.filter { !$0 }.count
            let files = fileShown.lazy.filter { $0 > 0 }.count
            summary = done.ending == .cancelled ? "Stopped, " + Tally.results(shown, files: files, capped: false).lowercased()
                : shown == 0 ? "No results" : Tally.results(shown, files: files, capped: done.ending == .capped)
        }
        bar.setSearching(searching)
        bar.summary.stringValue = summary
        bar.summary.setAccessibilityLabel(summary)
        bar.replaceAll.isEnabled = !bar.replace.stringValue.isEmpty && dismissed.contains(false) && !searching && bulkTask == nil
        bar.replaceAll.isLoading = bulkTask != nil
        bar.replaceAll.title = "Replace All"
        bar.replaceAll.shortcut = "\u{2325}\u{2318}\u{21A9}"
        showEmptyState()
    }

    private func showEmptyState() {
        empty?.removeFromSuperview()
        empty = nil
        let state: EmptyState? = switch phase {
        case .idle where results.isEmpty:
            EmptyState(symbol: "text.magnifyingglass", title: "Find in Files", hints: [
                ("Match Case", "\u{2325}\u{2318}C"), ("Words", "\u{2325}\u{2318}W"), ("Regular Expression", "\u{2325}\u{2318}R"),
                ("Ask Nyte About Results", "\u{2325}\u{21A9}"),
            ])
        case let .searching(progress) where results.isEmpty:
            EmptyState(loading: true, title: "Searching", description: Tally.files(progress))
        case let .done(summary) where results.isEmpty:
            EmptyState(symbol: "magnifyingglass", title: "No results", description: Tally.searched(lastQuery ?? query, summary: summary, place: scopePlace),
                       actions: includesIgnored ? [] : [("Include Ignored Files", { [weak self] in self?.setIncludesIgnored(true) })])
        default: nil
        }
        split.isHidden = state != nil
        guard let state else { return }
        empty = state
        Pin.fill(state, in: content)
    }
}

enum Excerpt {
    static let context = 12

    static func shift(for range: NSRange, columns: Int) -> Int {
        guard columns > context * 2, NSMaxRange(range) > columns - 1 else { return 0 }
        let shift = min(range.location - context, NSMaxRange(range) - columns + context)
        return shift > 1 ? shift : 0
    }

    static func cut(_ text: String, shift: Int) -> String {
        guard shift > 0 else { return text }
        return "\u{2026}" + (text as NSString).substring(from: min(shift + 1, (text as NSString).length))
    }
}

enum Tally {
    static func results(_ count: Int, files: Int, capped: Bool) -> String {
        let noun = count == 1 ? "result" : "results"
        let fileNoun = files == 1 ? "file" : "files"
        return (capped ? "More than " : "") + "\(count.formatted()) \(noun) in \(files.formatted()) \(fileNoun)"
    }

    static func occurrences(_ count: Int, files: Int) -> String {
        "\(count.formatted()) \(count == 1 ? "occurrence" : "occurrences") in \(files.formatted()) \(files == 1 ? "file" : "files")"
    }

    static func searched(_ query: SearchQuery, summary: SearchSummary, place: String) -> String {
        var options: [String] = []
        if query.isCaseSensitive { options.append("case sensitive") }
        if query.wholeWord { options.append("whole words") }
        if query.isRegex { options.append("regular expression") }
        let files = summary.progress.filesSearched
        var sentence = "Nothing matches \u{201C}\(query.text)\u{201D} in \(files.formatted()) \(files == 1 ? "file" : "files") \(place)"
        if !options.isEmpty { sentence += " (\(options.joined(separator: ", ")))" }
        sentence += "."
        if !query.includesIgnored { sentence += " Ignored files were skipped." }
        if summary.binaryFiles > 0 { sentence += " \(summary.binaryFiles.formatted()) binary skipped." }
        if let failure = summary.failures.first {
            sentence += summary.failures.count == 1 ? " Could not read \(failure.path): \(failure.reason)."
                : " Could not read \(summary.failures.count.formatted()) files."
        }
        return sentence
    }

    static func files(_ progress: SearchProgress) -> String {
        "\(progress.filesSearched.formatted()) of \(progress.filesTotal.formatted()) files"
    }
}
