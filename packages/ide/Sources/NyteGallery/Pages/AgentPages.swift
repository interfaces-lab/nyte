import AppKit
import NyteCore
import NyteReplay
@testable import NyteAgent
@testable import NyteUI

@MainActor
let agentPages: [GalleryPage] = [
    agentSessionsPage, agentPanePage, agentComposerPage, agentConnectionPage, agentStepsPage, agentLiveSessionsPage,
    agentReplayPage, agentContextPage, agentSwitcherPage,
]

@MainActor
private enum Agent {
    static let sidebar = NSSize(width: Metric.sidebarWidth, height: 520)
    static let pane = NSSize(width: Metric.agentWidth, height: 640)
    static let stepsHeight: CGFloat = 420
    static let replayHeight: CGFloat = 900
    static let peekHeight: CGFloat = 420
    static let root = URL(fileURLWithPath: "/Users/workgyver/Developer/nyte")
    static let liveWait: Duration = .seconds(4)
    static let minute: TimeInterval = 60
    static let hour: TimeInterval = 3_600
    static let day: TimeInterval = 86_400
    static let runSeconds: TimeInterval = 27
    static let askedAge = minute * 3
    static let unreadAge = minute * 14
    static let failedAge = hour * 2
    static let retryAge = hour * 3
    static let backgroundAge = hour * 5
    static let untitledAge = hour * 6
    static let pinnedAge = day + hour
    static let configAge = day + hour * 3
    static let docsAge = day * 3
    static let remoteAge = day * 4
    static let templatesAge = day * 9
    static let approvalAge = day * 12
    static let retryWait: TimeInterval = 52
    static let failedWait: TimeInterval = 22
    static let answeringHeight: CGFloat = 190
    static let failedRow = 6
    static let askedRow = 3
    static let editStep = 3
    static let added = 42
    static let removed = 7
    static let paneSettle = Motion.slow * 3
    static let connectionSettle = Motion.slow * 4
    static var kept: [AgentViewController] = []
    static var live: AgentViewController?

    static func ago(_ seconds: TimeInterval) -> Date { Date.now.addingTimeInterval(-seconds) }

    static func controller(hosted: Bool = false, workspace: URL = root) -> AgentViewController {
        let controller = AgentViewController(workspace: Workspace(root: workspace), hosted: hosted)
        _ = controller.view
        kept.append(controller)
        return controller
    }

    static func feed(_ controller: AgentViewController, _ updates: [AgentUpdate]) {
        for update in updates { controller.receive(AgentEvent(session: 0, connection: 0, update: update)) }
    }

    static func card(_ view: NSView, size: NSSize) -> NSView {
        let card = PaneCard()
        card.embed(view)
        return Gallery.sized(card, width: size.width, height: size.height)
    }

    static func navigator(_ controller: AgentViewController) -> NSView {
        card(controller.sessionsNavigator.view, size: sidebar)
    }

    static func session(_ id: String, _ title: String?, _ age: TimeInterval, _ run: SessionRun = .idle,
                        unread: Bool = false, pinned: Bool = false, asked: String? = nil, ask: AskKind? = nil,
                        background: (working: Int, waiting: Int) = (0, 0), reachable: Bool = true,
                        changes: ChangeTotals? = nil) -> SessionSummary {
        var summary = SessionSummary(id: id, title: title, lastActivity: ago(age))
        summary.run = run
        summary.unread = unread
        summary.pinned = pinned
        summary.asked = asked
        summary.askKind = ask
        summary.changes = changes
        summary.backgroundWorking = background.working
        summary.backgroundWaiting = background.waiting
        summary.reachable = reachable
        return summary
    }

