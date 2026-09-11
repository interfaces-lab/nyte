import assert from "node:assert/strict";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { afterEach, test, vi } from "vitest";
import type { Models } from "@nyte-ai/ai";
import { emptyUsageSummary } from "@nyte-ai/core/views";
import {
  createUsageScanCaches,
  decodeUsageScanCaches,
  encodeUsageScanCaches,
  readClaudeCodeUsage,
} from "@nyte-ai/host/usage";

const model: ReturnType<Models["getModels"]>[number] = {
  id: "claude-test-20260101",
  provider: "anthropic",
  api: "anthropic-messages",
  name: "Test Claude",
  baseUrl: "https://not-used.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
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
  const configDir = await mkdtemp(join(tmpdir(), "nyte-claude-usage-"));
  directories.push(configDir);
  await mkdir(join(configDir, "projects"));
  return configDir;
}

function record(requestId = "request", output = 20) {
  return {
    type: "assistant",
    requestId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      id: "message",
      model: model.id,
      content: [{ type: "text", text: "hello" }],
      usage: {
        input_tokens: 100,
        output_tokens: output,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 40,
        cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 10 },
      },
    },
  };
}

async function history(configDir: string, path: string, records: readonly unknown[]) {
  const file = join(configDir, "projects", path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, records.map((value) => JSON.stringify(value)).join("\n") + "\n");
  return file;
}

test("reads all projects and nested agents, preserving TTL subsets and current catalog costs", async () => {
  const configDir = await fixture();
  await history(configDir, "project-a/session.jsonl", [record()]);
  await history(configDir, "project-b/session/subagents/agent.jsonl", [record("other")]);
  await writeFile(join(configDir, "projects", "ignored.js"), "throw new Error('must not execute')");
  await writeFile(join(configDir, ".credentials.json"), "not json and must not be read");
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.unpricedRecords, 0);
  assert.equal(result.malformedRecords, 0);
  assert.equal(result.unreadableFiles, 0);
  assert.deepEqual(result.summary.compaction, emptyUsageSummary().compaction);
  assert.deepEqual(result.summary.tools, emptyUsageSummary().tools);
  assert.equal(result.summary.models.length, 1);
  assert.equal(result.summary.models[0]?.provider, "anthropic");
  assert.equal(result.summary.models[0]?.model, model.id);
  assert.equal(result.summary.models[0]?.turns, 2);
  assert.equal(result.summary.total.input, 200);
  assert.equal(result.summary.total.output, 40);
  assert.equal(result.summary.total.cacheRead, 100);
  assert.equal(result.summary.total.cacheWrite, 80);
  assert.equal(result.summary.total.cacheWrite1h, 20);
  assert.equal(result.summary.total.totalTokens, 420);
  assert.ok(Math.abs(result.summary.total.cost.cacheWrite - 0.000345) < 1e-12);
  assert.ok(Math.abs(result.summary.total.cost.total - 0.001575) < 1e-12);
});

test.each([false, true])(
  "deduplicates copies and blocks without losing final output, reverse=%s",
  async (reverse) => {
    const configDir = await fixture();
    const first = record("same", 1);
    const final = record("same", 40);
    // Invalid timestamps cannot affect selection; token evidence determines the winner.
    first.timestamp = "not a date";
    const blocks = [first, final, { ...final, message: { ...final.message, content: [] } }];
    const file = await history(
      configDir,
      "a/session.jsonl",
      reverse ? blocks.toReversed() : blocks,
    );
    await mkdir(join(configDir, "projects", "copy"));
    await copyFile(file, join(configDir, "projects", "copy", "session.jsonl"));
    await history(configDir, "b/session.jsonl", [record("different", 40)]);
    const result = await readClaudeCodeUsage({ models, configDir });
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    assert.equal(result.summary.models[0]?.turns, 2);
    assert.equal(result.summary.total.output, 80);
    assert.equal(result.summary.total.input, 200);
  },
);

