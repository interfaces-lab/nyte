import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type { Nyte, Plugin, Workspace } from "@nyte-ai/core";
import { definePlugin } from "@nyte-ai/core/plugins";
import type { ExecutionEnv } from "@nyte-ai/core/plugins";
import { SqliteStore } from "@nyte-ai/core/store";
import type { Api, Model } from "@nyte-ai/schema";
import { createHost, environmentId } from "../src/index.ts";

const model: Model<Api> = {
  id: "echo/model",
  name: "Echo",
  api: "openai-responses",
  provider: "echo",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const workspace: Workspace = {
  kind: "fake-sandbox",
  id: "fake:one",
  cwd: "/work",
  locator: { name: "one" },
};

const ref = { kind: "fake-sandbox", id: "fake:one", cwd: "/work" };

const fakeEnv: ExecutionEnv = {
  id: "fake:one",
  cwd: "/work",
  resolve: (...paths) => posix.resolve("/work", ...paths),
  readFile: async (path) => {
    throw new Error(`ENOENT: ${path}`);
  },
  writeFile: async () => undefined,
  mkdir: async () => undefined,
  stat: async () => undefined,
  readdir: async () => [],
  realpath: async () => undefined,
  exec: async () => ({ exitCode: 0 }),
};

function sandbox(open: (workspace: Workspace) => Promise<ExecutionEnv>): Plugin {
  return definePlugin({
    id: "fake-sandbox",
    environment: { kind: "fake-sandbox", open },
    session: () => undefined,
  });
}

const hosts: Nyte[] = [];
const stores: SqliteStore[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const store of stores.splice(0)) await store.close();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

async function open(plugins: readonly Plugin[]): Promise<{ host: Nyte; cwd: string }> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "nyte-environments-")));
  directories.push(cwd);
  vi.stubEnv("NYTE_HOME", join(cwd, "home"));
  vi.stubEnv("HOME", join(cwd, "user"));
  const store = new SqliteStore(join(cwd, "sessions.db"));
  stores.push(store);
  const host = await createHost({
    store,
    models: createModels({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
    }),
    model,
    plugins: { kind: "custom", plugins, cwd },
  });
  hosts.push(host);
  return { host, cwd };
}

test("new sessions act in this installation's local environment", async () => {
  const { host, cwd } = await open([]);
  const { sessionId } = await host.sessions.create();
  const info = await host.sessions.get({ sessionId });
  assert.deepEqual(info?.activation, { kind: "active" });
  assert.deepEqual(info?.workspace, { kind: "local", id: await environmentId(), cwd });
});

test("a custom host leaves this machine's other folders waiting for a grant", async () => {
  const { host, cwd } = await open([]);
  const other = join(cwd, "other");
  const { activation } = await host.sessions.create({
    workspace: { kind: "local", id: await environmentId(), cwd: other },
  });
  assert.deepEqual(activation, {
    kind: "requires",
    requirement: { kind: "workspace_trust", cwd: other },
  });
});

test("a workspace its provider fails to open is unreachable", async () => {
  const { host } = await open([
    sandbox(async () => {
      throw new Error("sandbox gone");
    }),
  ]);
  const { sessionId } = await host.sessions.create({ workspace });
  assert.deepEqual((await host.sessions.get({ sessionId }))?.activation, {
    kind: "requires",
    requirement: { kind: "workspace_unavailable", workspace: ref, reason: "unreachable" },
  });
});

test("a workspace its provider opens activates the session there", async () => {
  const opened: Workspace[] = [];
  const { host } = await open([
    sandbox(async (stored) => {
      opened.push(stored);
      return fakeEnv;
    }),
  ]);
  const { sessionId } = await host.sessions.create({ workspace });
  const info = await host.sessions.get({ sessionId });
  assert.deepEqual(info?.activation, { kind: "active" });
  assert.deepEqual(info?.workspace, ref);
  assert.deepEqual(opened, [workspace]);
});
