import assert from "node:assert/strict";
import { test } from "vitest";
import type { FileChange, ToolClass, ToolTurnPart, Turn, TurnPart } from "@nyte-ai/protocol";
import type { CommitBody } from "../../src/kernel/model.ts";
import { appendTurnChanges, changesFromTurns, EMPTY_CHANGES } from "@nyte-ai/client";
import { appendTranscriptCommit, EMPTY_TRANSCRIPT, transcriptFromCommits } from "@nyte-ai/client";
import { assistant, call, commit, message, toolResult, user } from "./helpers.ts";

function patch(
  path: string,
  added: number,
  removed: number,
  op: "edit" | "write" = "edit",
): ToolClass {
  return { kind: "file_patch", op, path, added, removed, patch: `--- a/${path}\n+++ b/${path}\n` };
}

function turn(...parts: TurnPart[]): Extract<Turn, { kind: "turn" }> {
  return { kind: "turn", id: "turn", parts, startedAt: 0, durationMs: 0 };
}

function settled(commit: string, toolClass: ToolClass, isError = false): ToolTurnPart {
  return {
    kind: "tool",
    callId: commit,
    class: toolClass,
    result: { commit, isError, output: "done" },
  };
}

/** Compare public results while retaining every prior snapshot and all input values. */
function checkProjection(turns: readonly Turn[], expected: readonly FileChange[]): void {
  const before = structuredClone(turns);
  const emptyBefore = structuredClone(EMPTY_CHANGES);
  let state = EMPTY_CHANGES;
  const snapshots = [];
  for (const item of turns) {
    snapshots.push({ state, before: structuredClone(state) });
    state = appendTurnChanges(state, item);
  }
  assert.deepEqual(state.files, expected);
  assert.deepEqual(changesFromTurns(turns), expected);
  for (const item of turns) assert.equal(appendTurnChanges(state, item), state);
  for (const snapshot of snapshots) assert.deepEqual(snapshot.state, snapshot.before);
  assert.deepEqual(turns, before);
  assert.deepEqual(EMPTY_CHANGES, emptyBefore);
}

test("bulk and incremental totals keep file order, repeated paths, latest commits and OID deduplication", () => {
  const repeated = settled("first", patch("first.txt", 4, 2));
  const turns = [
    turn(repeated, repeated),
    turn(settled("latest", patch("second.txt", 2, 0, "write"))),
    turn(settled("gone", patch("gone.txt", 0, 1)), settled("again", patch("second.txt", 2, 0))),
    turn(repeated),
  ];
  checkProjection(turns, [
    { path: "first.txt", added: 4, removed: 2 },
    { path: "second.txt", added: 4, removed: 0 },
    { path: "gone.txt", added: 0, removed: 1 },
  ]);
});

test("only settled, successful file_patch results count; other parts and classes do not reserve an OID", () => {
  const ignored = turn(
    { kind: "user", commit: "user", parent: null, content: "edit" },
    { kind: "assistant", commit: "assistant", contentIndex: 0, text: "working" },
    { kind: "thinking", commit: "thinking", contentIndex: 0, text: "plan" },
    { kind: "tool", callId: "pending", class: { kind: "file_edit", path: "first.txt" } },
    settled("failed", patch("first.txt", 2, 1), true),
    settled("shell", { kind: "shell", command: "ls" }),
    settled("read", { kind: "file_read", path: "first.txt" }),
    settled("custom", { kind: "custom", label: "edit" }),
  );
  assert.equal(appendTurnChanges(EMPTY_CHANGES, ignored), EMPTY_CHANGES);
  const zeroCounts = turn(settled("rename", patch("renamed.txt", 0, 0)));
  const valid = turn(
    settled("failed", patch("first.txt", 2, 1)),
    settled("shell", patch("second.txt", 2, 0)),
  );
  checkProjection(
    [ignored, zeroCounts, valid, ignored],
    [
      { path: "renamed.txt", added: 0, removed: 0 },
      { path: "first.txt", added: 2, removed: 1 },
      { path: "second.txt", added: 2, removed: 0 },
    ],
  );
  const sameTurn = turn(
    settled("retry", patch("first.txt", 2, 1)),
    settled("retry", patch("first.txt", 9, 9)),
  );
  checkProjection([sameTurn], [{ path: "first.txt", added: 2, removed: 1 }]);
});

