import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { SqliteStore } from "@nyte-ai/core/store";
import type { Commit } from "@nyte-ai/protocol";
import { UsageScanner } from "./usage-scan.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function assistant(at: number, output: number): Commit {
  return {
    kind: "commit",
    parent: null,
    at,
    calls: {},
    outcome: { kind: "ok" },
    body: {
      kind: "message",
      message: {
        role: "assistant",
        content: [],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "fixture",
        usage: {
          input: 10,
          output,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 10 + output,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: at,
      },
    },
  };
}

test("a session is read again only when its objects change, and a removed one is forgotten", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-usage-scan-"));
  directories.push(root);
  // Keep the transcript readers on empty fixtures; this test is about stores.
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));
  const path = join(root, "sessions.db");
  const store = new SqliteStore(path);
  const first = await store.create({ id: "first" });
  await first.objects.put([assistant(1, 5)]);
  const second = await store.create({ id: "second" });
  await second.objects.put([assistant(2, 7)]);

  const scanner = new UsageScanner(join(root, "state"));
  const request = { stores: [{ workspacePath: null, path }], catalog: [] };
  const tokens = (scan: Awaited<ReturnType<UsageScanner["scan"]>>) =>
    scan.stores[0]?.sessions.map((session) => [
      session.sessionId,
      session.commits.reduce((sum, commit) => sum + commit.usage.totalTokens, 0),
    ]);

  assert.deepEqual(tokens(await scanner.scan(request)), [
    ["first", 15],
    ["second", 17],
  ]);

  await first.objects.put([assistant(3, 100)]);
  await store.delete("second");
  assert.deepEqual(tokens(await scanner.scan(request)), [["first", 125]]);

  // A fresh scanner sees the same store the same way: the cache never adds.
  assert.deepEqual(tokens(await new UsageScanner(join(root, "state")).scan(request)), [
    ["first", 125],
  ]);
  await scanner.close();
  await store.close();
});

test("a store that cannot be opened is a failed row, not a failed scan", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-usage-scan-"));
  directories.push(root);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));
  await writeFile(join(root, "blocked"), "not a directory");
  const scanner = new UsageScanner(join(root, "state"));
  const scan = await scanner.scan({
    stores: [{ workspacePath: "/broken", path: join(root, "blocked", "sessions.db") }],
    catalog: [],
  });
  assert.equal(scan.stores[0]?.workspacePath, "/broken");
  assert.ok(scan.stores[0]?.failure);
  assert.deepEqual(scan.claudeCode, { kind: "missing" });
  assert.deepEqual(scan.codex, { kind: "missing" });
});
