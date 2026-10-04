/**
 * The transcript as a client receives it: typed provenance from the commit,
 * never a classification of tool names or error text.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type {
  Commit,
  CommitOutcome,
  Failure,
  Oid,
  RunPhase,
  ToolClass,
  ToolOutcome,
} from "@nyte-ai/protocol";
import type { AssistantMessage, ToolResultMessage } from "@nyte-ai/schema";
import {
  appendTranscriptCommit,
  changesFromTurns,
  EMPTY_TRANSCRIPT,
  transcriptFromCommits,
  transcriptWithRun,
  type RunEvidence,
  type Turn,
} from "../src/index.ts";

type Item = { readonly oid: Oid; readonly commit: Commit };

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(
  calls: readonly { readonly id: string; readonly name: string }[],
  stopReason: AssistantMessage["stopReason"] = "toolUse",
): { readonly kind: "message"; readonly message: AssistantMessage } {
  return {
    kind: "message",
    message: {
      role: "assistant",
      content: calls.map((call) => ({ type: "toolCall", ...call, arguments: {} })),
      api: "openai-responses",
      provider: "openai",
      model: "m",
      usage,
      stopReason,
      timestamp: 1,
    },
  };
}

function result(
  callId: string,
  options: Partial<Pick<ToolResultMessage, "isError">> = {},
): { readonly kind: "message"; readonly message: ToolResultMessage } {
  return {
    kind: "message",
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName: "edit",
      content: [{ type: "text", text: "ok" }],
      isError: options.isError ?? false,
      timestamp: 2,
    },
  };
}

type Entry =
  | {
      readonly body: ReturnType<typeof assistant>;
      readonly calls: Readonly<Record<string, ToolClass>>;
      readonly outcome: CommitOutcome;
    }
  | {
      readonly body: ReturnType<typeof result>;
      readonly call: ToolClass;
      readonly tree: null;
      readonly settlement?: ToolOutcome;
    };

/** A branch, oldest first, with each commit's stamp given beside its body. */
function branch(entries: readonly Entry[]): Item[] {
  let parent: Oid | null = null;
  return entries.map((entry, index) => {
    const oid = `c${String(index)}`;
    const commit = { kind: "commit", parent, at: index, ...entry } satisfies Commit;
    parent = oid;
    return { oid, commit };
  });
}

function conversation(turn: Turn | undefined): Extract<Turn, { kind: "turn" }> {
  if (turn?.kind !== "turn") assert.fail("expected a conversation turn");
  return turn;
}

const patched: ToolClass = {
  kind: "file_patch",
  op: "edit",
  path: "a.ts",
  added: 3,
  removed: 1,
  patch: "not parsed by the client",
};

const interrupted = { kind: "error", reason: { kind: "interrupted" }, commit: null } as const;

function under(phase: RunPhase): RunEvidence {
  return { run: { phase }, parked: [] };
}

function toolStates(turn: Turn | undefined): readonly unknown[] {
  return conversation(turn).parts.map((part) => (part.kind === "tool" ? part.state : undefined));
}

test("action source survives full and incremental transcript projection", () => {
  const source = { kind: "action", label: "Commit changes" } as const;
  const item = {
    oid: "action",
    commit: {
      kind: "commit",
      parent: null,
      at: 1,
      body: {
        kind: "message",
        message: { role: "user", content: "Commit the current changes", timestamp: 1 },
        source,
      },
      start: { kind: "none" },
    } satisfies Commit,
  };

  const full = transcriptFromCommits([item]);
  const incremental = appendTranscriptCommit(EMPTY_TRANSCRIPT, item);
  assert.ok(incremental !== undefined);
  assert.deepEqual(incremental.items, full);
  assert.deepEqual(conversation(full[0]).parts, [
    {
      kind: "user",
      commit: "action",
      parent: null,
      content: "Commit the current changes",
      at: 1,
      source,
    },
  ]);
});

