import Foundation
import NyteCore

extension AgentEngine {
    private enum Joined {
        case workspace(String)
        case refused(String)
    }

    func send(_ text: String, context: [AgentContext] = [], epoch mine: Int) async {
        guard mine == epoch else { return }
        let receipt = UUID().uuidString.lowercased()
        failures = []
        emit(.sendFailed(nil))
        prompts.append((receipt, text))
        if sentAt == nil { sentAt = .now }
        emitSnapshot()
        let content = Wire.Content(items: ContextFormat.content(prompt: text, context: context, root: URL(fileURLWithPath: root)))
        do throws(LinkError) {
            if let id = shown?.id {
                if let chosen, chosen != rows?.selectedModel {
                    let outcome = try await link.call(Wire.Configure(session: id, head: Self.head, patch: .init(model: chosen)))
                    guard case .configured = outcome else {
                        AgentLog.logger.error("head.configure refused the model: \(String(describing: outcome), privacy: .public)")
                        return unsent(receipt, text, context, "Nyte can't use that model for this chat.", epoch: mine)
                    }
                }
                chosen = nil
                let send = Wire.Send(session: id, head: Self.head, content: content, options: .init(id: receipt))
                _ = try await replaying { () async throws(LinkError) in try await self.link.call(send) }
                return
            }
            let workspace: String
            switch try await join() {
            case let .workspace(id): workspace = id
            case let .refused(reason): return unsent(receipt, text, context, reason, epoch: mine)
            }
            let start = Wire.Start(id: receipt, workspace: workspace, content: content, configuration: chosen.map(Wire.ModelPatch.init(model:)))
            let started = try await replaying { () async throws(LinkError) in try await self.link.call(start) }
            guard mine == epoch else { return }
            chosen = nil
            open(started.session, keeping: true)
            await attach()
        } catch {
            unsent(receipt, text, context, error.message, epoch: mine)
        }
    }

    private func unsent(_ receipt: String, _ text: String, _ context: [AgentContext], _ reason: String, epoch mine: Int) {
        guard mine == epoch else { return }
        prompts.removeAll { $0.id == receipt }
        emit(.draft(text))
        if !context.isEmpty { emit(.draftContext(context)) }
        emit(.sendFailed(reason))
        emitSnapshot()
    }

    func retry(turn: String, epoch mine: Int) async {
        guard mine == epoch, let id = shown?.id, let prompt = rows?.retryPrompt(turn: turn) else { return }
        failures = []
        let send = Wire.Send(session: id, head: Self.head, content: Wire.Content(items: prompt.content),
                             options: .init(id: UUID().uuidString.lowercased(), replace: prompt.id))
        do throws(LinkError) {
            _ = try await replaying { () async throws(LinkError) in try await self.link.call(send) }
        } catch {
            guard mine == epoch else { return }
            failures = ["Couldn't retry: \(error.message)"]
            emitSnapshot()
        }
    }

    private func join() async throws(LinkError) -> Joined {
        switch place {
        case let .registered(id): return .workspace(id)
        case .unknown: return .refused("Nyte hasn't read this folder yet.")
        case let .unregistered(identity):
            let added = try await replaying { () async throws(LinkError) in
                try await self.link.call(Wire.AddWorkspace(target: Wire.Target(path: self.root),
                                                           options: .init(expect: .init(identity: identity))))
            }
            switch added {
            case let .added(id), let .exists(id):
                place = .registered(id)
                return .workspace(id)
            case .stale:
                AgentLog.logger.error("workspaces.add answered stale")
                return .refused("This folder changed while it was opened. Try again.")
            case .unavailable, .unknown:
                AgentLog.logger.error("workspaces.add refused: \(String(describing: added), privacy: .public)")
                return .refused("Nyte can't open this folder.")
            }
        }
    }

    private func replaying<Output>(_ call: () async throws(LinkError) -> Output) async throws(LinkError) -> Output {
        var attempt = 1
        while true {
            do throws(LinkError) {
                return try await call()
            } catch {
                guard error == .lost, attempt < Self.attempts else { throw error }
                attempt += 1
                try await waitUntilReady()
            }
        }
    }

