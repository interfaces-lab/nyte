import Foundation
import NyteCore

extension ReplayScript {
    struct Thread {
        var messages: [JSON] = []
        var order: [String] = []
        var turns: [JSON] = []
        var parts: [JSON] = []
        var changes: [JSON] = []
        var background: [JSON] = []
        var runChanges: [String: [JSON]] = [:]

        mutating func add(_ message: JSON, id: String) {
            messages.append(message)
            order.append(id)
        }
    }

    static let hubBefore = """
    // Package hub routes messages to the channels registered for them and counts the outcomes.
    package hub

    import (
    \t"context"
    \t"errors"
    \t"fmt"
    \t"sync"
    )

    // Message is one notification on its way to a channel.
    type Message struct {
    \tChannel string
    \tSubject string
    \tBody    string
    }

    // Channel delivers messages somewhere: a mailbox, a webhook, a pager.
    type Channel interface {
    \t// Name is the key messages use to pick this channel.
    \tName() string
    \tSend(ctx context.Context, message Message) error
    }

    // ErrUnknownChannel is returned for a message whose channel was never registered.
    var ErrUnknownChannel = errors.New("unknown channel")

    // Hub owns the registered channels and the running counts.
    type Hub struct {
    \tmu       sync.Mutex
    \tchannels map[string]Channel
    \tstats    Stats
    }

    // New returns an empty hub.
    func New() *Hub {
    \treturn &Hub{channels: map[string]Channel{}, stats: newStats()}
    }

    // Register adds a channel, replacing any channel with the same name.
    func (h *Hub) Register(channel Channel) {
    \th.mu.Lock()
    \tdefer h.mu.Unlock()
    \th.channels[channel.Name()] = channel
    \th.stats.track(channel.Name())
    }

    // Submit sends a message through its channel and records how it went.
    func (h *Hub) Submit(ctx context.Context, message Message) error {
    \th.mu.Lock()
    \tchannel, ok := h.channels[message.Channel]
    \th.mu.Unlock()
    \tif !ok {
    \t\treturn fmt.Errorf("%w: %q", ErrUnknownChannel, message.Channel)
    \t}

    \terr := channel.Send(ctx, message)
    \th.record(channel.Name(), err == nil)
    \treturn err
    }

    // Stats returns a copy of the counts so far.
    func (h *Hub) Stats() Stats {
    \th.mu.Lock()
    \tdefer h.mu.Unlock()
    \treturn h.stats.clone()
    }

    func (h *Hub) record(name string, delivered bool) {
    \th.mu.Lock()
    \tdefer h.mu.Unlock()
    \th.stats.add(name, delivered)
    }

    // describe is unused on purpose: the fixture needs a warning for the editor to show.
    func describe(channel Channel, verbose bool) string {
    \tvar fallback *Email
    \tif channel == nil {
    \t\treturn fallback.address
    \t}
    \treturn channel.Name()
    }

    """

    static let hubAfter = """
    // Package hub routes messages to the channels registered for them and counts the outcomes.
    package hub

    import (
    \t"context"
    \t"errors"
    \t"fmt"
    \t"sync"
    )

    // Message is one notification on its way to a channel.
    type Message struct {
    \tChannel string
    \tSubject string
    \tBody    string
    }

    // Channel delivers messages somewhere: a mailbox, a webhook, a pager.
    type Channel interface {
    \t// Name is the key messages use to pick this channel.
    \tName() string
    \tSend(ctx context.Context, message Message) error
    }

    // ErrUnknownChannel is returned for a message whose channel was never registered.
    var ErrUnknownChannel = errors.New("unknown channel")

    // Hub owns the registered channels and the running counts.
    type Hub struct {
    \tmu       sync.Mutex
    \tchannels map[string]Channel
    \tstats    Stats
    }

    // New returns an empty hub.
    func New() *Hub {
    \treturn &Hub{channels: map[string]Channel{}, stats: newStats()}
    }

    // Register adds a channel, replacing any channel with the same name.
    func (h *Hub) Register(channel Channel) {
    \th.mu.Lock()
    \tdefer h.mu.Unlock()
    \th.channels[channel.Name()] = channel
    \th.stats.track(channel.Name())
    }

    // Submit sends a message through its channel and records how it went.
    func (h *Hub) Submit(ctx context.Context, message Message) error {
    \th.mu.Lock()
    \tchannel, ok := h.channels[message.Channel]
    \th.mu.Unlock()
    \tif !ok {
    \t\th.record("", false)
    \t\treturn fmt.Errorf("%w: %q", ErrUnknownChannel, message.Channel)
    \t}

    \terr := channel.Send(ctx, message)
    \th.record(channel.Name(), err == nil)
    \treturn err
    }

    // Stats returns a copy of the counts so far.
    func (h *Hub) Stats() Stats {
    \th.mu.Lock()
    \tdefer h.mu.Unlock()
    \treturn h.stats.clone()
    }

    func (h *Hub) record(name string, delivered bool) {
    \th.mu.Lock()
    \tdefer h.mu.Unlock()
    \th.stats.add(name, delivered)
    }

    // describe is unused on purpose: the fixture needs a warning for the editor to show.
    func describe(channel Channel, verbose bool) string {
    \tvar fallback *Email
    \tif channel == nil {
    \t\treturn fallback.address
    \t}
    \treturn channel.Name()
    }

    """

