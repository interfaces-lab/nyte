import assert from "node:assert/strict";
import { test } from "vitest";
import type { FileChange, ToolTurnPart, Turn, TurnPart } from "@nyte-ai/protocol";
import type { JsonValue } from "@nyte-ai/schema";
import type { CommitBody } from "../../src/kernel/model.ts";
import { appendTurnChanges, changesFromTurns, EMPTY_CHANGES, readPatch } from "@nyte-ai/client";
import { appendTranscriptCommit, EMPTY_TRANSCRIPT, transcriptFromCommits } from "@nyte-ai/client";
import { assistant, call, commit, message, toolResult, user } from "./helpers.ts";

const firstPatch =
  "--- a/first.txt\n+++ b/first.txt\n@@ -1 +1 @@\n-old\n+new\n@@ -8 +8,2 @@\n context\n+extra\n";
const secondPatch = "--- /dev/null\n+++ b/second.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n";
const deletion = "--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
const rename =
  "diff --git a/old.txt b/renamed.txt\nsimilarity index 100%\nrename from old.txt\nrename to renamed.txt\n";

function turn(...parts: TurnPart[]): Extract<Turn, { kind: "turn" }> {
  return { kind: "turn", id: "turn", parts, outcome: "completed", startedAt: 0, durationMs: 0 };
}

function settled(commit: string, details: JsonValue, isError = false): ToolTurnPart {
  return {
    kind: "tool",
    callId: commit,
    toolName: "edit",
    result: { commit, details, isError, output: "done" },
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
  const repeated = settled("first", { patch: firstPatch + secondPatch + firstPatch });
  const turns = [
    turn(repeated, repeated),
    turn(settled("latest", { diff: secondPatch + deletion })),
    turn(repeated),
  ];
  checkProjection(turns, [
    { path: "first.txt", added: 4, removed: 2, lastCommit: "first" },
    { path: "second.txt", added: 4, removed: 0, lastCommit: "latest" },
    { path: "gone.txt", added: 0, removed: 1, lastCommit: "latest" },
  ]);
});

test("skipped results do not reserve an OID and metadata still accounts for zero-count files", () => {
  const ignored = turn(
    { kind: "user", commit: "user", parent: null, content: "edit" },
    { kind: "assistant", commit: "assistant", contentIndex: 0, text: "working" },
    { kind: "thinking", commit: "thinking", contentIndex: 0, text: "plan" },
    { kind: "note", commit: "note", text: "note" },
    { kind: "tool", callId: "pending", toolName: "edit" },
    settled("failed", { patch: firstPatch }, true),
    settled("malformed", { patch: "--- a/bad\n+++ b/bad\n@@ -1 +1 @@\n-old" }),
    settled("no-path", { patch: "@@ -1 +1 @@\n-old\n+new\n" }),
    settled("plain", { patch: "not a patch" }),
    settled("empty", {}),
  );
  assert.equal(appendTurnChanges(EMPTY_CHANGES, ignored), EMPTY_CHANGES);
  const zeroCounts = turn(
    settled("rename", { patch: rename }),
    settled("same", { patch: "--- a/same.txt\n+++ b/same.txt\n@@ -1 +1 @@\n context\n" }),
    settled("headers", { patch: "--- a/headers.txt\n+++ b/headers.txt\n" }),
  );
  const valid = turn(
    settled("failed", { patch: firstPatch }),
    settled("malformed", { patch: secondPatch }),
    settled("no-path", { patch: deletion }),
  );
  checkProjection(
    [ignored, zeroCounts, valid, ignored],
    [
      { path: "renamed.txt", added: 0, removed: 0, lastCommit: "rename" },
      { path: "same.txt", added: 0, removed: 0, lastCommit: "same" },
      { path: "headers.txt", added: 0, removed: 0, lastCommit: "headers" },
      { path: "first.txt", added: 2, removed: 1, lastCommit: "failed" },
      { path: "second.txt", added: 2, removed: 0, lastCommit: "malformed" },
      { path: "gone.txt", added: 0, removed: 1, lastCommit: "no-path" },
    ],
  );
  const sameTurn = turn(
    settled("retry", { patch: "@@ -1 +1 @@\n-old\n+new\n" }),
    settled("retry", { patch: firstPatch }),
  );
  checkProjection([sameTurn], [{ path: "first.txt", added: 2, removed: 1, lastCommit: "retry" }]);
});

