import Foundation
import NyteCore
import os

@MainActor
public final class LanguageService: LanguageIntelligence {
    public struct RestartLimit: Sendable {
        public enum Verdict: Sendable, Equatable { case restart, giveUp }

        public let restarts: Int
        public let window: Duration

        public func verdict(after earlier: [ContinuousClock.Instant], at now: ContinuousClock.Instant) -> Verdict {
            earlier.filter { now - $0 <= window }.count < restarts ? .restart : .giveUp
        }

        var sentence: String {
            "stopped \(restarts + 1) times in \(window.components.seconds / 60) minutes."
        }
    }

    public static let restartLimit = RestartLimit(restarts: 3, window: .seconds(180))
    public static let startDeadline: Duration = .seconds(30)

    public var onEvent: ((IntelligenceEvent) -> Void)?
    public var applyEdit: ((WorkspaceEdit) async -> Bool)?

    let workspace: Workspace
    let toolchain: Toolchain

    struct Server {
        var spec: Int
        var root: URL
        var name: String
        var plan: ServerPlan?
        var connection: ServerConnection?
        var capabilities = Capabilities()
        var state = ServerStatus.State.starting
        var restarts: [ContinuousClock.Instant] = []
        var progress: [(token: String, title: String, percent: Int?)] = []
        var stopping = false
        var seen: Set<URL> = []
        var residentBytes: Int?
        var watchers: [String: [FileWatcher]] = [:]
        var install: ToolInstall?
        var environment: [String: String]?
    }

    struct OpenDocument {
        var url: URL
        var language: String
        var version: Int
        var text: String
        var server: Int
    }

    var servers: [Server] = []
    var documents: [OpenDocument] = []
    var problems: [URL: [Diagnostic]] = [:]
    var logs: [String: [Substring]] = [:]

    var completionRaw = (server: -1, generation: UInt32(0), items: [JSON](), defaults: JSON.null)
    var actionRaw = (server: -1, generation: UInt32(0), plans: [ActionPlan](), items: [JSON]())
    var completionInFlight: [URL: (connection: ServerConnection, id: Int)] = [:]
    var pulls: [URL: Task<Void, Never>] = [:]
    var pullResults: [URL: String] = [:]
    var outlines: [URL: (version: Int, symbols: [DocumentSymbol])] = [:]
    var marks: [URL: (version: Int, marks: [RunMark])] = [:]
    var counted: [URL: (version: Int, counts: [TextSpan: UsageCount])] = [:]
    var searchGeneration = 0
    var searching: Task<Void, Never>?
    var foregroundEpoch: [Int: Int] = [:]
    var background: [Int32: Int] = [:]
    var externalStream: FileEventStream?
    var externalRoots: [String] = []
    var captures: [URL: [TextEdit]] = [:]
    var saving: [URL: Int] = [:]
    var sentOwnText: Set<URL> = []
    var sampling: Task<Void, Never>?
    var toldEnvironmentProblem = false

    static let logLines = 400
    static let shutdownGrace: Duration = .seconds(3)

    public var settings: LanguageSettings {
        didSet { if settings != oldValue { apply(settings, replacing: oldValue) } }
    }

    public init(workspace: Workspace, toolchain: Toolchain, settings: LanguageSettings = LanguageSettings()) {
        self.workspace = workspace
        self.toolchain = toolchain
        self.settings = settings
    }

    public var statuses: [ServerStatus] {
        servers.indices.map(status(of:))
    }

