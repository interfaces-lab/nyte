/** What a client sees: the projections over commits, asserted by what they draw. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { hashObject } from "../../src/kernel/hash.ts";
import type { Commit, CommitBody, Oid, ToolClass } from "../../src/kernel/model.ts";
import {
  appendTranscriptCommit,
  changesFromTurns,
  collectAbandoned,
  EMPTY_TRANSCRIPT,
  mergeUsageSummaries,
  navigationTarget,
  projectContextStatus,
  projectTree,
  projectUsage,
  sessionDirectoryEntry,
  transcriptFromCommits,
  type Turn,
} from "@nyte-ai/client";
import { assistant, call, commit, message, toolResult, usage, user } from "./helpers.ts";

type Item = { readonly oid: Oid; readonly commit: Commit };
type Stamped = { readonly body: CommitBody } & Pick<Commit, "calls" | "failure">;

/** A branch as the store would hand it back: oldest first, each commit naming its parent. */
function branch(
  bodies: readonly (CommitBody | Stamped)[],
  options: { at?: number; run?: string } = {},
): Item[] {
  const items: Item[] = [];
  let parent: Oid | null = null;
  let at = options.at ?? 1_000;
  for (const entry of bodies) {
    const stamped = "body" in entry ? entry : { body: entry };
    const value = commit(parent, stamped.body, {
      at,
      run: options.run,
      calls: stamped.calls,
      failure: stamped.failure,
    });
    const oid = hashObject(value);
    items.push({ oid, commit: value });
    parent = oid;
    at += 1_000;
  }
  return items;
}

function conversation(turn: Turn | undefined): Extract<Turn, { kind: "turn" }> {
  if (turn?.kind !== "turn") assert.fail(`expected a conversation turn, got ${turn?.kind}`);
  return turn;
}

const partKinds = (turn: Turn | undefined): string[] =>
  conversation(turn).parts.map((part) => part.kind);

const filePatch = (path: string, added: number, removed: number): ToolClass => ({
  kind: "file_patch",
  op: "edit",
  path,
  added,
  removed,
  patch: `--- a/${path}\n+++ b/${path}\n`,
});

test("a turn is the user's message, the assistant's parts, and each tool call paired with its result", () => {
  const items = branch([
    message(user("read a.txt")),
    {
      body: message({
        ...assistant("looking", { calls: [call("c1", "read", { path: "a.txt" })] }),
        content: [
          { type: "thinking", thinking: "let me see" },
          { type: "text", text: "looking" },
          call("c1", "read", { path: "a.txt" }),
        ],
      }),
      calls: { c1: { kind: "file_read", path: "a.txt" } },
    },
    message(toolResult("c1", "read", "hello world", { details: { path: "a.txt" } })),
    message(assistant("it says hello")),
  ]);
  const turns = transcriptFromCommits(items);
  assert.equal(turns.length, 1);
  const turn = conversation(turns[0]);
  assert.equal(turn.id, items[0]?.oid);
  assert.equal(turn.failure, undefined);
  assert.deepEqual(partKinds(turn), ["user", "thinking", "assistant", "tool", "assistant"]);
  const tool = turn.parts[3];
  assert.ok(tool?.kind === "tool");
  assert.deepEqual(tool.class, { kind: "file_read", path: "a.txt" });
  assert.equal(tool.result?.output, "hello world");
  assert.equal(tool.result?.commit, items[2]?.oid);
  assert.equal(turn.startedAt, 1_000);
  assert.equal(turn.durationMs, 3_000);
});

test("a tool part carries the call's stamped class until its result commit replaces it", () => {
  const items = branch([
    message(user("edit")),
    {
      body: message(
        assistant("", { calls: [call("c1", "edit", { path: "a.ts" }), call("c2", "x")] }),
      ),
      calls: { c1: { kind: "file_edit", path: "a.ts" } },
    },
    {
      body: message(toolResult("c1", "edit", "ok")),
      calls: { c1: filePatch("a.ts", 2, 1) },
    },
    message(toolResult("c2", "x", "done")),
  ]);
  const turn = conversation(transcriptFromCommits(items)[0]);
  const [, edited, unknown] = turn.parts;
  assert.ok(edited?.kind === "tool" && unknown?.kind === "tool");
  assert.deepEqual(edited.class, filePatch("a.ts", 2, 1));
  assert.equal(edited.result?.commit, items[2]?.oid);
  assert.deepEqual(unknown.class, { kind: "custom", label: "x" });
  assert.equal(unknown.result?.output, "done");

  const pending = conversation(transcriptFromCommits(items.slice(0, 2))[0]).parts[1];
  assert.ok(pending?.kind === "tool");
  assert.deepEqual(pending.class, { kind: "file_edit", path: "a.ts" });
  assert.equal(pending.result, undefined);
});

