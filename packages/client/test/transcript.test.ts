/**
 * The transcript as a client receives it: typed provenance from the commit,
 * never a classification of tool names or error text.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { Commit, CommitOutcome, Failure, Oid, ToolClass } from "@nyte-ai/protocol";
import type { AssistantMessage, ToolResultMessage } from "@nyte-ai/schema";
import {
  appendTranscriptCommit,
  changesFromTurns,
  EMPTY_TRANSCRIPT,
  transcriptFromCommits,
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
    { kind: "tool", callId: "c1", class: { kind: "file_edit", path: "a.ts" }, at: 0 },
    { kind: "tool", callId: "c2", class: { kind: "custom", label: "mystery" }, at: 0 },
  ]);
  const settled = conversation(transcriptFromCommits(items)[0]).parts;
  assert.deepEqual(settled, [
    {
      kind: "tool",
      callId: "c1",
      class: patched,
      result: { commit: "c1", output: "ok", isError: false },
      at: 1,
    },
    {
      kind: "tool",
      callId: "c2",
      class: { kind: "custom", label: "mystery" },
      result: { commit: "c2", output: "ok", isError: false },
      at: 2,
    },
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