    func status(of index: Int) -> ServerStatus {
        let server = servers[index]
        let spec = ServerTable.all[server.spec]
        let reported = [server.capabilities.serverName, server.capabilities.serverVersion].filter { !$0.isEmpty }.joined(separator: " ")
        let version: String = switch server.plan?.name {
        case "typescript-language-server"?: [reported, server.plan.map { "TypeScript \($0.version)" } ?? ""].filter { !$0.isEmpty }
            .joined(separator: ", ")
        case "TypeScript"?: ["TypeScript", server.plan?.version ?? ""].filter { !$0.isEmpty }.joined(separator: " ") + ", native"
        default: server.capabilities.serverVersion
        }
        var status = ServerStatus(
            id: index, name: server.name, shortName: server.plan?.shortName ?? spec.name, state: server.state, version: version,
            location: server.plan?.executable,
            root: server.root, residentBytes: server.residentBytes, memoryCeiling: ServerTable.memoryCeiling(of: spec, settings)
        )
        status.source = server.plan?.source
        status.note = server.plan?.note
        status.install = server.install
        if spec.name == ServerTable.typescript.name, settings.typeScript.server == .automatic {
            status.offer = settings.usesTSServer(in: workspace.root) ? .useNative : .useTSServer
        }
        return status
    }

    public func log(for name: String) -> String {
        (logs[name] ?? []).joined(separator: "\n")
    }

    public func handles(_ url: URL) -> Bool {
        ServerTable.all.contains { $0.languageId(for: url) != nil }
    }

    public func status(for url: URL) -> ServerStatus? {
        guard let server = server(for: Wire.canonical(url)) else { return nil }
        return status(of: server)
    }

    public func triggers(for url: URL) -> (completion: Set<String>, signature: Set<String>) {
        guard let server = server(for: Wire.canonical(url)) else { return ([], []) }
        return (servers[server].capabilities.completionTriggers, servers[server].capabilities.signatureTriggers)
    }

    public func diagnostics(for url: URL) -> [Diagnostic] { problems[Wire.canonical(url)] ?? [] }

    public var filesWithDiagnostics: [URL] { problems.filter { !$0.value.isEmpty }.keys.sorted { $0.path < $1.path } }

    public func open(_ url: URL, text: String) {
        let url = Wire.canonical(url)
        guard document(at: url) == nil,
              let spec = ServerTable.all.firstIndex(where: { $0.languageId(for: url) != nil }),
              let language = ServerTable.all[spec].languageId(for: url)
        else { return }
        let root = ServerTable.all[spec].root(for: url, in: workspace)
        let server = servers.firstIndex { $0.spec == spec && $0.root == root } ?? {
            servers.append(Server(spec: spec, root: root, name: ServerTable.all[spec].name))
            let index = servers.count - 1
            Task { await self.launch(index) }
            return index
        }()
        documents.append(OpenDocument(url: url, language: language, version: 1, text: text, server: server))
        servers[server].seen.insert(url)
        if let connection = servers[server].connection {
            sendOpen(documents[documents.count - 1], to: connection)
            return pullDiagnostics(url, after: .zero)
        }
        relaunchIfStopped(server)
    }

    public func filesDidChange(_ urls: [URL]) {
        for index in servers.indices {
            guard let connection = servers[index].connection else { continue }
            let watchers = servers[index].watchers.values.flatMap { $0 }
            let prefix = servers[index].root.path + "/"
            let changes: [JSON] = urls.map(Wire.canonical).compactMap { url in
                let exists = FileManager.default.fileExists(atPath: url.path)
                let kind: FileWatcher.Kinds = !exists ? .deleted : (servers[index].seen.contains(url) ? .changed : .created)
                let wanted = watchers.isEmpty ? url.path.hasPrefix(prefix) : watchers.contains { $0.matches(url, kind: kind) }
                guard wanted else { return nil }
                if exists { servers[index].seen.insert(url) } else { servers[index].seen.remove(url) }
                let type = kind == .created ? 1 : (kind == .changed ? 2 : 3)
                return ["uri": Wire.uri(url), "type": .number(Double(type))]
            }
            guard !changes.isEmpty else { continue }
            connection.enqueue(.notify(ClientFeature.didChangeWatchedFiles.method, ["changes": .array(changes)]))
        }
    }

