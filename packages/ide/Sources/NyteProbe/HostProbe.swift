import CryptoKit
import Darwin
import Foundation
import OSLog
import Synchronization
@testable import NyteAgent

@MainActor func runHostProbe(_ arguments: [String]) async {
    if arguments.first == "replay" { return await HostCheck.serveReplay(arguments) }
    guard arguments.first == "check" else { fail("usage: NyteProbe host check [folder] | host replay <nyte-home>") }
    let folder = arguments.count > 1 ? URL(fileURLWithPath: arguments[1]) : HostCheck.repository()
    let check = HostCheck(folder: folder.standardizedFileURL)
    await check.run()
    print(check.failures == 0 ? "host check: all passed" : "host check: \(check.failures) failed")
    exit(check.failures == 0 ? 0 : 1)
}

@MainActor final class HostCheck {
    let folder: URL
    private(set) var failures = 0
    private let scratch = FileManager.default.temporaryDirectory.appending(path: "nyte-host-check")
    private let home = ProcessInfo.processInfo.environment["NYTE_HOME"].map { URL(fileURLWithPath: $0) }
        ?? FileManager.default.homeDirectoryForCurrentUser.appending(path: ".nyte")

    static let welcomeWait: Duration = .seconds(10)
    static let eventWindow: Duration = .seconds(4)
    static let record: Duration = .seconds(5)
    static let settle: Duration = .milliseconds(500)
    static let stateWait: Duration = .seconds(8)
    static let tail = 20
    static let recordedSessions = 3
    static let runSample = 8

    init(folder: URL) {
        self.folder = folder
    }

