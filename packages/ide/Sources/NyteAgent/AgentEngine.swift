import Foundation

actor AgentEngine {
    enum Rows {
        case unread
        case reading(previous: HeadRows?, buffered: [Wire.SessionChange])
        case read(HeadRows)
    }

    enum History: Equatable {
        case more, loading, done
    }

    enum TextChannel: Equatable {
        case closed, opening, open
    }

    enum Place: Equatable {
        case unknown
        case registered(String)
        case unregistered(identity: String)
    }

    enum Catalog {
        case unread
        case read([ModelChoice], defaultModel: ModelRef?)
        case failed(String)
    }

    struct Shown {
        let id: String
        var title: String?
        var rows = Rows.unread
        var history = History.more
        var streamed: [String: HeadRows.Streamed] = [:]
        var seen: String?
    }

    nonisolated let updates: AsyncStream<AgentEvent>
    let continuation: AsyncStream<AgentEvent>.Continuation
    let link: HostLink
    let root: String

    var epoch = 0
    var socketEpoch = 0
    var listening: Task<Void, Never>?
    var asking: Task<Void, Never>?
    var connection = ConnectionState.connecting
    var place = Place.unknown
    var text = TextChannel.closed
    var summaries: [String: SessionSummary] = [:]
    var catalog = Catalog.unread
    var chosen: ModelRef?
    var shown: Shown?
    var children: [String: [String: Wire.Part]] = [:]
    var prompts: [(id: String, text: String)] = []
    var failures: [String] = []
    var lastRequests: [AgentRequest] = []
    var asks: [String: AgentRequest] = [:]
    var askReads: Set<String> = []
    var sentAt: Date?
    var runs: [String: ChangeReview.RunState] = [:]
    var worktrees: [String: Wire.WorkspaceRow] = [:]
    var unknownWorkspaces: Set<String> = []
    var permission: Wire.Setting?
    var catalogRead: String?
    var reviews: [String: (key: String, tally: ChangeReview.Tally)] = [:]

    static let head = "main"
    static let tail = 100
    static let page = 50
    static let sessionPage = 100
    static let attempts = 6
    static let readyWait: Duration = .milliseconds(250)

    init(root: URL) {
        self.root = root.path
        (updates, continuation) = AsyncStream.makeStream(of: AgentEvent.self)
        link = HostLink(clientName: "Nyte IDE", version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")
    }

    func start() async {
        guard listening == nil else { return }
        let signals = link.signals
        listening = Task { for await signal in signals { await self.handle(signal) } }
        await link.start()
    }

    func shutdown() async {
        await link.shutdown()
        listening?.cancel()
        asking?.cancel()
        await listening?.value
        await asking?.value
        listening = nil
        asking = nil
        continuation.finish()
    }

    func retry() async {
        guard case .failed = connection else { return await link.retry() }
        show(.connecting)
        await opened()
    }

    func emit(_ update: AgentUpdate) {
        continuation.yield(AgentEvent(session: epoch, connection: socketEpoch, update: update))
    }

    private func handle(_ signal: LinkSignal) async {
        switch signal {
        case let .state(state):
            if case .open = state {
                socketEpoch += 1
                text = .closed
                children = [:]
                await opened()
                return
            }
            if let next = Self.connection(after: state, from: connection), next != connection { show(next) }
        case let .event(event): await receive(event)
        case let .text(frame): await stream(frame)
        }
    }

    static func connection(after state: LinkState, from current: ConnectionState) -> ConnectionState? {
        switch state {
        case .dialling: current == .missing ? nil : .connecting
        case let .waiting(_, failure): failure.hostAbsent ? .missing : .connecting
        case let .incompatible(reason): .incompatible(reason)
        case .open, .stopped: nil
        }
    }

    private func show(_ state: ConnectionState) {
        connection = state
        emit(.connection(state))
    }

    private func opened() async {
        do throws(LinkError) {
            _ = try await link.call(Wire.Subscribe(scopes: ["host"]))
            let inspection = try await link.call(Wire.Inspect(target: Wire.Target(path: root)))
            place = inspection.registered.map(Place.registered) ?? .unregistered(identity: inspection.identity)
            await readWorkspaces()
            await readModels()
            try await readSessions()
        } catch {
            switch error {
            case .lost, .notConnected: return
            case .host, .undecodable: show(.failed(error.message))
            }
            return
        }
        show(.ready)
        if shown != nil { await attach() }
    }

    private func readModels() async {
        do throws(LinkError) {
            let read = try await link.call(Wire.ListModels())
            let choices = read.providers.flatMap { provider -> [ModelChoice] in
                guard provider.credential == .configured || provider.credential == .verified else { return [] }
                return provider.models.compactMap { model in
                    guard provider.listings[model.ref.id] != .hidden else { return nil }
                    return ModelChoice(ref: model.ref, name: model.name, provider: provider.name)
                }
            }
            catalog = .read(choices, defaultModel: read.defaultModel)
        } catch {
            catalog = .failed(error.message)
        }
        emitModels()
    }

    func readSessions() async throws(LinkError) {
        guard case let .registered(workspace) = place else {
            summaries = [:]
            emit(.sessions([]))
            return
        }
        var cursor: String?
        repeat {
            let page = try await link.call(Wire.ListSessions(cursor: cursor, limit: Self.sessionPage))
            for row in page.items { remember(row, in: workspace) }
            cursor = page.next
        } while cursor != nil
        emitSessions()
    }

    private func remember(_ row: Wire.SessionRow, in workspace: String) {
        if row.id == shown?.id, let name = row.name, name != shown?.title {
            shown?.title = name
            emit(.title(name))
        }
        if row.parent == nil, !row.archived, row.workspace != workspace, worktrees[row.workspace] == nil {
            noticeWorkspace(row.workspace)
        }
        let worktree = worktrees[row.workspace].flatMap { $0.isolation?.source == workspace ? $0 : nil }
        guard row.belongs(to: workspace) || (worktree != nil && row.parent == nil && !row.archived) else {
            summaries.removeValue(forKey: row.id)
            return
        }
        var summary = row.summary(head: Self.head, asks: asks)
        summary.worktree = worktree?.isolation?.branch
        if case let .host(files)? = summary.lastRun.flatMap({ runs[$0] }) {
            summary.changes = ChangeTotals(files)
        }
        summaries[row.id] = summary
    }

    func emitSessions() {
        emit(.sessions(summaries.values.sorted { $0.lastActivity > $1.lastActivity }))
        emitPlace()
        let unknown = summaries.values.compactMap { summary -> (session: String, part: String)? in
            guard case let .asking(part) = summary.run, !part.isEmpty, asks[part] == nil, !askReads.contains(part) else { return nil }
            return (summary.id, part)
        }
        guard !unknown.isEmpty else { return }
        askReads.formUnion(unknown.map(\.part))
        let previous = asking
        asking = Task {
            await previous?.value
            await self.readAsks(unknown)
        }
    }

    private func readAsks(_ waiting: [(session: String, part: String)]) async {
        var learned = false
        for entry in waiting {
            guard !Task.isCancelled else { return }
            let read: Wire.PartRead
            do throws(LinkError) {
                read = try await link.call(Wire.ReadPart(session: entry.session, part: entry.part))
            } catch {
                continue
            }
            guard let request = read.part?.request(session: entry.session, subagent: false) else { continue }
            asks[entry.part] = request
            guard var summary = summaries[entry.session], summary.run == .asking(part: entry.part) else { continue }
            summary.asked = request.summary
            summary.askKind = request.kind
            summaries[entry.session] = summary
            learned = true
        }
        if learned { emit(.sessions(summaries.values.sorted { $0.lastActivity > $1.lastActivity })) }
    }

    func emitModels() {
        let effective = rows?.effectiveModel
        switch catalog {
        case .unread: emit(.models([], current: chosen ?? effective))
        case let .read(models, defaultModel): emit(.models(models, current: chosen ?? effective ?? defaultModel))
        case let .failed(problem): emit(.models([], current: chosen ?? effective, problem: problem))
        }
    }

    private func receive(_ event: Wire.Event) async {
        switch event {
        case let .sessions(table):
            if case let .registered(workspace) = place {
                for row in table.upsert { remember(row, in: workspace) }
            }
            for id in table.drop { summaries.removeValue(forKey: id) }
            emitSessions()
        case let .session(id, change):
            if id == shown?.id { return await apply(change) }
            guard var parts = children[id] else { return }
            for part in change.tables.parts?.upsert ?? [] { parts[part.id] = part }
            for part in change.tables.parts?.drop ?? [] { parts.removeValue(forKey: part) }
            children[id] = parts
            emitRequests()
        case .presence, .unknown:
            return
        }
    }

    private func apply(_ change: Wire.SessionChange) async {
        switch shown?.rows {
        case .unread?, nil:
            return
        case let .reading(previous, buffered)?:
            shown?.rows = .reading(previous: previous, buffered: buffered + [change])
        case .read?:
            guard withRows({ $0.apply(change) }) != .stale else { return await attach(fresh: true) }
            await settle()
        }
    }

    var rows: HeadRows? {
        guard case let .read(rows)? = shown?.rows else { return nil }
        return rows
    }

    @discardableResult
    func withRows<Result>(_ body: (inout HeadRows) -> Result) -> Result? {
        guard case .read(var rows)? = shown?.rows else { return nil }
        shown?.rows = .unread
        let result = body(&rows)
        shown?.rows = .read(rows)
        return result
    }

    private func stream(_ frame: Wire.TextFrame) async {
        switch frame {
        case .closed:
            text = .closed
            await openText()
        case let .whole(part, version, whole):
            guard shown != nil else { return }
            shown?.streamed[part] = HeadRows.Streamed(version: version, text: whole)
            emit(.text(part: part, version: version, text: whole, append: false))
        case let .append(part, version, piece):
            guard let known = shown?.streamed[part] else { return }
            shown?.streamed[part] = HeadRows.Streamed(version: version, text: known.text + piece)
            emit(.text(part: part, version: version, text: piece, append: true))
        case .progress, .unknown:
            return
        }
    }

    func openText() async {
        guard text == .closed else { return }
        text = .opening
        do throws(LinkError) {
            _ = try await link.call(Wire.OpenText())
            text = .open
        } catch {
            text = .closed
        }
    }

    func quietly<Request: Wire.Request>(_ request: Request) async {
        do throws(LinkError) {
            _ = try await link.call(request)
        } catch {
            return
        }
    }

    func attach(fresh: Bool = false) async {
        guard let id = shown?.id else { return }
        let resume = beginReading(fresh: fresh)
        let window: Wire.HeadWindow
        do throws(LinkError) {
            _ = try await link.call(Wire.Subscribe(scopes: ["session/" + id]))
            window = try await link.call(Wire.ReadHead(session: id, head: Self.head, window: .init(tail: Self.tail), resume: resume))
        } catch {
            guard id == shown?.id else { return }
            if case let .reading(previous, _)? = shown?.rows { shown?.rows = previous.map(Rows.read) ?? .unread }
            switch error {
            case .lost, .notConnected: return
            case .host, .undecodable: failures = ["Couldn't open this session: \(error.message)"]
            }
            return emitSnapshot()
        }
        guard id == shown?.id, case .reading(var previous, let buffered)? = shown?.rows else { return }
        shown?.rows = .unread
        if previous == nil { shown?.history = .more }
        previous?.resume(window)
        var next = previous ?? HeadRows(head: Self.head, window: window)
        previous = nil
        let stale = buffered.map { next.apply($0) }.contains(.stale)
        shown?.rows = .read(next)
        if stale { return await attach(fresh: true) }
        if shown?.title == nil { await nameShown(id) }
        await openText()
        await settle()
    }

    private func beginReading(fresh: Bool) -> Wire.Resume? {
        let previous = fresh ? nil : rows
        shown?.rows = .reading(previous: previous, buffered: [])
        return previous?.resumePoint
    }

    private func nameShown(_ id: String) async {
        do throws(LinkError) {
            let info = try await link.call(Wire.ReadSession(session: id))
            guard id == shown?.id else { return }
            shown?.title = info.name
            emit(.title(info.name))
        } catch {
            return
        }
    }

    func settle() async {
        emitSnapshot()
        emitModels()
        emitPlace()
        await readCatalog()
        loadRuns(rows?.endedRuns ?? [])
        await watchChildren()
        emitRequests()
    }

    func emitSnapshot() {
        let prompted = prompts.map { RowSpec(kind: .user, key: $0.id, text: $0.text, pending: true) }
        let failed = failures.enumerated().map { RowSpec(kind: .failure, key: "send:\($0.offset)", text: $0.element) }
        guard let shown, let rows else {
            if prompts.isEmpty { sentAt = nil }
            emit(.transcript(TranscriptSnapshot(
                rows: prompted + failed, live: false, sessionOpen: false, canLoadEarlier: false,
                activity: sentAt.map { Activity(kind: .working, since: $0) }
            )))
            return
        }
        prompts.removeAll { rows.messages[$0.id] != nil }
        let pending = prompts.map { RowSpec(kind: .user, key: $0.id, text: $0.text, pending: true) }
        let (live, activity) = rows.execution.activity(prompting: !prompts.isEmpty, sentAt: sentAt)
        if prompts.isEmpty { sentAt = nil }
        let specs = rows.specs(streamed: shown.streamed, reviews: reviewTallies(rows)) + pending + failed
        for (part, entry) in shown.streamed where (rows.version(of: part) ?? -1) >= entry.version {
            self.shown?.streamed.removeValue(forKey: part)
        }
        emit(.transcript(TranscriptSnapshot(
            rows: specs, live: live, sessionOpen: true, canLoadEarlier: shown.history != .done && rows.oldest != nil,
            activity: activity, contexts: rows.contexts(), deadlines: rows.deadlines()
        )))
    }

    private func watchChildren() async {
        let waiting = rows?.waitingChildren() ?? []
        let gone = children.keys.filter { !waiting.contains($0) }
        for id in gone { children.removeValue(forKey: id) }
        if !gone.isEmpty { await quietly(Wire.Unsubscribe(scopes: gone.map { "session/" + $0 })) }
        for id in waiting where children[id] == nil {
            children[id] = [:]
            let window: Wire.HeadWindow
            do throws(LinkError) {
                _ = try await link.call(Wire.Subscribe(scopes: ["session/" + id]))
                window = try await link.call(Wire.ReadHead(session: id, head: Self.head, window: .init(tail: 1), resume: nil))
            } catch {
                switch error {
                case .lost, .notConnected: break
                case .host, .undecodable: failures = ["Couldn't read a subagent's request: \(error.message)"]
                }
                continue
            }
            guard let heard = children[id] else { continue }
            let read = Dictionary((window.tables.parts?.upsert ?? []).map { ($0.id, $0) }) { _, last in last }
            children[id] = read.merging(heard) { _, event in event }
        }
    }

    func emitRequests() {
        let session = shown?.id ?? ""
        let own = (rows?.parts.values).map(Array.init) ?? []
        let requests = own.compactMap { $0.request(session: session, subagent: false) }
            + children.flatMap { child in child.value.values.compactMap { $0.request(session: child.key, subagent: true) } }
        let sorted = requests.sorted { left, right in
            if case .approval = left, case .question = right { return true }
            if case .question = left, case .approval = right { return false }
            return left.part < right.part
        }
        guard sorted != lastRequests else { return }
        lastRequests = sorted
        for request in sorted { asks[request.part] = request }
        emit(.requests(sorted))
    }
}
