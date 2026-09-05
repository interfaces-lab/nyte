/**
 * The client fold, by value: a snapshot, then the events `watch` yields, must
 * leave the same state a fresh snapshot would, and must say when they cannot.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { RunInfo, SessionEvent, SessionSnapshot } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/core";
import type { AssistantMessage, UserMessage } from "@nyte-ai/schema";
import {
  foldEvent,
  isRunning,
  livePartKey,
  stateFromSnapshot,
  tipMismatch,
  type SessionState,
} from "../src/session-state.ts";

type Commit = Extract<SessionEvent, { kind: "commit" }>["item"]["commit"];

const id = sessionId("s");

function snapshot(seq = 10): SessionSnapshot {
  return {
    seq,
    session: {
      sessionId: id,
      createdAt: 1,
      lastActivityAt: 1,
      pinned: false,
      archived: false,
      heads: [{ head: "main", tip: null }],
      config: {},
    },
    head: "main",
    tip: null,
    config: {},
    transcript: [],
    pending: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
  };
}

function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 1 };
}

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "m",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 2,
  };
}

function commit(
  parent: string | null,
  message: UserMessage | AssistantMessage,
  runId?: string,
): Commit {
  const base: Commit = { kind: "commit", parent, body: { kind: "message", message }, at: 5 };
  return runId === undefined ? base : { ...base, run: runId };
}

function run(runId: string, phase: RunInfo["phase"]): RunInfo {
  return { runId, head: "main", phase, startedAt: 0, attempts: 1, config: {} };
}

function fold(state: SessionState, events: readonly SessionEvent[]): SessionState {
  let current = state;
  for (const event of events) {
    const outcome = foldEvent(current, event);
    if (outcome.kind === "resnapshot") assert.fail(`resnapshot on ${event.kind}`);
    current = outcome.state;
  }
  return current;
}

test("a user commit and its streamed answer fold into one turn, and the commit drops the overlay", () => {
  const start = stateFromSnapshot(snapshot());
  const streamed = fold(start, [
    { seq: 11, kind: "head_moved", head: "main", from: null, to: "u1", reason: "land" },
    {
      seq: 11,
      kind: "commit",
      head: "main",
      item: { oid: "u1", commit: commit(null, user("hi")) },
    },
    { seq: 12, kind: "run", head: "main", run: run("r1", { kind: "respond" }) },
    { seq: 13, kind: "text_delta", runId: "r1", attempt: 1, index: 0, delta: "hel" },
    { seq: 14, kind: "text_delta", runId: "r1", attempt: 1, index: 0, delta: "lo" },
    { seq: 15, kind: "reasoning_delta", runId: "r1", attempt: 1, index: 1, delta: "why" },
  ]);
  assert.equal(streamed.seq, 15);
  assert.equal(streamed.transcript.tip, "u1");
  assert.equal(tipMismatch(streamed), false);
  assert.ok(isRunning(streamed.run));
  assert.deepEqual(
    streamed.overlay.map((part) => [livePartKey(part), part.kind === "tool" ? "" : part.text]),
    [
      ["text:r1:1:0", "hello"],
      ["thinking:r1:1:1", "why"],
    ],
  );

  const settled = fold(streamed, [
    { seq: 16, kind: "head_moved", head: "main", from: "u1", to: "a1", reason: "respond" },
    {
      seq: 16,
      kind: "commit",
      head: "main",
      item: { oid: "a1", commit: commit("u1", assistant("hello"), "r1") },
    },
    { seq: 17, kind: "run", head: "main", run: run("r1", { kind: "done" }) },
  ]);
  assert.deepEqual(settled.overlay, []);
  assert.equal(isRunning(settled.run), false);
  const turn = settled.transcript.items[0];
  assert.ok(turn?.kind === "turn");
  assert.deepEqual(
    turn.parts.map((part) => part.kind),
    ["user", "assistant"],
  );
});

test("a commit that does not extend the tip asks for a snapshot", () => {
  const start = stateFromSnapshot(snapshot());
  const outcome = foldEvent(start, {
    seq: 11,
    kind: "commit",
    head: "main",
    item: { oid: "x", commit: commit("elsewhere", user("hi")) },
  });
  assert.deepEqual(outcome, { kind: "resnapshot" });
});

test("a head that moves without commits to follow is a tip mismatch until they arrive", () => {
  const start = fold(stateFromSnapshot(snapshot()), [
    {
      seq: 11,
      kind: "commit",
      head: "main",
      item: { oid: "u1", commit: commit(null, user("hi")) },
    },
  ]);
  const movedBack = fold(start, [
    { seq: 12, kind: "head_moved", head: "main", from: "u1", to: null, reason: "move" },
  ]);
  assert.equal(tipMismatch(movedBack), true);
  const movedForward = fold(start, [
    { seq: 12, kind: "head_moved", head: "main", from: "u1", to: "u2", reason: "land" },
    {
      seq: 12,
      kind: "commit",
      head: "main",
      item: { oid: "u2", commit: commit("u1", user("again")) },
    },
  ]);
  assert.equal(tipMismatch(movedForward), false);
});

test("pending rows follow queued, landed, and cancelled, oldest first", () => {
  const start = stateFromSnapshot(snapshot());
  const queued = fold(start, [
    {
      seq: 11,
      kind: "queued",
      head: "main",
      item: { change: "c2", lane: "queue", at: 20, content: "two" },
    },
    {
      seq: 12,
      kind: "queued",
      head: "main",
      item: { change: "c1", lane: "steer", at: 10, content: "one" },
    },
  ]);
  assert.deepEqual(
    queued.pending.map((item) => item.change),
    ["c1", "c2"],
  );
  const moved = fold(queued, [
    {
      seq: 13,
      kind: "queued",
      head: "main",
      item: { change: "c2", lane: "steer", at: 20, content: "two" },
    },
  ]);
  assert.deepEqual(
    moved.pending.map((item) => [item.change, item.lane]),
    [
      ["c1", "steer"],
      ["c2", "steer"],
    ],
  );
  const drained = fold(moved, [
    { seq: 14, kind: "landed", head: "main", change: "c1" },
    { seq: 15, kind: "queue_cancelled", change: "c2" },
  ]);
  assert.deepEqual(drained.pending, []);
});

test("a retry and a terminal phase both drop the run's streamed parts", () => {
  const start = fold(stateFromSnapshot(snapshot()), [
    { seq: 11, kind: "run", head: "main", run: run("r1", { kind: "respond" }) },
    { seq: 12, kind: "text_delta", runId: "r1", attempt: 1, index: 0, delta: "partial" },
    { seq: 13, kind: "tool_progress", runId: "r1", callId: "call-1", progress: { text: "50%" } },
  ]);
  assert.equal(start.overlay.length, 2);
  const retrying = fold(start, [
    { seq: 14, kind: "run", head: "main", run: run("r1", { kind: "retry", at: 99, error: "429" }) },
  ]);
  assert.deepEqual(retrying.overlay, []);
  const failed = fold(start, [
    { seq: 14, kind: "run", head: "main", run: run("r1", { kind: "failed", error: "boom" }) },
  ]);
  assert.deepEqual(failed.overlay, []);
});

test("only a parked question takes over the composer", () => {
  const restored = stateFromSnapshot({
    ...snapshot(),
    parked: [
      {
        runId: "r1",
        callId: "task-1",
        tool: "task",
        args: { agent: "explore", prompt: "find it" },
      },
    ],
  });
  assert.equal(restored.waiting, undefined);

  const start = stateFromSnapshot(snapshot());
  const background = fold(start, [
    { seq: 11, kind: "run", head: "main", run: run("r1", { kind: "waiting" }) },
    {
      seq: 12,
      kind: "effect",
      runId: "r1",
      callId: "task-1",
      state: "waiting",
      tool: "task",
      args: { agent: "explore", prompt: "find it" },
    },
  ]);
  assert.equal(background.waiting, undefined);

  const waiting = fold(background, [
    {
      seq: 13,
      kind: "effect",
      runId: "r1",
      callId: "ask-1",
      state: "waiting",
      tool: "question",
      args: { question: "which?" },
    },
  ]);
  assert.deepEqual(waiting.waiting, {
    runId: "r1",
    callId: "ask-1",
    tool: "question",
    args: { question: "which?" },
  });
  const answered = fold(waiting, [
    {
      seq: 14,
      kind: "effect",
      runId: "r1",
      callId: "ask-1",
      state: "signal",
      tool: "question",
      args: {},
    },
    { seq: 15, kind: "fact", key: "name", value: "room" },
  ]);
  assert.equal(answered.waiting, undefined);
  assert.equal(answered.info.name, "room");
});

test("events for another head leave the transcript alone but still advance the cursor", () => {
  const start = stateFromSnapshot(snapshot());
  const other = fold(start, [
    {
      seq: 11,
      kind: "commit",
      head: "side",
      item: { oid: "s1", commit: commit(null, user("side")) },
    },
    { seq: 12, kind: "run", head: "side", run: run("r9", { kind: "respond" }) },
  ]);
  assert.equal(other.seq, 12);
  assert.equal(other.transcript.tip, null);
  assert.equal(other.run, undefined);
});