    static let hubTestBefore = """
    package hub

    import (
    \t"context"
    \t"testing"
    )

    func TestSubmitCountsPerChannel(t *testing.T) {
    \th := New()
    \th.Register(NewEmail("ops@example.com"))
    \th.Register(NewWebhook("http://insecure.example.com"))

    \tctx := context.Background()
    \tif err := h.Submit(ctx, Message{Channel: "email", Subject: "one"}); err != nil {
    \t\tt.Fatalf("email: %v", err)
    \t}
    \tif err := h.Submit(ctx, Message{Channel: "webhook", Subject: "two"}); err == nil {
    \t\tt.Fatal("webhook: expected an error for a non-https endpoint")
    \t}

    \tstats := h.Stats()
    \tif got, want := stats.Total, (Counts{Submitted: 2, Delivered: 1, Failed: 1}); got != want {
    \t\tt.Errorf("total = %+v, want %+v", got, want)
    \t}
    \tif got, want := stats.Channels["email"], (Counts{Submitted: 1, Delivered: 1}); got != want {
    \t\tt.Errorf("email = %+v, want %+v", got, want)
    \t}
    \tif got, want := stats.Channels["webhook"], (Counts{Submitted: 1, Failed: 1}); got != want {
    \t\tt.Errorf("webhook = %+v, want %+v", got, want)
    \t}
    }

    """

    static let hubTest = """
    package hub

    import (
    \t"context"
    \t"errors"
    \t"testing"
    )

    func TestSubmitCountsPerChannel(t *testing.T) {
    \th := New()
    \th.Register(NewEmail("ops@example.com"))
    \th.Register(NewWebhook("http://insecure.example.com"))

    \tctx := context.Background()
    \tif err := h.Submit(ctx, Message{Channel: "email", Subject: "one"}); err != nil {
    \t\tt.Fatalf("email: %v", err)
    \t}
    \tif err := h.Submit(ctx, Message{Channel: "webhook", Subject: "two"}); err == nil {
    \t\tt.Fatal("webhook: expected an error for a non-https endpoint")
    \t}
    \tif err := h.Submit(ctx, Message{Channel: "pager"}); !errors.Is(err, ErrUnknownChannel) {
    \t\tt.Fatalf("pager: got %v, want ErrUnknownChannel", err)
    \t}

    \tstats := h.Stats()
    \tif got, want := stats.Total, (Counts{Submitted: 3, Delivered: 1, Failed: 2}); got != want {
    \t\tt.Errorf("total = %+v, want %+v", got, want)
    \t}
    \tif got, want := stats.Channels["email"], (Counts{Submitted: 1, Delivered: 1}); got != want {
    \t\tt.Errorf("email = %+v, want %+v", got, want)
    \t}
    \tif got, want := stats.Channels["webhook"], (Counts{Submitted: 1, Failed: 1}); got != want {
    \t\tt.Errorf("webhook = %+v, want %+v", got, want)
    \t}
    }

    """

