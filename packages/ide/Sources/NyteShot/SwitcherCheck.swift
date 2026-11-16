import AppKit
@testable import NyteShell

@MainActor
enum SwitcherCheck {
    typealias Step = (type: NSEvent.EventType, modifiers: NSEvent.ModifierFlags, character: String?)

    static let sequences: [(name: String, armed: Bool, steps: [Step], expected: [SwitcherKey])] = [
        ("⌃Tab ⌃Tab release", true, [(.keyDown, .control, "\t"), (.keyDown, .control, "\t"), (.flagsChanged, [], nil)], [.next, .next, .commit]),
        ("⌃⇧Tab then release", true, [(.keyDown, [.control, .shift], "\t"), (.flagsChanged, [], nil)], [.previous, .commit]),
        ("shift pressed while Control is held", true, [(.flagsChanged, [.control, .shift], nil)], [.pass]),
        ("opened without Control", false, [(.flagsChanged, [], nil), (.flagsChanged, .shift, nil)], [.pass, .pass]),
        ("typing a filter", true, [(.keyDown, [], "h"), (.keyDown, .shift, "H")], [.pass, .pass]),
        ("Return and Escape go to the panel", true, [(.keyDown, [], "\r"), (.keyDown, [], "\u{1B}")], [.pass, .pass]),
    ]

    static var checks: Int { sequences.count + 3 }

    static func run(_ shell: ShellViewController) async -> [String] {
        var failures = sequences.compactMap { item -> String? in
            let decided = item.steps.map { SwitcherKey.decide($0.type, modifiers: $0.modifiers, character: $0.character, isArmed: item.armed) }
            return decided == item.expected ? nil : "\(item.name) decided \(decided)"
        }
        guard let window = shell.view.window, shell.editor.tabs.count >= 2, let start = shell.editor.selectedURL else {
            return failures + ["the switcher needs two open tabs"]
        }
        let previous = shell.recentTabs.dropFirst().first
        shell.palettes.showRecent(in: window, holdingControl: true)
        await Wait.pause(.milliseconds(300))
        if !shell.palettes.recent.isShown { failures.append("⌃Tab did not show the switcher") }
        let tab = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .control, timestamp: 0, windowNumber: 0, context: nil,
                                   characters: "\t", charactersIgnoringModifiers: "\t", isARepeat: false, keyCode: 48)
        let release = NSEvent.keyEvent(with: .flagsChanged, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
                                       characters: "", charactersIgnoringModifiers: "", isARepeat: false, keyCode: 59)
        if let tab, shell.palettes.handleSwitcher(tab) != nil { failures.append("⌃Tab inside the switcher was not consumed") }
        if let tab { _ = shell.palettes.handleSwitcher(tab) }
        if let release { _ = shell.palettes.handleSwitcher(release) }
        await Wait.pause(.milliseconds(300))
        if shell.palettes.recent.isShown { failures.append("releasing Control left the switcher up") }
        if shell.editor.selectedURL == start || shell.editor.selectedURL != previous {
            failures.append("releasing Control opened \(shell.editor.selectedURL?.lastPathComponent ?? "nothing"), not the previous file")
        }
        return failures
    }
}

@MainActor
enum WiringCheck {
    static let checks = 4

    static func run(_ shell: ShellViewController) async -> [String] {
        var failures: [String] = []
        let folder = shell.workspace.root.appendingPathComponent("hub")
        shell.navigator.onFindInFolder?(folder)
        if shell.dock.selected != .search { failures.append("Find in Folder did not show Find in Files") }
        shell.setAgent(open: false, from: nil)
        let file = shell.workspace.root.appendingPathComponent("main.go")
        shell.navigator.onAskAgent?([file])
        if !(ContextCheck.draft(of: shell.agent)?.contains(.file(file)) ?? false) { failures.append("Ask Nyte About… from the navigator lost the file") }
        shell.runInTerminal(["echo", "run in terminal"], directory: shell.workspace.root, title: "echo")
        if shell.dock.selected != .run { failures.append("Run in Terminal did not show its terminal") }
        shell.dock.close(.run)
        _ = await Wait.until(.seconds(10)) { !(shell.changes?.changedFiles.searchable.isEmpty ?? true) }
        if shell.changedFiles != shell.changes?.changedFiles.searchable { failures.append("search's changed files differ from the Changes list") }
        return failures
    }
}
