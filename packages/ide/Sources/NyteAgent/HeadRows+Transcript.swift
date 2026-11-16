import Foundation

extension HeadRows {
    struct Streamed: Sendable {
        var version: Int
        var text: String
    }

    var execution: Wire.Execution { headRow?.execution ?? .idle(lastEnd: nil) }

    func version(of id: String) -> Int? {
        guard case let .part(part)? = messages[id]?.body else { return nil }
        return part.body.version
    }

    func specs(streamed: [String: Streamed], reviews: [String: ChangeReview.Tally]) -> [RowSpec] {
        var specs: [RowSpec] = []
        let ids = transcript
        let lastTurn = ids.last.flatMap { messages[$0]?.turn }
        let idle = if case .idle = execution { true } else { false }
        for (index, id) in ids.enumerated() {
            guard let message = messages[id] else { continue }
            if let spec = Self.spec(message, streamed: streamed) { specs.append(spec) }
            if case let .user(user) = message.body, !ContextFormat.sent(user.content.items).chips.isEmpty {
                specs.append(RowSpec(kind: .context, key: Self.contextKey(id), text: ""))
            }
            let next = index + 1 < ids.count ? messages[ids[index + 1]]?.turn : nil
            guard let turn = message.turn, next != turn, case let .ended(end)? = turns[turn]?.state else { continue }
            let retryable = idle && turn == lastTurn && retryPrompt(turn: turn) != nil
            if let ended = Self.ending(end, turn: turn, retryable: retryable) { specs.append(ended) }
            if let tally = reviews[turn], tally.files > 0 { specs.append(Self.review(turn: turn, tally)) }
        }
        return specs
    }

    private static func review(turn: String, _ tally: ChangeReview.Tally) -> RowSpec {
        let count = tally.files == 1 ? "1 file changed" : "\(tally.files) files changed"
        var spec = RowSpec(kind: .review, key: ReviewTarget.runPrefix + turn, text: ChangeReview.turnTitle + " \u{00B7} " + count)
        spec.added = tally.added
        spec.removed = tally.removed
        return spec
    }

    func edit(part id: String) -> ChangeReview.Edit? {
        guard case let .part(message)? = messages[id]?.body, case let .tool(state) = message.body.content else { return nil }
        return ChangeReview.edit(state)
    }

    func edits(turn: String) -> [ChangeReview.Edit] {
        transcript.filter { messages[$0]?.turn == turn }.compactMap { edit(part: $0) }
    }

    func changeEntries(turn: String, runs: [String: ChangeReview.RunState]) -> [ChangeReview.Entry]? {
        let state = turns[turn]?.run.flatMap { runs[$0] } ?? (turns[turn]?.run == nil ? .unavailable : nil)
        return ChangeReview.entries(state, edits: edits(turn: turn))
    }

    var endedTurns: [String] {
        turns.values.compactMap { turn in
            guard case .ended = turn.state else { return nil }
            return turn.id
        }
    }

    var endedRuns: [String] {
        turns.values.compactMap { turn in
            guard case .ended = turn.state else { return nil }
            return turn.run
        }
    }

    func deadlines() -> [String: Date] {
        var found: [String: Date] = [:]
        for turn in turns.values {
            guard case let .ended(.failed(failure)) = turn.state, let wait = failure.retryAfter, let ended = turn.endedAt else { continue }
            let seconds = Double(wait.components.seconds) + Double(wait.components.attoseconds) / 1e18
            found[Self.turnKey(turn.id)] = Wire.Execution.date(ended).addingTimeInterval(seconds)
        }
        return found
    }

    static func turnKey(_ turn: String) -> String { "ended:" + turn }

    static func contextKey(_ message: String) -> String { "ctx:" + message }

    func contexts() -> [String: [ContextFormat.Chip]] {
        var found: [String: [ContextFormat.Chip]] = [:]
        for id in transcript {
            guard case let .user(user)? = messages[id]?.body else { continue }
            let chips = ContextFormat.sent(user.content.items).chips
            if !chips.isEmpty { found[Self.contextKey(id)] = chips }
        }
        return found
    }

    func retryPrompt(turn: String) -> (id: String, content: [Wire.Outgoing])? {
        guard let prompt = turns[turn]?.prompt, case let .user(user)? = messages[prompt]?.body else { return nil }
        let content = user.content.items.compactMap { item -> Wire.Outgoing? in
            switch item {
            case let .text(text): .text(text)
            case let .reference(path): .reference(path: path)
            case let .excerpt(.diff(path, side, start, end), text): .excerpt(.diff(path: path, side: side, start: start, end: end), text: text)
            case let .excerpt(.terminal(command), text): .excerpt(.terminal(command: command), text: text)
            case .excerpt(.other, _), .file, .skill, .unknown: nil
            }
        }
        guard !content.isEmpty, content.count == user.content.items.count else { return nil }
        return (prompt, content)
    }

    private static func ending(_ end: Wire.RunEnd, turn: String, retryable: Bool) -> RowSpec? {
        switch end {
        case .stopped: return RowSpec(kind: .ended, key: turnKey(turn), text: Rows.stopped)
        case let .failed(failure):
            var spec = RowSpec(kind: .failure, key: turnKey(turn), lead: failure.summary, text: failure.detail)
            spec.retryable = retryable
            return spec
        case .completed, .unknown: return nil
        }
    }

    private static func spec(_ message: Wire.Message, streamed: [String: Streamed]) -> RowSpec? {
        let id = message.id
        switch message.body {
        case let .user(user):
            switch user.source {
            case .answer: return nil
            case .child: return RowSpec(kind: .note, key: id, text: "Report from a subagent")
            case .job: return RowSpec(kind: .note, key: id, text: "Report from a background job")
            case .user, .shell, .action, .unknown:
                return RowSpec(kind: .user, key: id, text: ContextFormat.sent(user.content.items).prompt, pending: !user.landed)
            }
        case let .part(message):
            return spec(id: id, message, streamed: streamed)
        case let .unknown(kind):
            return RowSpec(kind: .unknown, key: id, text: kind)
        }
    }

    private static func spec(id: String, _ message: Wire.PartMessage, streamed: [String: Streamed]) -> RowSpec {
        let body = message.body
        let part = message.part
        let live = body.status == .live || body.status == .waiting
        let overlay = streamed[part].flatMap { live && $0.version > body.version ? $0 : nil }
        let version = overlay?.version ?? body.version
        switch body.content {
        case let .text(own):
            return RowSpec(kind: .prose, key: id, part: part, text: overlay?.text ?? own, version: version, running: live)
        case let .thinking(own):
            return RowSpec(kind: .thinking, key: id, part: part, text: overlay?.text ?? own, version: version, running: live,
                           expandable: true)
        case let .tool(state):
            let failed = if case .failed = body.status { true } else { false }
            return state.spec(id: id, part: part, version: body.version, live: live, failed: failed)
        case .compaction:
            return RowSpec(kind: .note, key: id, part: part, text: "Compacted the conversation", version: body.version)
        case .branchSummary:
            return RowSpec(kind: .note, key: id, part: part, text: "Summarized the earlier branch", version: body.version)
        case .approval, .question, .other:
            return RowSpec(kind: .unknown, key: id, part: part, text: body.content.kindName, version: body.version)
        }
    }

    func waitingChildren() -> Set<String> {
        Set(background.values.compactMap { row in
            row.head == head && row.kind == .child && row.state == .waiting ? row.id : nil
        })
    }
}