    static var sessions: [SessionSummary] {
        [
            session("s1", "Add sorting by priority to the task list", askedAge, .asking(part: "p1"),
                    asked: "Which field should break ties?", ask: .question),
            session("s2", "Port the hub to context cancellation", minute / 2, .working(since: ago(runSeconds))),
            session("s3", "Explain how sessions resume after a dropped socket", unreadAge, unread: true,
                    changes: ChangeTotals(files: 2, added: 51, removed: 3)),
            session("s4", "Fix the flaky watcher test", failedAge, .failed("Rate limited")),
            session("s5", "Rename the store migrations", retryAge,
                    .retrying(reason: "The provider is overloaded", until: Date.now.addingTimeInterval(retryWait))),
            session("s6", "Profile the transcript on long sessions", backgroundAge, background: (2, 0)),
            session("s7", nil, untitledAge),
            session("s8", "Release notes for 0.42", pinnedAge, pinned: true),
            session("s9", "Add configuration defaults and validation", configAge, changes: ChangeTotals(files: 6, added: 377, removed: 12)),
            session("s10", "Move the docs site to the new router", docsAge),
            session("s11", "Try the remote workspace", remoteAge, reachable: false),
            session("s12", "Add support for reusable task templates", templatesAge),
            session("s13", "Add a race-detector run to the hub's CI job", approvalAge, .asking(part: "p2"),
                    asked: "Wants to run go test -race -count=1 ./hub/...", ask: .approval),
        ]
    }

    static func sessionsPane(selected: String? = "s2", hovered: Int? = nil, focused: Bool = false, query: String = "",
                             connection: ConnectionState = .ready, list: [SessionSummary] = sessions,
                             renaming: String? = nil, cursor: Int? = nil) -> NSView {
        let controller = controller()
        let navigator = navigator(controller)
        feed(controller, [.connection(connection), .sessions(list), .shown(selected)])
        if let sessions = controller.sessionsNavigator as? SessionsViewController {
            if !query.isEmpty {
                sessions.search.stringValue = query
            }
            sessions.list.showsFocusAlways = focused
            if let hovered { sessions.list.setHoveredRow(hovered) }
            if let cursor { sessions.list.selectedRow = cursor }
            if let renaming {
                navigator.layoutSubtreeIfNeeded()
                sessions.beginRename(renaming)
            }
        }
        return navigator
    }

    static let reply = """
    The hub now takes a `context.Context` in `Run`, and each client's write loop selects on `ctx.Done()` \
    so a cancelled request stops its broadcast.

    I kept `Shutdown` as it was. It still drains the queue before it closes the listeners.
    """

    static var conversation: [RowSpec] {
        let read = StepWords.row(key: "t1", kind: .read, outcome: .done, subject: "hub.go")
        let list = StepWords.row(key: "t2", kind: .list, outcome: .done, subject: "hub")
        var edit = StepWords.row(key: "t3", kind: .edit, outcome: .done, subject: "hub.go", added: added, removed: removed)
        edit.reviewable = true
        let shell = StepWords.row(key: "t4", kind: .shell, outcome: .done, subject: "go test ./hub/...")
        return [
            RowSpec(kind: .user, key: "u1", text: "Port the hub to context cancellation. Keep Shutdown working."),
            RowSpec(kind: .thinking, key: "k1", text: "", expandable: true),
            read, list, edit, shell,
            RowSpec(kind: .prose, key: "a1", part: "a1", text: reply),
            RowSpec(kind: .user, key: "u2", text: "Run the race detector too."),
        ]
    }

    static func runningShell() -> RowSpec {
        StepWords.row(key: "t5", kind: .shell, outcome: .running, subject: "go test -race ./hub/...")
    }

    static let model = ModelRef(provider: "anthropic", id: "claude-sonnet-4-5")
    static let models = [
        ModelChoice(ref: model, name: "Claude Sonnet 4.5", provider: "Anthropic"),
        ModelChoice(ref: ModelRef(provider: "openai", id: "gpt-5"), name: "GPT-5", provider: "OpenAI"),
    ]

    static func pane(_ updates: [AgentUpdate], connection: ConnectionState = .ready) -> NSView {
        let controller = controller()
        feed(controller, [.connection(connection), .models(models, current: model), .sessions(sessions)] + updates)
        return card(controller.view, size: pane)
    }

