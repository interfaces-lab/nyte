import AppKit
import NyteCore
import NyteDebug
import NyteUI

struct ToolFinding: Sendable, Equatable {
    let id: String
    let title: String
    let path: URL?
    let version: String?
    let problem: String?
    var source: ToolSource?
    var install: ToolInstall?
}

enum ToolProbe {
    private static let versionTimeout: Duration = .seconds(5)
    static let debuggerKeys: [DebugTool: String] = [.delve: "dlv", .jsDebug: "js-debug", .node: "node"]

    @MainActor
    static func findAll(in folder: URL, debugSettings: DebugSettings) async -> [ToolFinding] {
        let toolchain = Toolchain(workspace: folder)
        var findings = await servers(toolchain)
        let debugger = Debugger(workspace: Workspace(root: folder), toolchain: toolchain, settings: debugSettings)
        for status in await debugger.toolStatus() {
            findings.append(ToolFinding(id: debuggerKeys[status.tool] ?? status.tool.rawValue, title: status.tool.title, path: status.path,
                                        version: status.version, problem: status.problem, source: status.source, install: status.install))
        }
        return findings
    }

    private static func servers(_ toolchain: Toolchain) async -> [ToolFinding] {
        let environment = await toolchain.environment()
        var findings: [ToolFinding] = []
        let tools: [(String, String, [String], InstallableTool?)] = [
            ("gopls", "gopls", ["version"], .gopls), ("typescript-language-server", "tsserver", ["--version"], nil),
        ]
        for (id, title, arguments, installable) in tools {
            let resolved = await toolchain.resolve(id)
            var version: String?
            if let path = resolved?.url { version = await Self.version(of: path, arguments: arguments, environment: environment) }
            let install = resolved == nil || resolved?.source == .bundled ? await installable.asyncMap { await toolchain.install($0) } ?? nil : nil
            findings.append(ToolFinding(id: id, title: title, path: resolved?.url, version: version, problem: nil, source: resolved?.source,
                                        install: install))
        }
        return findings
    }

    private static func version(of program: URL, arguments: [String], environment: [String: String]) async -> String? {
        let launch = ChildProcess.Launch(executable: program, arguments: arguments, environment: environment)
        guard let result = await ChildProcess.run(launch, timeout: versionTimeout), result.status == 0 else { return nil }
        let text = String(decoding: result.output, as: UTF8.self)
        let words = text.split(whereSeparator: \.isWhitespace).map(String.init)
        let numbered = words.first { $0.first == "v" && $0.dropFirst().first?.isNumber == true }
            ?? words.first { $0.first?.isNumber == true }
        return numbered.map { $0.hasPrefix("v") ? String($0.dropFirst()) : $0 }
    }
}

extension Optional {
    func asyncMap<Mapped>(_ transform: (Wrapped) async -> Mapped) async -> Mapped? {
        guard let self else { return nil }
        return await transform(self)
    }
}

@MainActor
enum ToolsPane {
    static let ceilings = [2_048, 3_072, 4_096, 8_192]

    private static let serverPaths: [String: WritableKeyPath<LanguageSettings, String?>] = [
        "gopls": \.go.serverPath, "typescript-language-server": \.typeScript.languageServerPath,
    ]

    static func languages(_ center: PreferencesCenter, findings: [ToolFinding]?, folder: URL?) -> SettingsForm {
        let form = SettingsForm()
        let typeScript = center.value.language.typeScript
        form.heading("Go")
        server("gopls", center, findings, form)
        form.row("Restart above", [ceiling("Go", center.value.language.go.memoryCeilingMegabytes) { value in
            center.update { $0.language.go.memoryCeilingMegabytes = value }
        }])
        form.heading("TypeScript")
        let servers = LanguageSettings.TypeScriptServer.allCases
        form.row("Server", [SettingsForm.picker("TypeScript server", servers.map { (TypeScriptServerTitle.words($0), $0) },
                                                selected: typeScript.server) { choice in
            center.update { $0.language.typeScript.server = choice }
        }])
        if let folder {
            let path = folder.standardizedFileURL.path
            form.row("", [SettingsForm.checkbox("Use tsserver (Node) for \(folder.lastPathComponent)",
                                                center.value.language.typeScript.tsserverWorkspaces.contains(path)) { on in
                center.update { $0.language = $0.language.choosingTSServer(on, in: folder) }
            }])
        }
        server("typescript-language-server", center, findings, form)
        form.row("Native server", [field(typeScript.nativeServerPath, placeholder: "Path override") { text in
            center.update { $0.language.typeScript.nativeServerPath = text }
        }])
        form.row("Restart above", [ceiling("TypeScript", typeScript.memoryCeilingMegabytes) { value in
            center.update { $0.language.typeScript.memoryCeilingMegabytes = value }
        }])
        EditorPane.hintRows(form, center)
        return form
    }

