import AppKit
import NyteCore
@testable import NyteSearch
@testable import NyteUI

extension SearchCheck {
    func press(_ key: (code: UInt16, text: String), _ modifiers: NSEvent.ModifierFlags = [], in window: NSWindow) {
        var flags = modifiers
        let scalar = key.text.unicodeScalars.first?.value ?? 0
        if scalar >= 0xF700 { flags.insert(.function) }
        if (0xF700...0xF703).contains(scalar) { flags.insert(.numericPad) }
        guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: window.windowNumber, context: nil, characters: key.text,
                                           charactersIgnoringModifiers: key.text, isARepeat: false, keyCode: key.code) else { return }
        window.sendEvent(event)
    }

    func settled(_ controller: FindInFilesViewController) async -> Bool {
        await Patience.until(.seconds(10)) {
            if case .done = controller.phase { return true }
            return false
        }
    }

    func window() async {
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        application.finishLaunching()
        UserDefaults.standard.removeObject(forKey: SearchHistory.key(for: corpus))
        defer { UserDefaults.standard.removeObject(forKey: SearchHistory.key(for: corpus)) }
        let controller = FindInFilesViewController(workspace: Workspace(root: corpus))
        var applied: [WorkspaceEdit] = []
        controller.onOpen = { [weak self] location, intent in self?.opened.append((location, intent)) }
        controller.onApply = { edit in
            applied.append(edit)
            return true
        }
        let size = NSSize(width: 1_000, height: 240)
        let window = KitProbeWindow(size: size)
        window.place(controller.view, at: .zero, size: size)
        controller.find("needle")
        expect(await settled(controller), "window: a search started by find() finishes")
        let engineCount = await search("needle").results.matchCount
        let table = controller.list.scrollView.documentView
        expect(controller.bar.summary.stringValue.hasPrefix("\(engineCount.formatted()) results in "), "window: the summary counts results and files",
               controller.bar.summary.stringValue)
        expect(controller.rowKind.first == .file && controller.list.content(0).isGroupHeader, "window: results group under file rows")
        expect(controller.split.isVertical, "window: at 1,000 points the preview sits beside the list")

        press(Keys.returnKey, in: window)
        let firstMatch = controller.rowKind.firstIndex(of: .match)
        expect(window.firstResponder === table && controller.list.selectedRow == firstMatch,
               "keys: Return in the field moves into the list on the first result", "\(String(describing: window.firstResponder))")
        let firstFile = controller.rowIndex[controller.rowKind.firstIndex(of: .file) ?? 0]
        let firstFileCount = Int(controller.fileShown[Int(firstFile)])
        for _ in 0..<firstFileCount { press(Keys.down, in: window) }
        let onNextFile = controller.list.selectedRow.map { controller.rowKind[$0] == .file && controller.rowIndex[$0] != firstFile } ?? false
        press(Keys.down, in: window)
        let crossed = controller.list.selectedRow.map { controller.rowKind[$0] == .match && controller.rowIndex[$0] >= controller.results.fileMatches[Int(firstFile)].upperBound } ?? false
        expect(onNextFile && crossed, "keys: Down walks matches across files through the next file's row")
        let selectedPath = controller.list.selectedRow.map { controller.results.paths[Int(controller.results.matchFile[Int(controller.rowIndex[$0])])] }
        expect(await Patience.until(.seconds(5)) { controller.preview.source?.name == selectedPath }, "preview: selecting a result shows its file",
               controller.preview.source?.name ?? "")
        let current = controller.preview.marks.filter(\.isCurrent)
        expect(current.count == 1 && controller.preview.marks.count >= 1, "preview: the selected match is the current mark in the kit's CodeView")

        guard let matchRow = controller.list.selectedRow else { return expect(false, "keys: a selection exists") }
        press(Keys.left, in: window)
        let header = controller.list.selectedRow
        expect(header.map { controller.rowKind[$0] == .file } ?? false, "keys: Left on a match selects its file")
        let before = controller.rowKind.count
        press(Keys.left, in: window)
        expect(controller.rowKind.count < before, "keys: Left on an open file folds it", "\(before) → \(controller.rowKind.count)")
        press(Keys.right, in: window)
        expect(controller.rowKind.count == before, "keys: Right unfolds it", "\(controller.rowKind.count)")
        controller.list.selectedRows = IndexSet(integer: matchRow)

        opened = []
        press(Keys.returnKey, in: window)
        let location = controller.location(of: Int(controller.rowIndex[matchRow]))
        expect(opened.count == 1 && opened.first?.1 == .focusEditor && opened.first?.0 == location, "keys: Return opens the result in the editor",
               "\(opened.map { "\($0.0.range) \($0.1)" })")
        press(Keys.returnKey, .command, in: window)
        expect(opened.count == 2 && opened.last?.1 == .keepFocus && window.firstResponder === table,
               "keys: Command-Return opens it and keeps the list focused")
        controller.preview.clear("")
        controller.previewKey = nil
        press(Keys.space, in: window)
        expect(await Patience.until(.seconds(5)) { controller.preview.source != nil }, "keys: Space previews the selected result through onPreview")
        let numbered = controller.row(matchRow)
        expect(numbered.number == (Int(controller.results.matchLine[Int(controller.rowIndex[matchRow])]) + 1).formatted() && numbered.meta.isEmpty,
               "kit: the line number sits in the leading number column")
        expect(numbered.actions.map(\.id) == ["dismiss"] && controller.row(controller.rowKind.firstIndex(of: .file) ?? 0).actions.map(\.id) == ["dismiss"],
               "kit: without a replacement rows offer Dismiss as a hover action")

        let shown = controller.dismissed.lazy.filter { !$0 }.count
        press((code: 51, text: "\u{7F}"), in: window)
        expect(controller.dismissed.lazy.filter { !$0 }.count == shown - 1 && controller.bar.summary.stringValue.hasPrefix("\((shown - 1).formatted()) "),
               "keys: Delete dismisses a result and the count follows", controller.bar.summary.stringValue)
        expect(controller.list.selectedRow.map { controller.rowKind[$0] == .match } ?? false, "keys: after Delete a result stays selected")

        let responded = window.firstResponder?.tryToPerform(#selector(FindInFilesViewController.toggleMatchCase(_:)), with: nil) ?? false
        expect(responded && controller.caseSensitive && controller.bar.toggles[QueryBar.Toggle.matchCase.rawValue].isOn,
               "keys: Match Case reaches the window through the responder chain and shows its on state")
        let item = NSMenuItem(title: "Match Case", action: #selector(FindInFilesViewController.toggleMatchCase(_:)), keyEquivalent: "c")
        expect(controller.validateMenuItem(item) && item.state == .on, "keys: the Match Case command validates with its state")
        _ = await settled(controller)
        _ = window.firstResponder?.tryToPerform(#selector(FindInFilesViewController.toggleMatchCase(_:)), with: nil)
        _ = await settled(controller)

        expect(SearchHistory.load(root: corpus).entries.first == "needle", "history: opening a result records the query")
        window.makeFirstResponder(controller.bar.field.field)
        controller.bar.field.stringValue = "other"
        press(Keys.up, in: window)
        expect(controller.bar.field.stringValue == "needle", "history: Up in the field recalls the last query", controller.bar.field.stringValue)
        press(Keys.down, in: window)
        expect(controller.bar.field.stringValue == "other", "history: Down returns to what was typed", controller.bar.field.stringValue)
        controller.bar.field.stringValue = "needle"
        _ = await settled(controller)

        let resultsBefore = controller.results.matchCount
        controller.flip(.regex)
        _ = await settled(controller)
        controller.bar.field.stringValue = "needle("
        expect(controller.bar.field.isInvalid && !controller.bar.field.message.isEmpty && controller.results.matchCount == resultsBefore,
               "regex: an invalid pattern shows why under the field and keeps the results", controller.bar.field.message)
        controller.bar.field.stringValue = "need(le)"
        _ = await settled(controller)
        expect(!controller.bar.field.isInvalid && controller.results.matchCount == resultsBefore, "regex: a valid pattern clears the message")

        controller.bar.disclosure.press()
        controller.bar.replace.stringValue = "pin$1"
        if let first = controller.rowKind.firstIndex(of: .match) {
            controller.list.scrollRowToVisible(first)
            window.displayIfNeeded()
        }
        let replaced = controller.rowKind.firstIndex(of: .match).map { controller.row($0) }
        expect(controller.bar.isDisclosed && !(replaced?.removed.isEmpty ?? true) && !(replaced?.added.isEmpty ?? true),
               "replace: rows show the removed and the added text", replaced?.title ?? "")
        expect(replaced.map { row in row.added.contains { (row.title as NSString).substring(with: $0) == "pinle" } } ?? false,
               "replace: the inline preview expands capture groups", replaced?.title ?? "")
        expect(controller.bar.replaceAll.isEnabled, "replace: Replace All is offered")
        if let row = controller.rowKind.firstIndex(of: .match) {
            controller.list.selectedRows = IndexSet(integer: row)
            window.makeFirstResponder(table)
            press((code: 18, text: "!"), [.command, .shift], in: window)
        }
        expect(await Patience.until(.seconds(5)) { !applied.isEmpty }, "replace: Shift-Command-1 replaces the selected result through the host")
        expect(applied.first?.editCount == 1 && applied.first?.files.first?.edits.first?.text == "pinle", "replace: one edit with the expanded text",
               "\(applied.first.map { "\($0.editCount) \($0.files.first?.edits.first?.text ?? "")" } ?? "none")")
        expect(await Patience.until(.seconds(5)) { !controller.bannerHost.arrangedSubviews.isEmpty }, "replace: a banner offers Undo afterwards")
        controller.bar.replace.stringValue = ""
        controller.flip(.regex)
        controller.bar.field.stringValue = "needle"
        _ = await settled(controller)

        controller.view.setFrameSize(NSSize(width: 700, height: 300))
        controller.view.layoutSubtreeIfNeeded()
        expect(!controller.split.isVertical, "window: at 700 points the preview moves below the list")

        expect(controller.view.accessibilityRole() == .group && controller.view.accessibilityLabel() == "Find in Files", "a11y: the window is a labelled group")
        let toggles = controller.bar.toggles.prefix(3)
        expect(toggles.allSatisfy { $0.accessibilityRole() == .checkBox && !($0.accessibilityLabel() ?? "").isEmpty && $0.toolTip?.contains("\u{2318}") == true },
               "a11y: the toggles are labelled check boxes whose tooltips show their keys")
        expect(controller.bar.field.field.accessibilityLabel() == "Search", "a11y: the field is labelled")
        expect(table?.accessibilityRole() == .outline, "a11y: results are an outline")
        let children = (table?.accessibilityChildren() as? [NSView]) ?? []
        let labels = children.compactMap { $0.accessibilityLabel() }
        expect(!children.isEmpty && labels.contains { $0.hasPrefix("Line ") } && labels.contains { $0.contains(" result") },
               "a11y: visible rows are children with file and line labels", labels.prefix(3).joined(separator: " | "))

        controller.bar.field.stringValue = "zzz nothing here"
        _ = await settled(controller)
        expect(controller.empty is EmptyState && controller.split.isHidden, "state: no results shows what was searched")
        controller.bar.field.stringValue = ""
        expect(controller.empty is EmptyState, "state: an empty query shows the key hints")
        window.orderOut(nil)
    }
}
