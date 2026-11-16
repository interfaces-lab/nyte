import AppKit
import NyteCore
@testable import NyteReplay
@testable import NyteAgent

extension HostCheck {
    static func serveReplay(_ arguments: [String]) async {
        guard arguments.count >= 2 else { fail("usage: NyteProbe host replay <nyte-home>") }
        let home = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        let host: ReplayHost
        do {
            host = try ReplayHost.start(home: home)
        } catch {
            fail("replay: \(error)")
        }
        FileHandle.standardOutput.write(Data("replay host on 127.0.0.1:\(host.port); run the app with NYTE_HOME=\(home.path)\n".utf8))
        while await Patience.pause(.seconds(3_600)) {}
    }

    @MainActor enum ReplayCheck {
        static func pane(check: HostCheck, root: URL) async {
            let controller = AgentViewController(workspace: Workspace(root: root), hosted: true)
            var heard: [[AgentWaitingSession]] = []
            controller.onWaitingChange = { heard.append($0) }
            _ = controller.view
            _ = await Patience.until(wait) { controller.waitingSessions.count == 2 }
            let waiting = controller.waitingSessions.map { "\($0.request) \($0.id)" }
            check.expect(controller.waitingSessions.map(\.request) == [.approval, .question] && heard.last == controller.waitingSessions
                         && controller.waitingSessions.allSatisfy { !$0.asked.isEmpty },
                         "replay: the pane hands the shell \(waiting.count) waiting sessions: \(waiting.joined(separator: ", "))")
            let key = { (flags: NSEvent.ModifierFlags) in
                NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil,
                                 characters: "s", charactersIgnoringModifiers: "s", isARepeat: false, keyCode: 1)
            }
            let opens = [key([.control, .command]), key(.command), key([.command, .option])].map { $0.map(SessionSwitcher.matches) ?? false }
            check.expect(opens == [true, false, false], "replay: \u{2303}\u{2318}S opens the session switcher; \u{2318}S and \u{2325}\u{2318}S do not")
        }

        static let wait: Duration = .seconds(10)
        static let scratchRoot = URL(fileURLWithPath: "/tmp/replay-workspace")
        static let fixture = "packages/ide/Fixtures/notifyhub-go"