test.each([
  { laterOutput: 300, input: 500, output: 20 },
  { laterOutput: 600, input: 100, output: 600 },
])("keeps the whole largest snapshot, later output=$laterOutput", async (expected) => {
  const configDir = await fixture();
  const early = record();
  early.message.usage.input_tokens = 500;
  const later = record("request", expected.laterOutput);
  later.timestamp = "2026-01-01T00:00:01.000Z";
  await history(configDir, "a.jsonl", [early, later]);
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.summary.total.input, expected.input);
  assert.equal(result.summary.total.output, expected.output);
  assert.equal(result.summary.models[0]?.turns, 1);
});

test.each(["message", "request"])("deduplicates copied %s-only identities", async (identity) => {
  const configDir = await fixture();
  const blocks = [record("same", 1), record("same", 40), record("same", 40)].map(
    (value, index) => ({
      ...value,
      requestId: identity === "message" ? [undefined, "", " \t"][index] : value.requestId,
      message: {
        ...value.message,
        id: identity === "request" ? [undefined, "", " \t"][index] : value.message.id,
      },
    }),
  );
  const file = await history(configDir, "a.jsonl", blocks);
  await copyFile(file, join(configDir, "projects", "copy.jsonl"));
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.summary.models[0]?.turns, 1);
  assert.equal(result.summary.total.input, 100);
  assert.equal(result.summary.total.output, 40);
});

test("namespaces partial identities and preserves complete tuples", async () => {
  const configDir = await fixture();
  const full = record("same");
  await history(configDir, "a.jsonl", [
    { ...full, requestId: undefined, message: { ...full.message, id: "same" } },
    { ...full, message: { ...full.message, id: undefined } },
    { ...full, message: { ...full.message, id: "same" } },
    { ...full, message: { ...full.message, id: "different" } },
    { ...full, requestId: "different", message: { ...full.message, id: "same" } },
    { ...full, requestId: "c", message: { ...full.message, id: "a:b" } },
    { ...full, requestId: "b:c", message: { ...full.message, id: "a" } },
  ]);
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.summary.models[0]?.turns, 7);
  assert.equal(result.summary.total.totalTokens, 1470);
});

test("records without either nonblank identity remain independent", async () => {
  const configDir = await fixture();
  const full = record();
  const records = [undefined, "", " \t"].map((id) => ({
    ...full,
    requestId: id,
    message: { ...full.message, id },
  }));
  const file = await history(configDir, "a.jsonl", records);
  await copyFile(file, join(configDir, "projects", "copy.jsonl"));
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.summary.models[0]?.turns, 6);
});

test("reported nonnegative costs, including zero, override estimates without inventing breakdowns", async () => {
  const configDir = await fixture();
  const unknown = record("unknown");
  unknown.message.model = "unknown";
  await history(configDir, "a.jsonl", [
    record("paid"),
    { ...record("paid"), costUSD: 2 },
    { ...record("free"), costUSD: 0 },
    { ...unknown, costUSD: 3 },
  ]);
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.summary.total.cost.total, 5);
  assert.equal(result.summary.total.cost.input, 0);
  assert.equal(result.summary.models[0]?.model, "unknown");
  assert.equal(result.unpricedRecords, 0);
});

test.each([-1, "2", null])(
  "invalid reported cost %s falls back to catalog pricing",
  async (costUSD) => {
    const configDir = await fixture();
    await history(configDir, "a.jsonl", [{ ...record(), costUSD }]);
    const result = await readClaudeCodeUsage({ models, configDir });
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    assert.ok(Math.abs(result.summary.total.cost.total - 0.0007875) < 1e-12);
    assert.equal(result.unpricedRecords, 0);
  },
);

test("unknown, fuzzy, wrong-provider and ambiguous matches retain unpriced tokens", async () => {
  const configDir = await fixture();
  const entries = ["unknown", "claude-test", "wrong-provider", model.id].map((id) => {
    const value = record(id);
    value.message.model = id;
    return value;
  });
  await history(configDir, "a.jsonl", [...entries, entries[0]]);
  const result = await readClaudeCodeUsage({
    configDir,
    models: {
      getModels: () => [
        model,
        { ...model, cost: { ...model.cost, input: 8 } },
        { ...model, id: "wrong-provider", provider: "other" },
      ],
    },
  });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.unpricedRecords, 4);
  assert.equal(result.summary.total.totalTokens, 840);
  assert.equal(result.summary.total.cost.total, 0);
  assert.equal(result.summary.models.length, 4);
});

