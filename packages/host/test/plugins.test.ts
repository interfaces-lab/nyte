import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type { MutableModels } from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/schema";
import { SKILLS_PLUGIN_ID } from "@nyte-ai/core/plugins";
import {
  createTrustStore,
  createWorkspaceRegistry,
  nyteHome,
  pluginDirectories,
  pluginWatchTargets,
  readManifest,
  resolveHostPlugins,
  skillDirectories,
} from "../src/index.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "nyte-host-plugins-")));
  directories.push(cwd);
  const home = join(cwd, "home");
  vi.stubEnv("NYTE_HOME", home);
  return { cwd, home, workspace: await createTrustStore().trust(cwd) };
}

test("home paths use only user directories; project paths preserve override order", async () => {
  const f = await fixture();
  assert.equal(nyteHome(), f.home);
  assert.deepEqual(pluginDirectories({ kind: "home" }), [
    { path: join(f.home, "plugins"), source: "user" },
  ]);
  assert.deepEqual(pluginDirectories({ kind: "project", workspace: f.workspace }), [
    { path: join(f.home, "plugins"), source: "user" },
    { path: join(f.cwd, ".nyte", "plugins"), source: "project" },
  ]);
  const userSkills = [
    join(f.home, "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
  assert.deepEqual(skillDirectories({ kind: "home" }), userSkills);
  assert.deepEqual(skillDirectories({ kind: "project", workspace: f.workspace }), [
    join(f.cwd, ".nyte", "skills"),
    join(f.cwd, ".agents", "skills"),
    join(f.cwd, ".claude", "skills"),
    ...userSkills,
  ]);
  await createWorkspaceRegistry().touch(f.cwd);
  assert.equal((await createWorkspaceRegistry().list())[0]?.path, f.cwd);
  assert.equal((await createTrustStore().require(f.cwd)).cwd, f.cwd);
  vi.stubEnv("NYTE_HOME", undefined);
  assert.equal(nyteHome(), join(homedir(), ".nyte"));
});

test("the manifest accepts disable entries, JSON options, and MCP servers, user under project", async () => {
  const f = await fixture();
  const project = { kind: "project", workspace: f.workspace } as const;
  assert.deepEqual(await readManifest(project), {});
  await mkdir(join(f.cwd, ".nyte"));
  await mkdir(f.home, { recursive: true });
  const manifest = {
    plugins: ["-rename", { id: "custom", options: { enabled: true, nested: [1, null] } }],
    mcp: {
      docs: { url: "https://mcp.example.invalid/mcp", headers: { Authorization: "Bearer x" } },
      shared: { command: "project-server" },
    },
  };
  await writeFile(join(f.cwd, ".nyte", "nyte.json"), JSON.stringify(manifest));
  assert.deepEqual(await readManifest(project), manifest);
  await writeFile(
    join(f.home, "nyte.json"),
    JSON.stringify({
      plugins: ["-web-search"],
      mcp: { shared: { command: "user-server" }, home: { command: "npx", args: ["-y", "x"] } },
    }),
  );
  assert.deepEqual(await readManifest({ kind: "home" }), {
    plugins: ["-web-search"],
    mcp: { shared: { command: "user-server" }, home: { command: "npx", args: ["-y", "x"] } },
  });
  assert.deepEqual(await readManifest(project), {
    plugins: ["-web-search", ...manifest.plugins],
    mcp: {
      shared: manifest.mcp.shared,
      home: { command: "npx", args: ["-y", "x"] },
      docs: manifest.mcp.docs,
    },
  });
});

test("invalid JSON and invalid manifest shapes identify the manifest path", async () => {
  const f = await fixture();
  await mkdir(join(f.cwd, ".nyte"));
  for (const text of [
    "{",
    "[]",
    '{"plugins": 1}',
    '{"plugins": [{"id": 1}]}',
    '{"plugins": [{"id": "x", "extra": true}]}',
    '{"extra": true}',
    '{"mcp": {"x": {}}}',
    '{"mcp": {"x": {"command": "a", "url": "b"}}}',
    '{"mcp": {"x": {"url": "b", "env": {}}}}',
  ]) {
    await writeFile(join(f.cwd, ".nyte", "nyte.json"), text);
    await assert.rejects(
      readManifest({ kind: "project", workspace: f.workspace }),
      /\.nyte\/nyte\.json: .+/,
    );
  }
});

test("plugin resolution watches its sources whole and the home directory by manifest name only", async () => {
  const f = await fixture();
  assert.deepEqual(pluginWatchTargets({ kind: "project", workspace: f.workspace }), [
    { path: f.home, recursive: false, names: ["nyte.json"] },
    { path: join(f.cwd, ".nyte"), recursive: true },
    { path: join(f.home, "plugins"), recursive: true },
    { path: join(f.cwd, ".agents", "skills"), recursive: true },
    { path: join(f.cwd, ".claude", "skills"), recursive: true },
    { path: join(f.home, "skills"), recursive: true },
    { path: join(homedir(), ".agents", "skills"), recursive: true },
    { path: join(homedir(), ".claude", "skills"), recursive: true },
  ]);
});

const model: Model<Api> = {
  id: "echo",
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

/** A catalog with one model. Resolution never streams, so the provider refuses to. */
function offlineModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });
  const refuse = () => {
    throw new Error("Plugin resolution must not stream");
  };
  models.setProvider({
    id: model.provider,
    name: model.name,
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
    stream: refuse,
    streamSimple: refuse,
  });
  return models;
}

function skillsVersion(resolved: Awaited<ReturnType<typeof resolveHostPlugins>>): string {
  const plugin = resolved.plugins.find((entry) => entry.id === SKILLS_PLUGIN_ID);
  assert.ok(plugin, "the skills builtin is always resolved");
  return plugin.version;
}

test("the skills plugin is versioned by what a scan finds, not by how often it runs", async () => {
  const f = await fixture();
  const skill = join(f.cwd, ".nyte", "skills", "brew-tea");
  await mkdir(skill, { recursive: true });
  const write = (body: string) =>
    writeFile(
      join(skill, "SKILL.md"),
      `---\nname: brew-tea\ndescription: Make a pot of tea\n---\n${body}\n`,
    );
  await write("Boil the water first.");
  const target = { kind: "project", workspace: f.workspace } as const;
  const context = { models: offlineModels(), model };

  const first = await resolveHostPlugins(target, context);
  // An unchanged scan must keep the version, or every resolution reactivates the plugin.
  assert.equal(skillsVersion(await resolveHostPlugins(target, context)), skillsVersion(first));

  await write("Warm the pot first.");
  assert.notEqual(skillsVersion(await resolveHostPlugins(target, context)), skillsVersion(first));
});
