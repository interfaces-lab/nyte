/**
 * The client fold's `waiting`: which parked call a shell asks the user about.
 * The answer is "the one whose wait carries a selection", never a tool name.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { foldEvent, stateFromSnapshot, waitingCall } from "../src/client/session-state.ts";
import { MAIN, sessionId, type Selection, type SessionSnapshot } from "../src/kernel/sdk/types.ts";

const SESSION = sessionId("waiting-test");
const selection: Selection = { title: "Continue?", choices: [{ id: "yes", label: "Yes" }] };

const activeRun = {
  runId: "run",
  head: MAIN,
  phase: { kind: "tools" } as const,
  startedAt: 0,
  attempts: 0,
  config: {},
};

function snapshot(parked: SessionSnapshot["parked"]): SessionSnapshot {
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
    pending: [],
    ...(parked === undefined || parked.length === 0 ? {} : { run: activeRun }),
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
    parked,
  };
}

test("a restored snapshot keeps every parked call; the composer answers the newest ask", () => {
  const parked: SessionSnapshot["parked"] = [
    {
      runId: "run",
      callId: "task",
      waitId: "wait-task",
      tool: "task",
      args: { model: "fixture/script", prompt: "Investigate" },
    },
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
  const state = stateFromSnapshot(snapshot(parked));
  assert.equal(state.parked, parked);
  assert.deepEqual(waitingCall(state), {
    sessionId: SESSION,
    runId: "run",
    callId: "q",
    waitId: "wait-q",
    selection,
    until: 50,
  });
  assert.deepEqual(stateFromSnapshot(snapshot(undefined)).parked, []);
  assert.equal(
    waitingCall(
      stateFromSnapshot(
        snapshot([{ runId: "run", callId: "task", waitId: "wait-task", tool: "task", args: {} }]),
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

test("a waiting effect requests a snapshot only when it asks something", () => {
  const idle = stateFromSnapshot(snapshot(undefined));
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
  // A background wait parks from its own event, complete, and settles the same way.
  assert.deepEqual(background.state.parked, [
    {
      runId: "run",
      callId: "task",
      waitId: "wait-task",
      tool: "task",
      args: { prompt: "Investigate" },
      until: 90,
    },
  ]);
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
    snapshot([
      {
        runId: "run",
        callId: "q",
        waitId: "wait-q",
        tool: "anything",
        args: {},
        selection,
      },
    ]),
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
