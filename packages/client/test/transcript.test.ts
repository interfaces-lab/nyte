/**
 * The transcript as a client receives it: typed provenance from the commit,
 * never a classification of tool names or error text.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { Commit, CommitBody, Failure, Oid, ToolClass } from "@nyte-ai/protocol";
import type { AssistantMessage, ToolResultMessage } from "@nyte-ai/schema";
import { changesFromTurns, transcriptFromCommits, type Turn } from "../src/index.ts";

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
): CommitBody {
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
): CommitBody {
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

/** A branch, oldest first, with each commit's stamp given beside its body. */
function branch(
  entries: readonly ({ readonly body: CommitBody } & Pick<Commit, "calls" | "failure">)[],
): Item[] {
  let parent: Oid | null = null;
  return entries.map((entry, index) => {
    const oid = `c${String(index)}`;
    const item = { oid, commit: { kind: "commit", parent, at: index, ...entry } } as const;
    parent = oid;
    return item;
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

test("a tool part carries the class its assistant commit stamped, and the result commit's replaces it", () => {
  const items = branch([
    {
      body: assistant([
        { id: "c1", name: "edit" },
        { id: "c2", name: "mystery" },
      ]),
      calls: { c1: { kind: "file_edit", path: "a.ts" } },
    },
    { body: result("c1"), calls: { c1: patched } },
    { body: result("c2") },
  ]);
  const pending = conversation(transcriptFromCommits(items.slice(0, 1))[0]).parts;
  assert.deepEqual(pending, [
    { kind: "tool", callId: "c1", class: { kind: "file_edit", path: "a.ts" } },
    { kind: "tool", callId: "c2", class: { kind: "custom", label: "mystery" } },
  ]);
  const settled = conversation(transcriptFromCommits(items)[0]).parts;
  assert.deepEqual(settled, [
    {
      kind: "tool",
      callId: "c1",
      class: patched,
      result: { commit: "c1", output: "ok", isError: false },
    },
    {
      kind: "tool",
      callId: "c2",
      class: { kind: "custom", label: "mystery" },
      result: { commit: "c2", output: "ok", isError: false },
    },
  ]);
});

test("a commit's failure is the turn's failure", () => {
  const failure: Failure = { class: "rate_limit", message: "slow down", retryAfterMs: 500 };
  const turns = transcriptFromCommits(branch([{ body: assistant([], "error"), failure }]));
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
    },
    { body: result("c1"), calls: { c1: patched } },
    { body: result("c2", { isError: true }), calls: { c2: { ...patched, path: "b.ts" } } },
  ]);
  assert.deepEqual(changesFromTurns(transcriptFromCommits(items)), [
    { path: "a.ts", added: 3, removed: 1, lastCommit: "c1" },
  ]);
});
