import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { RunInfo, RunPhase, SessionEvent } from "@nyte-ai/core";
import type { AssistantMessage, UserMessage } from "@nyte-ai/schema";
import { foldEvent, IDLE, livePartKey, resumeFrom } from "./live-fold.ts";
import type { LiveSnapshot } from "./live-fold.ts";

type CommitItem = Extract<SessionEvent, { readonly kind: "commit" }>["item"];

const RUN = "run-1";

function run(phase: RunPhase, runId = RUN): RunInfo {
  return { runId, head: "main", phase, startedAt: 1_000, attempts: 1, config: {} };
}

function runEvent(seq: number, phase: RunPhase, runId = RUN): SessionEvent {
  return { seq, kind: "run", head: "main", run: run(phase, runId) };
}

function textDelta(seq: number, attempt: number, index: number, delta: string): SessionEvent {
  return { seq, kind: "text_delta", runId: RUN, attempt, index, delta };
}

function reasoningDelta(seq: number, attempt: number, index: number, delta: string): SessionEvent {
  return { seq, kind: "reasoning_delta", runId: RUN, attempt, index, delta };
}

function assistantCommit(seq: number, runId: string | undefined): SessionEvent {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "settled" }],
    api: "openai-responses",
    provider: "openai",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1_000,
  };
  const base: CommitItem["commit"] = {
    kind: "commit",
    parent: null,
    body: { kind: "message", message },
    at: 1_000,
  };
  const commit = runId === undefined ? base : { ...base, run: runId };
  return { seq, kind: "commit", head: "main", item: { oid: `oid-${String(seq)}`, commit } };
}

function userCommit(seq: number): SessionEvent {
  const message: UserMessage = { role: "user", content: "hello", timestamp: 1_000 };
  return {
    seq,
    kind: "commit",
    head: "main",
    item: {
      oid: `oid-${String(seq)}`,
      commit: { kind: "commit", parent: null, run: RUN, body: { kind: "message", message }, at: 1 },
    },
  };
}

function foldAll(events: readonly SessionEvent[], from: LiveSnapshot = IDLE): LiveSnapshot {
  return events.reduce((snapshot, event) => foldEvent(snapshot, event).snapshot, from);
}

describe("live fold: streaming buffers", () => {
  test("keys deltas by run, attempt, and index in arrival order", () => {
    const snapshot = foldAll([
      reasoningDelta(1, 1, 0, "hm"),
      textDelta(2, 1, 1, "Hel"),
      textDelta(3, 1, 1, "lo"),
      textDelta(4, 2, 0, "again"),
    ]);

    assert.equal(snapshot.runState, "working");
    assert.equal(snapshot.thinking.get(livePartKey(RUN, 1, 0)), "hm");
    assert.equal(snapshot.text.get(livePartKey(RUN, 1, 1)), "Hello");
    assert.equal(snapshot.text.get(livePartKey(RUN, 2, 0)), "again");
    assert.deepEqual(
      snapshot.order.map((ref) => [ref.kind, ref.attempt, ref.index]),
      [
        ["thinking", 1, 0],
        ["text", 1, 1],
        ["text", 2, 0],
      ],
    );
  });

  test("a delta is ephemeral and never asks for a settled refresh", () => {
    assert.equal(foldEvent(IDLE, textDelta(1, 1, 0, "x")).refreshAt, undefined);
    assert.equal(foldEvent(IDLE, reasoningDelta(1, 1, 0, "x")).refreshAt, undefined);
    const progress = foldEvent(IDLE, {
      seq: 1,
      kind: "tool_progress",
      runId: RUN,
      callId: "call-1",
      progress: { text: "reading" },
    });
    assert.equal(progress.refreshAt, undefined);
    assert.deepEqual(progress.snapshot.tools.get("call-1"), {
      runId: RUN,
      progress: { text: "reading" },
    });
  });

  test("the assistant commit for an attempt drops that attempt's buffers and refreshes", () => {
    const streaming = foldAll([reasoningDelta(1, 1, 0, "hm"), textDelta(2, 1, 1, "Hello")]);
    const result = foldEvent(streaming, assistantCommit(3, RUN));

    assert.equal(result.refreshAt, 3);
    assert.equal(result.snapshot.text.size, 0);
    assert.equal(result.snapshot.thinking.size, 0);
    assert.deepEqual(result.snapshot.order, []);
    assert.equal(result.snapshot.runState, "working");
  });

  test("a commit that is not an assistant message leaves buffers alone", () => {
    const streaming = foldAll([textDelta(1, 1, 0, "Hello")]);

    const user = foldEvent(streaming, userCommit(2));
    assert.equal(user.refreshAt, 2);
    assert.equal(user.snapshot, streaming);

    const foreign = foldEvent(streaming, assistantCommit(3, "other-run"));
    assert.equal(foreign.snapshot, streaming);

    const runless = foldEvent(streaming, assistantCommit(4, undefined));
    assert.equal(runless.snapshot, streaming);
  });

  test("a terminal run phase drops every buffer of that run, including tool progress", () => {
    const streaming = foldAll([
      textDelta(1, 1, 0, "Hello"),
      { seq: 2, kind: "tool_progress", runId: RUN, callId: "call-1", progress: { text: "x" } },
      { seq: 3, kind: "tool_progress", runId: "other", callId: "call-2", progress: { text: "y" } },
    ]);

    for (const phase of [
      { kind: "done" },
      { kind: "aborted" },
      { kind: "failed", error: "boom" },
    ] satisfies readonly RunPhase[]) {
      const result = foldEvent(streaming, runEvent(4, phase));
      assert.equal(result.refreshAt, 4, phase.kind);
      assert.equal(result.snapshot.runState, "idle", phase.kind);
      assert.equal(result.snapshot.text.size, 0, phase.kind);
      assert.deepEqual([...result.snapshot.tools.keys()], ["call-2"], phase.kind);
    }
  });
});