    static func open(_ rows: [RowSpec], live: Bool, activity: Activity? = nil, shown: String = "s2",
                     deadlines: [String: Date] = [:]) -> [AgentUpdate] {
        [
            .shown(shown), .title(sessions.first { $0.id == shown }?.title ?? "Port the hub to context cancellation"),
            .transcript(TranscriptSnapshot(rows: rows, live: live, sessionOpen: true, canLoadEarlier: false, activity: activity,
                                           deadlines: deadlines)),
            .permission(permission), .place(worktree: shown == "s13" ? "race-detector-ci" : nil, path: nil),
        ]
    }

    static var permission: Wire.Setting? {
        let json = #"{"id":"permissions","label":"Permissions","scope":"host","value":"auto-edit","choices":[{"value":"ask","label":"Ask first","badge":"Asks before commands, file edits and other tools"},{"value":"auto-edit","label":"Auto-edit","badge":"Edits workspace files, asks before commands and other tools"},{"value":"full","label":"Full access","badge":"Runs every tool without asking"}]}"#
        return try? JSONDecoder().decode(Wire.Setting.self, from: Data(json.utf8))
    }

    static var failed: [AgentUpdate] {
        var row = RowSpec(kind: .failure, key: HeadRows.turnKey("f1"), lead: "Rate limited", text: "The provider asked to wait 30 seconds.")
        row.retryable = true
        let prompt = RowSpec(kind: .user, key: "fu", text: "The watcher test times out on slow CI machines. Find out why and fix it.")
        return open([prompt, row], live: false, shown: "s4", deadlines: [row.key: Date.now.addingTimeInterval(failedWait)])
    }

    static func answering() -> NSView {
        let made = RequestCard()
        made.show(question)
        made.write(true)
        return card(made, size: NSSize(width: pane.width - Space.x3 * 2, height: answeringHeight))
    }

    static var approval: AgentRequest {
        .approval(Approval(session: "s2", part: "p2", title: "Run this command?", detail: "go test -race -count=1 ./hub/...",
                           command: true, subagent: false, tool: "bash"))
    }

    static var question: AgentRequest {
        .question(Question(session: "s2", part: "p3", items: [
            QuestionItem(header: "Next step", question: "Which improvement should we plan next?", options: [
                (label: "Template task CLI", description: "A command that creates tasks from templates with overrides."),
                (label: "Template variables", description: "Placeholders such as {{issue}}, checked when a template is applied."),
                (label: "Persistent task CLI", description: "List, create and complete tasks stored in data/tasks.json."),
            ]),
            QuestionItem(header: "Scope", question: "Should it ship behind a flag?", options: [
                (label: "Yes", description: ""), (label: "No", description: ""),
            ]),
        ], subagent: false))
    }

    static var working: Activity { Activity(kind: .working, since: ago(runSeconds)) }

    static let oldRevision = 15
    static let olderCommandLine = HostMismatch(reason: "Update the host: it serves \(oldRevision) and the client needs 17 or later.",
                                               hostIsOlder: true, hostVersion: "0.0.21", hostRevision: oldRevision, install: .commandLine)
    static let olderDesktop = HostMismatch(reason: "Update the host: it serves \(oldRevision) and the client needs 17 or later.",
                                           hostIsOlder: true, hostVersion: "0.0.21", hostRevision: oldRevision,
                                           install: .desktop(URL(fileURLWithPath: "/Applications/Nyte.app")))
}

@MainActor
let agentSessionsPage = GalleryPage(name: "agent-sessions", settle: Agent.connectionSettle) {
    Gallery.page([
        Gallery.section("Sessions", note: "Every state. The session on show is selected; the pointer is over the failed one.", [
            Gallery.row([
                Gallery.specimen("selected, hover", Agent.sessionsPane(hovered: Agent.failedRow)),
                Gallery.specimen("focused, selection moved off the open one", Agent.sessionsPane(focused: true, cursor: Agent.askedRow)),
                Gallery.specimen("renaming", Agent.sessionsPane(renaming: "s4")),
            ]),
            Gallery.row([
                Gallery.specimen("filtered", Agent.sessionsPane(selected: nil, query: "hub")),
                Gallery.specimen("no match", Agent.sessionsPane(selected: nil, query: "kubernetes")),
                Gallery.specimen("no sessions", Agent.sessionsPane(selected: nil, list: [])),
            ]),
        ]),
        Gallery.section("Disconnected", [
            Gallery.row([
                Gallery.specimen("host missing", Agent.sessionsPane(selected: nil, connection: .missing, list: [])),
                Gallery.specimen("incompatible", Agent.sessionsPane(
                    selected: nil, connection: .incompatible(Agent.olderCommandLine), list: []
                )),
                Gallery.specimen("connecting", Agent.sessionsPane(selected: nil, connection: .connecting, list: [])),
            ]),
        ]),
    ])
}

