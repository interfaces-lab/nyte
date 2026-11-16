import AppKit
import NyteCore
import NyteUI

extension FindInFilesViewController {
    func replaceChanged() {
        replacer = nil
        replaceExpression = nil
        list.reload()
        render()
    }

    func activeReplacer() -> Replacer? {
        guard !bar.replace.stringValue.isEmpty, let query = lastQuery else { return nil }
        if let replacer, replacer.replacement == bar.replace.stringValue, replacer.preservesCase == preservesCase,
           replacer.query == query {
            return replacer
        }
        let fresh = Replacer(query: query, replacement: bar.replace.stringValue, preservesCase: preservesCase)
        replacer = fresh
        replaceExpression = fresh.expression()
        return fresh
    }

    func inlineReplacement(match: Int, slotText: String, local: NSRange, trimmed: Int) -> String? {
        guard bar.isDisclosed, let replacer = activeReplacer(), local.length > 0 || query.isRegex else { return nil }
        let slot = Int(results.matchSlot[match])
        let start = Int(results.matchColumn[match] - results.slotColumn[slot])
        let line = slotText as NSString
        let end = results.matchEndLine[match] == results.matchLine[match]
            ? Int(results.matchEndColumn[match] - results.slotColumn[slot]) : line.length
        guard start >= 0, end <= line.length else { return nil }
        return replacer.replacement(in: line, at: NSRange(location: start, length: end - start), expression: replaceExpression)
            .map { $0.replacingOccurrences(of: "\n", with: "\u{21B5}") }
    }

    static let replaceAction = RowContent.Action("replace", symbol: "arrow.2.squarepath", label: "Replace", key: "1", modifiers: [.command, .shift])
    static let replaceFileAction = RowContent.Action("replaceFile", symbol: "arrow.2.squarepath", label: "Replace All in File", key: "1",
                                                     modifiers: [.command, .shift])
    static let dismissAction = RowContent.Action("dismiss", symbol: "xmark", label: "Dismiss", key: "\u{7F}")

    func actions(for kind: RowKind) -> [RowContent.Action] {
        let replacing = !bar.replace.stringValue.isEmpty && onApply != nil
        switch kind {
        case .match: return (replacing ? [Self.replaceAction] : []) + [Self.dismissAction]
        case .file: return (replacing ? [Self.replaceFileAction] : []) + [Self.dismissAction]
        case .folder: return [Self.dismissAction]
        case .failures, .failure: return []
        }
    }

    func perform(_ action: String, on rows: IndexSet) {
        noteInteraction()
        switch action {
        case Self.replaceAction.id: replace(rows: rows)
        case Self.replaceFileAction.id:
            guard let row = rows.first(where: { rowKind.indices.contains($0) && rowKind[$0] == .file }) else { return }
            confirmReplaceAll(inFile: Int(rowIndex[row]))
        case Self.dismissAction.id: dismiss(rows)
        default: break
        }
    }

    func replace(rows: IndexSet) {
        apply(matches: matches(in: rows))
    }

    func confirmReplaceAll(inFile file: Int? = nil) {
        guard bulkTask == nil, !bar.replace.stringValue.isEmpty, var query = lastQuery else { return }
        let path = file.map { results.paths[$0] }
        if let path { query.scope = .files([path]) }
        let replacer = Replacer(query: query, replacement: bar.replace.stringValue, preservesCase: preservesCase)
        let excluded = Set(dismissed.indices.filter { dismissed[$0] }.map {
            MatchKey(path: results.paths[Int(results.matchFile[$0])], byte: results.matchBytes[$0].lowerBound)
        })
        let engine = engine, buffers = unsaved
        bulkTask = Task { [weak self] in
            let bulk = await replacer.planAll(engine: engine, unsaved: buffers, excluding: excluded)
            guard let self, !Task.isCancelled else { return }
            bulkTask = nil
            render()
            switch bulk {
            case let .refused(reason): refuse(reason)
            case let .ready(plan): confirm(plan, replacement: replacer.replacement, file: path)
            }
        }
        render()
    }

    private func refuse(_ reason: String) {
        clearBanner()
        let banner = Banner("Nothing was replaced", detail: reason, tone: .warning)
        banner.onDismiss = { [weak self] in self?.clearBanner() }
        bannerHost.addArrangedSubview(banner)
        banner.widthAnchor.constraint(equalTo: bannerHost.widthAnchor).isActive = true
    }

    private func confirm(_ plan: ReplacePlan, replacement: String, file: String?) {
        guard plan.count > 0 else { return refuse(plan.stale.isEmpty ? "Nothing matches any more." : "Every file changed since the search.") }
        let alert = NSAlert()
        alert.messageText = Self.confirmation(plan, file: file)
        alert.informativeText = "Each one becomes \u{201C}\(replacement)\u{201D}. You can undo this."
        alert.addButton(withTitle: file == nil ? "Replace All" : "Replace All in File")
        alert.addButton(withTitle: "Cancel")
        guard let window = view.window else { return }
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            self?.apply(plan)
        }
    }

    static func confirmation(_ plan: ReplacePlan, file: String?) -> String {
        guard let file else { return "Replace \(Tally.occurrences(plan.count, files: plan.edit.files.count))?" }
        return "Replace \(plan.count.formatted()) \(plan.count == 1 ? "occurrence" : "occurrences") in \((file as NSString).lastPathComponent)?"
    }

    func apply(_ plan: ReplacePlan) {
        guard let onApply else { return }
        recordHistory()
        Task { [weak self] in
            let applied = plan.count > 0 ? await onApply(plan.edit) : true
            guard let self else { return }
            showOutcome(plan, applied: applied)
            startSearch()
        }
    }

    func apply(matches chosen: [Int]) {
        guard !chosen.isEmpty, let replacer = activeReplacer() else { return }
        let snapshot = results, root = workspace.root, buffers = unsaved
        Task { [weak self] in
            let plan = await Task.detached(priority: .userInitiated) {
                replacer.plan(snapshot, matches: chosen, root: root, unsaved: buffers)
            }.value
            self?.apply(plan)
        }
    }

    func showOutcome(_ plan: ReplacePlan, applied: Bool) {
        clearBanner()
        let files = plan.edit.files.count
        let banner: Banner
        if !applied {
            banner = Banner("Could not replace", detail: "The editor refused the change.", tone: .danger)
        } else {
            let done = "Replaced \(Tally.occurrences(plan.count, files: files))"
            let skipped = plan.stale.isEmpty ? "" : "\(plan.stale.count.formatted()) changed since the search and were left alone."
            let inverse = plan.inverse
            banner = Banner(done, detail: skipped, tone: plan.stale.isEmpty ? .neutral : .warning,
                            action: plan.count > 0 ? ("Undo", { [weak self] in self?.undo(inverse) }) : nil)
        }
        banner.onDismiss = { [weak self] in self?.clearBanner() }
        bannerHost.addArrangedSubview(banner)
        banner.widthAnchor.constraint(equalTo: bannerHost.widthAnchor).isActive = true
    }

    func clearBanner() {
        bannerHost.arrangedSubviews.forEach { $0.removeFromSuperview() }
    }

    private func undo(_ inverse: WorkspaceEdit) {
        clearBanner()
        guard let onApply else { return }
        Task { [weak self] in
            _ = await onApply(inverse)
            self?.startSearch()
        }
    }
}
