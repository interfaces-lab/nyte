import AppKit
import CoreText
import NyteCore
@testable import NyteTerminal
import Synchronization

extension TerminalCheck {
    func preferences() async {
        guard let engine = try? TerminalEngine(grid: Self.grid, colors: Self.colors, preferences: .standard) else {
            return expect(false, "an engine starts for the preference checks")
        }
        let optionX = KeyInput(phase: .press, key: .x, modifiers: [.option], consumed: [], text: "\u{2248}", unshifted: 0x78)
        let rightOptionX = KeyInput(phase: .press, key: .x, modifiers: [.option, .rightOption], consumed: [], text: "\u{2248}",
                                    unshifted: 0x78)
        var meta = TerminalPreferences(optionAsMeta: .both)
        engine.apply(meta)
        let both = engine.encode(optionX)
        meta.optionAsMeta = .right
        engine.apply(meta)
        let rightOnLeft = engine.encode(optionX)
        let rightOnRight = engine.encode(rightOptionX)
        meta.optionAsMeta = .none
        engine.apply(meta)
        let none = engine.encode(optionX)
        expect(both == [0x1B, 0x78] && rightOnRight == [0x1B, 0x78] && rightOnLeft == Array("\u{2248}".utf8)
                   && none == Array("\u{2248}".utf8),
               "preferences: Option as Meta sends Escape-x for the chosen Option keys and the typed character otherwise",
               "both \(both), right on left \(rightOnLeft), right on right \(rightOnRight), none \(none)")

        let session = start(scrollback: 10_000)
        await until { shows("probe$") }
        type("seq 1 20000\r")
        await until(20) { shows("20000") && screen.lines.last(where: { !$0.isEmpty })?.hasPrefix("probe$") == true }
        let before = frame?.scrollback.total ?? 0
        session.enqueue { $0.apply(TerminalPreferences(scrollbackLines: 1_000)) }
        await until { (frame?.scrollback.total ?? .max) < before / 2 }
        let after = frame?.scrollback.total ?? 0
        expect(before > 10_000 && after < 2_500, "preferences: lowering scrollback on a running terminal drops old lines at once",
               "\(before) rows before, \(after) after")

        session.enqueue { $0.apply(TerminalPreferences(scrollbackLines: 1_000, cursorStyle: .bar, cursorBlinks: true)) }
        let restyled = await until { frame?.cursor.shape == .bar && frame?.cursor.blinking == true }
        expect(restyled, "preferences: a running shell's cursor takes the new style and blink at once",
               "shape \(String(describing: frame?.cursor.shape)), blinking \(String(describing: frame?.cursor.blinking))")
        type("printf '\\e[2 q'\r")
        let programWins = await until { frame?.cursor.shape == .block && frame?.cursor.blinking == false }
        expect(programWins, "preferences: a program that sets its own cursor still wins over the preference")
        session.enqueue { $0.shutdown() }
        self.session = nil
    }