    public func change(_ url: URL, range: TextSpan, text: String) {
        guard let index = document(at: Wire.canonical(url)) else { return }
        documents[index].text = Self.replacing(range, with: text, in: documents[index].text)
        let document = documents[index]
        if saving.removeValue(forKey: document.url) != nil, sentOwnText.remove(document.url) != nil {
            sendWholeText(index)
            return documentDidChange(documents[index])
        }
        documents[index].version += 1
        servers[document.server].connection?.enqueue(.notify("textDocument/didChange", [
            "textDocument": ["uri": Wire.uri(document.url), "version": .number(Double(documents[index].version))],
            "contentChanges": [["range": Wire.range(range), "text": .string(text)]],
        ]))
        documentDidChange(documents[index])
    }

    public func save(_ url: URL) {
        guard let index = document(at: Wire.canonical(url)) else { return }
        let document = documents[index]
        servers[document.server].connection?.enqueue(.notify("textDocument/didSave", ["textDocument": Wire.document(document.url)]))
    }

    public func close(_ url: URL) {
        guard let index = document(at: Wire.canonical(url)) else { return }
        let document = documents.remove(at: index)
        servers[document.server].connection?.enqueue(.notify("textDocument/didClose", ["textDocument": Wire.document(document.url)]))
        pulls.removeValue(forKey: document.url)?.cancel()
        pullResults[document.url] = nil
        outlines[document.url] = nil
        marks[document.url] = nil
        counted[document.url] = nil
    }

    public func openText(of url: URL) -> String? {
        text(of: Wire.canonical(url))
    }

    func document(at url: URL) -> Int? {
        documents.firstIndex { $0.url == url }
    }

    func sendOpen(_ document: OpenDocument, to connection: ServerConnection) {
        connection.enqueue(.notify("textDocument/didOpen", ["textDocument": [
            "uri": Wire.uri(document.url), "languageId": .string(document.language),
            "version": .number(Double(document.version)), "text": .string(document.text),
        ]]))
    }

    func server(for url: URL) -> Int? {
        if let index = document(at: url) { return documents[index].server }
        guard let spec = ServerTable.all.firstIndex(where: { $0.languageId(for: url) != nil }) else { return nil }
        let root = ServerTable.all[spec].root(for: url, in: workspace)
        return servers.firstIndex { $0.spec == spec && $0.root == root }
    }

    func text(of url: URL) -> String? {
        document(at: url).map { documents[$0].text }
    }

    private func relaunchIfStopped(_ index: Int) {
        switch servers[index].state {
        case .missing, .failed:
            guard servers[index].connection == nil else { return }
            servers[index].restarts = []
            setState(index, .starting)
            Task { await self.launch(index) }
        case .starting, .ready, .busy:
            break
        }
    }