        static func run(check: HostCheck, home: URL) async {
            let host: ReplayHost
            do {
                host = try ReplayHost.start(home: home)
            } catch {
                return check.expect(false, "replay: \(error)")
            }
            setenv("NYTE_HOME", home.path, 1)
            let fixture = HostCheck.repository().appending(path: Self.fixture)
            let onDisk = (try? String(contentsOf: fixture.appending(path: "hub/hub.go"), encoding: .utf8),
                          try? String(contentsOf: fixture.appending(path: "hub/hub_test.go"), encoding: .utf8))
            let matches = onDisk.0 == ReplayScript.hubAfter && onDisk.1 == ReplayScript.hubTest
            check.expect(matches, "replay: the scripted hub.go and hub_test.go after texts equal the Go fixture on disk")
            let root = matches ? fixture : Self.scratchRoot
            let engine = AgentEngine(root: root)
            let seen = EngineWatcher(engine)
            await engine.start()
            let listed = await Patience.until(wait) {
                seen.connection == .ready && seen.sessions?.count == ReplayScript.sessions.count
                    && seen.sessions?.allSatisfy { if case .asking = $0.run { $0.asked != nil } else { true } } == true
            }
            check.expect(listed, "replay: engine ready on port \(host.port) with \(seen.sessions?.count ?? 0) sessions, isolated NYTE_HOME \(home.path)")
            let runs = Dictionary(uniqueKeysWithValues: (seen.sessions ?? []).map { ($0.id, $0) })
            check.expect(runs[ReplayScript.running].map { if case .working = $0.run { $0.backgroundWorking == 2 } else { false } } == true,
                         "replay: running session is working with 2 subagents")
            check.expect(runs[ReplayScript.approval]?.asked?.hasPrefix("Wants to run go test -race") == true,
                         "replay: approval session needs input: \u{201C}\(runs[ReplayScript.approval]?.asked ?? "")\u{201D}")
            check.expect(runs[ReplayScript.question]?.asked == "Which improvement should we plan next?",
                         "replay: question session needs input: \u{201C}\(runs[ReplayScript.question]?.asked ?? "")\u{201D}")
            check.expect(runs[ReplayScript.failed]?.run == .failed("Rate limited"), "replay: failed session reads Rate limited")
            check.expect(runs[ReplayScript.retrying].map { if case .retrying = $0.run { true } else { false } } == true,
                         "replay: retrying session reads Retrying")
            check.expect(runs[ReplayScript.unread]?.unread == true && runs[ReplayScript.pinned]?.pinned == true,
                         "replay: one unread session and one pinned")
            let now = Date.now
            let states = ReplayScript.sessions.map { session in runs[session.id].map(SessionState.init) ?? .none }
            let words = states.map { $0.words(now: now) }
            let badges = states.map { $0.badge.map { [$0.text, $0.isLabel ? "label" : "chip"].joined(separator: " ") } ?? "" }
            check.expect(states.map(\.mark) == [.working, .waiting, .waiting, .unread, .none, .failed, .retrying, .none]
                         && badges.filter { !$0.isEmpty } == ["Approval label", "Question label"]
                         && words[6].hasPrefix("Retrying in ") && states.filter(\.isWaiting).count == 2,
                         "replay: session states \(words.map { $0.isEmpty ? "-" : $0 }.joined(separator: ", ")); trailing \(badges.filter { !$0.isEmpty })")
            check.expect(runs[ReplayScript.approval]?.worktree == ReplayScript.worktreeBranch,
                         "replay: the approval session is listed from its worktree \(runs[ReplayScript.approval]?.worktree ?? "missing")")
            await engine.needChanges(sessions: [ReplayScript.transcript, ReplayScript.unread])
            _ = await Patience.until(wait) { seen.sessions?.first { $0.id == ReplayScript.unread }?.changes != nil }
            let unreadTotals = seen.sessions?.first { $0.id == ReplayScript.unread }?.changes
            let quietTotals = seen.sessions?.first { $0.id == ReplayScript.transcript }?.changes
            let unreadLine = seen.sessions?.first { $0.id == ReplayScript.unread }.map {
                SessionLines.content(SessionLines.line($0, shown: nil, doing: nil, opening: nil, now: now))
            }
            check.expect(unreadTotals == ChangeTotals(files: 2, added: 51, removed: 3) && quietTotals == ChangeTotals(files: 0, added: 0, removed: 0)
                         && unreadLine.map { $0.diff?.added == 51 && $0.diff?.removed == 3 && $0.alignsFacts && !$0.meta.isEmpty } == true,
                         "replay: list rows carry their last run's totals from workspace.changes: unread +\(unreadTotals?.added ?? 0) \u{2212}\(unreadTotals?.removed ?? 0) over \(unreadTotals?.files ?? 0) files, the transcript's last run changed \(quietTotals?.files ?? -1)")

            await engine.openSession(ReplayScript.transcript, epoch: 1)
            _ = await Patience.until(wait) { seen.transcript?.sessionOpen == true && (seen.transcript?.rows.count ?? 0) > 2 }
            _ = await Patience.until(wait) { seen.transcript?.rows.contains { $0.kind == .review } == true }
            let rows = seen.transcript?.rows ?? []
            let leads = rows.filter { $0.kind == .tool }.map { [$0.lead, $0.text].joined(separator: " ") }
            check.expect(leads == ["Read hub.go", "Listed hub", "Edited hub.go", "Edited hub_test.go", "Ran go test ./hub/...",
                                   "Ran go test -race ./hub/..."]
                         && rows.contains { $0.kind == .prose } && rows.contains { $0.kind == .thinking }
                         && rows.filter { $0.kind == .review }.map(\.text) == ["This turn \u{00B7} 2 files changed"],
                         "replay: transcript session shows \(rows.count) rows: \(leads.joined(separator: ", ")), a reply, and \(rows.filter { $0.kind == .review }.count) run review")
            let sentChips = seen.transcript?.contexts.values.first?.map { [$0.label, $0.detail].filter { !$0.isEmpty }.joined(separator: " ") } ?? []
            let prompt = rows.first { $0.kind == .user && $0.key == "t2-prompt" }?.text ?? ""
            check.expect(sentChips == ["hub.go", "hub.go:50-56", "hub.go:77", "hub_test.go:26", "Terminal 3 lines"]
                         && prompt == "Run the race detector too, and look at what I marked."
                         && rows.contains { $0.kind == .context },
                         "replay: the last user turn shows its prompt and one row of context chips: \(sentChips.joined(separator: ", "))")
            if let changes = await engine.changes(.run(turn: "t1")) {
                let shapes = changes.files.map { file -> String in
                    switch file.content {
                    case .texts: "\(file.path) with both texts"
                    case .patches: "\(file.path) as a patch"
                    case .unavailable: "\(file.path) unavailable"
                    }
                }
                let review = rows.first { $0.kind == .review }
                let statuses = changes.files.map(\.status)
                let proven = changes.files.allSatisfy { if case .texts = $0.content { true } else { false } }
                check.expect(changes.files.count == 2 && statuses == [.modified, .modified] && changes.title == ChangeReview.turnTitle
                             && review?.added == ChangeReview.tally(changes).added && review?.removed == ChangeReview.tally(changes).removed
                             && (proven || !matches),
                             "replay: \(changes.title) has \(shapes.joined(separator: ", ")), +\(changes.added) \u{2212}\(changes.removed); the row under the run reads +\(review?.added ?? 0) \u{2212}\(review?.removed ?? 0)")
            } else {
                check.expect(false, "replay: no change set for the run")
            }
            let whole = await engine.sessionChanges()
            check.expect(whole?.title == ChangeReview.runTitle && whole?.scope == .session && whole?.files.map(\.status) == [.modified, .modified]
                         && whole?.files.allSatisfy { Diff.counts(of: $0) == ($0.added, $0.removed) } == true,
                         "replay: Review All Changes reads \(whole?.title ?? "nothing"): \(whole?.files.map { "\($0.path) +\($0.added) \u{2212}\($0.removed)" } ?? []) from workspace.changes for the session")
            let restored = ChangeReview.reverse(ReplayDiff.patch(path: "hub/hub.go", before: ReplayScript.hubBefore,
                                                                 after: ReplayScript.hubAfter).text, from: ReplayScript.hubAfter)
            check.expect(restored == ReplayScript.hubBefore, "replay: the scripted hub.go patch reverses to its before text")

            await engine.openSession(ReplayScript.approval, epoch: 2)
            let approval = await Patience.until(wait) { seen.requests.contains { if case .approval = $0 { true } else { false } } }
            _ = await Patience.until(wait) { seen.place == ReplayScript.worktreeBranch && seen.permission != nil }
            check.expect(approval && seen.place == ReplayScript.worktreeBranch && seen.permission?.chosen?.label == "Ask first",
                         "replay: approval session shows its card; footer reads \(seen.permission?.chosen?.label ?? "no mode") in \(seen.place ?? "the folder")")
            await engine.openSession(ReplayScript.question, epoch: 3)
            let question = await Patience.until(wait) {
                seen.requests.contains { if case let .question(item) = $0 { item.items.count == 2 } else { false } }
            }
            check.expect(question, "replay: question session shows its two-step question card")
            await engine.openSession(ReplayScript.failed, epoch: 4)
            let failure = await Patience.until(wait) {
                seen.transcript?.rows.contains { $0.kind == .failure && $0.lead == "Rate limited" && $0.retryable } == true
            }
            let failed = seen.transcript?.rows.first { $0.kind == .failure }
            let left = seen.transcript?.deadlines[failed?.key ?? ""].flatMap { SessionState.remaining(until: $0, now: .now) }
            check.expect(failure && failed?.text == "The provider asked to wait 30 seconds." && left != nil,
                         "replay: failed session reads \(failed?.lead ?? "") / \(failed?.text ?? ""), Retry with \(left ?? "no") wait left")
            await engine.openSession(ReplayScript.running, epoch: 5)
            let live = await Patience.until(wait) {
                seen.transcript?.live == true && seen.transcript?.rows.contains { $0.kind == .prose && $0.text.contains("already exact") } == true
            }
            check.expect(live, "replay: running session is live, with the streamed answer over its stored text")
            await engine.rename(ReplayScript.pinned, to: "Renamed")
            let refused = await Patience.until(wait) { seen.refused != nil }
            check.expect(refused, "replay: a rename is refused politely: \u{201C}\(seen.refused ?? "")\u{201D}")
            let archived = await engine.archive(ReplayScript.unread)
            check.expect(archived != nil, "replay: archiving goes through session.update and is refused politely: \u{201C}\(archived ?? "")\u{201D}")
            await pane(check: check, root: root)
            await engine.shutdown()
            await seen.finished()
            host.stop()
            unsetenv("NYTE_HOME")
        }
    }
}
