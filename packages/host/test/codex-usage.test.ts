import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test, vi } from "vitest";
import type { Models } from "@nyte-ai/ai";
import { readCodexUsage } from "@nyte-ai/host/usage";

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
  const result = await readCodexUsage({ models, homeDir });
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
  // 100 input, of which 60 was cached and 10 freshly written, leaves 30 uncached.
  assert.equal(total.input, 30);
  assert.equal(total.cacheRead, 60);
  assert.equal(total.cacheWrite, 10);
  assert.equal(total.output, 20);
  // Reasoning is reported inside output and is never added on top of it.
  assert.equal(total.reasoning, 5);
  assert.equal(total.totalTokens, 120);
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
  // A fork opens with the parent's history copied in under the same ids.
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
  // Three distinct responses, not five.
  assert.equal(summary.total.totalTokens, 360);
});

test("the legacy event drops re-emitted duplicates and the fork's copied prologue", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "archived_sessions/2026/01/01/legacy.jsonl", [
    {
      type: "session_meta",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: { forked_from_id: "parent" },
    },
    turnContext,
    // Copied prologue: written in one burst right after the fork instant.
    tokenCount("2026-01-01T00:00:00.100Z"),
    tokenCount("2026-01-01T00:00:00.400Z", { output_tokens: 21, total_tokens: 121 }),
    // The child's own first turn lands a real turn later, and ends suppression.
    tokenCount("2026-01-01T00:00:30.000Z", { output_tokens: 22, total_tokens: 122 }),
    // Codex re-emits an unchanged token_count on some stream boundaries.
    tokenCount("2026-01-01T00:00:31.000Z", { output_tokens: 22, total_tokens: 122 }),
    tokenCount("2026-01-01T00:00:40.000Z", { output_tokens: 23, total_tokens: 123 }),
  ]);

  const { summary } = await read(homeDir);
  // Only the two genuine turns survive: 30 + 60 + 10 + 22 and + 23.
  assert.equal(summary.total.totalTokens, 122 + 123);
});

test("a file carrying both formats is counted from the modern record alone", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/both.jsonl", [
    turnContext,
    usageRecord("resp-1"),
    // The legacy event is still written beside it and must not double the turn.
    tokenCount("2026-01-01T00:00:01.000Z"),
  ]);

  const { summary } = await read(homeDir);
  assert.equal(summary.total.totalTokens, 120);
});

test("usage before any turn context has no model to attribute and is skipped", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/early.jsonl", [
    usageRecord("resp-0"),
    turnContext,
    usageRecord("resp-1"),
  ]);

  const { summary } = await read(homeDir);
  assert.equal(summary.total.totalTokens, 120);
});

test("an unknown model keeps its tokens and reports itself as unpriced", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/unknown.jsonl", [
    { type: "turn_context", payload: { model: "gpt-not-in-catalog" } },
    usageRecord("resp-1"),
  ]);

  const result = await read(homeDir);
  assert.equal(result.unpricedRecords, 1);
  assert.equal(result.summary.total.totalTokens, 120);
  assert.equal(result.summary.total.cost.total, 0);
});

test("a priced model is costed from the catalog", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/priced.jsonl", [turnContext, usageRecord("resp-1")]);

  const result = await read(homeDir);
  assert.equal(result.unpricedRecords, 0);
  // 30 uncached at $2/M, 20 output at $10/M, 60 cache reads at $0.2/M.
  assert.ok(result.summary.total.cost.total > 0);
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
  assert.equal(result.summary.total.totalTokens, 120);
});

test("no Codex home is missing history, not a failed read or zero spend", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "nyte-codex-empty-"));
  directories.push(homeDir);
  assert.deepEqual(await readCodexUsage({ models, homeDir }), { kind: "missing" });
});

test("CODEX_HOME names the history when no directory is given", async () => {
  const homeDir = await fixture();
  await rollout(homeDir, "sessions/2026/01/01/env.jsonl", [turnContext, usageRecord("resp-1")]);
  vi.stubEnv("CODEX_HOME", homeDir);

  const result = await readCodexUsage({ models });
  assert.equal(result.kind, "ready");
  assert.equal(result.kind === "ready" && result.summary.total.totalTokens, 120);
});
