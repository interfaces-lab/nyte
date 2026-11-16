import AppKit
import Foundation
import NyteCore
@testable import NyteLanguage
import NyteUI

extension LanguageCheck {
    static let paneSize = NSSize(width: 640, height: 320)

    static func freshViews() async -> Int {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let check = LanguageCheck(go)
        await check.freshFind()
        check.freshStructure()
        check.freshProblems()
        return check.failures
    }

    private func freshFind() async {
        let stats = url("hub/stats.go")
        let test = url("hub/hub_test.go")
        let place = { (file: URL, line: Int) in FileLocation(url: file, range: TextSpan(at: .init(line: line, column: 4))) }
        let find = FindResultsViewController(workspace: Workspace(root: root))
        let dock = NSView(frame: NSRect(origin: .zero, size: Self.paneSize))
        find.onTitleChange = { [weak find] _ in
            guard let find, find.view.superview == nil else { return }
            find.view.frame = dock.bounds
            dock.addSubview(find.view)
            dock.layoutSubtreeIfNeeded()
        }
        find.show(locations: [place(stats, 5), place(stats, 14), place(test, 25)], title: "Usages of Counts")
        let usages = Self.rows(in: find.view)
        let edit = WorkspaceEdit(files: [WorkspaceEdit.File(url: stats, edits: [
            TextEdit(range: TextSpan(start: .init(line: 5, column: 5), end: .init(line: 5, column: 11)), text: "Totals"),
        ])])
        let preview = FindResultsViewController(workspace: Workspace(root: root))
        preview.show(preview: edit, title: "Rename Counts to Totals")
        let changes = Self.rows(in: preview.view)
        expect(find.isViewLoaded && usages == 5 && changes == 2,
               "Find show(locations:) and show(preview:) on a controller whose view never loaded, embedded while it shows, list every row",
               "usages \(usages) rows, preview \(changes) rows")
        guard let usageList = Self.list(in: find.view), let previewList = Self.list(in: preview.view) else { return }
        _ = await Patience.until(.seconds(5)) { !usageList.content(3).syntax.isEmpty && !previewList.content(1).syntax.isEmpty }
        let usageRow = usageList.content(3)
        let previewRow = previewList.content(1)
        let keyword = { (row: RowContent) in
            row.syntax.contains { $0.color == .keyword && (row.title as NSString).substring(with: $0.range) == "type" }
        }
        let structWord = previewRow.syntax.contains { $0.color == .keyword && (previewRow.title as NSString).substring(with: $0.range) == "struct" }
        expect(keyword(usageRow) && keyword(previewRow) && structWord && !previewRow.added.isEmpty && !previewRow.removed.isEmpty,
               "Find result and preview lines carry syntax colours under the match and the diff inks",
               "usage \(usageRow.title.debugDescription) \(usageRow.syntax), preview \(previewRow.title.debugDescription) \(previewRow.syntax)")
        expect(usageList.content(0).isGroupHeader && !usageList.content(0).isHeader && usageList.pinsGroupHeaders,
               "Find pins its file rows as group headers that keep their own title", "\(usageList.content(0).title)")
        expect(usageRow.number == "6" && usageRow.meta.isEmpty && previewRow.number == "6" && usageList.widestNumber?() == "26",
               "Find puts line numbers in the leading column, sized from the widest number it was told, not by measuring rows",
               "number \(usageRow.number.debugDescription), meta \(usageRow.meta.debugDescription), widest \(usageList.widestNumber?() ?? "nil")")
        await kindsAndSource(stats: stats, test: test)
    }

    private func freshStructure() {
        let structure = StructureViewController(intelligence: service)
        structure.caretDidMove(to: TextPosition(line: 2, column: 0))
        structure.documentDidChange()
        structure.serverStatusDidChange()
        structure.show(url("main.go"))
        expect(structure.isViewLoaded && Self.rows(in: structure.view) == 0,
               "Structure caretDidMove, documentDidChange, serverStatusDidChange and show on a fresh controller load it without a table exception",
               "loaded \(structure.isViewLoaded)")
    }

    private func freshProblems() {
        let file = url("hub/hub.go")
        service.problems[Wire.canonical(file)] = [
            Diagnostic(range: TextSpan(at: .init(line: 79, column: 1)), severity: .warning, message: "nil dereference"),
        ]
        let problems = ProblemsViewController(workspace: Workspace(root: root), intelligence: service)
        problems.diagnosticsDidChange(for: file)
        let loaded = problems.isViewLoaded
        let rows = Self.rows(in: problems.view)
        expect(!loaded && rows == 2,
               "Problems holds diagnostics reported before its view loads and lists them when it does",
               "loaded early \(loaded), rows \(rows)")
        var asked: [(URL, String)] = []
        let field = Self.searchField(in: problems.view)
        problems.onAskAgent = { url, diagnostic in asked.append((url, diagnostic.message)) }
        guard let list = Self.list(in: problems.view) else { return }
        list.selectedRows = IndexSet(integer: 1)
        let item = list.menuForRow?(1)?.items.first { $0.title == ProblemsViewController.askAgentTitle }
        item.flatMap { $0.target as? NSObject }.map { _ = $0.perform(item?.action, with: item) }
        let key = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .option, timestamp: 0, windowNumber: 0, context: nil,
                                   characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36)
        key.map { problems.view.keyDown(with: $0) }
        let fromField = field?.onCommand?(#selector(NSResponder.insertNewlineIgnoringFieldEditor(_:))) == true
        expect(asked.count == 3 && fromField && asked.allSatisfy { $0.0 == Wire.canonical(file) && $0.1 == "nil dereference" }
            && item?.keyEquivalent == "\r" && item?.keyEquivalentModifierMask == .option
            && list.content(0).isGroupHeader,
            "Problems Ask Nyte to Fix reaches onAskAgent from the row menu, Option-Return in the list and in the filter field; file rows pin",
            "\(asked.count) asks, menu item \(item?.title ?? "missing")")
        service.problems = [:]
    }