    static let answer = """
    An unknown channel now counts as a failed submission: `Submit` records it before it returns `ErrUnknownChannel`, so \
    `Stats` no longer undercounts failures.

    ```go
    if !ok {
    \th.record("", false)
    \treturn fmt.Errorf("%w: %q", ErrUnknownChannel, message.Channel)
    }
    ```

    | Test | Result |
    | --- | --- |
    | `TestSubmitCountsPerChannel` | passes |

    ```mermaid
    flowchart LR
      Submit -->|known| Channel
      Submit -->|unknown| Record
      Channel --> Record
    ```

    The test now sends to `pager`, which no one registered, and expects three submissions with two failures.
    """

    static let raceContext: JSON = [
        ["kind": "text", "text": "Run the race detector too, and look at what I marked."],
        ["kind": "reference", "path": "hub/hub.go"],
        ["kind": "text", "text": "```hub/hub.go:50-56\n\th.mu.Lock()\n\tchannel, ok := h.channels[message.Channel]\n\th.mu.Unlock()\n\tif !ok {\n\t\th.record(\"\", false)\n\t\treturn fmt.Errorf(\"%w: %q\", ErrUnknownChannel, message.Channel)\n\t}\n```"],
        ["kind": "text", "text": "diagnostic hub/hub.go:77:32-77:39 warning unusedparams: unused parameter: verbose"],
        ["kind": "excerpt", "source": ["kind": "diff", "path": "hub/hub_test.go", "side": "new", "start": 26, "end": 26],
         "text": "\tif got, want := stats.Total, (Counts{Submitted: 3, Delivered: 1, Failed: 2}); got != want {"],
        ["kind": "text", "text": "review hub/hub_test.go:26 new: Say why Failed is 2 here."],
        ["kind": "text", "text": "terminal in /tmp/replay-workspace"],
        ["kind": "excerpt", "source": ["kind": "terminal"], "text": "$ go test ./hub/...\nok  \texample.com/notifyhub/hub\t0.318s\n$ go vet ./hub/..."],
    ]

    static func user(_ id: String, turn: String, at: Double, _ text: String) -> JSON {
        user(id, turn: turn, at: at, content: .string(text))
    }

    static func user(_ id: String, turn: String, at: Double, content: JSON) -> JSON {
        ["id": .string(id), "turn": .string(turn), "at": .number(at), "kind": "user", "content": content,
         "source": ["kind": "user"], "delivery": "queue",
         "status": ["kind": "landed", "commit": .string("commit-" + id), "run": .null, "replaced": .null],
         "siblings": ["index": 0, "count": 1, "ids": []]]
    }

    static func part(_ id: String, turn: String, at: Double, kind: String, role: String, state: JSON, status: JSON) -> JSON {
        ["id": .string(id), "turn": .string(turn), "at": .number(at), "kind": "part", "part": .string(id), "partKind": .string(kind),
         "role": .string(role), "state": state, "version": 3, "status": status]
    }

    static func settled(_ at: Double) -> JSON { ["kind": "settled", "commit": "commit", "endedAt": .number(at)] }

    static func liveStatus(_ run: String) -> JSON { ["kind": "live", "run": .string(run)] }

    static func tool(_ name: String, args: JSON, subject: JSON, outcome: JSON?, changes: JSON = .null) -> JSON {
        guard let outcome else {
            return ["call": .string("call-" + name), "name": .string(name), "args": args, "class": subject, "phase": "running",
                    "progress": .null]
        }
        return ["call": .string("call-" + name), "name": .string(name), "args": args, "class": subject, "phase": "settled",
                "outcome": outcome, "changes": changes]
    }

    static func ok(_ text: String, output: JSON = .null) -> JSON {
        ["kind": "ok", "content": [["kind": "text", "text": .string(text)]], "output": output, "parts": []]
    }

    static func patchEntry(_ path: String, before: String?, after: String) -> (output: JSON, changes: JSON, file: JSON, run: JSON) {
        let patch = ReplayDiff.patch(path: path, before: before, after: after)
        let status: JSON = before == nil ? "added" : "modified"
        let output: JSON = ["path": .string(path), "status": status, "digest": .string(patch.digest), "kind": "text",
                            "added": .number(Double(patch.added)), "removed": .number(Double(patch.removed)), "patch": .string(patch.text)]
        let changes: JSON = ["added": .number(Double(patch.added)), "removed": .number(Double(patch.removed)), "paths": [.string(path)]]
        let file: JSON = ["path": .string(path), "status": status, "added": .number(Double(patch.added)),
                          "removed": .number(Double(patch.removed))]
        let run: JSON = ["path": .string(path), "status": status,
                         "stat": ["kind": "text", "added": .number(Double(patch.added)), "removed": .number(Double(patch.removed))]]
        return (output, changes, file, run)
    }

