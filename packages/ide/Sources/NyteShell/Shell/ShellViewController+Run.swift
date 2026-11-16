import AppKit
import NyteCore
import NyteDebug
import NyteTerminal
import NyteUI

extension ShellViewController {
    var runTarget: DebugTarget? {
        runTargets.first { $0.id == memory.state.runTarget } ?? runTargets.first
    }

    func refreshRunTargets() {
        let file = editor.selectedURL
        runTargetsFile = file
        Task {
            let found = await services.debugger.targets(near: file)
            guard runTargetsFile == file else { return }
            runTargets = found
            showRunTarget()
            refreshToolbar()
        }
    }

    func runTargetMenu() -> NSMenu {
        let chosen = runTarget?.id
        let item = { [weak self] (target: DebugTarget) in
            MenuItem(target.name, checked: target.id == chosen, subtitle: self?.subtitle(for: target) ?? "") { self?.choose(target) }
        }
        let saved = runTargets.filter { $0.id.hasPrefix(Self.savedPrefix) }
        let detected = runTargets.filter { !$0.id.hasPrefix(Self.savedPrefix) }
        var items: [MenuItem] = []
        if !saved.isEmpty { items += [.header("Saved")] + saved.map(item) }
        if !detected.isEmpty { items += [.header("Detected")] + detected.map(item) }
        if items.isEmpty { items = [MenuItem("No run targets in this folder", enabled: false)] }
        items += [.separator, MenuItem("Edit Configurations…") { [weak self] in self?.editConfigurations() }]
        return Menu.make(items)
    }

    static let savedPrefix = "config:"

    private func editConfigurations() {
        let file = workspace.root.appendingPathComponent(".nyte/run-configurations.json")
        let debugger = services.debugger
        let workspace = workspace
        let seed = runTarget
        Task {
            if !FileManager.default.fileExists(atPath: file.path), let seed {
                try? await debugger.saveRunConfigurations([RunConfiguration(target: seed, in: workspace)])
            }
            guard FileManager.default.fileExists(atPath: file.path) else { return }
            editor.open(file, preview: false)
            editor.focus()
        }
    }

    private func subtitle(for target: DebugTarget) -> String {
        switch target.kind {
        case .goPackage: "Go package"
        case let .goTest(_, test): test.map { "Go test \($0)" } ?? "Go tests"
        case .node: "Node"
        }
    }

    private func choose(_ target: DebugTarget) {
        memory.update { $0.runTarget = target.id }
        showRunTarget()
        refreshToolbar()
    }

    func showRunTarget() {
        if case let .starting(target) = services.debugger.state { return windowToolbar.show(target: Self.startingWords(target)) }
        windowToolbar.show(target: runTarget?.name)
    }

    static func startingWords(_ target: DebugTarget) -> String {
        switch target.kind {
        case .goPackage: "Building…"
        case .goTest: "Building tests…"
        case .node: "Starting…"
        }
    }

    func startOrContinue() {
        guard !isPaused else {
            Task { await services.debugger.resume() }
            return
        }
        start(debugging: true)
    }

    func start(debugging: Bool) {
        guard let target = runTarget else { return }
        start(target, debugging: debugging)
    }

    func start(_ target: DebugTarget, debugging: Bool) {
        startedTarget = target.name
        Task { await services.debugger.start(target, debugging: debugging) }
    }
}

extension ShellViewController {
    func runInTerminal(_ target: DebugTarget) {
        runInTerminal(Self.command(for: target), directory: target.directory, title: target.name)
    }

    func runInTerminal(_ command: [String], directory: URL, title: String) {
        if dock.contains(.run) { dock.close(.run) }
        let controller = TerminalViewController(workspace: workspace, directory: directory, command: command,
                                                preferences: terminal.preferences)
        wireTerminal(controller)
        controller.onTitleChange = { [weak self] title in self?.dock.update(.run, toolTip: title) }
        dock.add(ToolWindow(id: .run, title: title, toolTip: controller.paneTitle, isClosable: true, controller: controller))
        showToolWindow(.run)
        controller.focusTerminal()
    }

    static func command(for target: DebugTarget) -> [String] {
        switch target.kind {
        case let .goPackage(folder): ["go", "run", folder.path] + target.arguments
        case let .goTest(folder, test): ["go", "test", folder.path] + (test.map { ["-run", "^\($0)$"] } ?? []) + target.arguments
        case let .node(script): ["node"] + target.runtimeArguments + [script.path] + target.arguments
        }
    }

    func findUsages(at place: FileLocation?) {
        guard let url = place?.url ?? editor.selectedURL else { return }
        let position = place?.range.start ?? lastPosition.map { TextPosition(line: $0.line - 1, column: $0.column - 1) }
        guard let position else { return editor.perform(.findUsages) }
        let name = place == nil ? wordAtCaret() : nil
        let language = services.language
        Task {
            let usages = await language.classifiedReferences(at: position, in: url)
            guard !usages.isEmpty else { return editor.perform(.findUsages) }
            let title = name.map { "Usages of \($0)" } ?? "Usages"
            showFind(title)
            findResults.show(usages: usages, title: title)
        }
    }
}