test("forks from one snapshot and repeated bulk rebuilds own independent totals", () => {
  const trunk = turn(settled("trunk", { patch: firstPatch }));
  const left = turn(settled("left", { patch: firstPatch + secondPatch }));
  const right = turn(settled("right", { patch: deletion }));
  const state = appendTurnChanges(EMPTY_CHANGES, trunk);
  const before = structuredClone(state);
  const leftState = appendTurnChanges(state, left);
  const leftBefore = structuredClone(leftState);
  const leftFiles = changesFromTurns([trunk, left]);
  const rightState = appendTurnChanges(state, right);
  const expectedLeft = [
    { path: "first.txt", added: 4, removed: 2, lastCommit: "left" },
    { path: "second.txt", added: 2, removed: 0, lastCommit: "left" },
  ];
  const expectedRight = [
    { path: "first.txt", added: 2, removed: 1, lastCommit: "trunk" },
    { path: "gone.txt", added: 0, removed: 1, lastCommit: "right" },
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

test("a tool's patch is read from `patch`, then `diff`, byte for byte", () => {
  assert.equal(readPatch({ patch: firstPatch, diff: secondPatch }), firstPatch);
  assert.equal(readPatch({ patch: "", diff: secondPatch }), secondPatch);
  assert.equal(readPatch({ patch: 1, diff: secondPatch }), secondPatch);
  assert.equal(readPatch({ diff: ` ${firstPatch}` }), undefined);
  for (const details of [undefined, null, [], "patch", { patch: false, diff: {} }]) {
    assert.equal(readPatch(details), undefined);
  }
});

test("user and completion-opened work turns project the same changes during settlement and rebuild", () => {
  const bodies: CommitBody[] = [
    message(user("edit")),
    message(assistant("working", { calls: [call("foreground", "edit")] })),
    message(toolResult("foreground", "edit", "done", { details: { patch: firstPatch } })),
    message(assistant("finished")),
    { kind: "checkpoint", summary: "so far", retainedTail: [], tokensBefore: 10 },
    { kind: "summary", text: "another branch" },
    { kind: "config", model: { id: "model" } },
    { kind: "note", type: "status", data: { patch: deletion } },
    {
      kind: "completion",
      job: {
        id: "job",
        kind: "command",
        runId: "run",
        callId: "background",
        head: "main",
        mode: "background",
        state: "completed",
        title: "Build",
        output: "done",
        startedAt: 1,
        updatedAt: 2,
      },
    },
    message(assistant("follow-up", { calls: [call("follow-up", "edit")] })),
    message(toolResult("follow-up", "edit", "done", { details: { patch: secondPatch } })),
  ];
  const items = bodies.map((body, index) => ({
    oid: `commit-${index}`,
    commit: commit(index === 0 ? null : `commit-${index - 1}`, body, { at: index * 1000 }),
  }));
  const before = structuredClone(items);
  const turns = transcriptFromCommits(items);
  assert.deepEqual(
    turns.map((item) => item.kind),
    ["turn", "checkpoint", "summary", "config", "note", "turn"],
  );
  const work = turns.at(-1);
  assert.ok(work?.kind === "turn");
  assert.equal(work.id, "commit-8");
  assert.deepEqual(
    work.parts.map((part) => part.kind),
    ["assistant", "tool"],
  );
  const expected = [
    { path: "first.txt", added: 2, removed: 1, lastCommit: "commit-2" },
    { path: "second.txt", added: 2, removed: 0, lastCommit: "commit-10" },
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
