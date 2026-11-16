import AppKit
import NyteDebug
import NyteEditor

extension ShellViewController: NSMenuItemValidation, NSToolbarItemValidation {
    @objc func runCommand(_ sender: Any?) {
        guard let id = CommandID(sender: sender) else { return }
        run(id, from: sender)
    }

    func run(_ id: CommandID, from sender: Any?) {
        guard let command = Commands.command(id), canRun(command) else { return NSSound.beep() }
        if let selector = command.selector {
            let item = NSMenuItem(title: command.title, action: selector, keyEquivalent: "")
            item.tag = command.tag
            NSApp.sendAction(selector, to: target(for: selector), from: item)
            return
        }
        switch command.needs {
        case .editor(.findUsages):
            return findUsages(at: nil)
        case let .editor(editorCommand):
            return editor.perform(editorCommand)
        default:
            break
        }
        perform(id, from: sender)
    }

    private func perform(_ id: CommandID, from sender: Any?) {
        let animated = sender is NSToolbarItem ? sender : nil
        switch id {
        case .openQuickly: view.window.map { palettes.show(.files, in: $0) }
        case .commandPalette: view.window.map { palettes.show(.all, in: $0) }
        case .goToSymbol: view.window.map { palettes.show(.symbols, in: $0) }
        case .save: editor.saveSelected()
        case .saveAll: saveAllFiles()
        case .revertToSaved: revertSelected()
        case .closeTab: closeSelectedTab()
        case .closeOtherTabs: closeOtherTabs()
        case .closeTabsToRight: editor.selectedIndex.map(closeTabs(rightOf:))
        case .reopenClosedTab: reopenClosedTab()
        case .recentFiles: view.window.map { palettes.showRecent(in: $0) }
        case .findInFiles: findInFiles()
        case .toggleSidebar: setSidebar(open: sidebarItem.isCollapsed, from: animated)
        case .toggleBottomPanel: setDock(open: dockItem.isCollapsed, from: animated)
        case .toggleAgent: toggleAgent(from: animated)
        case .focusReview: toggleFocusReview()
        case .showTerminal: toggleTerminal()
        case .showProblems: showToolWindow(.problems)
        case .newSession:
            setAgent(open: true, from: nil)
            agent.newSession()
            agent.focusComposer()
        case .askNyte: askNyte()
        case .back: editor.goBack()
        case .forward: editor.goForward()
        case .nextTab: stepTab(by: 1)
        case .previousTab: stepTab(by: -1)
        case .startDebugging: startOrContinue()
        case .runWithoutDebugging: start(debugging: false)
        case .runInTerminal: runTarget.map(runInTerminal)
        case .stop: Task { await services.debugger.stop() }
        case .restart: Task { await services.debugger.restart() }
        case .stepOver: Task { await services.debugger.stepOver() }
        case .stepInto: Task { await services.debugger.stepInto() }
        case .stepOut: Task { await services.debugger.stepOut() }
        case .viewBreakpoints: showBreakpoints()
        default: break
        }
    }

    private func toggleAgent(from sender: Any?) {
        guard agentItem.isCollapsed else { return setAgent(open: false, from: sender) }
        setAgent(open: true, from: sender)
        if let waiting = agent.waitingSessions.min(by: { $0.since < $1.since }) { agent.openSession(waiting.id) }
        agent.focusComposer()
    }

    private func toggleTerminal() {
        let focused = (view.window?.firstResponder as? NSView)?.isDescendant(of: terminal.view) ?? false
        switch TerminalKey.decide(isDockOpen: !dockItem.isCollapsed, selected: dock.selected, isTerminalFocused: focused) {
        case .hide:
            setDock(open: false, from: nil)
            view.window?.makeFirstResponder(editor.view)
        case .show:
            showToolWindow(.terminal)
            terminal.focusTerminal()
        }
    }

    private func stepTab(by delta: Int) {
        guard let index = editor.selectedIndex, editor.tabs.count > 1 else { return }
        editor.select(at: (index + delta + editor.tabs.count) % editor.tabs.count)
    }

