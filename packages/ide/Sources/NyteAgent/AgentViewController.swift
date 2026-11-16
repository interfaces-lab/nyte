import AppKit
import NyteCore
import NyteUI

@MainActor
public final class AgentViewController: NSViewController {
    let workspace: Workspace
    let engine: AgentEngine
    private let hosted: Bool
    private let transcript = TranscriptController()
    let composer = ComposerView()
    private let card = RequestCard()
    private let activity = ActivityLine()
    private let bannerSlot = NSView()
    private let sendSlot = NSView()
    private let stateSlot = NSView()
    private let newButton = Button.header(symbol: "square.and.pencil", label: "New Session")
    private let moreButton = Button.header(symbol: "ellipsis", label: "More")
    lazy var header = PaneHeader(title: "", actions: [moreButton, newButton])
    let titleButton = SessionTitle(AgentViewController.untitled)
    let titleBar = NSStackView()
    let switcher = SessionSwitcher()
    var firstChoice = FirstChoice.waiting
    let stateView = SessionStateView()
    var stateClock: Timer?
    var permission: Wire.Setting?
    var waitingCount = 0
    private var navigator: SessionsViewController?

    private var epoch = 0
    private var socket = 0
    var connection = ConnectionState.connecting
    private var conversation = Conversation.none
    var shown: String?
    var sessions: [SessionSummary] = []
    var models: [ModelChoice] = []
    var currentModel: ModelRef?
    var modelProblem: String?
    private var requests: [AgentRequest] = []
    private var cardToken = 0
    private var reveal = Reveal.calm
    private var paneState = PaneState.none
    private var bannerState: ConnectionState?
    private var listening: Task<Void, Never>?
    private var observers: [NotificationCenter.ObservationToken] = []

    static let untitled = "New Session"
    static let historyLimit = 20

    public var onOpenFile: ((_ url: URL, _ line: Int?) -> Void)?
    public var onReviewChanges: ((AgentChangeSet) -> Void)?
    public var onWaitingCountChange: ((Int) -> Void)?
    public var onWaitingChange: (([AgentWaitingSession]) -> Void)?
    public var onOpenSessionInNewWindow: ((String) -> Void)? {
        didSet { switcher.sessions.onOpenInWindow = onOpenSessionInNewWindow }
    }
    public internal(set) var waitingSessions: [AgentWaitingSession] = []
    public var draftContext: [AgentContext] { context }

    private struct Draft {
        var text = ""
        var context: [AgentContext] = []
    }

    private var drafts: [String: Draft] = [:]
    private var context: [AgentContext] = [] {
        didSet { composer.show(context: context.map { ContextFormat.chip($0, root: workspace.root) }) }
    }

    public convenience init(workspace: Workspace) {
        self.init(workspace: workspace, hosted: true)
    }

    init(workspace: Workspace, hosted: Bool) {
        self.workspace = workspace
        self.hosted = hosted
        engine = AgentEngine(root: workspace.root)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    isolated deinit {
        stateClock?.invalidate()
        listening?.cancel()
        reveal.settle()
        let engine = engine
        Task { await engine.shutdown() }
    }

    public var sessionsNavigator: NSViewController {
        if let navigator { return navigator }
        let made = SessionsViewController()
        wire(made)
        navigator = made
        return made
    }

    var sessionLists: [SessionsViewController] { [navigator, switcher.sessions].compactMap { $0 } }

    func wire(_ made: SessionsViewController) {
        made.onOpen = { [weak self] id, focus in
            self?.switcher.dismiss()
            self?.open(id)
            if focus { self?.focusComposer() }
        }
        made.onNew = { [weak self] in
            self?.switcher.dismiss()
            self?.newSession()
        }
        made.onRename = { [weak self] id, name in self?.rename(id, to: name) }
        made.onRetry = { [weak self] in self?.retry() }
        made.onArchive = { [weak self] id in self?.confirmArchive(id) }
        made.onVisible = { [weak self] ids in
            guard let self else { return }
            let engine = engine
            Task { await engine.needChanges(sessions: ids) }
        }
        made.update(connection: connection)
        made.update(sessions: sessions)
        made.show(session: shown)
    }

    override public func loadView() {
        let root = KeyedView()
        root.onKeyEquivalent = { [weak self] event in
            guard SessionSwitcher.matches(event) else { return false }
            self?.showSessionSwitcher()
            return true
        }
        view = root
        setUpTitle()
        let dock = NSStackView(views: [bannerSlot, card, activity, sendSlot, composer])
        dock.orientation = .vertical
        dock.alignment = .width
        dock.spacing = Space.x2
        dock.translatesAutoresizingMaskIntoConstraints = false
        dock.setCustomSpacing(Space.x1, after: activity)
        card.isHidden = true
        bannerSlot.isHidden = true
        sendSlot.isHidden = true
        activity.isHidden = true
        stateSlot.translatesAutoresizingMaskIntoConstraints = false

        let scroll = transcript.scroll
        [scroll, stateSlot, header, dock].forEach(root.addSubview)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: root.topAnchor),
            header.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: root.trailingAnchor),

