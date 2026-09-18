/**
 * The client fold's queue: a landing publishes the head and the queue base in
 * one CAS, but the watch delivers them as separate frames. The commit that
 * landed a change must take it out of `pending` itself, so no frame shows a
 * message both queued and in the transcript.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { foldEvent, stateFromSnapshot } from "@nyte-ai/client";
import type { SessionState } from "@nyte-ai/client";
import {
  MAIN,
  sessionId,
  type PendingItem,
  type SessionEvent,
  type SessionSnapshot,
} from "../src/kernel/sdk/types.ts";

const SESSION = sessionId("queue-fold-test");

function snapshot(pending: readonly PendingItem[]): SessionSnapshot {
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
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
  };
}

const item = (change: string, at: number): PendingItem => ({
  change,
  lane: "steer",
  at,
  content: `message ${change}`,
  key: `key-${change}`,
});

function landing(oid: string, parent: string | null, change: string): SessionEvent {
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
  const start = stateFromSnapshot(snapshot([item("a", 1), item("b", 2)]));
  const committed = applied(start, landing("c1", null, "a"));
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
  const start = stateFromSnapshot(snapshot([item("a", 1)]));
  const note = applied(start, {
    seq: 2,
    kind: "commit",
    head: MAIN,
    item: {
      oid: "n1",
      commit: { kind: "commit", parent: null, body: { kind: "note", type: "hello" }, at: 2 },
    },
  });
  assert.deepEqual(note.pending, start.pending);
  const elsewhere = applied(note, landing("c2", "n1", "z"));
  assert.deepEqual(elsewhere.pending, start.pending);
  assert.deepEqual(userParts(elsewhere), [["c2", "key-z"]]);
});