    func canRun(_ command: Command) -> Bool {
        if let selector = command.selector { return canSend(selector, tag: command.tag) }
        return switch command.needs {
        case .nothing, .workspace: true
        case .file: editor.selectedIndex != nil || editorPane.shownDocument != nil
        case .unsavedFile: editor.selectedIndex.map { editor.tabs[$0].isDirty } ?? false
        case .unsavedFiles: editor.hasUnsavedChanges
        case .tabs: editor.tabs.count > 1
        case .tabsToRight: editor.selectedIndex.map { $0 < editor.tabs.count - 1 } ?? false
        case .closedTab: !closedTabs.isEmpty
        case .review: isReviewShown
        case let .editor(editorCommand): editor.canPerform(editorCommand)
        case .back: editor.canGoBack
        case .forward: editor.canGoForward
        case .language: !services.language.statuses.isEmpty
        case .target: runTarget != nil || isPaused
        case .session: isSessionActive
        case .paused: isPaused
        case .problems: dock.contains(.problems)
        }
    }

    private func target(for selector: Selector) -> AnyObject? {
        var responder = view.window?.firstResponder
        while let current = responder {
            if current.responds(to: selector) { return current }
            responder = current.nextResponder
        }
        let fallbacks: [AnyObject?] = [view.window, view.window?.delegate, NSApp, NSApp.delegate]
        return fallbacks.compactMap(\.self).first { $0.responds(to: selector) }
    }

    private func canSend(_ selector: Selector, tag: Int) -> Bool { probe(selector, tag: tag, title: "").enabled }

    private func probe(_ selector: Selector, tag: Int, title: String) -> (enabled: Bool, title: String) {
        guard let target = target(for: selector) else { return (false, title) }
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        item.tag = tag
        if let validator = target as? NSMenuItemValidation { return (validator.validateMenuItem(item), item.title) }
        if let validator = target as? NSUserInterfaceValidations { return (validator.validateUserInterfaceItem(item), item.title) }
        return (true, item.title)
    }

    func title(for command: Command) -> String {
        switch command.id {
        case .toggleSidebar: sidebarItem.isCollapsed ? "Show Sidebar" : "Hide Sidebar"
        case .toggleBottomPanel: dockItem.isCollapsed ? "Show Bottom Panel" : "Hide Bottom Panel"
        case .toggleAgent: agentItem.isCollapsed ? "Show Agent" : "Hide Agent"
        case .focusReview: if case .focused = reviewLayout { "Exit Focus Review" } else { "Focus Review" }
        case .startDebugging: isPaused ? "Continue" : "Start Debugging"
        case .fullScreen: view.window?.styleMask.contains(.fullScreen) == true ? "Exit Full Screen" : "Enter Full Screen"
        default: command.selector.map { probe($0, tag: command.tag, title: command.title).title } ?? command.title
        }
    }

    var isPaused: Bool {
        if case .paused = services.debugger.state { return true }
        return false
    }

    var isSessionActive: Bool {
        switch services.debugger.state {
        case .starting, .running, .paused: true
        case .idle, .ended, .failed: false
        }
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard let id = CommandID(sender: item), let command = Commands.command(id) else { return true }
        item.title = title(for: command)
        if let key = command.key, KeyRouting.owner(of: key, focus: keyFocus) == .terminal { return false }
        return canRun(command)
    }

    var keyFocus: KeyRouting.Focus {
        guard let focused = view.window?.firstResponder as? NSView else { return .other }
        let terminals = [terminal.view] + [dock.controller(.folderTerminal)?.view, dock.controller(.run)?.view].compactMap(\.self)
        return terminals.contains { focused.isDescendant(of: $0) } ? .terminal : .other
    }

    func validateToolbarItem(_ item: NSToolbarItem) -> Bool {
        guard let id = CommandID(sender: item), let command = Commands.command(id) else { return true }
        let title = title(for: command)
        switch id {
        case .startDebugging: windowToolbar.retitle(id, title: title, label: isPaused ? "Continue" : "Debug",
                                                      symbol: isPaused ? "forward.end" : "ladybug")
        default: windowToolbar.retitle(id, title: title)
        }
        return canRun(command)
    }
}