    static func debugger(_ center: PreferencesCenter, findings: [ToolFinding]?) -> SettingsForm {
        let form = SettingsForm()
        form.heading("Adapters")
        for finding in (findings ?? []).filter({ serverPaths[$0.id] == nil }) {
            form.row(finding.title, [field(center.value.tools.debuggerPaths[finding.id]) { text in
                center.update { $0.tools.debuggerPaths[finding.id] = text }
            }])
            form.note(words(finding))
        }
        if findings == nil { form.footnote("Looking for debuggers\u{2026}") }
        form.footnote("A path here replaces the one Nyte found. Leave it empty to use the found one.")
        return form
    }

    static func tools(findings: [ToolFinding]?, onInstall: @escaping (ToolInstall) -> Void) -> SettingsForm {
        let form = SettingsForm()
        form.heading("Found on this Mac")
        for finding in findings ?? [] {
            let install = finding.install.map { install in Button("Install", variant: .outline, size: .sm) { onInstall(install) } }
            form.row(finding.title, [install].compactMap(\.self))
            form.note(words(finding))
        }
        if findings == nil { form.footnote("Looking for tools\u{2026}") }
        form.footnote("Each tool is looked for in this project, your PATH and package managers\u{2019} folders before Nyte IDE\u{2019}s own copy.")
        return form
    }

    private static func server(_ id: String, _ center: PreferencesCenter, _ findings: [ToolFinding]?, _ form: SettingsForm) {
        guard let path = serverPaths[id] else { return }
        let finding = findings?.first { $0.id == id }
        form.row(finding?.title ?? id, [field(center.value.language[keyPath: path]) { text in center.update { $0.language[keyPath: path] = text } }])
        if let finding { form.note(words(finding)) }
    }

    private static func words(_ finding: ToolFinding) -> String {
        guard let path = finding.path else { return finding.problem ?? "Not found" }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let shown = path.path.hasPrefix(home) ? "~" + path.path.dropFirst(home.count) : path.path
        let version = finding.version.map { "Version \($0)" }
        let place = finding.source.map { "from \($0.words)" }
        return [version, place].compactMap(\.self).joined(separator: ", ") + (version == nil && place == nil ? "" : ": ") + shown
    }

    private static func field(_ value: String?, placeholder: String = "Path override", _ change: @escaping (String?) -> Void) -> Input {
        let input = Input(value ?? "", placeholder: placeholder, size: .sm)
        input.onEndEditing = { text in change(text.isEmpty ? nil : text) }
        input.widthAnchor.constraint(equalToConstant: EditorPane.fieldWidth).isActive = true
        return input
    }

    private static func ceiling(_ language: String, _ selected: Int, _ choose: @escaping (Int) -> Void) -> NSView {
        SettingsForm.picker("\(language) memory ceiling", ceilings.map { value in
            ("\(language): " + ByteCountFormatter.string(fromByteCount: Int64(value) * Int64(LanguageSettings.megabyte), countStyle: .memory), value)
        }, selected: selected, choose)
    }
}

@MainActor
final class KeysPane {
    static let listHeight: CGFloat = 360
    static let width: CGFloat = 520

    private let search = SearchField(placeholder: "Search commands", size: .md)
    private let list = ListView()
    private var shown: [Command] = Commands.all

    func build() -> NSView {
        let root = FlippedView()
        list.rowHeight = Metric.rowCompact
        list.rowCount = { [unowned self] in shown.count }
        list.content = { [unowned self] row in
            let command = shown[row]
            var content = RowContent(title: command.title, detail: command.menu.title, meta: command.key?.display ?? "")
            content.emphasizeMatches(of: search.stringValue)
            return content
        }
        list.setAccessibilityLabel("Keyboard shortcuts")
        search.onChange = { [unowned self] query in filter(query) }
        for view in [search, list] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(view)
        }
        NSLayoutConstraint.activate([
            search.topAnchor.constraint(equalTo: root.topAnchor, constant: SettingsForm.inset),
            search.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: SettingsForm.inset),
            search.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -SettingsForm.inset),
            list.topAnchor.constraint(equalTo: search.bottomAnchor, constant: Space.x3),
            list.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: SettingsForm.inset),
            list.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -SettingsForm.inset),
            list.heightAnchor.constraint(equalToConstant: Self.listHeight),
            list.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -SettingsForm.inset),
            root.widthAnchor.constraint(equalToConstant: Self.width),
        ])
        list.reload()
        return root
    }

    private func filter(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        shown = trimmed.isEmpty ? Commands.all : Commands.all.compactMap { command in
            FuzzyMatch.score(trimmed, in: command.title).map { (command: command, score: $0) }
        }.sorted { $0.score > $1.score }.map(\.command)
        list.reload()
    }
}

@MainActor
enum TypeScriptServerTitle {
    static func words(_ server: LanguageSettings.TypeScriptServer) -> String {
        switch server {
        case .automatic: "Native (TypeScript 7)"
        case .tsserver: "tsserver (Node)"
        }
    }
}
