import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test, vi } from "vitest";
import type { Models } from "@nyte-ai/ai";
import { createUsageScanCaches, readCodexUsage } from "../src/usage.ts";
import type { UsageWindow } from "../src/usage-types.ts";

const model: ReturnType<Models["getModels"]>[number] = {
  id: "gpt-test-1",
  provider: "openai-codex",
  api: "openai-codex-responses",
  name: "Test Codex",
  baseUrl: "https://not-used.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 8192,
};

const models: Pick<Models, "getModels"> = { getModels: () => [model] };

const allTime: UsageWindow = { sinceDay: null, untilDay: "9999-12-31" };

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const homeDir = await mkdtemp(join(tmpdir(), "nyte-codex-usage-"));
  directories.push(homeDir);
  await mkdir(join(homeDir, "sessions"), { recursive: true });

  return homeDir;
}

async function rollout(homeDir: string, path: string, records: readonly unknown[]) {
  const file = join(homeDir, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, records.map((value) => JSON.stringify(value)).join("\n") + "\n");
}

const turnContext = { type: "turn_context", payload: { model: model.id } };

/** `input_tokens` arrives inclusive of the cached and freshly written portions. */
function usage(overrides?: Partial<Record<string, number>>) {
  return {
    input_tokens: 100,
    cached_input_tokens: 60,
    cache_write_input_tokens: 10,
    output_tokens: 20,
    reasoning_output_tokens: 5,
    total_tokens: 120,
    ...overrides,
  };
}

function usageRecord(responseId: string, overrides?: Partial<Record<string, number>>) {
  return {
    type: "token_usage_record",
    timestamp: "2026-01-01T00:00:00.000Z",
    payload: { response_id: responseId, usage: usage(overrides) },
  };
}

function tokenCount(at: string, overrides?: Partial<Record<string, number>>) {
  return {
    type: "event_msg",
    timestamp: at,
    payload: { type: "token_count", info: { last_token_usage: usage(overrides) } },
  };
}

async function read(homeDir: string) {
  const result = await readCodexUsage({ window: allTime, models, homeDir });
  assert.equal(result.kind, "ready");

  return result;
}

test("a response is counted once, with the cached share split out of the input", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/rollout-a.jsonl", [
    turnContext,
    usageRecord("resp-1"),
  ]);

  const { summary } = await read(homeDir);
  const total = summary.total;
  assert.equal(total.input, 30, "100 input less 60 cached and 10 freshly written");
  assert.equal(total.cacheRead, 60);
  assert.equal(total.cacheWrite, 10);
  assert.equal(total.output, 20);
  assert.equal(total.reasoning, 5, "reasoning sits inside output, never added on top");
  assert.equal(total.total, 120);
  assert.equal(summary.models.length, 1);
  assert.equal(summary.models[0]?.model, model.id);
});

test("a forked rollout repeating its parent's responses is counted once", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/parent.jsonl", [
    turnContext,
    usageRecord("resp-1"),
    usageRecord("resp-2"),
  ]);
  await rollout(homeDir, "sessions/2026/01/01/fork.jsonl", [
    {
      type: "session_meta",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: { forked_from_id: "parent" },
    },
    turnContext,
    usageRecord("resp-1"),
    usageRecord("resp-2"),
    usageRecord("resp-3"),
  ]);

  const { summary } = await read(homeDir);
  assert.equal(summary.total.total, 360, "three distinct responses, not five");
});

test("the legacy event drops re-emitted duplicates and the fork's copied prologue", async () => {
  const homeDir = await fixture();

  const copiedPrologue = [
    tokenCount("2026-01-01T00:00:00.100Z"),
    tokenCount("2026-01-01T00:00:00.400Z", { output_tokens: 21, total_tokens: 121 }),
  ];

  const firstOwnTurn = tokenCount("2026-01-01T00:00:30.000Z", {
    output_tokens: 22,
    total_tokens: 122,
  });

  const reEmitted = tokenCount("2026-01-01T00:00:31.000Z", {
    output_tokens: 22,
    total_tokens: 122,
  });

  await rollout(homeDir, "archived_sessions/2026/01/01/legacy.jsonl", [
    {
      type: "session_meta",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: { forked_from_id: "parent" },
    },
    turnContext,
    ...copiedPrologue,
    firstOwnTurn,
    reEmitted,
    tokenCount("2026-01-01T00:00:40.000Z", { output_tokens: 23, total_tokens: 123 }),
  ]);

  const { summary } = await read(homeDir);
  assert.equal(summary.total.total, 122 + 123, "only the two turns after the prologue count");
});

test("a file carrying both formats is counted from the modern record alone", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/both.jsonl", [
    turnContext,
    usageRecord("resp-1"),
    tokenCount("2026-01-01T00:00:01.000Z"),
  ]);

  const { summary } = await read(homeDir);
  assert.equal(summary.total.total, 120);
});

test("usage before any turn context has no model to attribute and is skipped", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/early.jsonl", [
    usageRecord("resp-0"),
    turnContext,
    usageRecord("resp-1"),
  ]);

  const { summary } = await read(homeDir);
  assert.equal(summary.total.total, 120);
});

test("an unknown model keeps its tokens and reports itself as unpriced", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/unknown.jsonl", [
    { type: "turn_context", payload: { model: "gpt-not-in-catalog" } },
    usageRecord("resp-1"),
  ]);

  const result = await read(homeDir);
  assert.equal(result.unpricedRecords, 1);
  assert.equal(result.summary.total.total, 120);
  assert.equal(result.summary.total.cost.total, 0);
});

test("a priced model is costed from the catalog", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/priced.jsonl", [turnContext, usageRecord("resp-1")]);

  const result = await read(homeDir);
  assert.equal(result.unpricedRecords, 0);
  assert.ok(
    Math.abs(result.summary.total.cost.total - 0.000272) < 1e-12,
    "30 uncached at $2/M, 20 output at $10/M and 60 cache reads at $0.2/M",
  );
});

test("a malformed line is counted, not fatal", async () => {
  const homeDir = await fixture();
  const file = join(homeDir, "sessions/2026/01/01/torn.jsonl");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    [JSON.stringify(turnContext), "{not json}", JSON.stringify(usageRecord("resp-1"))].join("\n") +
      "\n",
  );

  const result = await read(homeDir);
  assert.equal(result.malformedRecords, 1);
  assert.equal(result.summary.total.total, 120);
});

test("no Codex home is missing history, not a failed read or zero spend", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "nyte-codex-empty-"));
  directories.push(homeDir);
  assert.deepEqual(await readCodexUsage({ window: allTime, models, homeDir }), { kind: "missing" });
});

test("CODEX_HOME names the history when no directory is given", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/env.jsonl", [turnContext, usageRecord("resp-1")]);
  vi.stubEnv("CODEX_HOME", homeDir);

  const result = await readCodexUsage({ window: allTime, models });
  assert.equal(result.kind, "ready");
  assert.equal(result.kind === "ready" && result.summary.total.total, 120);
});

test("a grown rollout resumes against the model its earlier lines named", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/a.jsonl", [turnContext, usageRecord("one")]);
  const cache = createUsageScanCaches().codex;
  await readCodexUsage({ window: allTime, models, homeDir, cache });
  await appendFile(join(homeDir, "sessions/a.jsonl"), `${JSON.stringify(usageRecord("two"))}\n`);
  const result = await readCodexUsage({ window: allTime, models, homeDir, cache });
  assert.equal(result.kind, "ready");

  if (result.kind !== "ready") return;
  assert.equal(result.summary.models[0]?.model, model.id);
  assert.equal(result.summary.models[0]?.turns, 2);
});