@MainActor
let agentPanePage = GalleryPage(name: "agent-pane", settle: Agent.paneSettle) {
    Gallery.page([
        Gallery.section("Agent pane", note: "A short conversation, then the two requests a run can wait on.", [
            Gallery.row([
                Gallery.specimen("conversation", Agent.pane(Agent.open(Agent.conversation + [Agent.runningShell()], live: true,
                                                                       activity: Agent.working))),
                Gallery.specimen("approval, in a worktree", Agent.pane(Agent.open(Agent.conversation, live: true, shown: "s13")
                    + [.requests([Agent.approval])])),
            ]),
            Gallery.row([
                Gallery.specimen("question", Agent.pane(Agent.open(Agent.conversation, live: true, shown: "s1") + [.requests([Agent.question])])),
                Gallery.specimen("failed, wait running", Agent.pane(Agent.failed)),
            ]),
            Gallery.row([
                Gallery.specimen("question, answered in own words", Agent.answering()),
            ]),
        ]),
    ])
}

@MainActor
let agentComposerPage = GalleryPage(name: "agent-composer", settle: Motion.slow) {
    Gallery.page([
        Gallery.section("Composer", note: "Empty in a new session, with a draft, and while a run is live.", [
            Gallery.row([
                Gallery.specimen("new session", Agent.pane([])),
                Gallery.specimen("draft", Agent.pane(Agent.open(Agent.conversation, live: false) + [
                    .draft("Now split the write loop into its own goroutine and keep the tests green"),
                ])),
            ]),
            Gallery.row([
                Gallery.specimen("send failed, draft kept", Agent.pane(Agent.open(Agent.conversation, live: false) + [
                    .draft("Now split the write loop into its own goroutine and keep the tests green"),
                    .sendFailed("The connection to Nyte dropped."),
                ])),
            ]),
            Gallery.row([
                Gallery.specimen("live", Agent.pane(Agent.open(Agent.conversation + [Agent.runningShell()], live: true,
                                                               activity: Agent.working))),
                Gallery.specimen("retrying", Agent.pane(Agent.open(Agent.conversation, live: true, activity: Activity(
                    kind: .retrying, since: Agent.ago(Agent.runSeconds), reason: "The provider is overloaded"
                )))),
            ]),
        ]),
    ])
}

@MainActor
let agentConnectionPage = GalleryPage(name: "agent-connection", settle: Agent.connectionSettle) {
    Gallery.page([
        Gallery.section("Connection", note: "Without a conversation the pane says it; with one, a banner sits over the composer.", [
            Gallery.row([
                Gallery.specimen("host missing", Agent.pane([], connection: .missing)),
                Gallery.specimen("connecting", Agent.pane([], connection: .connecting)),
            ]),
            Gallery.row([
                Gallery.specimen("incompatible, command-line host", Agent.pane([], connection: .incompatible(Agent.olderCommandLine))),
                Gallery.specimen("incompatible, desktop host", Agent.pane([], connection: .incompatible(Agent.olderDesktop))),
            ]),
            Gallery.row([
                Gallery.specimen("incompatible mid-conversation", Agent.pane(Agent.open(Agent.conversation, live: false),
                                                                             connection: .incompatible(Agent.olderCommandLine))),
                Gallery.specimen("lost mid-conversation", Agent.pane(Agent.open(Agent.conversation, live: false),
                                                                     connection: .missing)),
            ]),
        ]),
    ])
}

