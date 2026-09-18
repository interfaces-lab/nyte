/** Walking commits and turning them into what a model reads. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { Message } from "@nyte-ai/schema";
import { branchConfig, contextMessages, modelContext } from "@nyte-ai/client";
import { branch, contextCommits, history, isAncestor } from "../../src/kernel/graph.ts";
import type { Commit, CommitBody } from "../../src/kernel/model.ts";
import {
  assistant,
  call,
  chain,
  commit,
  message,
  openSession,
  toolResult,
  usage,
  user,
} from "./helpers.ts";

const checkpoint = (summary: string, tail: CommitBody[] = []): CommitBody => ({
  kind: "checkpoint",
  summary,
  retainedTail: tail.flatMap((body) => (body.kind === "message" ? [body.message] : [])),
  tokensBefore: 1_000,
});

function firstText(message: Message): string {
  if (!Array.isArray(message.content)) return "";
  const part = message.content[0];
  return part?.type === "text" ? part.text : "";
}

test("history walks newest first and a branch reads oldest first", async () => {
  const session = await openSession();
  const [a, b, c] = await chain(session, null, [
    message(user("1")),
    message(assistant("2")),
    message(user("3")),
  ]);
  const newest: string[] = [];
  for await (const item of history(session.objects, c ?? null)) newest.push(item.oid);
  assert.deepEqual(newest, [c, b, a]);

  const limited: string[] = [];
  for await (const item of history(session.objects, c ?? null, { limit: 2 })) {
    limited.push(item.oid);
  }
  assert.deepEqual(limited, [c, b]);

  assert.deepEqual(
    (await branch(session.objects, c ?? null)).map((item) => item.oid),
    [a, b, c],
  );
  assert.deepEqual(await branch(session.objects, null), []);
});

test("context starts at the newest checkpoint and includes it", async () => {
  const session = await openSession();
  const [, , cp, d] = await chain(session, null, [
    message(user("old")),
    message(assistant("old answer")),
    checkpoint("what happened"),
    message(user("new")),
  ]);
  assert.deepEqual(
    (await contextCommits(session.objects, d ?? null)).map((item) => item.oid),
    [cp, d],
  );
  const [lone] = await chain(session, null, [message(user("x"))]);
  assert.equal((await contextCommits(session.objects, lone ?? null)).length, 1);
});

test("ancestry follows the context parent only", async () => {
  const session = await openSession();
  const [a, b] = await chain(session, null, [message(user("a")), message(user("b"))]);
  const [other] = await chain(session, null, [message(user("other"))]);
  const objects = session.objects;
  assert.equal(await isAncestor(objects, { ancestor: a ?? null, descendant: b ?? null }), true);
  assert.equal(await isAncestor(objects, { ancestor: b ?? null, descendant: a ?? null }), false);
  assert.equal(await isAncestor(objects, { ancestor: b ?? null, descendant: b ?? null }), true);
  assert.equal(
    await isAncestor(objects, { ancestor: other ?? null, descendant: b ?? null }),
    false,
  );
  assert.equal(await isAncestor(objects, { ancestor: null, descendant: b ?? null }), true);
});

test("model context keeps what a provider accepts and drops what it rejects", () => {
  const failed = assistant("", { stop: "error", error: "boom" });
  const aborted = assistant("partial", { stop: "aborted" });
  const asked = assistant("", { calls: [call("c1", "read", { path: "a" }), call("c2", "read")] });
  const commits: Commit[] = [
    commit(null, message(user("hi"))),
    commit(null, message(failed)),
    commit(null, message(aborted)),
    commit(null, { kind: "config", model: { id: "m" } }),
    commit(null, { kind: "note", type: "ui", data: 1 }),
    commit(null, message(asked)),
    commit(null, message(toolResult("c1", "read", "contents"))),
    commit(null, message(toolResult("zzz", "read", "orphan"))),
    commit(null, message(user("next"))),
  ];
  const messages = contextMessages(commits);
  assert.deepEqual(
    messages.map((item) =>
      item.role === "toolResult" ? `${item.role}:${item.toolCallId}` : item.role,
    ),
    ["user", "assistant", "toolResult:c1", "toolResult:c2", "user"],
  );
  const synthetic = messages[3];
  assert.ok(synthetic?.role === "toolResult" && synthetic.isError);
  assert.match(firstText(synthetic), /interrupted/u);
});

test("a checkpoint replaces history with its summary and tail; a summary joins as one message", () => {
  const tail = message(assistant("kept"));
  const commits: Commit[] = [
    commit(null, checkpoint("the gist", [tail])),
    commit(null, { kind: "summary", text: "left branch was about x" }),
    commit(null, { kind: "summary", text: "" }),
    commit(null, message(user("now"))),
  ];
  const messages = contextMessages(commits);
  assert.deepEqual(
    messages.map((item) => item.role),
    ["user", "assistant", "user", "user"],
  );
  assert.match(firstText(messages[0] ?? user("")), /the gist/u);
  assert.match(firstText(messages[2] ?? user("")), /left branch was about x/u);
});

test("native checkpoint material is used only for the exact model that produced it", () => {
  const material = {
    type: "provider" as const,
    provider: "openai" as const,
    api: "openai-responses" as const,
    model: "m1",
    data: {},
  };
  const commits: Commit[] = [
    commit(null, { kind: "checkpoint", summary: "s", retainedTail: [], tokensBefore: 1, material }),
    commit(null, message(user("q"))),
  ];
  const exact = modelContext(commits, { provider: "openai", api: "openai-responses", model: "m1" });
  assert.deepEqual(exact.checkpoint, material);
  assert.deepEqual(
    exact.messages.map((item) => item.role),
    ["user"],
  );

  const other = modelContext(commits, { provider: "openai", api: "openai-responses", model: "m2" });
  assert.equal(other.checkpoint, undefined);
  assert.deepEqual(
    other.messages.map((item) => item.role),
    ["user", "user"],
  );
});

test("the branch's declared config is the latest value of each field, checkpoints included", () => {
  const commits: Commit[] = [
    commit(null, { kind: "config", model: { provider: "p", id: "m1" }, thinkingLevel: "low" }),
    commit(null, checkpoint("s")),
    commit(null, { kind: "config", agent: "reviewer" }),
    commit(null, { kind: "config", model: { id: "m2" } }),
  ];
  assert.deepEqual(branchConfig(commits), {
    model: { id: "m2" },
    thinkingLevel: "low",
    agent: "reviewer",
  });
  assert.deepEqual(branchConfig([commit(null, message(assistant("x", { usage })))]), {});
});