    private func kindsAndSource(stats: URL, test: URL) async {
        let place = { (file: URL, line: Int, column: Int) in
            FileLocation(url: file, range: TextSpan(start: .init(line: line, column: column), end: .init(line: line, column: column + 6)))
        }
        var titles: [String] = []
        let find = FindResultsViewController(workspace: Workspace(root: root))
        find.onTitleChange = { titles.append($0) }
        find.view.frame = NSRect(origin: .zero, size: NSSize(width: 960, height: Self.paneSize.height))
        find.show(usages: [Usage(location: place(stats, 5, 5), kind: .declaration), Usage(location: place(stats, 14, 10), kind: .read),
                           Usage(location: place(test, 25, 31), kind: .read)], title: "Usages of Counts")
        guard let list = Self.list(in: find.view) else { return expect(false, "Find has a list", "") }
        let headers = (0..<list.rowCount()).map(list.content).filter(\.isHeader).map { "\($0.title) \($0.meta)" }
        let shown = await Patience.until(.seconds(5)) { find.source.code.source?.name == "stats.go" }
        find.view.layoutSubtreeIfNeeded()
        let codeFrame = find.source.code.frame
        let listFrame = list.frame
        let current = find.source.code.marks.first(where: \.isCurrent)
        expect(headers == ["Declaration 1", "Value read 2"] && shown && current?.line == 5 && current?.start == 5
            && find.source.code.marks.count == 2 && find.source.split.isVertical && codeFrame.width > 0 && listFrame.maxX < codeFrame.minX,
            "Find groups usages by kind with counts and previews the selected usage's file beside the list, the current one marked",
            "headers \(headers), source \(find.source.code.source?.name ?? "nil"), marks \(find.source.code.marks), list \(listFrame), code \(codeFrame)")
        let dock = { (height: CGFloat) -> (stacked: Bool, shown: Bool, toggle: Bool, list: NSRect, code: NSRect) in
            find.view.frame = NSRect(origin: .zero, size: NSSize(width: 640, height: height))
            find.view.layoutSubtreeIfNeeded()
            return (!find.source.split.isVertical, !find.source.code.isHidden, find.previewToggle.isOn, list.frame, find.source.code.frame)
        }
        let tall = dock(360)
        let short = dock(260)
        find.source.toggle()
        find.view.layoutSubtreeIfNeeded()
        let back = !find.source.code.isHidden && find.source.code.frame.height > 0 && find.previewToggle.isOn
        expect(tall.stacked && tall.shown && tall.toggle && tall.code.height > 0 && tall.list.maxY <= tall.code.minY
            && tall.list.height >= SourcePreview.fewestListRows * list.rowHeight && short.stacked && !short.shown && !short.toggle && back,
            "Find stacks the source preview under the list below 720 pt, hides it when the list would show fewer than six rows, and its toggle brings it back",
            "360 pt \(tall), 260 pt \(short), toggled back \(back)")
        find.show(preview: WorkspaceEdit(files: [WorkspaceEdit.File(url: stats, edits: [
            TextEdit(range: TextSpan(start: .init(line: 5, column: 5), end: .init(line: 5, column: 11)), text: "Totals"),
        ])]), title: "Rename Counts to Totals")
        find.view.layoutSubtreeIfNeeded()
        let codeGone = find.source.code.isHidden || find.source.code.frame.width < 1 || find.source.code.frame.height < 1
        expect(titles == ["Usages of Counts", "Rename Preview"] && codeGone,
               "Find names a rename preview's tab Rename Preview and hides the source preview for it",
               "\(titles), code \(find.source.code.frame) hidden \(find.source.code.isHidden)")
    }

    func structureRows() async {
        let file = url(fixture.annotated == "main.go" ? "hub/hub.go" : "src/hub.ts")
        let method = fixture.server == "gopls" ? "Submit" : "submit"
        let full = fixture.server == "gopls" ? "Submit(ctx context.Context, message Message) error"
            : "submit(message: Message, signal: AbortSignal) Promise<void>"
        let structure = StructureViewController(intelligence: service)
        structure.show(file)
        let list = Self.list(in: structure.view)
        _ = Self.rows(in: structure.view)
        let row = { () -> RowContent? in
            guard let list else { return nil }
            return (0..<list.rowCount()).map(list.content).first { $0.title == method }
        }
        _ = await Patience.until(.seconds(10)) { row() != nil }
        let found = row()
        expect(found?.toolTip == full && found?.detailShort == StructureViewController.collapsedParameters && found?.detailJoinsTitle == true,
               "\(fixture.server) Structure hands the kit the parameters, their short form and the result, with the full signature as the tooltip",
               "tooltip \(found?.toolTip ?? "nil"), short \(found?.detailShort ?? "nil")")
    }

    static func rows(in view: NSView) -> Int {
        view.frame = NSRect(origin: .zero, size: paneSize)
        view.layoutSubtreeIfNeeded()
        return list(in: view)?.rowCount() ?? -1
    }

    static func searchField(in view: NSView) -> SearchField? {
        if let field = view as? SearchField { return field }
        return view.subviews.lazy.compactMap { searchField(in: $0) }.first
    }

    static func list(in view: NSView) -> ListView? {
        if let list = view as? ListView { return list }
        return view.subviews.lazy.compactMap { list(in: $0) }.first
    }
}