            scroll.topAnchor.constraint(equalTo: header.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: dock.topAnchor, constant: -Space.x2),

            stateSlot.topAnchor.constraint(equalTo: header.bottomAnchor),
            stateSlot.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            stateSlot.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            stateSlot.bottomAnchor.constraint(equalTo: dock.topAnchor),

            dock.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Space.x3),
            dock.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Space.x3),
            dock.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Space.x3),
        ] + dock.arrangedSubviews.flatMap { [
            $0.leadingAnchor.constraint(equalTo: dock.leadingAnchor), $0.trailingAnchor.constraint(equalTo: dock.trailingAnchor),
        ] })
        header.follow(scroll)
        moreButton.menuProvider = { [weak self] in self?.moreMenu() }
        newButton.onPress = { [weak self] in self?.newSession() }
        newButton.toolTip = "New Session (\u{2318}N)"
        wire()
        render()
    }

    override public func viewDidLoad() {
        super.viewDidLoad()
        guard hosted else { return }
        let engine = engine
        listening = Task { [weak self] in
            await engine.start()
            for await event in engine.updates {
                guard let self else { return }
                self.receive(event)
            }
        }
    }

    override public func viewDidAppear() {
        super.viewDidAppear()
        if firstChoice == .waiting { firstChoice = .opened }
        chooseFirst()
        guard observers.isEmpty, let window = view.window else { return }
        let center = NotificationCenter.default
        observers = [
            center.addObserver(of: window, for: .willClose) { [weak self] _ in self?.shutdown() },
            center.addObserver(of: window, for: .didBecomeKey) { [weak self] _ in self?.markSeen() },
        ]
    }

    private func shutdown() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        reveal.settle()
        let engine = engine
        let listener = listening
        Task {
            await engine.shutdown()
            await listener?.value
        }
    }

    public func focusComposer() {
        view.window?.makeFirstResponder(composer.text)
    }

    public func addContext(_ items: [AgentContext]) {
        let fresh = items.map(ContextFormat.capped).filter { !context.contains($0) }
        guard !fresh.isEmpty else { return }
        context += fresh
    }

    private func stashDraft() {
        drafts[shown ?? ""] = Draft(text: composer.draft, context: context)
    }

    private func restoreDraft() {
        let draft = drafts.removeValue(forKey: shown ?? "") ?? Draft()
        composer.draft = draft.text
        context = draft.context
    }

    public func newSession() {
        firstChoice = .made
        stashDraft()
        switchSession()
        restoreDraft()
        let mine = epoch
        Task { await engine.newChat(epoch: mine) }
        focusComposer()
    }

    private func wire() {
        composer.onSend = { [weak self] text in self?.send(text) }
        composer.onRemoveLastContext = { [weak self] in
            guard let self, !context.isEmpty else { return false }
            context.removeLast()
            return true
        }
        composer.chips.onRemove = { [weak self] index in
            guard let self, index < context.count else { return }
            context.remove(at: index)
            if context.isEmpty { focusComposer() }
        }
        composer.chips.onOpen = { [weak self] chip in self?.openChip(chip) }
        transcript.onOpenChip = { [weak self] chip in self?.openChip(chip) }
        composer.onStop = { [weak self] in self?.stop() }
        composer.model.menuProvider = { [weak self] in self?.modelMenu() }
        composer.permission.menuProvider = { [weak self] in self?.permissionMenu() }
        composer.onReturnEmpty = { [weak self] in self?.card.primary() ?? false }
        composer.onEscape = { [weak self] in self?.escape() ?? false }
        composer.onMove = { [weak self] delta in self?.card.move(by: delta) ?? false }
        card.onAnswer = { [weak self] request, answer in self?.answer(request, answer) }
        transcript.onReachTop = { [weak self] in
            guard let self else { return }
            Task { await self.engine.loadEarlier() }
        }
        transcript.onNeedOutput = { [weak self] key, part in self?.loadOutput(key: key, part: part) }
        transcript.onOpenLink = { NSWorkspace.shared.open($0) }
        transcript.onOpenFile = { [weak self] path, line in self?.openFile(path, line: line) }
        transcript.onRetry = { [weak self] key in self?.retryTurn(key) }
        transcript.baseURL = workspace.root
        transcript.onReview = { [weak self] target in self?.reviewChanges(target) }
    }

    private func openChip(_ chip: ContextFormat.Chip) {
        guard let path = chip.path else { return }
        openFile(path, line: chip.line)
    }

    private func openFile(_ path: String, line: Int?) {
        let expanded = (path as NSString).expandingTildeInPath
        let url = expanded.hasPrefix("/") ? URL(fileURLWithPath: expanded) : workspace.root.appendingPathComponent(expanded)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        onOpenFile?(url.standardizedFileURL, line)
    }

    func receive(_ event: AgentEvent) {
        switch event.update {
        case let .connection(next):
            connection = next
            sessionLists.forEach { $0.update(connection: next) }
            render()
        case let .sessions(list):
            sessions = list
            sessionLists.forEach { $0.update(sessions: list) }
            showHeaderState()
            announceWaiting(list)
            chooseFirst()
            markSeen()
        case let .models(list, current, problem):
            guard event.session == epoch else { return }
            models = list
            currentModel = current
            modelProblem = problem
            composer.modelTitle = list.first { $0.ref == current }?.name ?? current?.id ?? "Model"
        case let .title(title):
            guard event.session == epoch else { return }
            show(title: title)
        case let .shown(id):
            guard event.session == epoch else { return }
            shown = id
            sessionLists.forEach { $0.show(session: id) }
            showHeaderState()
            markSeen()
            render()
        case let .transcript(snapshot):
            guard event.session == epoch else { return }
            socket = event.connection
            conversation = Conversation(snapshot)
            transcript.apply(snapshot)
            activity.show(snapshot.activity)
            let doing = snapshot.rows.last { $0.kind == .tool && $0.running }?.text
            sessionLists.forEach { $0.update(doing: doing, opening: snapshot.rows.first { $0.kind == .user }?.text) }
            render()
        case let .text(part, version, text, append):
            guard event.session == epoch, event.connection >= socket else { return }
            transcript.stream(part: part, version: version, text: text, append: append)
        case let .requests(list):
            guard event.session == epoch else { return }
            requests = list
            showCard()
            render()
        case let .draft(text):
            guard event.session == epoch, composer.draft.isEmpty else { return }
            composer.draft = text
        case let .draftContext(items):
            guard event.session == epoch, context.isEmpty else { return }
            context = items
        case let .renameRefused(problem):
            sessionLists.forEach { $0.show(problem: problem) }
        case let .sendFailed(problem):
            guard event.session == epoch else { return }
            showSendProblem(problem)
        case let .permission(setting):
            permission = setting
            composer.show(permission: setting?.chosen?.label ?? setting?.value, detail: setting?.chosen?.badge)
        case let .permissionRefused(problem):
            showSendProblem(problem, title: "Couldn't change permissions")
        case let .place(worktree, path):
            guard event.session == epoch else { return }
            showPlace(worktree: worktree, path: path)
        }
    }

    private func render() {
        let live = conversation == .live
        let kept = !transcript.isEmpty || conversation != .none
        composer.set(live: live, deciding: !requests.isEmpty, canSend: connection == .ready)
        composer.placeholder = live ? "Add to this run" : (kept ? "Reply" : "Ask or describe a task")
        renderBanner(kept && connection != .ready ? connection : nil)
        if connection != .connecting || kept { reveal.settle() }
        let next = PaneState.decide(connection: connection, kept: kept, patient: reveal.hasElapsed)
        if next == .none, connection == .connecting, !kept {
            reveal.wait(AgentStates.connectingDelay) { [weak self] in
                self?.reveal = .elapsed
                self?.render()
            }
        }
        show(state: next)
    }

    private func show(state next: PaneState) {
        stateSlot.isHidden = next == .none
        guard next != paneState else { return }
        paneState = next
        stateSlot.subviews.forEach { $0.removeFromSuperview() }
        let state: NSView? = switch next {
        case .none: nil
        case .ready:
            EmptyState(title: workspace.name, description: "Ask about this project, or hand the agent a task.",
                       hints: [("Send", "\u{21A9}"), ("New line", "\u{21E7}\u{21A9}")])
        case .connecting: AgentStates.connecting()
        case .missing, .incompatible, .failed: AgentStates.problem(next) { [weak self] in self?.retry() }
        }
        guard let state else { return }
        state.translatesAutoresizingMaskIntoConstraints = false
        stateSlot.addSubview(state)
        NSLayoutConstraint.activate([
            state.leadingAnchor.constraint(equalTo: stateSlot.leadingAnchor),
            state.trailingAnchor.constraint(equalTo: stateSlot.trailingAnchor),
            state.topAnchor.constraint(equalTo: stateSlot.topAnchor),
            state.bottomAnchor.constraint(equalTo: stateSlot.bottomAnchor),
        ])
    }

    private func renderBanner(_ next: ConnectionState?) {
        bannerSlot.isHidden = next == nil
        guard next != bannerState else { return }
        bannerState = next
        bannerSlot.subviews.forEach { $0.removeFromSuperview() }
        let banner: Banner? = switch next {
        case .ready?, nil: nil
        case .connecting?: Banner("Reconnecting to Nyte", tone: .neutral)
        case .missing?:
            Banner("Nyte stopped", detail: "Open Nyte, or run nyte host in a terminal.", tone: .warning,
                   action: ("Try Again", { [weak self] in self?.retry() }))
        case let .incompatible(mismatch)?:
            Banner("This Nyte can't talk to the IDE", detail: mismatch.revisions, tone: .danger,
                   action: AgentStates.updateRoute(mismatch) ?? ("Try Again", { [weak self] in self?.retry() }))
        case let .failed(reason)?:
            Banner("Nyte couldn't open this folder", detail: reason, tone: .danger,
                   action: ("Try Again", { [weak self] in self?.retry() }))
        }
        guard let banner else { return }
        bannerSlot.addSubview(banner)
        NSLayoutConstraint.activate([
            banner.leadingAnchor.constraint(equalTo: bannerSlot.leadingAnchor),
            banner.trailingAnchor.constraint(equalTo: bannerSlot.trailingAnchor),
            banner.topAnchor.constraint(equalTo: bannerSlot.topAnchor),
            banner.bottomAnchor.constraint(equalTo: bannerSlot.bottomAnchor),
        ])
    }

    func showSendProblem(_ problem: String?, title: String = "Couldn't send") {
        sendSlot.subviews.forEach { $0.removeFromSuperview() }
        sendSlot.isHidden = problem == nil
        guard let problem else { return }
        let banner = Banner(title, detail: problem, tone: .danger) {
            [weak self] in self?.showSendProblem(nil)
        }
        sendSlot.addSubview(banner)
        NSLayoutConstraint.activate([
            banner.leadingAnchor.constraint(equalTo: sendSlot.leadingAnchor),
            banner.trailingAnchor.constraint(equalTo: sendSlot.trailingAnchor),
            banner.topAnchor.constraint(equalTo: sendSlot.topAnchor),
            banner.bottomAnchor.constraint(equalTo: sendSlot.bottomAnchor),
        ])
    }

    func reviewAllChanges() {
        let mine = epoch
        Task {
            let changes = await engine.sessionChanges()
            guard mine == epoch else { return }
            guard let changes, !changes.files.isEmpty else {
                return showSendProblem("Nyte has no changes recorded for this session.", title: "Nothing to review")
            }
            onReviewChanges?(changes)
        }
    }

    private func reviewChanges(_ target: ReviewTarget) {
        let mine = epoch
        Task {
            guard let changes = await engine.changes(target), mine == epoch else { return }
            onReviewChanges?(changes)
        }
    }

    private func retryTurn(_ key: String) {
        guard key.hasPrefix(HeadRows.turnKey("")) else { return }
        let turn = String(key.dropFirst(HeadRows.turnKey("").count))
        let mine = epoch
        Task { await engine.retry(turn: turn, epoch: mine) }
    }

    private func showCard() {
        cardToken += 1
        let token = cardToken
        let duration = Motion.duration(AgentMotion.card)
        guard let next = requests.first else {
            guard !card.isHidden, card.request != nil else { return }
            card.retire()
            NSAnimationContext.runAnimationGroup { context in
                context.duration = duration
                context.timingFunction = Motion.easeOut
                card.animator().alphaValue = 0
            } completionHandler: { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, self.cardToken == token else { return }
                    self.card.isHidden = true
                }
            }
            return
        }
        let appearing = card.isHidden || card.request == nil
        card.show(next)
        guard appearing else { return }
        card.alphaValue = 0
        card.isHidden = false
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = Motion.easeOut
            card.animator().alphaValue = 1
        }
    }

    private func answer(_ request: AgentRequest, _ answer: RequestAnswer) {
        requests.removeAll { $0.part == request.part }
        showCard()
        let mine = epoch
        Task { await engine.act(request, answer, epoch: mine) }
    }

    private func escape() -> Bool {
        if card.decline() { return true }
        guard conversation == .live else { return false }
        stop()
        return true
    }

    override public func cancelOperation(_ sender: Any?) {
        _ = escape()
    }

    private func send(_ text: String) {
        let mine = epoch
        let items = context
        context = []
        Task {
            await engine.send(text, context: items, epoch: mine)
            refocus(after: mine)
        }
    }

    private func refocus(after mine: Int) {
        guard mine == epoch, let window = view.window, window.isKeyWindow else { return }
        let inPane = (window.firstResponder as? NSView)?.isDescendant(of: view) ?? (window.firstResponder === window)
        guard inPane, window.firstResponder !== composer.text else { return }
        window.makeFirstResponder(composer.text)
    }

    private func stop() {
        let mine = epoch
        Task { await engine.stop(epoch: mine) }
    }

    private func retry() {
        Task { await engine.retry() }
    }

    private func rename(_ id: String, to name: String) {
        if id == shown { show(title: name) }
        Task { await engine.rename(id, to: name) }
    }

    private func markSeen() {
        guard hosted, shown != nil, NSApp.isActive, view.window?.isKeyWindow == true, !view.isHiddenOrHasHiddenAncestor else { return }
        Task { await engine.see() }
    }

    public func openSession(_ id: String) {
        open(id)
    }

    func open(_ id: String) {
        firstChoice = .made
        guard id != shown else { return }
        stashDraft()
        switchSession()
        shown = id
        restoreDraft()
        let mine = epoch
        Task { await engine.openSession(id, epoch: mine) }
    }

    private func switchSession() {
        epoch += 1
        conversation = .none
        shown = nil
        requests = []
        showCard()
        activity.show(nil)
        showSendProblem(nil)
        transcript.reset()
        show(title: nil)
        showHeaderState()
        render()
    }

    private func loadOutput(key: String, part: String) {
        let mine = epoch
        Task {
            guard let output = await engine.output(of: part), mine == epoch, view.window != nil else { return }
            transcript.setOutput(output, for: key)
        }
    }

}
