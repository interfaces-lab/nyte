import assert from "node:assert/strict";
import { test } from "vitest";
import {
  commitUsage,
  emptyUsageSummary,
  mergeUsageSummaries,
  projectUsage,
  usageTokens,
} from "@nyte-ai/client";
import type { CommitBody } from "../../src/kernel/model.ts";
import { assistant, commit, message, toolResult, usage, user } from "./helpers.ts";

test("usage classification distinguishes absent usage from reported zero", () => {
  const zero = emptyUsageSummary().total;
  const absent: CommitBody[] = [
    message(user("hello")),
    message(toolResult("call", "read", "done")),
    { kind: "checkpoint", summary: "s", retainedTail: [], tokensBefore: 10 },
    { kind: "summary", text: "s" },
    { kind: "config", model: { id: "m" } },
    { kind: "note", type: "test", data: null },
  ];
  for (const body of absent) assert.equal(commitUsage(commit(null, body)), undefined);
  const recorded = [
    {
      body: message(assistant("", { usage: zero })),
      subject: { kind: "model", provider: "openai", model: "test-model" },
    },
    {
      body: message({ ...toolResult("call", "read", "done"), usage: zero }),
      subject: { kind: "tool" },
    },
    {
      body: { kind: "checkpoint", summary: "s", retainedTail: [], tokensBefore: 10, usage: zero },
      subject: { kind: "compaction" },
    },
    { body: { kind: "summary", text: "s", usage: zero }, subject: { kind: "compaction" } },
  ] satisfies { body: CommitBody; subject: unknown }[];
  for (const { body, subject } of recorded) {
    assert.deepEqual(commitUsage(commit(null, body)), { subject, usage: zero });
  }
  const summary = projectUsage(recorded.map(({ body }) => commit(null, body)));
  assert.equal(summary.models[0]?.turns, 1);
  assert.deepEqual(summary.total, zero);
});

test("model identity includes the provider and cannot collide on delimiters", () => {
  const identities = [
    ["a", "b/c"],
    ["a/b", "c"],
    ["other", "c"],
  ] as const;
  const summaries = identities.map(([provider, model]) =>
    projectUsage([commit(null, message({ ...assistant("reply"), provider, model }))]),
  );
  const merged = summaries.reduce(mergeUsageSummaries, emptyUsageSummary());
  const doubled = mergeUsageSummaries(merged, merged);
  assert.deepEqual(
    doubled.models.map((row) => [row.provider, row.model, row.turns, row.usage.totalTokens]),
    [
      ["a", "b/c", 2, 30],
      ["a/b", "c", 2, 30],
      ["other", "c", 2, 30],
    ],
  );
  const commits = identities.map(([provider, model]) =>
    commit(null, message({ ...assistant("reply"), provider, model })),
  );
  assert.deepEqual(projectUsage(commits), merged);
});

test("token fallback is per commit and does not double count reasoning or cache-write subcounts", () => {
  const fallback = {
    ...usage,
    cacheRead: 3,
    cacheWrite: 7,
    cacheWrite1h: 4,
    reasoning: 2,
    totalTokens: 0,
  };
  assert.equal(usageTokens(fallback), 25);
  assert.equal(usageTokens({ ...fallback, totalTokens: 20 }), 20);
  const summary = projectUsage([
    commit(null, message(assistant("partial", { stop: "error", usage: fallback }))),
    commit(null, message(assistant("partial", { stop: "aborted", usage }))),
    commit(null, message({ ...toolResult("call", "read", "done"), usage: fallback })),
    commit(null, { kind: "summary", text: "s", usage: fallback }),
  ]);
  assert.equal(summary.models[0]?.usage.totalTokens, 40);
  assert.equal(summary.tools.totalTokens, 25);
  assert.equal(summary.compaction.totalTokens, 25);
  assert.equal(summary.total.totalTokens, 90);
  assert.equal(mergeUsageSummaries(summary, summary).total.totalTokens, 180);
});