    private func waitUntilReady() async throws(LinkError) {
        while connection != .ready {
            if case .incompatible = connection { throw .lost }
            do {
                try await Task.sleep(for: Self.readyWait)
            } catch {
                throw .lost
            }
        }
    }

    func stop(epoch mine: Int) async {
        guard mine == epoch, let id = shown?.id, let run = rows?.execution.runID else { return }
        do throws(LinkError) {
            _ = try await link.call(Wire.StopRun(session: id, run: run))
        } catch {
            guard mine == epoch else { return }
            failures = ["Couldn't stop the run: \(error.message)"]
            emitSnapshot()
        }
    }

    func act(_ request: AgentRequest, _ answer: RequestAnswer, epoch mine: Int) async {
        do throws(LinkError) {
            let outcome = try await link.call(Wire.Act(session: request.session, part: request.part, answer: answer))
            let problem: String = switch outcome {
            case .ok: ""
            case let .rejected(reason): reason.isEmpty ? "Nyte didn't take that answer." : "Nyte didn't take that answer: \(reason)"
            case let .failed(message): message.isEmpty ? "Nyte didn't take that answer." : message
            case .closed: "The request closed before the answer arrived."
            case .noOwner: "The plugin that asked isn't loaded."
            case .unknownAction, .unknown: "Nyte didn't take that answer."
            }
            guard !problem.isEmpty else { return }
            AgentLog.logger.error("part.act was not taken")
            failures = [problem]
        } catch {
            failures = ["Couldn't answer: \(error.message)"]
        }
        guard mine == epoch else { return }
        emitSnapshot()
    }

    func openSession(_ id: String, epoch mine: Int) async {
        epoch = mine
        await close()
        open(id, keeping: false)
        emitSnapshot()
        emitRequests()
        emitPlace()
        emitPermission()
        guard connection == .ready else { return }
        await attach()
    }

    func newChat(epoch mine: Int) async {
        epoch = mine
        await close()
        emitSnapshot()
        emitRequests()
        emitModels()
        emitPlace()
        emitPermission()
    }

    func open(_ id: String, keeping: Bool) {
        if shown?.id != id {
            shown = Shown(id: id)
            if !keeping { prompts = [] }
            failures = []
        }
        shown?.title = summaries[id]?.title
        emit(.title(shown?.title))
        emit(.shown(id))
    }

    private func close() async {
        let scopes = ([shown?.id].compactMap { $0 } + children.keys).map { "session/" + $0 }
        children = [:]
        shown = nil
        prompts = []
        failures = []
        chosen = nil
        lastRequests = []
        sentAt = nil
        emit(.title(nil))
        emit(.shown(nil))
        if !scopes.isEmpty { await quietly(Wire.Unsubscribe(scopes: scopes)) }
    }

    func rename(_ id: String, to name: String) async {
        let problem: String
        do throws(LinkError) {
            switch try await link.call(Wire.UpdateSession(session: id, patch: .init(name: name))) {
            case .updated: return
            case .busy: problem = "The session is busy. Try again when its run ends."
            case .unknownWorkspace, .unknown: problem = "Nyte didn't rename the session."
            }
            AgentLog.logger.error("session.update refused the rename")
        } catch {
            problem = error.message
        }
        emit(.renameRefused(problem))
        emitSessions()
        if id == shown?.id { emit(.title(shown?.title)) }
    }

    func archive(_ id: String) async -> String? {
        do throws(LinkError) {
            switch try await link.call(Wire.UpdateSession(session: id, patch: .init(archived: true))) {
            case .updated:
                summaries.removeValue(forKey: id)
                emitSessions()
                return nil
            case .busy: return "The session is busy. Try again when its run ends."
            case .unknownWorkspace, .unknown: return "Nyte didn't archive the session."
            }
        } catch {
            return error.message
        }
    }

