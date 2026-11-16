import Foundation

extension Wire.Failure {
    var summary: String {
        switch cause {
        case .rateLimit: return "Rate limited"
        case .auth: return "The provider refused the sign-in"
        case .quota: return "Out of quota"
        case .contextWindow: return "The context window is full"
        case .overloaded: return "The provider is overloaded"
        case .network: return "The network failed"
        case .aborted: return "Stopped"
        case .provider, .runner, .unknown:
            let line = message.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
            return line.isEmpty ? "Failed" : line
        }
    }

    var detail: String {
        if let retryAfter {
            let wait = retryAfter.formatted(.units(allowed: [.hours, .minutes, .seconds], width: .wide, maximumUnitCount: 2))
            return "The provider asked to wait \(wait)."
        }
        let firstLine = message.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        guard !firstLine.isEmpty, firstLine != summary else { return "" }
        let prefix = summary + ": "
        guard firstLine.hasPrefix(prefix) else { return firstLine }
        let rest = firstLine.dropFirst(prefix.count)
        return rest.prefix(1).uppercased() + rest.dropFirst()
    }
}

extension Wire.Execution {
    static func date(_ milliseconds: Double) -> Date { Date(timeIntervalSince1970: milliseconds / 1000) }

    var sessionRun: SessionRun {
        switch self {
        case let .live(run, _): .working(since: Self.date(run.startedAt))
        case let .retrying(_, reason, until): .retrying(reason: reason, until: until.map(Self.date))
        case let .waiting(_, .part(part)): .asking(part: part)
        case let .waiting(run, _): .working(since: Self.date(run.startedAt))
        case let .idle(.failed(failure)?, _): .failed(failure.summary)
        case .idle, .unknown: .idle
        }
    }

    var runID: String? {
        switch self {
        case let .live(run, _), let .waiting(run, _), let .retrying(run, _, _): run.id
        case .idle, .unknown: nil
        }
    }

    var endedRun: String? {
        guard case let .idle(_, run) = self else { return nil }
        return run
    }

    func activity(prompting: Bool, sentAt: Date?) -> (live: Bool, activity: Activity?) {
        let fallback = Activity(kind: .working, since: sentAt ?? .now)
        switch self {
        case .idle: return prompting ? (true, fallback) : (false, nil)
        case .unknown: return (true, fallback)
        case let .live(run, stopping): return (true, Activity(kind: stopping ? .stopping : .working, since: Self.date(run.startedAt)))
        case .waiting(_, .part): return (true, nil)
        case let .waiting(run, _): return (true, Activity(kind: .working, since: Self.date(run.startedAt)))
        case let .retrying(run, reason, until):
            return (true, Activity(kind: .retrying, since: Self.date(run.startedAt), reason: reason, until: until.map(Self.date)))
        }
    }
}

extension Wire.SessionRow {
    func summary(head name: String, asks: [String: AgentRequest]) -> SessionSummary {
        let head = heads.first { $0.name == name } ?? heads.first
        var summary = SessionSummary(id: id, title: self.name, lastActivity: Wire.Execution.date(lastActivityAt))
        summary.run = head?.execution.sessionRun ?? .idle
        summary.backgroundWorking = head?.background.working ?? 0
        summary.backgroundWaiting = head?.background.waiting ?? 0
        summary.unread = head?.unread ?? false
        summary.pinned = pinned
        summary.reachable = switch activation {
        case .unavailable, .failed: false
        case .active, .inactive, .unknown: true
        }
        if case let .commit(tip)? = head?.tip { summary.tip = tip }
        summary.lastRun = head?.execution.endedRun
        if case let .asking(part) = summary.run, let ask = asks[part] {
            summary.asked = ask.summary
            summary.askKind = ask.kind
        }
        return summary
    }

    func belongs(to workspace: String) -> Bool {
        self.workspace == workspace && parent == nil && !archived
    }
}

