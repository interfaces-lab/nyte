import AppKit
import NyteCore
@testable import NyteSearch
@testable import NyteUI

extension SearchCheck {
    func windowRoundTwo() async {
        let controller = FindInFilesViewController(workspace: Workspace(root: corpus))
        var asked: [[AgentContext]] = []
        controller.onAskAgent = { asked.append($0) }
        controller.openFiles = { [] }
        let size = NSSize(width: 1_000, height: 300)
        let window = KitProbeWindow(size: size)
        window.place(controller.view, at: .zero, size: size)

        let titles = { controller.scopeMenu().items.map(\.title).filter { !$0.isEmpty } }
        expect(titles() == ["Workspace", "Open Files", FindInFilesViewController.chooseFolderTitle], "scope: Changed is offered only when the host supplies it",
               titles().joined(separator: ", "))
        controller.changedFiles = { [] }
        expect(titles().contains("Changed Files"), "scope: Changed appears once the host supplies changed files")

        controller.find("needle")
        _ = await settled(controller)
        controller.pick(folder: corpus.appendingPathComponent("glob"))
        _ = await settled(controller)
        expect(controller.scope == .folder("glob") && !controller.bar.folderChip.isHidden && controller.bar.folderChip.title == "glob"
               && controller.results.paths.allSatisfy { $0.hasPrefix("glob/") } && !controller.results.isEmpty,
               "scope: a chosen folder shows as a chip and limits the search", controller.results.paths.joined(separator: " "))
        controller.bar.folderChip.onRemove?()
        _ = await settled(controller)
        expect(controller.scope == .workspace && controller.bar.folderChip.isHidden && controller.results.paths.contains("plain.txt"),
               "scope: removing the chip searches the workspace again")
        controller.pick(folder: URL(fileURLWithPath: "/tmp"))
        expect(controller.scope == .workspace && !controller.bannerHost.arrangedSubviews.isEmpty, "scope: a folder outside the workspace is refused with a reason")
        controller.clearBanner()

        controller.bar.grouping.press()
        expect(controller.groupsByFolder && controller.rowKind.contains(.folder) && controller.bar.grouping.isOn,
               "grouping: the toggle shows folders as parents")
        let folderIcon = controller.rowKind.firstIndex(of: .folder).map { controller.row($0).leading }
        let tinted = if case .tinted? = folderIcon { true } else { false }
        expect(tinted, "kit: folder rows carry the kit's folder icon")
        controller.bar.grouping.press()
        expect(!controller.rowKind.contains(.folder), "grouping: and back to a flat list of files")

        window.makeFirstResponder(controller.bar.field.field)
        controller.bar.field.stringValue = "value"
        _ = await settled(controller)
        expect(controller.list.showsFocusAlways, "focus: while the field drives the list, the list keeps its focused look so hover actions show")
        window.makeFirstResponder(controller.list.scrollView.documentView)
        window.makeFirstResponder(controller.bar.field.field)
        window.makeFirstResponder(nil)
        expect(!controller.list.showsFocusAlways, "focus: leaving the field drops it")
        guard let firstMatch = controller.rowKind.firstIndex(of: .match), let fileRow = controller.rowKind.firstIndex(of: .file) else {
            return expect(false, "kit: results for value")
        }
        let line = controller.row(firstMatch)
        let file = controller.row(fileRow)
        expect(line.syntax.contains { $0.color == .keyword } && !line.emphasis.isEmpty && line.titleInk == .primary,
               "kit: a result line carries its syntax colour and the match only changes weight")
        expect(file.isGroupHeader && !file.isHeader && file.toolTip == "lex.swift" && line.yieldOrder == [.title],
               "kit: file rows are pinned group rows with the path as tooltip; a line number never yields")

        controller.bar.setDisclosed(true)
        controller.onApply = { _ in true }
        controller.bar.replace.stringValue = "VALUE"
        let actions = controller.row(firstMatch).actions.map(\.id)
        let fileActions = controller.row(fileRow).actions.map(\.id)
        let merged = controller.list.withActions(Menu.make([MenuItem("Open")]), row: firstMatch, targets: IndexSet(integer: firstMatch))
        expect(actions == ["replace", "dismiss"] && fileActions == ["replaceFile", "dismiss"]
               && merged?.items.prefix(2).map(\.title) == ["Replace", "Dismiss"],
               "kit: hover actions Replace, Replace All in File and Dismiss, listed first in the row menu", "\(actions) \(fileActions)")
        let before = controller.dismissed.filter { !$0 }.count
        controller.list.onAction?("dismiss", IndexSet(integer: controller.rowKind.lastIndex(of: .match) ?? firstMatch))
        expect(controller.dismissed.filter { !$0 }.count == before - 1, "kit: the Dismiss action dismisses through onAction")
        let deleted = KeyLabel.matches(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber,
                                                        context: nil, characters: "\u{7F}", charactersIgnoringModifiers: "\u{7F}", isARepeat: false,
                                                        keyCode: 51) ?? NSEvent(), key: FindInFilesViewController.dismissAction.key, modifiers: [])
        expect(deleted, "kit: the Delete key matches the Dismiss action's key")
        controller.bar.replace.stringValue = ""
        controller.list.selectedRows = IndexSet([firstMatch, firstMatch + 1])
        let menu = controller.menu(for: controller.list.selectedRows)
        expect(menu?.items.contains { $0.title == FindInFilesViewController.askAgentTitle } ?? false, "ask: the result menu offers Ask Nyte")
        window.makeFirstResponder(controller.list.scrollView.documentView)
        press(Keys.returnKey, .option, in: window)
        expect(await Patience.until(.seconds(5)) { !asked.isEmpty }, "ask: Option-Return hands the selection to the host")
        if case let .lines(lines)? = asked.first?.first {
            let first = Int(controller.results.matchLine[Int(controller.rowIndex[firstMatch])]) + 1
            expect(asked.first?.count == 1 && lines.range.first == first && lines.range.last == first + 1
                   && lines.text == "let value = 1\nlet value = 1" && lines.file.lastPathComponent == "lex.swift",
                   "ask: adjacent lines merge into one range, 1-based, with their text", "\(lines.range.first)-\(lines.range.last) \(lines.text.debugDescription)")
        } else {
            expect(false, "ask: adjacent lines merge into one range, 1-based, with their text", "\(asked)")
        }
        for index in 0..<2_500 { write(String(format: "many/f%04d.txt", index), String(repeating: "dense line\n", count: 5)) }
        controller.filesDidChange()
        controller.choose(.folder("many"))
        _ = await settled(controller)
        let full = await SearchBench.fill(controller, with: "dense")
        expect(full.total < .seconds(5) && full.stall < .milliseconds(250) && controller.results.matchCount == 10_000,
               "window: 10,000 results in 2,000 files land without stalling the main thread past 250 ms",
               "\(full.total), stall \(full.stall), \(controller.results.matchCount)")
        window.orderOut(nil)
    }
}
