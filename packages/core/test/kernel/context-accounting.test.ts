import assert from "node:assert/strict";
import { test } from "vitest";
import { prepareCheckpoint } from "../../src/kernel/compaction.ts";
import { contextCommits } from "../../src/kernel/graph.ts";
import { headRef } from "../../src/kernel/names.ts";
import { estimateContextTokens, projectContextStatus } from "../../src/kernel/views/context.ts";
import { assistant, message, openSession, seedHead, usage, user } from "./helpers.ts";

const target = { provider: "openai", api: "openai-responses", model: "test-model" } as const;

test("portable checkpoints invalidate retained usage until a response sees the replacement prefix", async () => {
  const session = await openSession();
  await seedHead(session, "main", [
    message(user("old request", 100)),
    message(assistant("old answer", { at: 150 })),
    {
      kind: "checkpoint",
      summary: "gist",
      retainedTail: [
        assistant("kept", { at: 200, usage: { ...usage, input: 9_495, totalTokens: 9_500 } }),
      ],
      tokensBefore: 9_500,
    },
    message(user("tail", 2_000)),
  ]);
  const entries = await contextCommits(session.objects, await session.refs.read(headRef("main")));
  const commits = entries.map((entry) => entry.commit);
  for (const selected of [undefined, target]) {
    const status = projectContextStatus(commits, 10_000, selected);
    assert.equal(status.usageTokens, 0);
    assert.equal(status.estimatedTokens, status.trailingTokens);
    assert.equal(status.percent, 0);
  }
  const prepared = prepareCheckpoint(entries, {
    enabled: true,
    reserveTokens: 100,
    keepRecentTokens: 1,
  });
  assert.ok(prepared.ok && prepared.value);
  assert.equal(prepared.value.tokensBefore, projectContextStatus(commits, 10_000).estimatedTokens);

  await seedHead(session, "main", [
    message(
      assistant("new reply", { at: 3_000, usage: { ...usage, input: 195, totalTokens: 200 } }),
    ),
    message(user("tail", 4_000)),
  ]);
  const resumed = (
    await contextCommits(session.objects, await session.refs.read(headRef("main")))
  ).map((entry) => entry.commit);
  assert.equal(projectContextStatus(resumed, 10_000, target).estimatedTokens, 201);
  assert.equal(projectContextStatus(resumed, 10_000, target).usageTokens, 200);
});

test("usage applicability checks the whole prefix, not only the adjacent message", () => {
  const messages = [
    user("inserted", 500),
    user("older", 100),
    assistant("stale", { at: 200, usage: { ...usage, totalTokens: 9_500 } }),
  ];
  assert.equal(estimateContextTokens(messages).usageTokens, 0);
  assert.equal(
    estimateContextTokens([...messages, assistant("fresh", { at: 500 })]).usageTokens,
    usage.totalTokens,
  );
});