    static func turn(_ id: String, run: String, prompt: String, state: JSON, startedAt: Double, endedAt: Double? = nil) -> JSON {
        let empty: JSON = ["count": 0, "paths": []]
        return ["id": .string(id), "run": .string(run), "prompt": .string(prompt), "state": state, "startedAt": .number(startedAt),
                "endedAt": endedAt.map(JSON.number) ?? .null, "steps": 0, "thinkingOnly": false,
                "summary": ["byClass": ["read": empty, "list": empty, "edit": empty, "shell": empty, "delegate": empty, "custom": empty],
                            "failed": 0, "stopped": 0]]
    }

    static func ended(_ end: JSON) -> JSON { ["kind": "ended", "end": end] }

    static func thread(_ session: Session, now: Double) -> Thread {
        let start = now - session.age - ReplayScript.minute * 5
        switch session.id {
        case transcript: return transcriptThread(start: start)
        case approval: return askingThread(session, start: start, ask: approvalAsk)
        case question: return askingThread(session, start: start, ask: questionAsk)
        case failed: return failedThread(start: start)
        case running: return runningThread(session, start: start)
        default: return shortThread(session, start: start)
        }
    }

    static func transcriptThread(start: Double) -> Thread {
        var thread = Thread()
        let edit = patchEntry("hub/hub.go", before: hubBefore, after: hubAfter)
        let write = patchEntry("hub/hub_test.go", before: hubTestBefore, after: hubTest)
        thread.add(user("t1-prompt", turn: "t1", at: start, "Count a message sent to an unknown channel as a failed submission, and test it."),
                   id: "t1-prompt")
        let steps: [(String, String, String, JSON)] = [
            ("t1-think", "thinking", "step", ["markdown": "Submit returns early for an unknown channel without recording it, so Stats undercounts failures.",
                                              "merged": 0, "signature": .null]),
            ("t1-read", "tool", "step", tool("read", args: ["path": "hub/hub.go"], subject: ["kind": "read", "path": "hub/hub.go"],
                                              outcome: ok(hubBefore))),
            ("t1-list", "tool", "step", tool("list", args: ["path": "hub"], subject: ["kind": "list", "path": "hub"],
                                              outcome: ok("email.go\nhub.go\nhub_test.go\nstats.go\nwebhook.go\n"))),
            ("t1-edit", "tool", "step", tool("edit", args: ["path": "hub/hub.go", "edits": []], subject: ["kind": "edit", "path": "hub/hub.go"],
                                              outcome: ok("Edited hub/hub.go: 1 replacement.", output: edit.output), changes: edit.changes)),
            ("t1-write", "tool", "step", tool("write", args: ["path": "hub/hub_test.go", "content": .string(hubTest)],
                                               subject: ["kind": "edit", "path": "hub/hub_test.go"],
                                               outcome: ok("Wrote \(hubTest.utf8.count) bytes to hub/hub_test.go.", output: write.output),
                                               changes: write.changes)),
            ("t1-test", "tool", "step", tool("bash", args: ["command": "go test ./hub/..."], subject: ["kind": "shell", "command": "go test ./hub/..."],
                                              outcome: ok("ok  \texample.com/notifyhub/hub\t0.318s\n[exit code 0]"))),
            ("t1-answer", "text", "answer", ["markdown": .string(answer), "signature": .null]),
        ]
        for (offset, step) in steps.enumerated() {
            thread.add(part(step.0, turn: "t1", at: start + Double(offset + 1) * 9_000, kind: step.1, role: step.2, state: step.3,
                            status: settled(start + Double(offset + 1) * 9_000)), id: step.0)
        }
        thread.turns.append(turn("t1", run: "run-transcript-1", prompt: "t1-prompt", state: ended(completed), startedAt: start,
                                 endedAt: start + Double(steps.count) * 9_000))
        thread.runChanges["run-transcript-1"] = [edit.run, write.run]
        let second = start + ReplayScript.minute * 3
        thread.add(user("t2-prompt", turn: "t2", at: second, content: raceContext), id: "t2-prompt")
        thread.add(part("t2-race", turn: "t2", at: second + 8_000, kind: "tool", role: "step",
                        state: tool("bash", args: ["command": "go test -race ./hub/..."],
                                    subject: ["kind": "shell", "command": "go test -race ./hub/..."],
                                    outcome: ok("ok  \texample.com/notifyhub/hub\t1.204s\n[exit code 0]")),
                        status: settled(second + 8_000)), id: "t2-race")
        thread.add(part("t2-answer", turn: "t2", at: second + 12_000, kind: "text", role: "answer",
                        state: ["markdown": "The race detector passes: `Submit` reads the channel map under `h.mu`, and `record` takes the lock itself. I left `describe` alone; the fixture keeps it for the editor's warning.",
                                "signature": .null], status: settled(second + 12_000)), id: "t2-answer")
        thread.turns.append(turn("t2", run: "run-transcript-2", prompt: "t2-prompt", state: ended(completed), startedAt: second,
                                 endedAt: second + 12_000))
        thread.runChanges["run-transcript-2"] = []
        thread.changes = [edit.file, write.file]
        return thread
    }