extension Wire.Part {
    func request(session: String, subagent: Bool) -> AgentRequest? {
        guard body.status == .live else { return nil }
        switch body.content {
        case let .approval(state):
            guard !state.decided else { return nil }
            let (title, detail): (String, String) = switch state.subject {
            case let .shell(command): ("Run this command?", command)
            case let .edit(path): (state.reason == .outside ? "Edit outside the workspace?" : "Edit this file?", path)
            case let .read(path), let .list(path): ("Use \(state.tool)?", path)
            case let .delegate(title): ("Use \(state.tool)?", title ?? "")
            case let .custom(label): ("Use \(state.tool)?", label)
            case .unknown: ("Use \(state.tool)?", "")
            }
            let command = if case .shell = state.subject { true } else { false }
            return .approval(Approval(session: session, part: id, title: title, detail: detail, command: command, subagent: subagent,
                                      tool: state.tool))
        case let .question(state):
            guard state.phase == .asking || state.phase == .open else { return nil }
            let items = state.questions.map { item in
                QuestionItem(header: item.header, question: item.question,
                             options: item.options.map { (label: $0.label, description: $0.description) })
            }
            return .question(Question(session: session, part: id, items: items, subagent: subagent))
        case .text, .thinking, .tool, .compaction, .branchSummary, .other:
            return nil
        }
    }
}

extension Wire.PartContent {
    var kindName: String {
        switch self {
        case .text: "text"
        case .thinking: "thinking"
        case .tool: "tool"
        case .compaction: "compaction"
        case .branchSummary: "branchSummary"
        case .approval: "ask/approval"
        case .question: "ask/question"
        case let .other(kind): kind
        }
    }
}

extension Wire.Prompt {
    var words: String {
        items.compactMap { item -> String? in
            switch item {
            case let .text(text), let .excerpt(_, text): text
            case let .file(name): "[\(name)]"
            case let .reference(path): "@\(path)"
            case let .skill(name): "/\(name)"
            case .unknown: nil
            }
        }.joined(separator: " ")
    }
}

extension Wire.ToolState {
    var stepKind: StepKind {
        if asksQuestion { return .question }
        return switch subject {
        case .read: .read
        case .list: .list
        case .edit: .edit
        case .shell: .shell
        case .delegate: .delegate
        case .custom, .unknown: .tool
        }
    }

    func stepOutcome(live: Bool, partFailed: Bool) -> StepOutcome {
        if partFailed { return .failed }
        switch outcome {
        case nil: return live && phase != .settled ? .running : .stopped
        case let .ok(_, _, shell)?:
            guard stepKind == .shell else { return .done }
            return switch shell {
            case .exitedWithError: .failed
            case .timedOut: .timedOut
            case .exitedCleanly, .other: .done
            }
        case .failed?: return .failed
        case .rejected?: return .denied
        case .stopped?: return .stopped
        case .interrupted?, .unknown?: return .interrupted
        }
    }

    var subjectText: String {
        switch subject {
        case let .read(path), let .edit(path): Self.file(path)
        case let .list(path): path.isEmpty ? "files" : Self.file(path)
        case let .shell(command): command.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? command
        case let .delegate(title): title ?? ""
        case let .custom(label): asksQuestion ? "" : label
        case .unknown: asksQuestion ? "" : name
        }
    }

    func spec(id: String, part: String, version: Int, live: Bool, failed: Bool) -> RowSpec {
        let outcome = stepOutcome(live: live, partFailed: failed)
        var spec = StepWords.row(key: id, part: part, kind: stepKind, outcome: outcome, subject: subjectText, version: version,
                                 added: changes?.added ?? 0, removed: changes?.removed ?? 0)
        if StepWords.showsChanges(stepKind, outcome), case .text? = ChangeReview.edit(self)?.entry.body { spec.reviewable = true }
        return spec
    }

    private static func file(_ path: String) -> String {
        path.isEmpty ? "" : (path as NSString).lastPathComponent
    }

    var output: ToolOutput {
        switch outcome {
        case let .ok(_, entry?, _)?:
            switch entry.body {
            case let .text(patch, _, _): ToolOutput(text: patch, diff: true)
            case .binary: ToolOutput(text: "A binary file changed.", diff: false)
            case .empty: ToolOutput(text: "The file did not change.", diff: false)
            case .tooLarge: ToolOutput(text: "The change is too large to show.", diff: false)
            case let .failed(reason): ToolOutput(text: reason.isEmpty ? "The change could not be read." : reason, diff: false)
            case .unknown: ToolOutput(text: "No output.", diff: false)
            }
        case let .ok(text, nil, _)? where !text.isEmpty: ToolOutput(text: text, diff: false)
        case let .failed(message)? where !message.isEmpty: ToolOutput(text: message, diff: false)
        default: ToolOutput(text: "No output.", diff: false)
        }
    }
}
