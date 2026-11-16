import Foundation
import NyteCore

public enum ReplayScript {
    public static let workspace = "replay-workspace"
    public static let worktreeWorkspace = "replay-worktree"
    public static let worktreeBranch = "race-detector-ci"
    static let catalog = "replay-catalog"
    public static let permission = "ask"
    public static let transcript = "replay-transcript"
    public static let approval = "replay-approval"
    public static let question = "replay-question"
    public static let failed = "replay-failed"
    public static let running = "replay-running"
    public static let unread = "replay-unread"
    public static let pinned = "replay-pinned"
    public static let retrying = "replay-retrying"
    public static let approvalPart = "replay-approval-part"
    public static let questionPart = "replay-question-part"
    public static let livePart = "replay-live-answer"

    static let head = "main"
    static let minute = 60_000.0
    static let hour = minute * 60
    static let day = hour * 24

    struct Session: Sendable {
        let id: String
        let title: String
        let age: Double
        let execution: @Sendable (Double) -> JSON
        var unread = false
        var pinned = false
        var working = 0
        var waiting = 0
    }

    static let sessions: [Session] = [
        Session(id: running, title: "Profile the transcript on long sessions and cut the layout work done on every scroll",
                age: minute / 2, execution: { live(run: "run-running", startedAt: $0 - 27_000) }, working: 2),
        Session(id: approval, title: "Add a race-detector run to the hub's CI job and fix whatever it turns up",
                age: minute * 3, execution: { waiting(run: "run-approval", startedAt: $0 - minute * 4, part: approvalPart) }),
        Session(id: question, title: "Plan the next improvement to task templates and their variables",
                age: minute * 9, execution: { waiting(run: "run-question", startedAt: $0 - minute * 10, part: questionPart) }),
        Session(id: unread, title: "Explain how sessions resume after a dropped socket and what the client keeps",
                age: minute * 14, execution: { _ in idle(run: "run-unread", end: completed) }, unread: true),
        Session(id: transcript, title: "Count messages to an unknown channel as failed submissions in the hub",
                age: hour, execution: { _ in idle(run: "run-transcript-2", end: completed) }),
        Session(id: failed, title: "Fix the flaky watcher test that times out on slow CI machines",
                age: failedAge, execution: { _ in idle(run: "run-failed", end: rateLimited) }),
        Session(id: retrying, title: "Rename the store migrations so their order is obvious from the file names",
                age: hour * 3, execution: { retry(run: "run-retrying", startedAt: $0 - minute * 6) }),
        Session(id: pinned, title: "Release notes for 0.42 with the new IDE agent pane and the changes review",
                age: day + hour, execution: { _ in idle(run: "run-pinned", end: completed) }, pinned: true),
    ]

    static func row(_ session: Session, now: Double) -> JSON {
        let at = now - session.age
        return [
            "id": .string(session.id), "name": .string(session.title), "parent": .null, "call": .null,
            "workspace": .string(session.id == approval ? worktreeWorkspace : workspace), "pinned": .bool(session.pinned), "archived": false, "activation": ["kind": "active"],
            "heads": [[
                "name": .string(head), "tip": ["kind": "commit", "id": .string("tip-" + session.id)], "stack": .null,
                "execution": session.execution(now), "unread": .bool(session.unread),
                "background": ["working": .number(Double(session.working)), "waiting": .number(Double(session.waiting))],
            ]],
            "createdAt": .number(at - hour), "lastActivityAt": .number(at),
        ]
    }

    static let failedAge = 8_000.0

    static let usage: JSON = [
        "input": 1_204, "output": 8_331, "cacheRead": 412_900, "cacheWrite": 21_004, "reasoning": 2_210, "total": 445_649,
        "cost": ["input": .number(0.0036), "output": .number(0.125), "cacheRead": .number(0.1239), "cacheWrite": .number(0.0788),
                 "total": .number(0.3313)],
    ]