    static func repository() -> URL {
        var folder = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        while folder.path != "/" {
            if FileManager.default.fileExists(atPath: folder.appending(path: ".git").path) { return folder }
            folder.deleteLastPathComponent()
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    }

    func expect(_ condition: Bool, _ what: String) {
        print((condition ? "ok   " : "FAIL ") + what)
        if !condition { failures += 1 }
    }

    func run() async {
        try? FileManager.default.removeItem(at: scratch)
        try? FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        print("live host, read-only, workspace \(folder.path)")
        let recorded = scratch.appending(path: "stream.tsv")
        await Recorder(home: home, folder: folder, file: recorded).run(check: self)
        StreamDecode(file: recorded).run(check: self)
        let liveStarted = Date.now
        await live()
        await engine()
        let troubles = Self.entries(since: liveStarted).filter {
            $0.contains(" failed: ") || $0.hasPrefix("skipped ") || ($0.hasPrefix("unknown ") && !$0.hasPrefix("unknown part kind "))
        }
        expect(troubles.isEmpty, troubles.isEmpty ? "live log: no host call failed, nothing skipped" : "live log: \(troubles)")
        print("failure paths, loopback only")
        await offline("missing host file", host: .none, connection: .missing, logged: "no host file") {
            if case .waiting(_, .noHostFile) = $0 { true } else { false }
        }
        await offline("port nobody listens on", host: .closedPort, connection: .connecting, logged: "the host did not answer") {
            if case .waiting(_, .unreachable) = $0 { true } else { false }
        }
        await offline("token the host rejects", host: .loopback(.refuseToken), connection: .connecting,
                      logged: "the host refused the token (HTTP 401)") {
            if case .waiting(_, .refused(status: 401)) = $0 { true } else { false }
        }
        let old = HostMismatch(reason: Loopback.oldReason, hostIsOlder: true, hostRevision: Loopback.oldRevision)
        await offline("welcome with an old revision", host: .loopback(.oldWelcome), connection: .incompatible(old),
                      logged: "the host is incompatible: Update the host") { $0 == .incompatible(old) }
        let new = HostMismatch(reason: Loopback.closeReason, hostIsOlder: false, hostRevision: Loopback.newRevision)
        await offline("socket closed for no shared revision", host: .loopback(.closeWithReason), connection: .incompatible(new),
                      logged: "the host is incompatible: Update the client") { $0 == .incompatible(new) }
        unsetenv("NYTE_HOME")
        print("step wording")
        StepCheck.run(check: self)
        print("context serialisation")
        ContextCheck.run(check: self)
        print("replay host")
        await ReplayCheck.run(check: self, home: scratch.appending(path: "replay"))
    }

    private func live() async {
        guard FileManager.default.fileExists(atPath: home.appending(path: "host.json").path) else {
            return expect(false, "live: no host.json in \(home.path)")
        }
        let link = HostLink(clientName: "NyteProbe", version: "0")
        let watcher = LinkWatcher(link)
        await link.start()
        guard await Patience.until(Self.welcomeWait, { watcher.welcome != nil }), let welcome = watcher.welcome else {
            expect(false, "welcome: none within \(Self.welcomeWait); states \(watcher.states)")
            return await link.shutdown()
        }
        expect(welcome.revision >= Wire.minRevision,
               "welcome: host \(welcome.hostId) at API revision \(welcome.revision), server revision \(welcome.serverRevision)")
        do throws(LinkError) {
            _ = try await link.call(Wire.Subscribe(scopes: ["host"]))
            let inspection = try await link.call(Wire.Inspect(target: Wire.Target(path: folder.path)))
            guard let workspace = inspection.registered else {
                expect(false, "workspaces.inspect: this folder is not a workspace on the host")
                return await link.shutdown()
            }
            var mine: [Wire.SessionRow] = []
            var total = 0
            var pages = 0
            var cursor: String?
            repeat {
                let page = try await link.call(Wire.ListSessions(cursor: cursor, limit: AgentEngine.sessionPage))
                pages += 1
                total += page.items.count
                mine += page.items.filter { $0.belongs(to: workspace) }
                cursor = page.next
            } while cursor != nil
            expect(!mine.isEmpty, "sessions.list: \(mine.count) sessions in this workspace of \(total) on the host, \(pages) pages")
            sessionsOnHost = mine.count
            if let newest = mine.max(by: { $0.lastActivityAt < $1.lastActivityAt }) {
                _ = try await link.call(Wire.Subscribe(scopes: ["session/" + newest.id]))
                let window = try await link.call(Wire.ReadHead(session: newest.id, head: AgentEngine.head,
                                                               window: .init(tail: Self.tail), resume: nil))
                let rows = HeadRows(head: AgentEngine.head, window: window)
                expect(!window.order.isEmpty,
                       "head.read: \(window.order.count) messages, \(rows.specs(streamed: [:], reviews: [:]).count) transcript rows at seq \(window.seq)")
                if let catalog = rows.catalog {
                    let read = try await link.call(Wire.ReadCatalog(id: catalog))
                    let mode = read.settings.first { $0.id == AgentEngine.permissionSetting }
                    expect(mode?.chosen != nil && mode?.scope == .host,
                           "catalogs.read: permission mode \(mode?.chosen?.label ?? "missing") of \(mode?.choices.map(\.label) ?? []), scope host")
                } else {
                    expect(false, "head.read: the window names no catalog")
                }
            }
            let ended = mine.sorted { $0.lastActivityAt > $1.lastActivityAt }.compactMap { row in
                row.heads.first.flatMap { $0.execution.endedRun }
            }
            var answered = 0
            var unavailable = 0
            var files = 0
            for run in ended.prefix(Self.runSample) {
                do throws(LinkError) {
                    files += try await link.call(Wire.RunChanges(workspace: workspace, source: .init(run: run))).files.count
                    answered += 1
                } catch {
                    guard case .host = error else { throw error }
                    unavailable += 1
                }
            }
            expect(answered + unavailable == min(ended.count, Self.runSample),
                   "workspace.changes: \(answered) of the newest \(min(ended.count, Self.runSample)) ended runs answered with \(files) files, \(unavailable) had no snapshot")
            let worktrees = try await link.call(Wire.ListWorkspaces()).items.filter { $0.isolation?.source == workspace }
            expect(true, "workspaces.list: \(worktrees.count) worktrees of this workspace: \(worktrees.map { $0.isolation?.branch ?? "" }.joined(separator: ", "))")
            _ = try await link.call(Wire.OpenText())
        } catch {
            expect(false, "live call failed: \(error.logDescription)")
        }
        let port = URL(string: (try? JSONDecoder().decode(Wire.HostFile.self, from: Data(contentsOf: home.appending(path: "host.json"))))?.url ?? "")?.port ?? 0
        let connected = Self.connections(to: port)
        expect(!connected.isEmpty, "socket open while connected: \(connected.count) TCP connections to port \(port)")
        let events = watcher.events
        await Patience.pause(Self.eventWindow)
        expect(true, "events: \(watcher.events - events) change events and \(watcher.texts) text frames in \(Self.eventWindow)")
        await link.shutdown()
        await watcher.finished()
        expect(watcher.states.last == .stopped, "disconnect: the link ends stopped")
        await Patience.pause(Self.settle)
        let open = Self.connections(to: port)
        expect(open.isEmpty, open.isEmpty ? "socket closed: no TCP connection to port \(port) remains" : "socket still open: \(open)")
    }

    private var sessionsOnHost = 0

    private func engine() async {
        let engine = AgentEngine(root: folder)
        let seen = EngineWatcher(engine)
        await engine.start()
        let ready = await Patience.until(Self.welcomeWait) { seen.connection == .ready && seen.sessions != nil }
        let count = seen.sessions?.count ?? 0
        expect(ready && abs(count - sessionsOnHost) <= 1,
               "engine: ready with \(count) sessions for this workspace (the link listed \(sessionsOnHost))")
        if let newest = seen.sessions?.first {
            await engine.openSession(newest.id, epoch: 1)
            let opened = await Patience.until(Self.welcomeWait) { seen.transcript?.sessionOpen == true }
            expect(opened, "engine: opened the newest session, \(seen.transcript?.rows.count ?? 0) rows, nothing marked read")
        }
        await engine.shutdown()
        await seen.finished()
        expect(seen.finishedCleanly, "engine: shut down and its update stream ended")
    }

    private enum HostSetup {
        case none
        case closedPort
        case loopback(Loopback.Mode)
    }

    private func offline(_ name: String, host: HostSetup, connection: ConnectionState, logged phrase: String,
                         _ matches: @escaping (LinkState) -> Bool) async {
        let started = Date.now
        let folder = scratch.appending(path: name.replacingOccurrences(of: " ", with: "-"))
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var server: Loopback.Server?
        switch host {
        case .none: break
        case .closedPort: writeHost(port: Loopback.unusedPort(), in: folder)
        case let .loopback(mode):
            server = Loopback.start(mode)
            writeHost(port: server?.port ?? 0, in: folder)
        }
        setenv("NYTE_HOME", folder.path, 1)
        let link = HostLink(clientName: "NyteProbe", version: "0")
        let watcher = LinkWatcher(link)
        await link.start()
        let reached = await Patience.until(Self.stateWait) { watcher.states.contains(where: matches) }
        await link.shutdown()
        await watcher.finished()
        server?.stop()
        let state = watcher.states.first(where: matches)
        let mapped = state.flatMap { AgentEngine.connection(after: $0, from: .connecting) } ?? .connecting
        let logged = Self.logged(since: started, containing: phrase)
        expect(reached && mapped == connection && logged,
               "\(name): \(state.map(Self.describe) ?? "never reached; states \(watcher.states.map(Self.describe))"), pane shows \(Self.describe(mapped)), logged \(logged ? "\u{201C}\(phrase)\u{201D}" : "nothing")")
    }

    private static func describe(_ state: LinkState) -> String {
        switch state {
        case let .dialling(attempt): "dialling, attempt \(attempt + 1)"
        case let .open(welcome): "open at API revision \(welcome.revision)"
        case let .waiting(_, failure): "waiting to redial because \(failure.logDescription)"
        case let .incompatible(mismatch): "incompatible (\(mismatch.reason))"
        case .stopped: "stopped"
        }
    }

    private static func describe(_ state: ConnectionState) -> String {
        switch state {
        case let .incompatible(mismatch): "incompatible: \(mismatch.revisions)"
        default: "\(state)"
        }
    }

    private func writeHost(port: Int, in folder: URL) {
        let file = "{\"url\":\"http://127.0.0.1:\(port)\",\"token\":\"\(Loopback.token)\",\"pid\":\(getpid())}"
        try? Data(file.utf8).write(to: folder.appending(path: "host.json"))
    }

    static func logged(since date: Date, containing phrase: String) -> Bool {
        entries(since: date).contains { $0.contains(phrase) }
    }

    static func entries(since date: Date?) -> [String] {
        guard let store = try? OSLogStore(scope: .currentProcessIdentifier) else { return [] }
        let predicate = NSPredicate(format: "subsystem == %@ AND category == %@", "sh.nyte.ide", "NyteAgent")
        let position = date.map { store.position(date: $0) }
        guard let entries = try? store.getEntries(at: position, matching: predicate) else { return [] }
        return entries.compactMap { ($0 as? OSLogEntryLog)?.composedMessage }
    }

    static func connections(to port: Int) -> [String] {
        let lsof = Process()
        lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        lsof.arguments = ["-nP", "-a", "-p", String(getpid()), "-iTCP@127.0.0.1:\(port)"]
        let pipe = Pipe()
        lsof.standardOutput = pipe
        lsof.standardError = FileHandle.nullDevice
        guard (try? lsof.run()) != nil else { return ["lsof did not run"] }
        lsof.waitUntilExit()
        let text = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        return text.split(separator: "\n").dropFirst().map(String.init)
    }
}

@MainActor final class LinkWatcher {
    private(set) var states: [LinkState] = []
    private(set) var events = 0
    private(set) var texts = 0
    private var listening: Task<Void, Never>?