describe("live fold: run phases", () => {
  test("respond and tools are working; waiting and terminal phases are idle", () => {
    assert.equal(foldEvent(IDLE, runEvent(1, { kind: "respond" })).snapshot.runState, "working");
    assert.equal(foldEvent(IDLE, runEvent(1, { kind: "tools" })).snapshot.runState, "working");
    assert.equal(foldEvent(IDLE, runEvent(1, { kind: "waiting" })).snapshot.runState, "idle");
    assert.equal(foldEvent(IDLE, runEvent(1, { kind: "done" })).snapshot.runState, "idle");
  });

  test("retry carries its time and error, and discards the failed attempt's stream", () => {
    const streaming = foldAll([textDelta(1, 1, 0, "partial")]);
    const result = foldEvent(streaming, runEvent(2, { kind: "retry", at: 5_000, error: "429" }));

    assert.equal(result.refreshAt, 2);
    assert.equal(result.snapshot.runState, "retrying");
    assert.deepEqual(result.snapshot.retry, { at: 5_000, message: "429" });
    assert.equal(result.snapshot.text.size, 0);

    const resumed = foldEvent(result.snapshot, textDelta(3, 2, 0, "second try"));
    assert.equal(resumed.snapshot.runState, "working");
    assert.equal(resumed.snapshot.retry, undefined);
    assert.equal(resumed.snapshot.text.get(livePartKey(RUN, 2, 0)), "second try");
  });

  test("every run event refreshes the thread at its seq", () => {
    assert.equal(foldEvent(IDLE, runEvent(7, { kind: "respond" })).refreshAt, 7);
  });
});

describe("live fold: durable events and effects", () => {
  test("every durable event refreshes the thread at its seq without touching the overlay", () => {
    const streaming = foldAll([textDelta(1, 1, 0, "Hello")]);
    const durable: readonly SessionEvent[] = [
      { seq: 2, kind: "head_moved", head: "main", from: null, to: "a", reason: "publish" },
      {
        seq: 3,
        kind: "queued",
        head: "main",
        item: { change: "c", lane: "steer", at: 1, content: "x" },
      },
      { seq: 4, kind: "landed", head: "main", change: "c" },
      { seq: 5, kind: "queue_cancelled", change: "c" },
      { seq: 6, kind: "fact", key: "name", value: "x" },
      { seq: 7, kind: "stack", head: "side", parent: "main", base: null },
      { seq: 8, kind: "deleted" },
    ];

    for (const event of durable) {
      const result = foldEvent(streaming, event);
      assert.equal(result.refreshAt, event.seq, event.kind);
      assert.equal(result.snapshot, streaming, event.kind);
    }
  });

  test("a waiting effect parks the run; other effect states refresh", () => {
    const working = foldEvent(IDLE, runEvent(1, { kind: "tools" })).snapshot;
    const effect = (state: "intent" | "waiting" | "signal" | "result"): SessionEvent => ({
      seq: 2,
      kind: "effect",
      runId: RUN,
      callId: "call-1",
      state,
      tool: "ask",
      args: {},
    });

    const waiting = foldEvent(working, effect("waiting"));
    assert.equal(waiting.snapshot.runState, "idle");
    assert.equal(waiting.refreshAt, undefined);

    for (const state of ["intent", "signal", "result"] as const) {
      const result = foldEvent(working, effect(state));
      assert.equal(result.refreshAt, 2, state);
      assert.equal(result.snapshot, working, state);
    }
  });

  test("synced and plugins_changed change nothing", () => {
    assert.deepEqual(foldEvent(IDLE, { seq: 1, kind: "synced" }), { snapshot: IDLE });
    assert.deepEqual(foldEvent(IDLE, { seq: 1, kind: "plugins_changed", plugins: [] }), {
      snapshot: IDLE,
    });
  });

  test("diagnostics keep info, warn, and error, newest three", () => {
    const levels = ["info", "warn", "error", "info"] as const;
    const snapshot = foldAll(
      levels.map((level, index) => ({
        seq: index + 1,
        kind: "diagnostic",
        level,
        owner: "plugin",
        message: `m${String(index)}`,
      })),
    );

    assert.deepEqual(
      snapshot.diagnostics.map((entry) => [entry.level, entry.message]),
      [
        ["warn", "m1"],
        ["error", "m2"],
        ["info", "m3"],
      ],
    );
  });
});

describe("live fold: resuming from a snapshot", () => {
  test("clears every buffer, keeps diagnostics, and takes the run state from the snapshot", () => {
    const before = foldAll([
      textDelta(1, 1, 0, "stale"),
      { seq: 2, kind: "tool_progress", runId: RUN, callId: "call-1", progress: { text: "x" } },
      { seq: 3, kind: "diagnostic", level: "warn", owner: "plugin", message: "kept" },
    ]);

    const idle = resumeFrom(before, undefined);
    assert.equal(idle.runState, "idle");
    assert.equal(idle.text.size, 0);
    assert.equal(idle.tools.size, 0);
    assert.deepEqual(idle.order, []);
    assert.deepEqual(idle.diagnostics, before.diagnostics);

    assert.equal(resumeFrom(before, run({ kind: "respond" })).runState, "working");
    const retrying = resumeFrom(before, run({ kind: "retry", at: 9, error: "e" }));
    assert.equal(retrying.runState, "retrying");
    assert.deepEqual(retrying.retry, { at: 9, message: "e" });
  });
});
