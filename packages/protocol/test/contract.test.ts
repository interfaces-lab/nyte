/**
 * The schemas against values the SDK produces and values an attacker sends.
 * The type-level proof that each schema matches its interface runs in `tsc`
 * at every `typed<T>()` call; these are the runtime facts a type cannot state.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { Value } from "typebox/value";
import { validationIssues, describeIssues } from "../src/parse.ts";
import * as schemas from "../src/schemas.ts";
import { OPERATIONS, parseOperation } from "../src/operations.ts";
import { CallReplySchema, WireErrorSchema, statusFor, type ErrorCode } from "../src/wire.ts";
import { acceptsSelectionReply } from "../src/ui.ts";
import type { SessionEvent } from "../src/sdk.ts";

test("selection replies obey cardinality, choice ids, and own-answer permission", () => {
  const single = {
    title: "Continue?",
    choices: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
    other: "Another answer",
  } as const;
  assert.equal(acceptsSelectionReply(single, { choices: ["yes"] }), true);
  assert.equal(acceptsSelectionReply(single, { choices: [], other: "later" }), true);
  assert.equal(acceptsSelectionReply(single, { choices: ["yes", "no"] }), false);
  assert.equal(acceptsSelectionReply(single, { choices: ["missing"] }), false);
  assert.equal(acceptsSelectionReply(single, { choices: ["yes", "yes"] }), false);
  assert.equal(acceptsSelectionReply(single, { choices: ["yes"], other: "later" }), false);
  assert.equal(
    acceptsSelectionReply({ ...single, multiple: true }, { choices: ["yes", "no"] }),
    true,
  );
  assert.equal(
    acceptsSelectionReply(
      { title: single.title, choices: single.choices },
      { choices: [], other: "later" },
    ),
    false,
  );
});

test("activation requirement and all activation states validate", () => {
  assert.ok(
    Value.Check(schemas.ActivationRequirement, { kind: "workspace_trust", cwd: "/workspace" }),
  );
  assert.ok(!Value.Check(schemas.ActivationRequirement, { kind: "workspace_trust", cwd: "" }));
  assert.ok(Value.Check(schemas.SessionActivationState, { kind: "active" }));
  assert.ok(Value.Check(schemas.SessionActivationState, { kind: "inactive" }));
  assert.ok(
    Value.Check(schemas.SessionActivationState, {
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: "/workspace" },
    }),
  );
});

test("SessionInfo, snapshots, activation_changed, and compaction validate", () => {
  const session = {
    sessionId: "session",
    activation: { kind: "active" },
    createdAt: 1,
    lastActivityAt: 1,
    pinned: false,
    archived: false,
    heads: [],
    config: {},
  };
  assert.ok(Value.Check(schemas.SessionInfo, session));
  assert.ok(!Value.Check(schemas.SessionInfo, { ...session, activation: { kind: "requires" } }));
  assert.ok(
    Value.Check(schemas.SessionEvent, {
      seq: 2,
      kind: "activation_changed",
      activation: { kind: "inactive" },
    }),
  );
  const compaction = { id: "c1", reason: "manual", startedAt: 3 };
  assert.ok(
    Value.Check(schemas.SessionSnapshot, {
      seq: 2,
      session,
      head: "main",
      tip: null,
      config: {},
      transcript: [],
      pending: [],
      compaction,
      context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 0 },
    }),
  );
  assert.ok(
    Value.Check(schemas.SessionEvent, { seq: 3, kind: "compaction", head: "main", compaction }),
  );
  assert.ok(
    Value.Check(schemas.SessionEvent, {
      seq: 4,
      kind: "compaction",
      head: "main",
      compaction: null,
    }),
  );
  assert.ok(
    !Value.Check(schemas.SessionEvent, {
      seq: 2,
      kind: "activation_changed",
      activation: { kind: "requires", requirement: { kind: "workspace_trust", cwd: "" } },
    }),
  );
  assert.ok(
    !Value.Check(schemas.SessionEvent, {
      seq: 5,
      kind: "compaction",
      head: "main",
      compaction: { ...compaction, reason: "timer" },
    }),
  );
});

test("a fact event whose value was deleted arrives without a value key and is still an event", () => {
  const deleted: SessionEvent = { seq: 4, kind: "fact", key: "name", value: undefined };
  const wire: unknown = JSON.parse(JSON.stringify(deleted));
  assert.deepEqual(wire, { seq: 4, kind: "fact", key: "name" });
  assert.ok(Value.Check(schemas.SessionEvent, wire));
  assert.equal(wire.kind, "fact");
});

test("a commit event carries the whole message, and a mangled one is refused with a path", () => {
  const event: SessionEvent = {
    seq: 9,
    kind: "commit",
    head: "main",
    item: {
      oid: "abc",
      commit: {
        kind: "commit",
        parent: null,
        body: { kind: "message", message: { role: "user", content: "hi", timestamp: 1 } },
        start: { kind: "none" },
        at: 1,
      },
    },
  };
  assert.ok(Value.Check(schemas.SessionEvent, JSON.parse(JSON.stringify(event))));
  const broken = {
    ...event,
    item: { oid: "abc", commit: { ...event.item.commit, body: { kind: "message", message: 5 } } },
  };
  assert.ok(!Value.Check(schemas.SessionEvent, broken));
  const issues = validationIssues(Value.Errors(schemas.SessionEvent, broken));
  assert.ok(issues.some((issue) => issue.path.startsWith("/item/commit/body")));
});

test("a submission key rides on the pending item, the commit, and the user part, and stays optional", () => {
  const pending = { change: "abc", delivery: "steer", at: 1, content: "hi" };
  assert.ok(Value.Check(schemas.PendingItem, pending));
  assert.ok(Value.Check(schemas.PendingItem, { ...pending, key: "outbox-1" }));
  assert.ok(!Value.Check(schemas.PendingItem, { ...pending, key: 7 }));
  const commit = {
    kind: "commit",
    parent: null,
    change: "abc",
    key: "outbox-1",
    body: { kind: "message", message: { role: "user", content: "hi", timestamp: 1 } },
    start: { kind: "none" },
    at: 1,
  };
  assert.ok(Value.Check(schemas.Commit, commit));
  assert.ok(!Value.Check(schemas.Commit, { ...commit, key: null }));
  const part = { kind: "user", commit: "abc", parent: null, content: "hi", at: 1 };
  assert.ok(Value.Check(schemas.UserTurnPart, part));
  assert.ok(Value.Check(schemas.UserTurnPart, { ...part, key: "outbox-1" }));
  assert.ok(!Value.Check(schemas.UserTurnPart, { ...part, key: 7 }));
});

test("strict inputs refuse unknown keys, including an own __proto__ key parsed from JSON", () => {
  const input = OPERATIONS["sessions.get"].input;
  assert.ok(Value.Check(input, { sessionId: "s" }));
  assert.ok(!Value.Check(input, { sessionId: "s", extra: 1 }));
  assert.ok(!Value.Check(input, JSON.parse('{"sessionId":"s","__proto__":{"x":1}}')));
  assert.ok(!Value.Check(input, { sessionId: "" }));
});

test("JsonValue refuses undefined at any depth and accepts nested JSON", () => {
  assert.ok(Value.Check(schemas.JsonValue, { a: [1, "b", { c: null }] }));
  assert.ok(!Value.Check(schemas.JsonValue, { a: [1, undefined] }));
  assert.ok(!Value.Check(schemas.JsonValue, undefined));
});

test("failure delays and file patch counts are nonnegative integers where required", () => {
  assert.ok(
    Value.Check(schemas.Failure, { class: "rate_limit", message: "wait", retryAfterMs: 0 }),
  );
  assert.ok(
    !Value.Check(schemas.Failure, { class: "rate_limit", message: "wait", retryAfterMs: -1 }),
  );
  const patch = {
    kind: "file_patch",
    op: "edit",
    path: "file.ts",
    added: 1,
    removed: 0,
    patch: "diff",
  };
  assert.ok(Value.Check(schemas.ToolClass, patch));
  assert.ok(!Value.Check(schemas.ToolClass, { ...patch, added: -1 }));
  assert.ok(!Value.Check(schemas.ToolClass, { ...patch, removed: 0.5 }));
});

test("optional-input operations accept undefined and void operations accept only undefined", () => {
  assert.ok(Value.Check(OPERATIONS["sessions.list"].input, undefined));
  assert.ok(Value.Check(OPERATIONS["sessions.list"].input, { limit: 2 }));
  assert.ok(!Value.Check(OPERATIONS["sessions.list"].input, { limit: 1.5 }));
  assert.ok(!Value.Check(OPERATIONS["sessions.list"].input, null));
  assert.ok(Value.Check(OPERATIONS["sessions.rename"].output, undefined));
  assert.ok(!Value.Check(OPERATIONS["sessions.rename"].output, null));
  assert.ok(Value.Check(OPERATIONS["sessions.get"].output, undefined));
  assert.ok(!Value.Check(OPERATIONS["plugins.catalog"].output, undefined));
});

test("a reply carries any JSON value and names its exact wait; an outcome is one of three kinds", () => {
  const input = OPERATIONS["runs.reply"].input;
  assert.ok(Value.Check(input, { sessionId: "s", callId: "c", waitId: "w1", reply: null }));
  assert.ok(
    Value.Check(input, {
      sessionId: "s",
      callId: "c",
      waitId: "w1",
      reply: { approved: [1, "x"] },
    }),
  );
  assert.ok(!Value.Check(input, { sessionId: "s", callId: "c", reply: null }));
  assert.ok(!Value.Check(input, { sessionId: "s", callId: "c", waitId: "w1" }));
  assert.ok(!Value.Check(input, { sessionId: "s", callId: "c", waitId: "w1", reply: undefined }));
  assert.ok(Value.Check(OPERATIONS["runs.reply"].output, { kind: "signalled" }));
  assert.ok(!Value.Check(OPERATIONS["runs.reply"].output, { kind: "queued" }));
  assert.ok(Value.Check(OPERATIONS["runs.current"].output, undefined));
  assert.ok(Value.Check(OPERATIONS["plugins.status.list"].output, ["a", "b"]));
});

test("workspace select input is strict and outcomes are named kinds", () => {
  const input = OPERATIONS["workspace.select"].input;
  assert.ok(Value.Check(input, { kind: "home" }));
  assert.ok(Value.Check(input, { kind: "project", path: "/repo" }));
  assert.ok(!Value.Check(input, { kind: "home", path: "/repo" }));
  assert.ok(!Value.Check(input, { kind: "project" }));
  assert.ok(!Value.Check(input, { kind: "project", path: "/repo", extra: 1 }));
  const output = OPERATIONS["workspace.select"].output;
  assert.ok(Value.Check(output, { kind: "opened", selection: { kind: "home" } }));
  assert.ok(
    Value.Check(output, {
      kind: "opened",
      selection: {
        kind: "project",
        workspace: { path: "/repo", name: "repo", lastOpenedAt: 0 },
      },
    }),
  );
  assert.ok(Value.Check(output, { kind: "unavailable", path: "/repo" }));
  assert.ok(Value.Check(output, { kind: "untrusted", path: "/repo" }));
  assert.ok(Value.Check(output, { kind: "failed", message: "This host serves one workspace" }));
  assert.ok(!Value.Check(output, { kind: "opened" }));
  assert.ok(!Value.Check(output, { kind: "opened", selection: { kind: "project" } }));
  assert.ok(Value.Check(OPERATIONS["workspace.current"].input, undefined));
  assert.ok(Value.Check(OPERATIONS["workspace.current"].output, { kind: "home" }));
});

test("operation lookup never walks the prototype chain", () => {
  assert.equal(parseOperation("constructor"), undefined);
  assert.equal(parseOperation("__proto__"), undefined);
  assert.equal(parseOperation("toString"), undefined);
  assert.equal(parseOperation("messages.send"), "messages.send");
});

test("reply envelopes distinguish an undefined value from null, and every error code has a status", () => {
  assert.ok(Value.Check(CallReplySchema, { ok: true, defined: false }));
  assert.ok(Value.Check(CallReplySchema, { ok: true, defined: true, value: null }));
  assert.ok(!Value.Check(CallReplySchema, { ok: true }));
  assert.ok(!Value.Check(CallReplySchema, { ok: false, error: { code: "made_up", message: "x" } }));
  const codes: readonly ErrorCode[] = [
    "invalid_input",
    "cursor_expired",
    "unknown_operation",
    "unknown_session",
    "not_found",
    "method_not_allowed",
    "unsupported_media_type",
    "payload_too_large",
    "unauthorized",
    "forbidden",
    "closed",
    "internal",
  ];
  for (const code of codes) assert.ok(statusFor(code) >= 400 && statusFor(code) < 600, code);
  assert.ok(Value.Check(WireErrorSchema, { code: "cursor_expired", message: "m", floor: 3 }));
  assert.ok(!Value.Check(WireErrorSchema, { code: "cursor_expired", message: "m" }));
});

test("validation diagnostics are bounded and readable", () => {
  const errors = Value.Errors(schemas.SessionId, "");
  const issues = validationIssues(errors);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.path, "");
  assert.ok(describeIssues(issues).startsWith("/: "));
  assert.equal(describeIssues([]), "value did not match its schema");
  assert.equal(validationIssues(Array.from({ length: 30 }, () => errors).flat()).length, 20);
});

test("commit provenance belongs only to the body variant that produced it", () => {
  const assistantMessage = {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "openai",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
  const base = { kind: "commit", parent: null, at: 1 };
  const commits = [
    {
      ...base,
      body: { kind: "message", message: { role: "user", content: "go", timestamp: 1 } },
      start: { kind: "run", tree: null },
    },
    {
      ...base,
      body: { kind: "message", message: assistantMessage },
      calls: {},
      outcome: { kind: "ok" },
    },
    {
      ...base,
      body: { kind: "message", message: assistantMessage },
      calls: {},
      outcome: { kind: "failed", failure: { class: "provider", message: "offline" } },
    },
    {
      ...base,
      body: {
        kind: "message",
        message: {
          role: "toolResult",
          toolCallId: "call",
          toolName: "bash",
          content: [],
          isError: false,
          timestamp: 1,
        },
      },
      call: { kind: "shell", command: "pnpm test" },
      tree: null,
    },
    {
      ...base,
      body: {
        kind: "completion",
        job: {
          kind: "command",
          id: "job",
          command: "pnpm test",
          end: { kind: "completed" },
          output: "ok",
        },
      },
      start: { kind: "none" },
    },
    {
      ...base,
      body: { kind: "checkpoint", summary: "so far", retainedTail: [], tokensBefore: 10 },
    },
    { ...base, body: { kind: "summary", text: "branch" }, imports: ["source"] },
    { ...base, body: { kind: "config", thinkingLevel: "high" } },
  ];
  for (const commit of commits) assert.ok(Value.Check(schemas.Commit, commit));

  assert.ok(
    !Value.Check(schemas.Commit, { ...commits[1], failure: { class: "provider", message: "x" } }),
  );
  assert.ok(!Value.Check(schemas.Commit, { ...commits[4], outcome: { kind: "ok" } }));
  assert.ok(!Value.Check(schemas.Commit, { ...commits[0], calls: {} }));
  assert.ok(!Value.Check(schemas.Commit, { ...commits[3], calls: {} }));
  assert.ok(!Value.Check(schemas.Commit, { ...commits[6], imports: undefined }));
});

test("version-control schemas preserve head, side, file-column, and diff variants", () => {
  for (const head of [
    { kind: "unborn", branch: "main" },
    { kind: "detached", oid: "HEAD" },
    {
      kind: "attached",
      oid: "HEAD",
      branch: "main",
      upstream: { name: "origin/main", ahead: 2, behind: 1 },
      base: { name: "origin/main", source: "default" },
    },
  ])
    assert.ok(Value.Check(schemas.VcsHead, head));
  assert.ok(!Value.Check(schemas.VcsHead, { kind: "unborn", branch: "main", oid: "HEAD" }));
  assert.ok(
    !Value.Check(schemas.VcsHead, {
      kind: "attached",
      oid: "HEAD",
      branch: "main",
      upstream: { name: "origin/main", ahead: -1, behind: 0 },
      base: null,
    }),
  );

  const contents = {
    path: "file.ts",
    old: { kind: "absent" },
    new: { kind: "text", text: "hello" },
  };
  assert.ok(Value.Check(schemas.VcsContents, contents));
  assert.ok(
    Value.Check(schemas.VcsContents, {
      path: "file.ts",
      old: { kind: "truncated", head: "start" },
      new: { kind: "binary" },
    }),
  );
  assert.ok(!Value.Check(schemas.VcsContents, { ...contents, binary: false }));
  assert.ok(!Value.Check(schemas.VcsContents, { ...contents, old: { kind: "absent", text: "" } }));

  const snapshot = {
    kind: "repository",
    root: "/repo",
    revision: "revision",
    head: { kind: "unborn", branch: "main" },
    staged: [
      { path: "added", kind: "added" },
      { path: "renamed", kind: "renamed", from: "old" },
      { path: "conflict", kind: "conflicted" },
    ],
    unstaged: [
      { path: "working", kind: "modified" },
      { path: "new", kind: "untracked" },
      { path: "conflict", kind: "conflicted" },
    ],
  };
  assert.ok(Value.Check(schemas.VcsSnapshot, snapshot));
  assert.ok(
    !Value.Check(schemas.VcsSnapshot, { ...snapshot, staged: [{ path: "x", kind: "untracked" }] }),
  );
  assert.ok(
    !Value.Check(schemas.VcsSnapshot, {
      ...snapshot,
      unstaged: [{ path: "x", kind: "renamed", from: "y" }],
    }),
  );

  assert.ok(
    Value.Check(schemas.VcsDiff, {
      path: "file.ts",
      status: "modified",
      kind: "text",
      added: 1,
      removed: 2,
      patch: "diff",
    }),
  );
  assert.ok(
    Value.Check(schemas.VcsDiff, {
      path: "image.png",
      status: "added",
      kind: "binary",
      patch: "Binary files differ",
    }),
  );
  assert.ok(
    !Value.Check(schemas.VcsDiff, {
      path: "image.png",
      status: "added",
      kind: "binary",
      added: 0,
      removed: 0,
      patch: "Binary files differ",
    }),
  );
});

test("version-control operations require an explicit target and nonempty mutation paths", () => {
  const workspace = { target: { kind: "workspace" } };
  const session = { target: { kind: "session", sessionId: "session" } };
  assert.ok(Value.Check(OPERATIONS["workspace.vcs.snapshot"].input, workspace));
  assert.ok(Value.Check(OPERATIONS["workspace.files"].input, { ...session, query: "src" }));
  assert.ok(!Value.Check(OPERATIONS["workspace.vcs.snapshot"].input, {}));
  assert.ok(!Value.Check(OPERATIONS["workspace.vcs.snapshot"].input, { sessionId: "session" }));
  assert.ok(
    Value.Check(OPERATIONS["workspace.vcs.diff"].input, {
      ...workspace,
      scope: { kind: "worktree" },
      ignoreWhitespace: false,
    }),
  );
  assert.ok(
    !Value.Check(OPERATIONS["workspace.vcs.diff"].input, {
      ...workspace,
      scope: { kind: "worktree" },
    }),
  );
  const expect = { revision: "revision" };
  assert.ok(
    Value.Check(OPERATIONS["workspace.vcs.stage"].input, {
      ...workspace,
      paths: ["file.ts"],
      staged: true,
      expect,
    }),
  );
  assert.ok(
    !Value.Check(OPERATIONS["workspace.vcs.stage"].input, {
      ...workspace,
      paths: [],
      staged: true,
      expect,
    }),
  );
  assert.ok(
    Value.Check(OPERATIONS["workspace.vcs.commit"].input, {
      ...session,
      message: "Ship it",
      files: { kind: "paths", paths: ["file.ts"] },
      expect,
    }),
  );
  assert.ok(
    !Value.Check(OPERATIONS["workspace.vcs.commit"].input, {
      ...session,
      message: "Ship it",
      files: { kind: "paths", paths: [] },
      expect,
    }),
  );
});