test("tool parts carry their call and result commit timestamps", () => {
  const items = branch([
    {
      body: assistant([
        { id: "c1", name: "edit" },
        { id: "c2", name: "mystery" },
      ]),
      calls: {
        c1: { kind: "file_edit", path: "a.ts" },
        c2: { kind: "custom", label: "mystery" },
      },
      outcome: { kind: "ok" },
    },
    { body: result("c1"), call: patched, tree: null },
    { body: result("c2"), call: { kind: "custom", label: "mystery" }, tree: null },
  ]);
  const pending = conversation(transcriptFromCommits(items.slice(0, 1))[0]).parts;
  assert.deepEqual(pending, [
    {
      kind: "tool",
      callId: "c1",
      class: { kind: "file_edit", path: "a.ts" },
      state: interrupted,
      at: 0,
    },
    {
      kind: "tool",
      callId: "c2",
      class: { kind: "custom", label: "mystery" },
      state: interrupted,
      at: 0,
    },
  ]);
  const settled = conversation(transcriptFromCommits(items)[0]).parts;
  assert.deepEqual(settled, [
    {
      kind: "tool",
      callId: "c1",
      class: patched,
      state: { kind: "success", commit: "c1" },
      output: "ok",
      at: 1,
    },
    {
      kind: "tool",
      callId: "c2",
      class: { kind: "custom", label: "mystery" },
      state: { kind: "success", commit: "c2" },
      output: "ok",
      at: 2,
    },
  ]);
});

test("a stored result is success or a plain error; the output never decides", () => {
  const items = branch([
    {
      body: assistant([
        { id: "c1", name: "edit" },
        { id: "c2", name: "edit" },
      ]),
      calls: { c1: { kind: "file_edit", path: "a.ts" }, c2: { kind: "file_edit", path: "b.ts" } },
      outcome: { kind: "ok" },
    },
    {
      body: result("c1", { isError: true }),
      call: { kind: "file_edit", path: "a.ts" },
      tree: null,
    },
    { body: result("c2"), call: { kind: "file_edit", path: "b.ts" }, tree: null },
  ]);
  assert.deepEqual(toolStates(transcriptFromCommits(items, under({ kind: "tools" }))[0]), [
    { kind: "error", reason: { kind: "error" }, commit: "c1" },
    { kind: "success", commit: "c2" },
  ]);
});

test("a result commit's stored settlement is the state; isError only stands in for a record without one", () => {
  const exit = { kind: "error", reason: { kind: "exit", code: 2 } } as const;
  const items = branch([
    {
      body: assistant([
        { id: "c1", name: "bash" },
        { id: "c2", name: "bash" },
        { id: "c3", name: "bash" },
      ]),
      calls: {
        c1: { kind: "shell", command: "a" },
        c2: { kind: "shell", command: "b" },
        c3: { kind: "shell", command: "c" },
      },
      outcome: { kind: "ok" },
    },
    {
      body: result("c1", { isError: true }),
      call: { kind: "shell", command: "a", facts: { durationMs: 12, truncated: false } },
      tree: null,
      settlement: exit,
    },
    {
      body: result("c2", { isError: true }),
      call: { kind: "shell", command: "b" },
      tree: null,
      settlement: { kind: "error", reason: { kind: "cancelled" } },
    },
    {
      body: result("c3"),
      call: { kind: "shell", command: "c" },
      tree: null,
      settlement: { kind: "success" },
    },
  ]);
  const turn = conversation(transcriptFromCommits(items, under({ kind: "done" }))[0]);
  assert.deepEqual(toolStates(turn), [
    { ...exit, commit: "c1" },
    { kind: "error", reason: { kind: "cancelled" }, commit: "c2" },
    { kind: "success", commit: "c3" },
  ]);
  const [first] = turn.parts;
  assert.ok(first?.kind === "tool" && first.class.kind === "shell");
  assert.deepEqual(first.class.facts, { durationMs: 12, truncated: false });
});

