import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "vite";
import { afterEach, test, vi } from "vitest";
import { FileModelsStore, type Models } from "@nyte-ai/ai";
import { UsageScanWorker } from "@nyte-ai/host/usage-scan";
import { localDay } from "@nyte-ai/host/store-usage";
import { CALL_INPUT_SCHEMAS } from "./ipc-inputs.ts";
import { testDesktop } from "./fixtures/desktop-host.ts";

const folders: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function histories() {
  const home = await mkdtemp(join(tmpdir(), "nyte-usage-desktop-"));
  folders.push(home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(home, "claude"));
  vi.stubEnv("CODEX_HOME", join(home, "codex"));

  return home;
}

test("host.usage reads a real completed chat and keeps external histories separate", async () => {
  await histories();
  const made = await testDesktop();

  try {
    const host = await made.host.host();
    made.fake.reply({
      content: [{ type: "text", text: "Done" }],
      usage: { input: 100, output: 20, cacheRead: 10, reasoning: 5 },
    });
    const session = await host.sessions.create({ name: "Usage chat" });
    await (await session.send("Work")).settled();
    const today = localDay(Date.now());
    const report = await made.host.call(1, "host.usage", { sinceDay: today, untilDay: today });
    assert.equal(report.nyteError, null);
    assert.equal(report.entries.length, 1);
    assert.deepEqual(report.entries[0]?.subject, {
      kind: "model",
      provider: "test",
      model: "model",
    });
    assert.equal(report.entries[0]?.totals.tokens, 130);
    assert.equal(report.sessions[0]?.name, "Usage chat");
    assert.deepEqual(report.claudeCode, { kind: "missing" });
    assert.deepEqual(report.codex, { kind: "missing" });
    assert.equal(
      (await made.host.call(1, "host.usage", { sinceDay: "2000-01-01", untilDay: "2000-01-01" }))
        .entries.length,
      0,
    );
  } finally {
    await made.close();
  }
});

test("usage windows reject invalid, reversed and extra input", () => {
  for (const input of [
    { sinceDay: null, untilDay: "bad" },
    { sinceDay: null, untilDay: "2026-02-30" },
    { sinceDay: "2026-09-03", untilDay: "2026-09-02" },
    { sinceDay: null, untilDay: "2026-09-02", extra: true },
  ])
    assert.throws(() => CALL_INPUT_SCHEMAS["host.usage"].Parse(input));
  assert.deepEqual(
    CALL_INPUT_SCHEMAS["host.usage"].Parse({ sinceDay: null, untilDay: "2026-09-02" }),
    { sinceDay: null, untilDay: "2026-09-02" },
  );
});

test("the bundled worker serves scans, handles repeated reads and closes pending work", async () => {
  const home = await histories();
  await mkdir(join(home, ".nyte"));
  const output = join(home, "worker");
  await build({
    configFile: false,
    envDir: false,
    logLevel: "silent",
    build: {
      target: "node24",
      outDir: output,
      lib: {
        entry: fileURLToPath(new URL("./usage-worker.ts", import.meta.url)),
        formats: ["es"],
        fileName: () => "usage-worker.js",
      },
      rolldownOptions: { platform: "node", external: (id) => id.startsWith("node:") },
    },
  });
  const worker = new UsageScanWorker(home, pathToFileURL(join(output, "usage-worker.js")));
  const request = { window: { sinceDay: null, untilDay: "2026-09-02" }, catalog: [] };

  try {
    const [first, second] = await Promise.all([worker.scan(request), worker.scan(request)]);
    assert.deepEqual(first.entries, []);
    assert.deepEqual(second.claudeCode, { kind: "missing" });
    assert.equal(first.nyteError, null);

    const model: ReturnType<Models["getModels"]>[number] = {
      id: "claude-test",
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

    await new FileModelsStore(join(home, ".nyte", "models-store.json")).write("anthropic", {
      models: [model],
    });
    await mkdir(join(home, "claude", "projects"), { recursive: true });
    await writeFile(
      join(home, "claude", "projects", "chat.jsonl"),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "message",
          model: model.id,
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      }) + "\n",
    );
    const priced = await worker.scan({ window: request.window });
    assert.equal(priced.claudeCode.kind, "ready");

    if (priced.claudeCode.kind !== "ready") throw new Error("The transcript must be readable.");
    assert.equal(priced.claudeCode.unpricedRecords, 0);
    assert.ok(Math.abs(priced.claudeCode.summary.total.cost.total - 0.0006) < 1e-12);
    const pending = worker.scan(request);
    const rejected = assert.rejects(pending, /Usage worker closed/);
    await worker.close();
    await rejected;
  } finally {
    await worker.close();
  }
}, 30_000);