test("forks from one snapshot and repeated bulk rebuilds own independent totals", () => {
  const trunk = turn(settled("trunk", patch("first.txt", 2, 1)));
  const left = turn(
    settled("left", patch("first.txt", 2, 1)),
    settled("left-2", patch("second.txt", 2, 0)),
  );
  const right = turn(settled("right", patch("gone.txt", 0, 1)));
  const state = appendTurnChanges(EMPTY_CHANGES, trunk);
  const before = structuredClone(state);
  const leftState = appendTurnChanges(state, left);
  const leftBefore = structuredClone(leftState);
  const leftFiles = changesFromTurns([trunk, left]);
  const rightState = appendTurnChanges(state, right);
  const expectedLeft = [
    { path: "first.txt", added: 4, removed: 2 },
    { path: "second.txt", added: 2, removed: 0 },
  ];
  const expectedRight = [
    { path: "first.txt", added: 2, removed: 1 },
    { path: "gone.txt", added: 0, removed: 1 },
  ];
  assert.deepEqual(leftState.files, expectedLeft);
  assert.deepEqual(rightState.files, expectedRight);
  assert.deepEqual(changesFromTurns([trunk, right]), expectedRight);
  assert.deepEqual(changesFromTurns([trunk, left]), expectedLeft);
  assert.deepEqual(leftFiles, expectedLeft);
  assert.deepEqual(leftState, leftBefore);
  assert.deepEqual(state, before);
  assert.equal(appendTurnChanges(leftState, left), leftState);
  checkProjection([], []);
});

test("user and completion-opened work turns project the same changes during settlement and rebuild", () => {
  const bodies: (CommitBody | { body: CommitBody; calls?: Record<string, ToolClass> })[] = [
    message(user("edit")),
    message(assistant("working", { calls: [call("foreground", "edit")] })),
    {
      body: message(toolResult("foreground", "edit", "done")),
      calls: { foreground: patch("first.txt", 2, 1) },
    },
    message(assistant("finished")),
    { kind: "checkpoint", summary: "so far", retainedTail: [], tokensBefore: 10 },
    { kind: "summary", text: "another branch" },
    { kind: "config", model: { id: "model" } },
    {
      kind: "completion",
      job: {
        kind: "command",
        id: "job",
        command: "Build",
        end: { kind: "completed" },
        output: "done",
      },
    },
    message(assistant("follow-up", { calls: [call("follow-up", "edit")] })),
    {
      body: message(toolResult("follow-up", "edit", "done")),
      calls: { "follow-up": patch("second.txt", 2, 0) },
    },
  ];
  const items = bodies.map((entry, index) => {
    const stamped = "body" in entry ? entry : { body: entry, calls: undefined };
    return {
      oid: `commit-${index}`,
      commit: commit(index === 0 ? null : `commit-${index - 1}`, stamped.body, {
        at: index * 1000,
        calls: stamped.calls,
      }),
    };
  });
  const before = structuredClone(items);
  const turns = transcriptFromCommits(items);
  assert.deepEqual(
    turns.map((item) => item.kind),
    ["turn", "checkpoint", "summary", "config", "turn"],
  );
  const work = turns.at(-1);
  assert.ok(work?.kind === "turn");
  assert.equal(work.id, "commit-7");
  assert.deepEqual(
    work.parts.map((part) => part.kind),
    ["assistant", "tool"],
  );
  const expected = [
    { path: "first.txt", added: 2, removed: 1 },
    { path: "second.txt", added: 2, removed: 0 },
  ];
  checkProjection(turns, expected);
  let transcript = EMPTY_TRANSCRIPT;
  let changes = EMPTY_CHANGES;
  for (const item of items) {
    const transcriptBefore = structuredClone(transcript);
    const changesBefore = structuredClone(changes);
    const previousChanges = changes;
    const next = appendTranscriptCommit(transcript, item);
    assert.ok(next !== undefined);
    for (const projected of next.items) changes = appendTurnChanges(changes, projected);
    assert.deepEqual(transcript, transcriptBefore);
    assert.deepEqual(previousChanges, changesBefore);
    transcript = next;
    assert.deepEqual(changes.files, changesFromTurns(transcript.items));
  }
  assert.deepEqual(transcript.items, turns);
  assert.deepEqual(changes.files, expected);
  assert.deepEqual(items, before);
});