test("an open call in the newest turn follows the run; one the conversation moved past is interrupted", () => {
  const items = branch([
    {
      body: assistant([{ id: "c1", name: "edit" }]),
      calls: { c1: { kind: "file_edit", path: "a.ts" } },
      outcome: { kind: "ok" },
    },
  ]);
  const stateUnder = (evidence: RunEvidence) =>
    toolStates(transcriptFromCommits(items, evidence)[0])[0];
  assert.deepEqual(stateUnder(under({ kind: "respond" })), { kind: "pending" });
  assert.deepEqual(stateUnder(under({ kind: "tools" })), { kind: "running" });
  assert.deepEqual(stateUnder(under({ kind: "waiting" })), { kind: "running" });
  assert.deepEqual(
    stateUnder({
      run: { phase: { kind: "waiting" } },
      parked: [
        {
          callId: "c1",
          waitId: "w1",
          selection: { title: "Pick", choices: [{ id: "a", label: "A" }] },
        },
      ],
    }),
    { kind: "running", waitingFor: { kind: "input", waitId: "w1" } },
  );
  assert.deepEqual(
    stateUnder({ run: { phase: { kind: "waiting" } }, parked: [{ callId: "c1", waitId: "w1" }] }),
    { kind: "running" },
  );
  assert.deepEqual(stateUnder(under({ kind: "done" })), interrupted);
  assert.deepEqual(stateUnder(under({ kind: "aborted" })), interrupted);
  assert.deepEqual(stateUnder({ run: undefined, parked: [] }), interrupted);

  const live = { items: transcriptFromCommits(items, under({ kind: "tools" })), tip: "c0" };
  assert.equal(transcriptWithRun(live, under({ kind: "tools" })), live);
  assert.deepEqual(toolStates(transcriptWithRun(live, under({ kind: "done" })).items[0]), [
    interrupted,
  ]);
  assert.deepEqual(toolStates(live.items[0]), [{ kind: "running" }]);

  const movedPast = appendTranscriptCommit(
    live,
    {
      oid: "u",
      commit: {
        kind: "commit",
        parent: "c0",
        at: 5,
        body: { kind: "message", message: { role: "user", content: "next", timestamp: 5 } },
        start: { kind: "none" },
      },
    },
    under({ kind: "tools" }),
  );
  assert.ok(movedPast !== undefined);
  assert.deepEqual(toolStates(movedPast.items[0]), [interrupted]);
  assert.deepEqual(toolStates(live.items[0]), [{ kind: "running" }]);
});

test("a call interrupted only by missing run evidence is running once the run is known", () => {
  const items = branch([
    {
      body: assistant([{ id: "c1", name: "edit" }]),
      calls: { c1: { kind: "file_edit", path: "a.ts" } },
      outcome: { kind: "ok" },
    },
  ]);
  const folded = appendTranscriptCommit(EMPTY_TRANSCRIPT, items[0] ?? assert.fail());
  assert.ok(folded !== undefined);
  assert.deepEqual(toolStates(folded.items[0]), [interrupted]);
  const known = transcriptWithRun(folded, under({ kind: "tools" }));
  assert.deepEqual(known.items, transcriptFromCommits(items, under({ kind: "tools" })));
  assert.deepEqual(toolStates(known.items[0]), [{ kind: "running" }]);
  assert.deepEqual(toolStates(transcriptWithRun(known, under({ kind: "aborted" })).items[0]), [
    interrupted,
  ]);
});

test("a commit's failure is the turn's failure", () => {
  const failure: Failure = { class: "rate_limit", message: "slow down", retryAfterMs: 500 };
  const turns = transcriptFromCommits(
    branch([
      {
        body: assistant([], "error"),
        calls: {},
        outcome: { kind: "failed", failure },
      },
    ]),
  );
  const turn = conversation(turns[0]);
  assert.deepEqual(turn.failure, failure);
  assert.deepEqual(turn.parts, []);
});

test("file_patch results fold into changes by their stamped counts, without reading the patch", () => {
  const items = branch([
    {
      body: assistant([
        { id: "c1", name: "edit" },
        { id: "c2", name: "edit" },
      ]),
      calls: {
        c1: { kind: "custom", label: "edit" },
        c2: { kind: "custom", label: "edit" },
      },
      outcome: { kind: "ok" },
    },
    { body: result("c1"), call: patched, tree: null },
    {
      body: result("c2", { isError: true }),
      call: { ...patched, path: "b.ts" },
      tree: null,
    },
  ]);
  assert.deepEqual(changesFromTurns(transcriptFromCommits(items)), [
    { path: "a.ts", added: 3, removed: 1 },
  ]);
});

test("an await on children is the run's own control flow: neither the call nor its result is a part", () => {
  const awaiting: ToolClass = {
    kind: "delegate",
    role: "await",
    target: { kind: "many", sessions: [sessionId("child")], mode: "all" },
  };
  const items = branch([
    {
      body: assistant([{ id: "w", name: "await" }]),
      calls: { w: awaiting },
      outcome: { kind: "ok" },
    },
    { body: result("w"), call: awaiting, tree: null },
    {
      body: assistant([{ id: "e", name: "edit" }]),
      calls: { e: { kind: "file_edit", path: "a.ts" } },
      outcome: { kind: "ok" },
    },
  ]);
  assert.deepEqual(
    transcriptFromCommits(items).flatMap((turn) => conversation(turn).parts),
    [
      {
        kind: "tool",
        callId: "e",
        class: { kind: "file_edit", path: "a.ts" },
        state: interrupted,
        at: 2,
      },
    ],
  );
});
