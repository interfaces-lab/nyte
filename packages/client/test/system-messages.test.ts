/**
 * System messages are instructions, not conversation: they lead model context,
 * never open a turn, and a usage commit bills without entering context.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { Commit, Oid } from "@nyte-ai/protocol";
import type {
  AssistantMessage,
  Message,
  ProviderCheckpointMaterial,
  SystemMessage,
  Usage,
} from "@nyte-ai/schema";
import {
  contextMessages,
  estimateContextTokens,
  estimateTokens,
  modelContext,
  projectTree,
  projectUsage,
  transcriptFromCommits,
} from "../src/index.ts";

const zeroUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const target = { provider: "anthropic", api: "anthropic-messages", model: "claude" } as const;

const readTool = {
  name: "read",
  description: "Read a file",
  parameters: { type: "object", properties: {} },
};

const editTool = {
  name: "edit",
  description: "Edit a file",
  parameters: { type: "object", properties: {} },
};

const initial: SystemMessage = {
  role: "system",
  content: "You are Nyte.",
  toolsAdded: [readTool],
  timestamp: 0,
};

const editAdded: SystemMessage = {
  role: "system",
  content: "",
  toolsAdded: [editTool],
  timestamp: 3,
};

const snapshot: SystemMessage = {
  role: "system",
  content: "You are Nyte.",
  toolsAdded: [readTool, editTool],
  timestamp: 10,
};

const material: ProviderCheckpointMaterial = {
  type: "provider",
  ...target,
  data: { compacted: true },
};

function assistant(
  text: string,
  timestamp: number,
  calls: readonly { readonly id: string; readonly name: string }[] = [],
): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      ...calls.map((call) => ({ type: "toolCall" as const, ...call, arguments: {} })),
    ],
    api: target.api,
    provider: target.provider,
    model: target.model,
    usage: zeroUsage,
    stopReason: calls.length === 0 ? "stop" : "toolUse",
    timestamp,
  };
}

function user(text: string, timestamp: number): Message {
  return { role: "user", content: text, timestamp };
}

function toolResult(toolCallId: string, timestamp: number): Message {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "read",
    content: [{ type: "text", text: "ok" }],
    isError: false,
    timestamp,
  };
}

const readCall = { kind: "file_read", path: "a.ts" } as const;

function commitOf(message: Message, at: number): Commit {
  const base = { kind: "commit", parent: null, at } as const;

  switch (message.role) {
    case "user":
      return { ...base, body: { kind: "message", message }, start: { kind: "none" } };
    case "system":
      return { ...base, body: { kind: "message", message } };
    case "assistant":
      return {
        ...base,
        body: { kind: "message", message },
        calls: Object.fromEntries(
          message.content.flatMap((part) =>
            part.type === "toolCall" ? [[part.id, readCall]] : [],
          ),
        ),
        outcome: { kind: "ok" },
      };
    case "toolResult":
      return {
        ...base,
        body: { kind: "message", message },
        call: readCall,
        tree: null,
      };
    default: {
      const _exhaustive: never = message;

      return _exhaustive;
    }
  }
}

/** Oldest first, parents chained so the transcript fold accepts the branch. */
function branch(commits: readonly Commit[]): { readonly oid: Oid; readonly commit: Commit }[] {
  let parent: Oid | null = null;

  return commits.map((commit, index) => {
    const oid = `c${String(index)}`;
    const item = { oid, commit: { ...commit, parent } };
    parent = oid;

    return item;
  });
}

const usageCommit: Commit = {
  kind: "commit",
  parent: null,
  at: 5,
  body: {
    kind: "usage",
    operation: "cache_warm",
    provider: target.provider,
    model: target.model,
    usage: {
      ...zeroUsage,
      input: 1200,
      totalTokens: 1200,
      cost: { ...zeroUsage.cost, total: 0.4 },
    },
  },
};

const checkpoint: Commit = {
  kind: "commit",
  parent: null,
  at: 10,
  body: {
    kind: "checkpoint",
    summary: "Earlier work",
    retainedTail: [initial, user("hello", 1), assistant("hi", 2), editAdded, user("more", 4)],
    tokensBefore: 100,
    systemMessage: snapshot,
  },
};

