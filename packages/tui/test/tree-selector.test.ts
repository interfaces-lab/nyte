import assert from "node:assert/strict";
import { test } from "vitest";
import { projectTree } from "@nyte-ai/core";
import type { Oid, SessionTreeNode } from "@nyte-ai/core";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@nyte-ai/schema";
import { layoutTree, nearestRowIndex } from "../src/tree-selector.ts";

function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 1 };
}

function assistant(
  text: string,
  calls: readonly { id: string; args: object }[] = [],
): AssistantMessage {
  return {
    role: "assistant",
    content: [
      ...(text === "" ? [] : [{ type: "text" as const, text }]),
      ...calls.map((call) => ({
        type: "toolCall" as const,
        id: call.id,
        name: "read",
        arguments: call.args,
      })),
    ],
    api: "openai-responses",
    provider: "openai",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: calls.length > 0 ? "toolUse" : "stop",
    timestamp: 1,
  };
}

function result(callId: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: "read",
    content: [{ type: "text", text: "…" }],
    details: {},
    isError: false,
    timestamp: 1,
  };
}

interface StoredCommit {
  readonly oid: Oid;
  readonly commit: SessionTreeNode["commit"];
}

let counter = 0;
function stored(parent: Oid | null, message: Message, at = ++counter): StoredCommit {
  return {
    oid: `c${String(at)}`,
    commit: { kind: "commit", parent, body: { kind: "message", message }, at },
  };
}

/**
 * main: u1 → a1 (calls read) → r1 → a2 → u2 → a3        (tip: a3)
 * fork off a2:                       ↳ u3 → a4
 */
function fixture() {
  const u1 = stored(null, user("first"));
  const a1 = stored(u1.oid, assistant("", [{ id: "call-1", args: { path: "src/a.ts" } }]));
  const r1 = stored(a1.oid, result("call-1"));
  const a2 = stored(r1.oid, assistant("looked"));
  const u2 = stored(a2.oid, user("second"));
  const a3 = stored(u2.oid, assistant("done"));
  const u3 = stored(a2.oid, user("other way"));
  const a4 = stored(u3.oid, assistant("also done"));
  const commits = [u1, a1, r1, a2, u2, a3, u3, a4];
  return {
    commits,
    tree: projectTree(commits, { tip: a3.oid }),
    ids: { u1, a1, r1, a2, u2, a3, u3, a4 },
  };
}

test("the default filter shows tool results named by their call and hides tool-only steps", () => {
  const { tree } = fixture();
  const rows = layoutTree(tree);
  assert.deepEqual(
    rows.map(
      (row) =>
        `${row.prefix}${row.active ? "• " : ""}${row.label}${row.text === "" ? "" : ` ${row.text}`}`,
    ),
    [
      "• user: first",
      "• [read: src/a.ts]",
      "• assistant: looked",
      "├⊟ • user: second",
      "│     • assistant: done",
      "└⊟ user: other way",
      "      assistant: also done",
    ],
  );
  assert.deepEqual(
    layoutTree(tree, { filter: "no-tools" }).map((row) => row.label),
    ["user:", "assistant:", "user:", "assistant:", "user:", "assistant:"],
  );
  assert.deepEqual(
    layoutTree(tree, { filter: "users" }).map((row) => row.text),
    ["first", "second", "done", "other way"],
  );
  assert.equal(layoutTree(tree, { filter: "all" }).length, 8);
});

test("a folded branch keeps its row and drops what is under it; search matches label and text", () => {
  const { tree, ids } = fixture();
  const folded = layoutTree(tree, { folded: new Set([ids.u3.oid]) });
  assert.deepEqual(
    folded.map((row) => row.text),
    ["first", "", "looked", "second", "done", "other way"],
  );
  assert.equal(folded.at(-1)?.folded, true);
  assert.deepEqual(
    layoutTree(tree, { query: "other" }).map((row) => row.text),
    ["other way"],
  );
  assert.deepEqual(
    layoutTree(tree, { query: "read src" }).map((row) => row.label),
    ["[read: src/a.ts]"],
  );
});

test("the cursor lands on the row, else its nearest ancestor with one, else the last row", () => {
  const { tree, ids, commits } = fixture();
  const rows = layoutTree(tree, { filter: "users" });
  const parents = new Map(commits.map((item) => [item.oid, item.commit.parent]));
  assert.equal(rows[nearestRowIndex(rows, parents, ids.u3.oid)]?.text, "other way");
  // The tool result has no row under `users`; its nearest ancestor with one is the first prompt.
  assert.equal(rows[nearestRowIndex(rows, parents, ids.r1.oid)]?.text, "first");
  assert.equal(nearestRowIndex(rows, parents, "missing"), rows.length - 1);
});