test("an empty catalog retains all tokens and model rows without inventing prices", async () => {
  const configDir = await fixture();
  const unknown = record("unknown");
  unknown.message.model = "unknown";
  await history(configDir, "a.jsonl", [record(), record(), unknown]);
  const result = await readClaudeCodeUsage({ models: { getModels: () => [] }, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.unpricedRecords, 2);
  assert.equal(result.summary.models.length, 2);
  assert.equal(result.summary.total.totalTokens, 420);
  assert.equal(result.summary.total.cost.total, 0);
});

test("aggregates many turns into model rows and computes totals from those rows", async () => {
  const configDir = await fixture();
  await history(
    configDir,
    "a.jsonl",
    Array.from({ length: 4000 }, (_, index) => {
      const value = record(String(index));
      if (index % 2 === 0) value.message.model = "unknown";
      return value;
    }),
  );
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.deepEqual(
    result.summary.models.map((row) => [row.model, row.turns]),
    [
      [model.id, 2000],
      ["unknown", 2000],
    ],
  );
  assert.equal(result.unpricedRecords, 2000);
  assert.equal(result.summary.total.totalTokens, 840_000);
  assert.ok(Math.abs(result.summary.total.cost.total - 1.575) < 1e-12);
});

test("zero catalog rates are known prices and catalog tiers use the complete input count", async () => {
  const configDir = await fixture();
  await history(configDir, "a.jsonl", [record()]);
  const free = await readClaudeCodeUsage({
    configDir,
    models: {
      getModels: () => [{ ...model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    },
  });
  assert.equal(free.kind, "ready");
  if (free.kind !== "ready") return;
  assert.equal(free.unpricedRecords, 0);
  assert.equal(free.summary.total.cost.total, 0);
  const tiered = await readClaudeCodeUsage({
    configDir,
    models: {
      getModels: () => [
        {
          ...model,
          cost: {
            ...model.cost,
            tiers: [
              { inputTokensAbove: 150, input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 },
            ],
          },
        },
      ],
    },
  });
  assert.equal(tiered.kind, "ready");
  if (tiered.kind !== "ready") return;
  assert.ok(Math.abs(tiered.summary.total.cost.total - 0.001575) < 1e-12);
});

test("validates numeric usage once and continues after malformed records", async () => {
  const configDir = await fixture();
  const valid = record();
  const invalid = [-1, 0.5, "3", null, 1e100].map((input_tokens) => ({
    ...valid,
    message: { ...valid.message, usage: { ...valid.message.usage, input_tokens } },
  }));
  const file = await history(configDir, "a.jsonl", [
    { type: "user", message: { content: "ignored" } },
    { type: "progress" },
    ...invalid,
    {
      ...valid,
      message: {
        ...valid.message,
        usage: { ...valid.message.usage, cache_creation_input_tokens: 1 },
      },
    },
    { type: "assistant", message: {} },
    valid,
  ]);
  await appendFile(
    file,
    "not json\n" +
      JSON.stringify(valid).replace('"input_tokens":100', '"input_tokens":1e400') +
      "\n",
  );
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.malformedRecords, 9);
  assert.equal(result.summary.models[0]?.turns, 1);
});

test("streams across chunk boundaries, ignores incomplete tails, and rereads without a cache", async () => {
  const configDir = await fixture();
  const large = record();
  large.message.content[0] = { type: "text", text: "🙂".repeat(40_000) };
  const file = await history(configDir, "a.jsonl", [large]);
  const tail = JSON.stringify(record("tail"));
  await appendFile(file, tail.slice(0, -3));
  const partial = await readClaudeCodeUsage({ models, configDir });
  assert.equal(partial.kind, "ready");
  if (partial.kind !== "ready") return;
  assert.equal(partial.malformedRecords, 0);
  assert.equal(partial.summary.models[0]?.turns, 1);
  // A complete JSON object counts even without a final newline.
  await appendFile(file, tail.slice(-3));
  const complete = await readClaudeCodeUsage({ models, configDir });
  assert.equal(complete.kind, "ready");
  if (complete.kind !== "ready") return;
  assert.equal(complete.malformedRecords, 0);
  assert.equal(complete.summary.models[0]?.turns, 2);
});

test("empty history is ready, absent projects are missing, non-directories fail", async () => {
  const configDir = await fixture();
  const empty = await readClaudeCodeUsage({ models, configDir });
  assert.deepEqual(empty, {
    kind: "ready",
    summary: emptyUsageSummary(),
    unpricedRecords: 0,
    malformedRecords: 0,
    unreadableFiles: 0,
  });
  await rm(join(configDir, "projects"), { recursive: true });
  assert.deepEqual(await readClaudeCodeUsage({ models, configDir }), { kind: "missing" });
  assert.deepEqual(await readClaudeCodeUsage({ models, configDir: join(configDir, "absent") }), {
    kind: "missing",
  });
  await writeFile(join(configDir, "projects"), "not a directory");
  const failed = await readClaudeCodeUsage({ models, configDir });
  assert.equal(failed.kind, "failed");
});

test("explicit config beats environment; blank environment falls back to home", async () => {
  const explicit = await fixture();
  const environment = await fixture();
  const home = await fixture();
  await history(explicit, "a.jsonl", [record("explicit", 1)]);
  await history(environment, "a.jsonl", [record("environment", 2)]);
  await history(join(home, ".claude"), "a.jsonl", [record("home", 3)]);
  vi.stubEnv("HOME", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", environment);
  const first = await readClaudeCodeUsage({ models, configDir: explicit });
  assert.equal(first.kind === "ready" && first.summary.total.output, 1);
  const second = await readClaudeCodeUsage({ models });
  assert.equal(second.kind === "ready" && second.summary.total.output, 2);
  vi.stubEnv("CLAUDE_CONFIG_DIR", "  \t ");
  const third = await readClaudeCodeUsage({ models });
  assert.equal(third.kind === "ready" && third.summary.total.output, 3);
});

test("skips child transcript and directory symlinks without counting copies", async () => {
  const configDir = await fixture();
  const outside = await fixture();
  const target = await history(outside, "a.jsonl", [record("outside")]);
  const full = record();
  const local = await history(configDir, "a.jsonl", [
    { ...full, requestId: undefined, message: { ...full.message, id: undefined } },
  ]);
  await symlink(target, join(configDir, "projects", "external.jsonl"));
  await symlink(local, join(configDir, "projects", "copy.jsonl"));
  await symlink(join(outside, "projects"), join(configDir, "projects", "linked-project"));
  await symlink(join(configDir, "projects"), join(configDir, "projects", "cycle"));
  const result = await readClaudeCodeUsage({ models, configDir });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.summary.total.totalTokens, 210);
  assert.equal(result.summary.models[0]?.turns, 1);
  assert.equal(result.unreadableFiles, 0);
});

test.each(["config", "ancestor", "projects"])("follows a linked %s root", async (linked) => {
  const configDir = await fixture();
  const outside = await fixture();
  const target = linked === "ancestor" ? join(outside, "child") : outside;
  await history(target, "a.jsonl", [record()]);
  if (linked === "projects") {
    await rm(join(configDir, "projects"), { recursive: true });
    await symlink(join(outside, "projects"), join(configDir, "projects"));
  } else {
    await symlink(outside, join(configDir, "linked-config"));
  }
  const result = await readClaudeCodeUsage({
    models,
    configDir:
      linked === "projects"
        ? configDir
        : linked === "ancestor"
          ? join(configDir, "linked-config", "child")
          : join(configDir, "linked-config"),
  });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.summary.total.totalTokens, 210);
  assert.equal(result.unreadableFiles, 0);
});

test.skipIf(process.getuid?.() === 0)(
  "continues unreadable files and subdirectories but fails an unreadable root",
  async () => {
    const configDir = await fixture();
    await history(configDir, "good.jsonl", [record()]);
    const blocked = await history(configDir, "blocked.jsonl", [record("blocked")]);
    const blockedDirectory = join(configDir, "projects", "blocked-directory");
    await mkdir(blockedDirectory);
    await chmod(blocked, 0);
    await chmod(blockedDirectory, 0);
    try {
      const result = await readClaudeCodeUsage({ models, configDir });
      assert.equal(result.kind, "ready");
      if (result.kind !== "ready") return;
      assert.equal(result.unreadableFiles, 2);
      assert.equal(result.summary.models[0]?.turns, 1);
    } finally {
      await chmod(blocked, 0o600);
      await chmod(blockedDirectory, 0o700);
    }
    await chmod(join(configDir, "projects"), 0);
    try {
      assert.equal((await readClaudeCodeUsage({ models, configDir })).kind, "failed");
    } finally {
      await chmod(join(configDir, "projects"), 0o700);
    }
  },
);

test("cancellation rejects before and during scans without returning partial totals", async () => {
  const configDir = await fixture();
  const reason = new Error("scan cancelled");
  await assert.rejects(
    readClaudeCodeUsage({ models, configDir, signal: AbortSignal.abort(reason) }),
    (error) => error === reason,
  );
  await history(
    configDir,
    "large.jsonl",
    Array.from({ length: 20_000 }, (_, index) => record(String(index))),
  );
  const controller = new AbortController();
  const reading = readClaudeCodeUsage({ models, configDir, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(reason), 10);
  try {
    await assert.rejects(reading, (error) => error === reason);
  } finally {
    clearTimeout(timer);
  }
  await rm(join(configDir, "projects", "large.jsonl"));
});

test("a cache reuses unchanged files, reparses changed ones, and forgets removed ones", async () => {
  const configDir = await fixture();
  const first = await history(configDir, "first.jsonl", [record("one")]);
  const second = await history(configDir, "second.jsonl", [record("two")]);
  const cache = createUsageScanCaches().claudeCode;
  const cold = await readClaudeCodeUsage({ models, configDir, cache });
  assert.equal(cold.kind, "ready");
  if (cold.kind !== "ready") return;
  assert.equal(cold.summary.models[0]?.turns, 2);
  assert.deepEqual([...cache.keys()].toSorted(), [first, second].toSorted());

  // The same read from the cache alone: no file is opened, so an unreadable
  // one is still counted from what it said before it was locked.
  await chmod(first, 0);
  try {
    const warm = await readClaudeCodeUsage({ models, configDir, cache });
    assert.equal(warm.kind, "ready");
    if (warm.kind !== "ready") return;
    assert.equal(warm.summary.models[0]?.turns, 2);
    assert.equal(warm.unreadableFiles, 0);
  } finally {
    await chmod(first, 0o600);
  }

  // Cost is derived from the catalog on each read, never baked into the cache.
  const unpriced = await readClaudeCodeUsage({ models: { getModels: () => [] }, configDir, cache });
  assert.equal(unpriced.kind, "ready");
  if (unpriced.kind !== "ready") return;
  assert.equal(unpriced.unpricedRecords, 2);
  const repriced = await readClaudeCodeUsage({ models, configDir, cache });
  assert.equal(repriced.kind, "ready");
  if (repriced.kind !== "ready") return;
  assert.equal(repriced.unpricedRecords, 0);
  assert.ok(repriced.summary.total.cost.total > 0);

  await appendFile(first, `${JSON.stringify(record("three"))}\n`);
  await rm(second);
  const changed = await readClaudeCodeUsage({ models, configDir, cache });
  assert.equal(changed.kind, "ready");
  if (changed.kind !== "ready") return;
  assert.equal(changed.summary.models[0]?.turns, 2);
  assert.deepEqual([...cache.keys()], [first]);
});

test("a persisted cache round-trips and a foreign file decodes to a cold cache", async () => {
  const configDir = await fixture();
  const full = record("kept");
  await history(configDir, "a.jsonl", [
    { ...full, costUSD: 0.5 },
    { ...full, requestId: undefined, message: { ...full.message, id: undefined } },
  ]);
  const caches = createUsageScanCaches();
  const read = await readClaudeCodeUsage({ models, configDir, cache: caches.claudeCode });
  assert.equal(read.kind, "ready");
  const restored = decodeUsageScanCaches(encodeUsageScanCaches(caches));
  assert.deepEqual(restored, caches);
  const warm = await readClaudeCodeUsage({ models, configDir, cache: restored.claudeCode });
  assert.deepEqual(warm, read);
  assert.deepEqual(decodeUsageScanCaches("not json"), createUsageScanCaches());
  assert.deepEqual(decodeUsageScanCaches('{"version":0}'), createUsageScanCaches());
});