test("failures and aborts mark the turn from the commit; empty assistant output draws nothing", () => {
  const failure = { class: "provider", message: "boom" } as const;
  const failed = transcriptFromCommits(
    branch([
      message(user("q")),
      { body: message(assistant("", { stop: "error", error: "boom" })), failure },
    ]),
  );
  assert.deepEqual(conversation(failed[0]).failure, failure);
  assert.deepEqual(partKinds(failed[0]), ["user"]);

  const aborted = transcriptFromCommits(
    branch([
      message(user("q")),
      {
        body: message(assistant("half", { stop: "aborted" })),
        failure: { class: "aborted", message: "stopped" },
      },
    ]),
  );
  assert.equal(conversation(aborted[0]).failure?.class, "aborted");

  const blank = transcriptFromCommits(branch([message(user("q")), message(assistant("   "))]));
  assert.deepEqual(partKinds(blank[0]), ["user"]);
  assert.equal(conversation(blank[0]).failure, undefined);
});

test("a result whose call is not on this branch stands on its own", () => {
  const turns = transcriptFromCommits(
    branch([message(user("q")), message(toolResult("elsewhere", "bash", "out"))]),
  );
  const tool = conversation(turns[0]).parts[1];
  assert.ok(tool?.kind === "tool");
  assert.deepEqual(tool.class, { kind: "custom", label: "bash" });
  assert.equal(tool.result?.output, "out");
});

test("checkpoints, summaries, and config are markers between turns", () => {
  const items = branch([
    message(user("a")),
    { kind: "checkpoint", summary: "so far", retainedTail: [], tokensBefore: 10 },
    { kind: "summary", text: "the other branch" },
    { kind: "config", model: { id: "m2" } },
    message(user("b")),
  ]);
  assert.deepEqual(
    transcriptFromCommits(items).map((turn) => turn.kind),
    ["turn", "checkpoint", "summary", "config", "turn"],
  );
});

test("folding one commit at a time along the branch gives the same transcript, and a fork is refused", () => {
  const items = branch([message(user("a")), message(assistant("b")), message(user("c"))]);
  let state = EMPTY_TRANSCRIPT;
  for (const item of items) {
    const next = appendTranscriptCommit(state, item);
    assert.ok(next !== undefined);
    state = next;
  }
  assert.deepEqual(state.items, transcriptFromCommits(items));
  assert.equal(state.tip, items[2]?.oid);

  const repeated = appendTranscriptCommit(
    state,
    items[2] ?? { oid: "", commit: commit(null, message(user("x"))) },
  );
  assert.equal(repeated, state);

  const fork = { oid: "f", commit: commit(items[0]?.oid ?? null, message(user("elsewhere"))) };
  assert.equal(appendTranscriptCommit(state, fork), undefined);
});

test("file changes fold from stamped patch classes, per file, ignoring failed calls", () => {
  const items = branch([
    message(user("edit")),
    message(assistant("", { calls: [call("c1", "edit"), call("c2", "edit"), call("c3", "edit")] })),
    { body: message(toolResult("c1", "edit", "ok")), calls: { c1: filePatch("a.ts", 2, 1) } },
    { body: message(toolResult("c2", "edit", "ok")), calls: { c2: filePatch("a.ts", 1, 1) } },
    {
      body: message(toolResult("c3", "edit", "failed", { isError: true })),
      calls: { c3: filePatch("b.ts", 5, 0) },
    },
  ]);
  const changes = changesFromTurns(transcriptFromCommits(items));
  assert.deepEqual(changes, [{ path: "a.ts", added: 3, removed: 2, lastCommit: items[3]?.oid }]);
});

