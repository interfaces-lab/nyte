/**
 * The client fold's projections of a session.
 *
 * Queue: a drain publishes the head and the queue base in one CAS, but the
 * watch delivers them as separate frames. The commit that landed a change must
 * take it out of `pending` itself, so no frame shows a message both queued and
 * in the transcript.
 *
 * `waiting`: which parked call a shell asks the user about. The answer is "the
 * one whose wait carries a selection", never a tool name.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  MAIN,
  sessionId,
  type PendingItem,
  type Selection,
  type SessionEvent,
  type SessionSnapshot,
  type Turn,
} from "@nyte-ai/protocol";
import { foldEvent, stateFromSnapshot, waitingCall, type SessionState } from "../src/index.ts";

const SESSION = sessionId("session-state-test");
const selection: Selection = { title: "Continue?", choices: [{ id: "yes", label: "Yes" }] };

const activeRun = {
  runId: "run",
  head: MAIN,
  origin: { kind: "user" } as const,
  root: "run",
  phase: { kind: "tools" } as const,
  startedAt: 0,
  attempts: 0,
  config: {},
};

function snapshot(
  input: { pending?: readonly PendingItem[]; parked?: SessionSnapshot["parked"] } = {},
): SessionSnapshot {
  const { pending = [], parked } = input;
  return {
    seq: 1,
    head: MAIN,
    tip: null,
    session: {
      sessionId: SESSION,
      activation: { kind: "active" },
      createdAt: 0,
      lastActivityAt: 0,
      pinned: false,
      archived: false,
      heads: [{ head: MAIN, tip: null }],
      config: {},
    },
    config: {},
    transcript: [],
    pending,
    ...(parked === undefined || parked.length === 0 ? {} : { run: activeRun }),
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
    parked,
  };
}

const item = (change: string, at: number): PendingItem => ({
  change,
  delivery: "steer",
  at,
  content: `message ${change}`,
  key: `key-${change}`,
});

function drain(oid: string, parent: string | null, change: string): SessionEvent {
  return {
    seq: 2,
    kind: "commit",
    head: MAIN,
    item: {
      oid,
      commit: {
        kind: "commit",
        parent,
        change,
        key: `key-${change}`,
        body: {
          kind: "message",
          message: { role: "user", content: `message ${change}`, timestamp: 1 },
        },
        start: { kind: "none" },
        at: 2,
      },
    },
  };
}

function applied(state: SessionState, event: SessionEvent): SessionState {
  const outcome = foldEvent(state, event);
  assert.equal(outcome.kind, "state");
  if (outcome.kind !== "state") throw new Error("unreachable");
  return outcome.state;
}

function userParts(state: SessionState): readonly (string | undefined)[][] {
  return state.transcript.items.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.flatMap((part) => (part.kind === "user" ? [[part.commit, part.key]] : []))
      : [],
  );
}

test("the commit that lands a change removes it from pending; its landed frame then changes nothing", () => {
  const start = stateFromSnapshot(snapshot({ pending: [item("a", 1), item("b", 2)] }));
  const committed = applied(start, drain("c1", null, "a"));
  assert.deepEqual(userParts(committed), [["c1", "key-a"]]);
  assert.deepEqual(
    committed.pending.map((entry) => entry.change),
    ["b"],
  );
  const landed = applied(committed, { seq: 2, kind: "landed", head: MAIN, change: "a" });
  assert.deepEqual(landed.pending, committed.pending);
  assert.deepEqual(userParts(landed), [["c1", "key-a"]]);
});

test("a commit that landed no change, or one this fold never queued, leaves pending alone", () => {
  const start = stateFromSnapshot(snapshot({ pending: [item("a", 1)] }));
  const configured = applied(start, {
    seq: 2,
    kind: "commit",
    head: MAIN,
    item: {
      oid: "n1",
      commit: { kind: "commit", parent: null, body: { kind: "config", agent: "hello" }, at: 2 },
    },
  });
  assert.deepEqual(configured.pending, start.pending);
  const elsewhere = applied(configured, drain("c2", "n1", "z"));
  assert.deepEqual(elsewhere.pending, start.pending);
  assert.deepEqual(userParts(elsewhere), [["c2", "key-z"]]);
});

test("a restored snapshot keeps its asks; the composer answers the newest", () => {
  const asks: SessionSnapshot["parked"] = [
    { runId: "run", callId: "p", waitId: "wait-p", tool: "anything", args: {}, selection },
    {
      runId: "run",
      callId: "q",
      waitId: "wait-q",
      tool: "anything",
      args: {},
      selection,
      until: 50,
    },
  ];
  const parked: SessionSnapshot["parked"] = [
    {
      runId: "run",
      callId: "task",
      waitId: "wait-task",
      tool: "task",
      args: { model: "fixture/script", prompt: "Investigate" },
    },
    ...asks,
  ];
  const state = stateFromSnapshot(snapshot({ parked }));
  // A wait on background work is the run's own business, never client state.
  assert.deepEqual(state.parked, asks);
  assert.deepEqual(waitingCall(state), {
    sessionId: SESSION,
    runId: "run",
    callId: "q",
    waitId: "wait-q",
    selection,
    until: 50,
  });
  assert.deepEqual(stateFromSnapshot(snapshot()).parked, []);
  assert.equal(
    waitingCall(
      stateFromSnapshot(
        snapshot({
          parked: [{ runId: "run", callId: "task", waitId: "wait-task", tool: "task", args: {} }],
        }),
      ),
    ),
    undefined,
  );

  // A run's terminal phase settles every ask; another run's phase does not touch them.
  const other = foldEvent(state, {
    seq: 2,
    kind: "run",
    head: MAIN,
    run: { ...activeRun, runId: "other" },
  });
  assert.ok(other.kind === "state");
  assert.deepEqual(other.state.parked, []);
  const done = foldEvent(state, {
    seq: 2,
    kind: "run",
    head: MAIN,
    run: { ...activeRun, phase: { kind: "done" } },
  });
  assert.ok(done.kind === "state");
  assert.deepEqual(done.state.parked, []);
  const still = foldEvent(state, { seq: 2, kind: "run", head: MAIN, run: activeRun });
  assert.ok(still.kind === "state");
  assert.equal(still.state.parked, state.parked);
});

test("terminal jobs clear progress and late frames cannot restore it", () => {
  const state = stateFromSnapshot(snapshot({ parked: [] }));
  const started = foldEvent(state, { seq: 2, kind: "run", head: MAIN, run: activeRun });
  assert.ok(started.kind === "state");
  const progress = foldEvent(started.state, {
    seq: 3,
    kind: "tool_progress",
    runId: "run",
    callId: "call",
    progress: { text: "working" },
  });
  assert.ok(progress.kind === "state");
  assert.equal(progress.state.overlay.length, 1);
  const completed = foldEvent(progress.state, {
    seq: 4,
    kind: "job",
    job: {
      id: "job",
      head: MAIN,
      origin: { kind: "run", runId: "run", callId: "call" },
      command: "work",
      output: "done",
      isBackgrounded: false,
      phase: { kind: "completed" },
      startedAt: 1,
      updatedAt: 2,
    },
  });
  assert.ok(completed.kind === "state");
  assert.deepEqual(completed.state.overlay, []);
  const late = foldEvent(completed.state, {
    seq: 5,
    kind: "tool_progress",
    runId: "run",
    callId: "call",
    progress: { text: "late" },
  });
  assert.ok(late.kind === "state");
  assert.deepEqual(late.state.overlay, []);
});

test("a snapshot's settled calls stay settled when a progress frame replays after it", () => {
  const settledTurn = {
    kind: "turn",
    id: "t",
    run: { kind: "run", id: "run" },
    startedAt: 0,
    durationMs: 0,
    parts: [
      {
        kind: "tool",
        callId: "call",
        at: 0,
        class: { kind: "shell", command: "ls" },
        state: { kind: "success", commit: "c" },
      },
      {
        kind: "tool",
        callId: "open",
        at: 0,
        class: { kind: "shell", command: "sleep" },
        state: { kind: "running" },
      },
    ],
  } satisfies Turn;
  const state = stateFromSnapshot({ ...snapshot(), run: activeRun, transcript: [settledTurn] });
  const frame = (callId: string, seq: number): SessionEvent => ({
    seq,
    kind: "tool_progress",
    runId: "run",
    callId,
    progress: { text: "late" },
  });
  const late = foldEvent(state, frame("call", 2));
  assert.ok(late.kind === "state");
  assert.deepEqual(late.state.overlay, []);
  const live = foldEvent(late.state, frame("open", 3));
  assert.ok(live.kind === "state");
  assert.equal(live.state.overlay.length, 1);
});

test("a waiting effect requests a snapshot only when it asks something", () => {
  const idle = stateFromSnapshot(snapshot());
  const started = foldEvent(idle, { seq: 2, kind: "run", head: MAIN, run: activeRun });
  assert.ok(started.kind === "state");
  const background = foldEvent(started.state, {
    seq: 3,
    kind: "effect",
    state: "waiting",
    runId: "run",
    callId: "task",
    waitId: "wait-task",
    tool: "task",
    args: { prompt: "Investigate" },
    until: 90,
  });
  assert.ok(background.kind === "state");
  assert.deepEqual(background.state.parked, []);
  assert.equal(waitingCall(background.state), undefined);
  const settled = foldEvent(background.state, {
    seq: 4,
    kind: "effect",
    state: "result",
    runId: "run",
    callId: "task",
    tool: "task",
    args: {},
  });
  assert.ok(settled.kind === "state");
  assert.deepEqual(settled.state.parked, []);

  const asked = foldEvent(background.state, {
    seq: 4,
    kind: "effect",
    state: "waiting",
    runId: "run",
    callId: "q",
    waitId: "wait-q",
    tool: "anything",
    args: {},
    selection,
  });
  assert.equal(asked.kind, "resnapshot");
});

test("a replayed selection requests a snapshot and another run cannot replace this call", () => {
  const current = stateFromSnapshot(
    snapshot({
      parked: [
        {
          runId: "run",
          callId: "q",
          waitId: "wait-q",
          tool: "anything",
          args: {},
          selection,
        },
      ],
    }),
  );
  const stale = foldEvent(current, {
    seq: 2,
    kind: "effect",
    state: "waiting",
    runId: "run",
    callId: "q",
    waitId: "older-wait",
    tool: "anything",
    args: {},
    selection: { title: "Old question", choices: [{ id: "old", label: "Old" }] },
  });
  assert.equal(stale.kind, "resnapshot");

  const foreignWait = foldEvent(current, {
    seq: 3,
    kind: "effect",
    state: "waiting",
    runId: "other-run",
    callId: "other-call",
    waitId: "wait-other",
    tool: "anything",
    args: {},
    selection: { title: "Wrong head", choices: [{ id: "x", label: "Wrong" }] },
  });
  assert.ok(foreignWait.kind === "state");
  assert.equal(foreignWait.state.parked, current.parked);

  const foreignSignal = foldEvent(foreignWait.state, {
    seq: 4,
    kind: "effect",
    state: "signal",
    runId: "other-run",
    callId: "q",
    tool: "anything",
    args: {},
  });
  assert.ok(foreignSignal.kind === "state");
  assert.equal(foreignSignal.state.parked, current.parked);

  // A settled ask of this run has no wait generation on the wire; the snapshot decides.
  const settled = foldEvent(current, {
    seq: 5,
    kind: "effect",
    state: "result",
    runId: "run",
    callId: "q",
    tool: "anything",
    args: {},
  });
  assert.equal(settled.kind, "resnapshot");
  const unlisted = foldEvent(current, {
    seq: 5,
    kind: "effect",
    state: "result",
    runId: "run",
    callId: "task",
    tool: "task",
    args: {},
  });
  assert.ok(unlisted.kind === "state");
  assert.equal(unlisted.state.parked, current.parked);
});