test("a checkpoint's system snapshot leads context and replaces retained system deltas", () => {
  const messages = contextMessages([
    checkpoint,
    commitOf(assistant("after", 11), 11),
    commitOf({ ...editAdded, timestamp: 12 }, 12),
  ]);

  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "user", "assistant", "user", "assistant", "system"],
  );
  assert.equal(messages[0], snapshot);
  const summary = messages[1];
  assert.ok(summary?.role === "user" && Array.isArray(summary.content));
  assert.ok(summary.content[0]?.type === "text");
  assert.match(summary.content[0].text, /Earlier work/);
});

test("native checkpoint material keeps its system snapshot for the exact target only", () => {
  const native: Commit = {
    ...checkpoint,
    body: { ...checkpoint.body, kind: "checkpoint", summary: "", material },
  };

  const next = user("next", 11);
  const after = commitOf(next, 11);
  const exact = modelContext([native, after], target);
  assert.equal(exact.checkpoint, material);
  assert.deepEqual(exact.messages, [snapshot, next]);

  const other = modelContext([native, after], { ...target, model: "other" });
  assert.equal(other.checkpoint, undefined);
  assert.equal(other.messages[0], snapshot);
  assert.deepEqual(
    other.messages.map((message) => message.role),
    ["system", "user", "assistant", "user", "user"],
  );
});

test("a system update between a call and its result does not break the pair", () => {
  const messages = contextMessages([
    commitOf(initial, 0),
    commitOf(user("read it", 1), 1),
    commitOf(assistant("reading", 2, [{ id: "call-1", name: "read" }]), 2),
    commitOf(editAdded, 3),
    commitOf(toolResult("call-1", 4), 4),
  ]);

  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "assistant", "system", "toolResult"],
  );
  const result = messages[4];
  assert.ok(result?.role === "toolResult");
  assert.equal(result.isError, false);
});

test("system and usage commits are neither turns nor model context", () => {
  const items = branch([
    commitOf(initial, 0),
    commitOf(user("hello", 1), 1),
    commitOf(assistant("hi", 2), 2),
    commitOf(editAdded, 3),
    usageCommit,
  ]);

  const turns = transcriptFromCommits(items);
  assert.deepEqual(
    turns.map((turn) => turn.kind),
    ["turn"],
  );
  assert.deepEqual(
    turns.flatMap((turn) => (turn.kind === "turn" ? turn.parts.map((part) => part.kind) : [])),
    ["user", "assistant"],
  );

  assert.deepEqual(
    contextMessages(items.map((item) => item.commit)).map((message) => message.role),
    ["system", "user", "assistant", "system"],
  );

  const usage = projectUsage(items.map((item) => item.commit));
  assert.equal(usage.total.input, 1200);
  assert.equal(usage.total.cost.total, 0.4);
  assert.deepEqual(
    usage.models.map((row) => [row.provider, row.model, row.turns]),
    [[target.provider, target.model, 2]],
  );
});

test("a usage chain under its own ref bills the session without adding tree rows", () => {
  const conversation = branch([commitOf(user("hello", 1), 1), commitOf(assistant("hi", 2), 2)]);
  const tip = conversation[1]?.oid ?? null;
  const warm = { oid: "w0", commit: { ...usageCommit, parent: tip } };
  const warmAgain = { oid: "w1", commit: { ...usageCommit, parent: warm.oid, at: 6 } };
  const all = [...conversation, warm, warmAgain];

  const tree = projectTree(all, { tip, heads: [{ head: "usage/main", tip: warmAgain.oid }] });
  assert.deepEqual(
    tree.roots.map((root) => root.oid),
    ["c0"],
  );
  assert.deepEqual(
    tree.roots[0]?.children.map((child) => child.oid),
    ["c1"],
  );
  assert.deepEqual(tree.roots[0]?.children[0]?.children, []);

  assert.equal(projectUsage(all.map((item) => item.commit)).total.input, 2400);
  assert.equal(transcriptFromCommits(conversation).length, 1);
});

test("estimating without usage counts the replayed system state once", () => {
  const messages: Message[] = [initial, user("hello", 1), editAdded];
  const replayed: SystemMessage = { ...initial, toolsAdded: [readTool, editTool] };

  assert.equal(
    estimateContextTokens(messages).tokens,
    estimateTokens(replayed) + estimateTokens(user("hello", 1)),
  );
  assert.ok(estimateTokens(editAdded) > 0);
});