    func see() async {
        guard let id = shown?.id, let summary = summaries[id], summary.unread, let tip = summary.tip, tip != shown?.seen else { return }
        shown?.seen = tip
        await quietly(Wire.See(session: id, head: Self.head, commit: tip))
    }

    func choose(_ model: ModelRef) {
        chosen = model
        emitModels()
    }

    func loadEarlier() async {
        guard let id = shown?.id, let oldest = rows?.oldest, shown?.history == .more else { return }
        shown?.history = .loading
        do throws(LinkError) {
            let page = try await link.call(Wire.ReadHistory(session: id, head: Self.head, before: oldest, limit: Self.page))
            guard id == shown?.id else { return }
            let added = withRows { $0.prepend(page) } ?? 0
            shown?.history = added == 0 ? .done : .more
        } catch {
            guard id == shown?.id else { return }
            shown?.history = .more
            failures = ["Couldn't load earlier messages: \(error.message)"]
        }
        emitSnapshot()
    }

    func reviewTallies(_ rows: HeadRows) -> [String: ChangeReview.Tally] {
        var found: [String: ChangeReview.Tally] = [:]
        for turn in rows.endedTurns {
            guard let entries = rows.changeEntries(turn: turn, runs: runs) else { continue }
            let key = entries.map { "\($0.path) \($0.status) \($0.added) \($0.removed) \($0.edits.map(\.entry.digest))" }.joined(separator: "\n")
            if reviews[turn]?.key != key, let set = changes(.run(turn: turn)) {
                reviews[turn] = (key, ChangeReview.tally(set))
            }
            found[turn] = reviews[turn]?.tally
        }
        return found
    }

    func changes(_ target: ReviewTarget) -> AgentChangeSet? {
        guard let id = shown?.id, let rows else { return nil }
        let root = URL(fileURLWithPath: self.root)
        let read = { (url: URL) in try? String(contentsOf: url, encoding: .utf8) }
        switch target {
        case let .step(part):
            guard let edit = rows.edit(part: part), case let .part(message)? = rows.messages[part]?.body,
                  case let .tool(state) = message.body.content else { return nil }
            let title = StepWords.title(state.stepKind, .done) + " " + state.subjectText
            return ChangeReview.build(session: id, scope: .step(part: part), title: title, root: root,
                                      entries: ChangeReview.entries([edit]), read: read)
        case let .run(turn):
            guard let entries = rows.changeEntries(turn: turn, runs: runs), !entries.isEmpty else { return nil }
            return ChangeReview.build(session: id, scope: .run(turn: turn), title: ChangeReview.turnTitle, root: root, entries: entries,
                                      read: read)
        case .session:
            guard case let .host(files)? = runs[ChangeReview.sessionKey(id)] else { return nil }
            let edits = rows.transcript.compactMap { rows.edit(part: $0) }
            let entries = ChangeReview.entries(.host(files), edits: edits) ?? []
            return ChangeReview.build(session: id, scope: .session, title: ChangeReview.runTitle, root: root, entries: entries, read: read)
        }
    }

    func sessionChanges() async -> AgentChangeSet? {
        guard let id = shown?.id, case let .registered(workspace) = place else { return nil }
        do throws(LinkError) {
            let set = try await link.call(Wire.RunChanges(workspace: workspace, source: .init(session: id)))
            runs[ChangeReview.sessionKey(id)] = .host(set.files)
        } catch {
            return nil
        }
        return changes(.session)
    }

    func output(of part: String) async -> ToolOutput? {
        guard let id = shown?.id, case let .part(message)? = rows?.messages[part]?.body,
              case let .tool(state) = message.body.content else { return nil }
        guard message.elided else { return state.output }
        do throws(LinkError) {
            let read = try await link.call(Wire.ReadPart(session: id, part: part))
            guard case let .tool(whole)? = read.part?.body.content else { return state.output }
            return whole.output
        } catch {
            return ToolOutput(text: "Couldn't read the whole output: \(error.message)", diff: false)
        }
    }
}