    static let completed: JSON = ["kind": "completed", "usage": usage]

    static let rateLimited: JSON = [
        "kind": "failed",
        "failure": ["class": "rate_limit", "message": "Rate limited: the provider asked to wait before the next request.",
                    "retryAfterMs": 30_000],
    ]

    static func runView(_ run: String, startedAt: Double) -> JSON {
        ["id": .string(run), "head": .string(head), "startedAt": .number(startedAt), "attempt": 1,
         "origin": ["kind": "input", "message": .string(run + "-prompt")]]
    }

    static func idle(run: String, end: JSON) -> JSON {
        ["kind": "idle", "lastRun": ["id": .string(run), "end": end, "endedAt": 0]]
    }

    static func live(run: String, startedAt: Double) -> JSON {
        ["kind": "live", "run": runView(run, startedAt: startedAt), "phase": "responding", "stopping": false]
    }

    static func waiting(run: String, startedAt: Double, part: String) -> JSON {
        ["kind": "waiting", "run": runView(run, startedAt: startedAt), "on": ["kind": "part", "part": .string(part)]]
    }

    static func retry(run: String, startedAt: Double) -> JSON {
        ["kind": "retrying", "run": runView(run, startedAt: startedAt), "until": .number(startedAt + minute * 7),
         "reason": "The provider is overloaded"]
    }

    static let models: JSON = [
        "generation": "replay", "default": ["provider": "anthropic", "id": "claude-sonnet-4-5"],
        "providers": [[
            "id": "anthropic", "name": "Anthropic", "credential": "verified", "methods": [], "listings": [:],
            "models": [
                ["ref": ["provider": "anthropic", "id": "claude-sonnet-4-5"], "name": "Claude Sonnet 4.5"],
                ["ref": ["provider": "anthropic", "id": "claude-opus-4-1"], "name": "Claude Opus 4.1"],
            ],
        ], [
            "id": "openai", "name": "OpenAI", "credential": "configured", "methods": [], "listings": [:],
            "models": [["ref": ["provider": "openai", "id": "gpt-5"], "name": "GPT-5"]],
        ]],
    ]

    static let workspaces: JSON = [[
        "id": .string(worktreeWorkspace), "target": ["kind": "local", "path": .string("/tmp/replay-worktrees/" + worktreeBranch)],
        "identity": "replay-worktree-identity", "availability": ["kind": "available"], "projectResources": .null, "trusted": .null,
        "projectSources": [], "addedBy": "local", "sessions": 1, "writers": [],
        "isolation": ["kind": "worktree", "source": .string(workspace), "session": .string(approval), "branch": .string(worktreeBranch),
                      "base": "replay-base"],
    ]]

    static let catalogView: JSON = [
        "commands": [], "skills": [], "agents": [], "tools": [],
        "settings": [[
            "id": "permissions", "owner": "approvals", "scope": "host", "label": "Permissions", "schema": [:],
            "choices": [
                ["value": "ask", "label": "Ask first", "badge": "Asks before commands, file edits and other tools"],
                ["value": "auto-edit", "label": "Auto-edit", "badge": "Edits workspace files, asks before commands and other tools"],
                ["value": "full", "label": "Full access", "badge": "Runs every tool without asking"],
            ],
            "value": .string(permission), "from": "host",
        ]],
    ]

    static func sessionChanges(_ id: String, now: Double) -> [JSON]? {
        guard let session = sessions.first(where: { $0.id == id }) else { return nil }
        return thread(session, now: now).runChanges.values.flatMap { $0 }
    }

    static func runChanges(_ run: String, now: Double) -> [JSON]? {
        sessions.lazy.compactMap { thread($0, now: now).runChanges[run] }.first
    }

    static func inspection(path: String) -> JSON {
        ["target": ["kind": "local", "path": .string(path)], "identity": "replay-identity", "availability": ["kind": "available"],
         "projectSources": [], "registered": .string(workspace)]
    }
}