    var welcome: Wire.Welcome? {
        states.lazy.compactMap { if case let .open(welcome) = $0 { welcome } else { nil } }.last
    }

    init(_ link: HostLink) {
        let signals = link.signals
        listening = Task { [weak self] in
            for await signal in signals {
                guard let self else { return }
                switch signal {
                case let .state(state): states.append(state)
                case .event: events += 1
                case .text: texts += 1
                }
            }
        }
    }

    func finished() async {
        await listening?.value
    }
}

@MainActor final class EngineWatcher {
    private(set) var connection = ConnectionState.connecting
    private(set) var sessions: [SessionSummary]?
    private(set) var transcript: TranscriptSnapshot?
    private(set) var requests: [AgentRequest] = []
    private(set) var refused: String?
    private(set) var permission: Wire.Setting?
    private(set) var place: String?
    private(set) var finishedCleanly = false
    private var listening: Task<Void, Never>?

    init(_ engine: AgentEngine) {
        let updates = engine.updates
        listening = Task { [weak self] in
            for await event in updates {
                guard let self else { return }
                switch event.update {
                case let .connection(state): connection = state
                case let .sessions(list): sessions = list
                case let .transcript(snapshot): transcript = snapshot
                case let .requests(list): requests = list
                case let .renameRefused(problem): refused = problem
                case let .permission(setting): permission = setting
                case let .place(worktree, _): place = worktree
                default: break
                }
            }
            self?.finishedCleanly = true
        }
    }

    func finished() async {
        await listening?.value
    }
}