    func launch(_ index: Int) async {
        let spec = ServerTable.all[servers[index].spec]
        let root = servers[index].root
        let plan: ServerPlan
        let reading = await toolchain.reading()
        if let problem = reading.problem, !toldEnvironmentProblem {
            toldEnvironmentProblem = true
            onEvent?(.notice(problem, .warning))
        }
        switch await spec.plan(PlanRequest(root: root, workspace: workspace.root, toolchain: toolchain, settings: settings)) {
        case let .success(found): plan = found
        case let .failure(.missing(hint, install)):
            Logger.language.error("locate \(spec.name, privacy: .public) failed: not on PATH or in the managed tools")
            servers[index].install = install
            return setState(index, .missing(hint: hint))
        case let .failure(.failed(sentence)):
            Logger.language.error("prepare \(spec.name, privacy: .public) failed: \(sentence, privacy: .public)")
            return setState(index, .failed(sentence))
        }
        servers[index].plan = plan
        servers[index].name = plan.name
        servers[index].install = plan.install
        let environment = reading.values
        servers[index].environment = environment
        let connection: ServerConnection
        do {
            connection = try ServerConnection(
                name: plan.name,
                launch: .init(executable: plan.executable, arguments: plan.arguments, environment: environment, directory: root)
            )
        } catch {
            Logger.language.error("start \(plan.executable.path, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            return setState(index, .failed("\(plan.name) could not start: \(error.localizedDescription)"))
        }
        servers[index].connection = connection
        servers[index].progress = []
        for document in documents where document.server == index { sendOpen(document, to: connection) }
        let signals = connection.signals
        Task { [weak self] in
            for await signal in signals { self?.handle(signal, from: index, connection: connection) }
        }
        startSampling()
        let started = await connection.start(initialize: initializeParameters(plan.options, root: root), deadline: Self.startDeadline)
        guard servers[index].connection === connection else { return }
        switch started {
        case let .success(capabilities):
            servers[index].capabilities = capabilities
            connection.enqueue(.notify(ClientFeature.didChangeConfiguration.method, ["settings": plan.settings]))
            setState(index, progressState(index))
            for document in documents where document.server == index { pullDiagnostics(document.url, after: .zero) }
        case let .failure(failure):
            Logger.language.error("initialize \(plan.name, privacy: .public) failed: \(failure.message, privacy: .public)")
            appendLog(plan.name, "Nyte IDE: initialize failed: \(failure.message)\n")
            servers[index].connection = nil
            await connection.terminate()
            let sentence = failure == .startTimedOut(plan.name, after: Self.startDeadline)
                ? failure.message : "\(plan.name) could not start: \(failure.message)"
            setState(index, .failed(sentence))
        }
    }

    public func shutdown() async {
        externalStream = nil
        externalRoots = []
        sampling?.cancel()
        sampling = nil
        for task in pulls.values { task.cancel() }
        pulls = [:]
        for index in servers.indices { servers[index].stopping = true }
        await withTaskGroup(of: Void.self) { group in
            for index in servers.indices {
                guard let connection = servers[index].connection else { continue }
                group.addTask { await self.stop(index, connection) }
            }
        }
    }

    func stop(_ index: Int, _ connection: ServerConnection) async {
        let answered = Task { await self.request(connection, "shutdown", .null) { _, _ in () } }
        let deadline = Task {
            try await Task.sleep(for: Self.shutdownGrace)
            answered.cancel()
        }
        _ = await answered.value
        deadline.cancel()
        connection.enqueue(.notify("exit", .null))
        await connection.finish(within: Self.shutdownGrace)
        if servers[index].connection === connection { servers[index].connection = nil }
    }

    func setState(_ index: Int, _ state: ServerStatus.State) {
        guard servers[index].state != state else { return }
        servers[index].state = state
        onEvent?(.status(status(of: index)))
    }

    private func progressState(_ index: Int) -> ServerStatus.State {
        servers[index].progress.last.map { .busy(title: $0.title, percent: $0.percent) } ?? .ready
    }

    private func exited(_ index: Int, status: Int32) {
        servers[index].connection = nil
        servers[index].progress = []
        let name = servers[index].name
        appendLog(name, "\(name) exited with status \(status)\n")
        guard !servers[index].stopping else { return }
        Logger.language.error("\(name, privacy: .public) exited with status \(status)")
        let now = ContinuousClock.now
        servers[index].restarts.removeAll { now - $0 > Self.restartLimit.window }
        switch Self.restartLimit.verdict(after: servers[index].restarts, at: now) {
        case .giveUp:
            setState(index, .failed("\(name) \(Self.restartLimit.sentence) Reopen a file to start it again."))
        case .restart:
            servers[index].restarts.append(now)
            setState(index, .starting)
            Task { await self.launch(index) }
        }
    }

    private func handle(_ signal: ServerSignal, from index: Int, connection: ServerConnection) {
        let name = servers[index].name
        switch signal {
        case let .exited(status):
            guard servers[index].connection === connection else { return }
            exited(index, status: status)
        case let .diagnostics(reported, version, diagnostics):
            let url = Self.matchingCase(reported, below: servers[index].root)
            if let version, let document = document(at: url), documents[document].version != version { return }
            publish(diagnostics, for: url)
        case let .progress(token, title, percent, done):
            if done {
                servers[index].progress.removeAll { $0.token == token }
            } else if let slot = servers[index].progress.firstIndex(where: { $0.token == token }) {
                servers[index].progress[slot].percent = percent
            } else {
                servers[index].progress.append((token, title ?? "", percent))
            }
            guard servers[index].connection === connection else { return }
            switch servers[index].state {
            case .ready, .busy: setState(index, progressState(index))
            case .starting, .missing, .failed: break
            }
        case let .message(text, severity):
            onEvent?(.notice(text, severity))
        case let .log(text):
            appendLog(name, text)
        case let .applyEdit(id, edit):
            if case let .success(edit) = edit, capture(edit) {
                return connection.enqueue(.respond(id, ["applied": true]))
            }
            Task {
                let failure: String? = switch edit {
                case let .failure(failure): failure.message
                case let .success(edit): await self.applyEdit?(edit) == true ? nil : IntelligenceFailure.editorRefused.message
                }
                if let failure { self.appendLog(name, "Nyte IDE: refused workspace/applyEdit: \(failure)\n") }
                var result: [String: JSON] = ["applied": .bool(failure == nil)]
                if let failure { result["failureReason"] = .string(failure) }
                connection.enqueue(.respond(id, .object(result)))
            }
        case let .request(id, method, params):
            if method == "client/registerCapability" || method == "client/unregisterCapability" {
                updateWatchers(index, method == "client/registerCapability", params)
            }
            if method == ClientFeature.diagnosticRefresh.method {
                for document in documents where document.server == index { pullDiagnostics(document.url, after: .zero) }
            }
            connection.enqueue(.respond(id, answer(method, params, index: index)))
        }
    }

    private func answer(_ method: String, _ params: JSON, index: Int) -> JSON {
        let settings = servers[index].plan?.settings ?? .null
        switch method {
        case ClientFeature.configuration.method:
            return .array((params["items"]?.array ?? []).map { item in
                guard let section = item["section"]?.string else { return settings }
                return section.split(separator: ".").reduce(Optional(settings)) { $0?[String($1)] } ?? .null
            })
        case ClientFeature.workspaceFolders.method:
            return [["uri": Wire.uri(servers[index].root), "name": .string(servers[index].root.lastPathComponent)]]
        default:
            return .null
        }
    }

    nonisolated static func matchingCase(_ url: URL, below root: URL) -> URL {
        let path = url.path
        guard !path.hasPrefix(root.path + "/"), path.lowercased().hasPrefix(root.path.lowercased() + "/") else { return url }
        return URL(fileURLWithPath: root.path + path.dropFirst(root.path.count))
    }

    func appendLog(_ name: String, _ text: String) {
        var lines = logs[name] ?? []
        lines += text.split(separator: "\n", omittingEmptySubsequences: false).dropLast(text.hasSuffix("\n") ? 1 : 0)
        if lines.count > Self.logLines { lines.removeFirst(lines.count - Self.logLines) }
        logs[name] = lines
    }

    nonisolated static func offset(of position: TextPosition, in units: String.UTF16View) -> Int {
        var line = 0
        var offset = 0
        for unit in units {
            if line == position.line { break }
            offset += 1
            if unit == 0x0A { line += 1 }
        }
        guard line == position.line else { return units.count }
        var column = 0
        for unit in units.dropFirst(offset) {
            if column == position.column || unit == 0x0A { break }
            column += 1
        }
        return offset + column
    }

    nonisolated static func nsRange(_ range: TextSpan, in text: String) -> NSRange {
        let start = offset(of: range.start, in: text.utf16)
        let end = offset(of: range.end, in: text.utf16)
        return NSRange(location: start, length: max(end - start, 0))
    }

    nonisolated static func replacing(_ range: TextSpan, with replacement: String, in text: String) -> String {
        (text as NSString).replacingCharacters(in: nsRange(range, in: text), with: replacement)
    }
}

extension IntelligenceFailure {
    static func startTimedOut(_ name: String, after deadline: Duration) -> IntelligenceFailure {
        IntelligenceFailure(
            "\(name) did not answer within \(deadline.components.seconds) seconds of starting. Its log says what it was doing; "
                + "reopen a file to try again."
        )
    }
}