    static let approvalAsk: (part: String, kind: String, state: JSON) = (approvalPart, "ask/approval", [
        "tool": "bash", "class": ["kind": "shell", "command": "go test -race -count=1 ./hub/..."], "reason": "shell", "decision": .null,
    ])

    static let questionAsk: (part: String, kind: String, state: JSON) = (questionPart, "ask/question", [
        "call": "call-question",
        "questions": [[
            "header": "Next step", "question": "Which improvement should we plan next?",
            "options": [
                ["label": "Template task CLI", "description": "A command that creates tasks from templates with overrides."],
                ["label": "Template variables",
                 "description": "Placeholders such as {{issue}}, checked when a template is applied, so a missing value fails before the task is made."],
                ["label": "Persistent task CLI", "description": "List, create and complete tasks stored in data/tasks.json."],
            ],
        ], [
            "header": "Scope", "question": "Should it ship behind a flag?",
            "options": [["label": "Yes", "description": ""], ["label": "No", "description": ""]],
        ]],
        "phase": ["kind": "asking"],
    ])

    static func askingThread(_ session: Session, start: Double, ask: (part: String, kind: String, state: JSON)) -> Thread {
        var thread = Thread()
        thread.add(user("a-prompt-" + session.id, turn: "a-" + session.id, at: start, session.title + "."), id: "a-prompt-" + session.id)
        thread.add(part("a-read-" + session.id, turn: "a-" + session.id, at: start + 6_000, kind: "tool", role: "step",
                        state: tool("read", args: ["path": "hub/hub.go"], subject: ["kind": "read", "path": "hub/hub.go"], outcome: ok(hubAfter)),
                        status: settled(start + 6_000)), id: "a-read-" + session.id)
        let run = "run-" + session.id
        thread.parts.append(["id": .string(ask.part), "partKind": .string(ask.kind), "placement": ["kind": "modal"], "state": ask.state,
                             "version": 1, "status": liveStatus(run), "owner": "replay"])
        thread.turns.append(turn("a-" + session.id, run: run, prompt: "a-prompt-" + session.id,
                                 state: ["kind": "waiting", "on": ["kind": "part", "part": .string(ask.part)]], startedAt: start))
        return thread
    }

    static func failedThread(start: Double) -> Thread {
        var thread = Thread()
        thread.add(user("f-prompt", turn: "f1", at: start, "The watcher test times out on slow CI machines. Find out why and fix it."),
                   id: "f-prompt")
        thread.add(part("f-test", turn: "f1", at: start + 7_000, kind: "tool", role: "step",
                        state: tool("bash", args: ["command": "go test -run TestWatcher -count=20 ./watch/..."],
                                    subject: ["kind": "shell", "command": "go test -run TestWatcher -count=20 ./watch/..."],
                                    outcome: ok("--- FAIL: TestWatcher (5.01s)\n    watch_test.go:41: no event after 5s\n[exit code 1]")),
                        status: settled(start + 7_000)), id: "f-test")
        thread.turns.append(turn("f1", run: "run-failed", prompt: "f-prompt", state: ended(rateLimited), startedAt: start,
                                 endedAt: start + ReplayScript.minute * 5))
        return thread
    }