    func pane() async {
        _ = NSApplication.shared
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("nyte-pane-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        var preferences = TerminalPreferences(shellPath: "/bin/zsh")
        let controller = TerminalViewController(workspace: Workspace(root: folder), preferences: preferences)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 400), styleMask: [.titled], backing: .buffered,
                              defer: true)
        window.contentView = controller.view
        window.contentView?.layoutSubtreeIfNeeded()
        let view = controller.terminalView
        let pasteboard = NSPasteboard(name: NSPasteboard.Name("ai.nyte.probe.\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        view.pasteboard = pasteboard
        let pump: @MainActor () -> Bool = {
            view.session?.enqueue { $0.produceFrame() }
            return true
        }
        func settle(_ seconds: Double = 15, _ condition: () -> Bool) async -> Bool {
            await until(seconds) { pump() && condition() }
        }
        guard await settle(15, { view.session != nil && view.cursor.visible }) else { return expect(false, "pane: the shell starts in a pane") }
        view.session?.enqueue { $0.text("echo font-$((2+3))\r") }
        _ = await settle { view.screenText.contains("font-5") }
        let columns = view.columns
        preferences.fontSize = Double(CTFontGetSize(view.metrics.fonts[0]) * 2)
        controller.apply(preferences)
        let reflowed = await settle { view.columns > 0 && view.columns < columns * 3 / 4 && view.screenText.contains("font-5") }
        expect(reflowed, "preferences: doubling the font size reflows to fewer columns and keeps the output",
               "\(columns) columns before, \(view.columns) after")

        func selectMarker() async -> Bool {
            var previous = ""
            var steady = 0
            _ = await settle(5) {
                let current = view.screenText
                steady = current == previous ? steady + 1 : 0
                previous = current
                return steady >= 8 && view.lastGrid.map { Int($0.columns) } == view.columns
                    && view.layouts.contains { $0?.source.plainText.hasPrefix("font-5") == true }
            }
            guard let grid = view.lastGrid,
                  let row = view.layouts.firstIndex(where: { $0?.source.plainText.hasPrefix("font-5") == true }) else { return false }
            let y = (Double(row) + 0.5) * Double(grid.cellHeight)
            for (phase, column, within) in [(PointerInput.Phase.press, 0, 0.1), (.drag, 5, 0.9), (.release, 5, 0.9)] {
                let input = PointerInput(phase: phase, button: .left, modifiers: [], column: column, row: row,
                                         x: (Double(column) + within) * Double(grid.cellWidth), y: y, time: 0, repeatInterval: 0,
                                         forceSelection: true)
                view.session?.enqueue { $0.pointer(input) }
            }
            return await settle(5) { view.selectionTextCache != nil }
        }
        preferences.copiesOnSelect = true
        controller.apply(preferences)
        pasteboard.clearContents()
        let selected = await selectMarker()
        let copied = await settle(5) { pasteboard.string(forType: .string) == "font-5" }
        expect(selected && copied, "preferences: copy on select puts a mouse selection on the pasteboard",
               pasteboard.string(forType: .string) ?? "nothing")
        let context = controller.selectionContext()
        expect(context?.text == "font-5" && context?.directory.lastPathComponent == folder.lastPathComponent,
               "Ask Nyte: the selection is the context, with the shell's directory", "\(String(describing: context))")

        let received = Mutex<AgentContext?>(nil)
        controller.onAskAgent = { context in received.withLock { $0 = context } }
        let menuEvent = NSEvent.mouseEvent(with: .rightMouseDown, location: NSPoint(x: 20, y: 20), modifierFlags: [], timestamp: 0,
                                           windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        let item = menuEvent.flatMap { view.menu(for: $0) }?.items.first { $0.title == "Ask Nyte" }
        expect(item?.isEnabled == true, "Ask Nyte: the context menu offers it while there is a selection")
        view.askNyte(nil)
        let sent = received.withLock { $0 }
        if case let .terminal(terminal) = sent {
            expect(terminal.text == "font-5", "Ask Nyte: it reports the selection through onAskAgent", terminal.text)
        } else {
            expect(false, "Ask Nyte: it reports the selection through onAskAgent", "\(String(describing: sent))")
        }
        controller.onAskAgent = nil
        let hidden = menuEvent.flatMap { view.menu(for: $0) }?.items.contains { $0.title == "Ask Nyte" } ?? true
        expect(!hidden, "Ask Nyte: the item is absent while nothing listens")

        preferences.copiesOnSelect = false
        controller.apply(preferences)
        view.session?.enqueue { $0.text("printf '\\e]133;C\\a'; echo out-$((40+2)); printf '\\e]133;D;0\\a'\r") }
        let output = await settle { view.lastCommandOutput?.contains("out-42") == true && !view.hasSelectedText }
        expect(output, "Ask Nyte: with shell integration marks, the last command's output is known",
               view.lastCommandOutput ?? "nothing")
        let fallback = controller.selectionContext()?.text ?? ""
        expect(!view.hasSelectedText && fallback.contains("out-42"), "Ask Nyte: without a selection the context is that output", fallback)

        pasteboard.clearContents()
        _ = await selectMarker()
        let untouched = await settle(1) { pasteboard.string(forType: .string) != nil }
        expect(!untouched, "preferences: with copy on select off, a selection leaves the pasteboard alone")

        controller.view.removeFromSuperview()
        view.session?.enqueue { $0.shutdown() }
        _ = await until(2) { false }
    }
}