@MainActor
private func steps(hovered: Int? = nil) -> NSView {
    var specs = Agent.conversation.filter { $0.kind == .tool || $0.kind == .thinking } + [Agent.runningShell()]
    specs += [
        StepWords.row(key: "t6", kind: .edit, outcome: .denied, subject: "client.go"),
        StepWords.row(key: "t9", kind: .shell, outcome: .failed, subject: "go test ./store/..."),
        StepWords.row(key: "t10", kind: .shell, outcome: .timedOut, subject: "go test -race ./..."),
        StepWords.row(key: "t11", kind: .read, outcome: .stopped, subject: "migrate.go"),
        StepWords.row(key: "t7", kind: .delegate, outcome: .done, subject: "Explore how the store migrates rows"),
        StepWords.row(key: "t8", kind: .shell, outcome: .done, subject: "go vet ./..."),
        RowSpec(kind: .note, key: "n1", text: "Compacted the conversation"),
    ]
    let stack = NSStackView()
    stack.orientation = .vertical
    stack.spacing = 0
    stack.alignment = .width
    for (index, spec) in specs.enumerated() {
        var flags: Transcript.Flags = []
        if spec.running { flags.insert(.running) }
        if spec.failed { flags.insert(.failed) }
        if spec.expandable { flags.insert(.expandable) }
        if spec.reviewable { flags.insert(.reviewable) }
        if spec.key == "t8" { flags.insert(.expanded) }
        let cell = StepCell()
        cell.configure(kind: spec.kind, lead: spec.lead, text: spec.text, glyph: spec.glyph, flags: flags, added: Int32(spec.added),
                       removed: Int32(spec.removed), gap: 0)
        cell.hovering = index == hovered
        cell.heightAnchor.constraint(equalToConstant: Rows.line).isActive = true
        stack.addArrangedSubview(cell)
    }
    let review = ReviewCell()
    review.configure("2 files changed", added: Int32(Agent.added), removed: Int32(Agent.removed), gap: Space.x2)
    review.heightAnchor.constraint(equalToConstant: ReviewCell.height + Space.x2).isActive = true
    stack.addArrangedSubview(review)
    let holder = NSView()
    stack.translatesAutoresizingMaskIntoConstraints = false
    holder.addSubview(stack)
    NSLayoutConstraint.activate([
        stack.topAnchor.constraint(equalTo: holder.topAnchor, constant: Space.x3),
        stack.leadingAnchor.constraint(equalTo: holder.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
    ])
    return Agent.card(holder, size: NSSize(width: Agent.pane.width, height: Agent.stepsHeight))
}

@MainActor
let agentStepsPage = GalleryPage(name: "agent-steps") {
    Gallery.page([
        Gallery.section("Steps", note: "Tool steps, thinking and notes as one quiet line each; the edit row is under the pointer. A finished edit offers Review Changes beside its chevron, and a finished run ends with one.", [
            Gallery.row([Gallery.specimen("rest", steps()), Gallery.specimen("hover on the edit", steps(hovered: Agent.editStep))]),
        ]),
    ])
}

@MainActor
let agentLiveSessionsPage = GalleryPage(name: "agent-live", settle: 0, prepare: {
    await Wait.pause(Agent.liveWait)
}) {
    let controller = Agent.live ?? Agent.controller(hosted: true)
    Agent.live = controller
    return Gallery.page([
        Gallery.section("This repository's sessions", note: "Read from the running host; nothing is opened or sent.", [
            Agent.navigator(controller),
        ]),
    ])
}

@MainActor
private enum Replay {
    static let home = FileManager.default.temporaryDirectory.appending(path: "nyte-gallery-replay")
    static let wait: Duration = .seconds(3)
    static var host: ReplayHost?
    static var controller: AgentViewController?

    static func start() -> AgentViewController? {
        if let controller { return controller }
        do {
            host = try ReplayHost.start(home: home)
        } catch {
            return nil
        }
        setenv("NYTE_HOME", home.path, 1)
        let fixture = Agent.root.appending(path: "packages/ide/Fixtures/notifyhub-go")
        let made = Agent.controller(hosted: true, workspace: fixture)
        controller = made
        return made
    }
}

@MainActor
let agentReplayPage = GalleryPage(name: "agent-replay", settle: Motion.slow * 4, prepare: {
    await Wait.pause(Replay.wait)
    Replay.controller?.openSession(ReplayScript.transcript)
    await Wait.pause(Replay.wait)
}, teardown: {
    Replay.host?.stop()
    unsetenv("NYTE_HOME")
}) {
    guard let controller = Replay.start() else { return Gallery.page([]) }
    return Gallery.page([
        Gallery.section("Replay host", note: "The scripted workspace a replay host serves, read through the real client.", [
            Gallery.row([Agent.navigator(controller), Agent.card(controller.view, size: NSSize(width: Agent.pane.width,
                                                                                               height: Agent.replayHeight))]),
        ]),
    ])
}

@MainActor
private enum Context {
    static func file(_ path: String) -> URL { Agent.root.appending(path: path) }

    static let lines = AgentContext.lines(AgentContext.Lines(
        file: file("hub/hub.go"), range: .init(first: 41, last: 58),
        text: "func (h *Hub) Run(ctx context.Context) error {\n\tfor {\n\t\tselect {\n\t\tcase msg := <-h.broadcast:\n\t\t\tfor c := range h.clients {\n\t\t\t\tc.send <- msg\n\t\t\t}\n\t\tcase <-ctx.Done():\n\t\t\treturn ctx.Err()\n\t\t}\n\t}\n}"
    ))
    static let diagnostic = AgentContext.diagnostic(AgentContext.Diagnostic(
        file: file("hub/hub.go"), start: .init(line: 47, column: 9), end: .init(line: 47, column: 12), severity: .error,
        message: "undefined: ctx", source: "gopls", code: "UndeclaredName"
    ))
    static let review = AgentContext.review(AgentContext.Review(
        file: file("hub/hub_test.go"), side: .new, range: .init(first: 13, last: 14),
        lines: "\tgo func() { done <- h.Run(ctx) }()\n\tcancel()", comment: "Cancel only after Run has started."
    ))
    static let terminal = AgentContext.terminal(AgentContext.Terminal(
        text: "$ go test -race ./hub/...\nWARNING: DATA RACE\nexit status 66", directory: Agent.root
    ))
    static let stop = AgentContext.stop(AgentContext.Stop(file: file("hub/hub.go"), line: 44, function: "(*Hub).Run", locals: [
        .init(name: "ctx", type: "context.Context", value: "context.Background.WithCancel"),
        .init(name: "msg", type: "[]byte", value: "len: 12, cap: 16"),
    ]))
    static var big: AgentContext {
        .lines(AgentContext.Lines(file: file("store/schema.sql"), range: .init(first: 1, last: 5_000),
                                  text: (1 ... 5_000).map { "-- row \($0)" }.joined(separator: "\n")))
    }

    static var all: [AgentContext] { [lines, diagnostic, review, terminal, stop, .file(file("hub/client.go"))] }
    static var flow: ChipFlow?

    static func composing(_ items: [AgentContext], draft: String) -> NSView {
        let controller = Agent.controller()
        Agent.feed(controller, [.connection(.ready), .models(Agent.models, current: Agent.model), .sessions(Agent.sessions)]
            + Agent.open(Agent.conversation, live: false) + [.draft(draft)])
        controller.addContext(items)
        return Agent.card(controller.view, size: Agent.pane)
    }

    static func peeking() -> NSView {
        let made = ChipFlow(singleLine: false)
        made.show(all.map { ContextFormat.chip(ContextFormat.capped($0), root: Agent.root) }, removable: true)
        flow = made
        let holder = NSView()
        holder.addSubview(made)
        NSLayoutConstraint.activate([
            made.leadingAnchor.constraint(equalTo: holder.leadingAnchor, constant: Space.x3),
            made.trailingAnchor.constraint(equalTo: holder.trailingAnchor, constant: -Space.x3),
            made.bottomAnchor.constraint(equalTo: holder.bottomAnchor, constant: -Space.x3),
        ])
        return Agent.card(holder, size: NSSize(width: Agent.pane.width, height: Agent.peekHeight))
    }

    static func sent() -> NSView {
        let controller = Agent.controller()
        let chips = all.map { ContextFormat.chip(ContextFormat.capped($0), root: Agent.root) }
        var rows = Agent.conversation
        let at = rows.firstIndex { $0.key == "u2" }.map { $0 + 1 } ?? rows.count
        rows.insert(RowSpec(kind: .context, key: "ctx:u2", text: ""), at: at)
        Agent.feed(controller, [.connection(.ready), .models(Agent.models, current: Agent.model), .sessions(Agent.sessions),
                                .shown("s2"), .title("Port the hub to context cancellation"),
                                .transcript(TranscriptSnapshot(rows: rows, live: false, sessionOpen: true, canLoadEarlier: false,
                                                               contexts: ["ctx:u2": chips]))])
        return Agent.card(controller.view, size: Agent.pane)
    }
}

@MainActor
let agentContextPage = GalleryPage(name: "agent-context", settle: Motion.slow * 2, prepare: {
    Context.flow?.showPeek(at: 0)
}) {
    Gallery.page([
        Gallery.section("Context in the composer", note: "Chips above the draft: file lines, a diagnostic, a review comment, terminal output, a debugger stop and a file.", [
            Gallery.row([
                Gallery.specimen("six kinds", Context.composing(Context.all, draft: "Why does Run miss the cancel?")),
                Gallery.specimen("over the cap", Context.composing([Context.big], draft: "Check the schema for missing indexes.")),
            ]),
            Gallery.row([
                Gallery.specimen("hover shows the content", Context.peeking()),
                Gallery.specimen("a sent turn keeps its context as one row", Context.sent()),
            ]),
        ]),
    ])
}

@MainActor
private enum Switcher {
    static func open() -> NSView {
        let controller = Agent.controller()
        Agent.feed(controller, [.connection(.ready), .models(Agent.models, current: Agent.model), .sessions(Agent.sessions)]
            + Agent.open(Agent.conversation, live: true))
        let sessions = controller.switcher.sessions
        let surface = FloatingSurface(radius: Radius.card)
        surface.translatesAutoresizingMaskIntoConstraints = false
        let content = sessions.view
        content.translatesAutoresizingMaskIntoConstraints = false
        surface.addSubview(content)
        controller.view.addSubview(surface)
        let height = min(SessionSwitcher.mostHeight, max(SessionSwitcher.fewestHeight, sessions.preferredHeight))
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: surface.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: surface.trailingAnchor),
            content.topAnchor.constraint(equalTo: surface.topAnchor),
            content.bottomAnchor.constraint(equalTo: surface.bottomAnchor),
            surface.topAnchor.constraint(equalTo: controller.header.bottomAnchor, constant: FloatingPanel.anchorGap),
            surface.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor, constant: Space.x1),
            surface.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor, constant: -Space.x1),
            surface.heightAnchor.constraint(equalToConstant: height),
        ])
        sessions.list.showsFocusAlways = true
        sessions.list.selectedRow = sessions.lines.firstIndex { $0.key == "s2" }
        return Agent.card(controller.view, size: Agent.pane)
    }

    static func waiting() -> NSView {
        Agent.pane(Agent.open(Agent.conversation, live: true, shown: "s13") + [.requests([Agent.approval])])
    }
}

@MainActor
let agentSwitcherPage = GalleryPage(name: "agent-switcher", settle: Agent.paneSettle) {
    Gallery.page([
        Gallery.section("Session switcher", note: "The pane's title opens the sessions: search, New Session, then the list by day.", [
            Gallery.row([
                Gallery.specimen("switcher open", Switcher.open()),
                Gallery.specimen("a session waiting on approval", Switcher.waiting()),
            ]),
        ]),
    ])
}