    static func runningThread(_ session: Session, start: Double) -> Thread {
        var thread = Thread()
        thread.add(user("r-prompt", turn: "r1", at: start, "Long sessions stutter when they scroll. Profile it and cut the layout work."),
                   id: "r-prompt")
        thread.add(part("r-read", turn: "r1", at: start + 5_000, kind: "tool", role: "step",
                        state: tool("read", args: ["path": "Sources/NyteAgent/TranscriptView.swift"],
                                    subject: ["kind": "read", "path": "Sources/NyteAgent/TranscriptView.swift"], outcome: ok("…")),
                        status: settled(start + 5_000)), id: "r-read")
        thread.add(part("r-profile", turn: "r1", at: start + 9_000, kind: "tool", role: "step",
                        state: tool("bash", args: ["command": "swift build -c release && xctrace record --template 'Time Profiler'"],
                                    subject: ["kind": "shell", "command": "swift build -c release && xctrace record --template 'Time Profiler'"],
                                    outcome: nil),
                        status: liveStatus("run-running")), id: "r-profile")
        thread.add(part(livePart, turn: "r1", at: start + 12_000, kind: "text", role: "answer",
                        state: ["markdown": "Every scroll re-measures rows that", "signature": .null], status: liveStatus("run-running")),
                   id: livePart)
        thread.turns.append(turn("r1", run: "run-running", prompt: "r-prompt", state: ["kind": "working", "activity": .null], startedAt: start))
        thread.background = (1 ..< session.working + 1).map { index in
            ["head": .string(head), "item": ["kind": "child", "id": .string("child-\(index)"),
                                             "title": .string(index == 1 ? "Measure row heights" : "Trace scroll frames"),
                                             "state": "working", "startedBy": .null]]
        }
        return thread
    }

    static func shortThread(_ session: Session, start: Double) -> Thread {
        var thread = Thread()
        let prompt = "p-" + session.id
        thread.add(user(prompt, turn: "s-" + session.id, at: start, session.title + "."), id: prompt)
        thread.add(part("a-" + session.id, turn: "s-" + session.id, at: start + 20_000, kind: "text", role: "answer",
                        state: ["markdown": "Here is what I found, with the files involved and what to change first.", "signature": .null],
                        status: settled(start + 20_000)), id: "a-" + session.id)
        let run = "run-" + session.id.replacingOccurrences(of: "replay-", with: "")
        thread.turns.append(turn("s-" + session.id, run: run, prompt: prompt, state: ended(completed), startedAt: start,
                                 endedAt: start + 20_000))
        thread.runChanges[run] = session.id == ReplayScript.unread
            ? [["path": "docs/resume.md", "status": "added", "stat": ["kind": "text", "added": 42, "removed": 0]],
               ["path": "client/socket.go", "status": "modified", "stat": ["kind": "text", "added": 9, "removed": 3]]]
            : []
        return thread
    }

    static func window(_ session: Session, now: Double) -> JSON {
        let thread = thread(session, now: now)
        func table(_ rows: [JSON]) -> JSON { ["upsert": .array(rows), "drop": []] }
        let configuration: JSON = ["kind": "exact", "model": ["provider": "anthropic", "id": "claude-sonnet-4-5"], "thinking": "medium",
                                   "agent": .null, "settings": [:]]
        return [
            "seq": 1, "head": .string(head), "order": .array(thread.order.map(JSON.string)), "leadingPrompt": .null, "complete": true,
            "tables": [
                "messages": table(thread.messages), "turns": table(thread.turns), "parts": table(thread.parts),
                "changes": table(thread.changes), "catalog": table([["id": .string(catalog)]]),
                "heads": table([["name": .string(head), "revision": .null, "execution": session.execution(now), "reportsHeld": false,
                                 "seenThrough": .null, "queue": []]]),
                "settings": table([["name": .string(head), "configuration": ["selected": configuration, "effective": configuration],
                                    "context": ["tokens": 41_200, "window": 200_000]]]),
                "usage": table([["name": .string(head), "usage": usage]]),
                "background": table(thread.background),
            ],
            "live": ["activation": ["kind": "active"]],
        ]
    }

    static func part(_ id: String, session: Session) -> JSON? {
        let thread = thread(session, now: Date.now.timeIntervalSince1970 * 1000)
        return thread.parts.first { $0["id"]?.string == id }
    }
}