test("the tree is a forest with the selected path marked and every head labelled", () => {
  const trunk = branch([message(user("a")), message(assistant("b"))]);
  const forkPoint = trunk[0]?.oid ?? null;
  const left = { oid: "", commit: commit(forkPoint, message(user("left")), { at: 5_000 }) };
  left.oid = hashObject(left.commit);
  const right = { oid: "", commit: commit(forkPoint, message(user("right")), { at: 3_000 }) };
  right.oid = hashObject(right.commit);
  const orphan = { oid: "", commit: commit("0".repeat(64), message(user("lost"))) };
  orphan.oid = hashObject(orphan.commit);

  const tree = projectTree([...trunk, left, right, orphan], {
    tip: left.oid,
    heads: [
      { head: "main", tip: trunk[1]?.oid ?? null },
      { head: "review", tip: left.oid },
    ],
  });
  assert.equal(tree.roots.length, 2);
  const root = tree.roots[0];
  assert.equal(root?.oid, trunk[0]?.oid);
  assert.deepEqual(
    root?.children.map((child) => child.oid),
    [trunk[1]?.oid, right.oid, left.oid],
  );
  assert.deepEqual(
    root?.children.map((child) => [child.active, child.heads]),
    [
      [false, ["main"]],
      [false, []],
      [true, ["review"]],
    ],
  );
  assert.equal(root?.active, true);
  assert.deepEqual([...tree.activePath].sort(), [trunk[0]?.oid, left.oid].sort());
  assert.equal(tree.roots[1]?.oid, orphan.oid);
});

test("selecting a user message hands it back and parks on its parent; anything else is a plain move", () => {
  const items = branch([message(user("a")), message(assistant("b"))]);
  assert.deepEqual(navigationTarget(undefined), { kind: "move", to: null });
  assert.deepEqual(navigationTarget(items[1]), { kind: "move", to: items[1]?.oid });
  assert.deepEqual(navigationTarget(items[0]), { kind: "restore", to: null, commit: items[0] });
});

test("moving away abandons what is below the shared ancestor, measured against the selection", () => {
  const trunk = branch([
    message(user("a")),
    message(assistant("b")),
    message(user("c")),
    message(assistant("d")),
  ]);
  const byOid = new Map(trunk.map((item) => [item.oid, item.commit]));
  const abandoned = collectAbandoned(byOid, {
    from: trunk[3]?.oid ?? null,
    selected: trunk[1]?.oid ?? null,
  });
  assert.deepEqual(
    abandoned.commits.map((item) => item.oid),
    [trunk[2]?.oid, trunk[3]?.oid],
  );
  assert.equal(abandoned.commonAncestor, trunk[1]?.oid);
  assert.deepEqual(collectAbandoned(byOid, { from: null, selected: null }), {
    commits: [],
    commonAncestor: null,
  });
});

test("usage is summed per model, plus tools and summaries, across every commit given", () => {
  const items = branch([
    message(user("q")),
    message(assistant("a", { usage: { ...usage, cost: { ...usage.cost, total: 2 } } })),
    message({ ...assistant("b"), model: "other" }),
    message({ ...toolResult("c1", "bash", "x"), usage }),
    { kind: "checkpoint", summary: "s", retainedTail: [], tokensBefore: 1, usage },
  ]);
  const summary = projectUsage(items.map((item) => item.commit));
  assert.deepEqual(
    summary.models.map((row) => [row.model, row.turns, row.usage.totalTokens]),
    [
      ["test-model", 1, 15],
      ["other", 1, 15],
    ],
  );
  assert.equal(summary.tools.totalTokens, 15);
  assert.equal(summary.compaction.totalTokens, 15);
  assert.equal(summary.total.totalTokens, 60);

  const merged = mergeUsageSummaries(summary, summary);
  assert.equal(merged.total.totalTokens, 120);
  assert.equal(merged.models.find((row) => row.model === "other")?.turns, 2);
});

test("the directory row shows the newest message, the last activity, and each head once in the order given", () => {
  const items = branch([
    message(user("first question")),
    message(assistant("the answer")),
    message(toolResult("c1", "bash", "noise")),
  ]);
  const row = sessionDirectoryEntry({
    id: "s1",
    createdAt: 500,
    name: "Chat",
    heads: ["review", "main", "review"],
    commits: items.map((item) => item.commit),
  });
  assert.deepEqual(row, {
    id: "s1",
    name: "Chat",
    preview: "the answer",
    lastActivity: 3_000,
    heads: ["review", "main"],
  });
  assert.equal(
    sessionDirectoryEntry({ id: "e", createdAt: 7, heads: [], commits: [] }).lastActivity,
    7,
  );
});

test("the context gauge reports what the next request would cost against the window", () => {
  const items = branch([message(user("hello there")), message(assistant("hi", { usage }))]);
  const status = projectContextStatus(
    items.map((item) => item.commit),
    1_000,
  );
  assert.equal(status.contextWindow, 1_000);
  assert.ok(status.estimatedTokens > 0);
  assert.equal(status.lastTurnTokens, 15);
  assert.equal(status.percent, Math.round((status.estimatedTokens / 1_000) * 100));
  assert.equal(projectContextStatus([], 0).percent, undefined);
});
