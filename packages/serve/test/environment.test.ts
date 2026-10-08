/**
 * `nyte-serve`'s environment over its own listener: the catalog and usage of
 * the one folder it serves, preferences that change what its picker lists,
 * and GitHub state for that folder's repository.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import { createNyteClient } from "@nyte-ai/client";
import { createWorkspaceStore } from "@nyte-ai/host";
import type { GitHubCommandRequest, GitHubCommandRunner } from "@nyte-ai/host";
import { localDay } from "@nyte-ai/host/store-usage";
import type { Api, Model } from "@nyte-ai/schema";
import { openServedHost } from "../src/host.ts";
import { randomToken, startServe } from "../src/index.ts";

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

/** Answers every turn with one input and one output token, so a run leaves usage behind. */
const replying: Provider["stream"] = (selected) => {
  const events = createAssistantMessageEventStream();
  events.push({
    type: "done",
    reason: "stop",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  });
  return events;
};

function offlineModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });
  models.setProvider({
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
    stream: replying,
    streamSimple: replying,
  });
  return models;
}

const completed = (stdout: string, code = 0, stderr = "") =>
  ({ kind: "completed", code, stdout, stderr }) as const;

function github(calls: GitHubCommandRequest[]): GitHubCommandRunner {
  return async (request) => {
    calls.push(request);
    const [first, second] = request.args;
    if (request.command === "git") {
      if (first === "symbolic-ref") return completed("feature\n");
      return completed(second === undefined ? "origin\n" : "https://github.com/owner/repo.git\n");
    }
    if (first === "auth") return completed(JSON.stringify([{ active: true, state: "success" }]));
    if (first === "api") {
      return completed(JSON.stringify({ login: "octo", name: null, avatar_url: null }));
    }
    if (second === "create") return completed("https://github.com/owner/repo/pull/13\n");
    return completed("", 1, "no pull requests found for branch");
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function serve(calls: GitHubCommandRequest[] = []) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-serve-environment-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv("NYTE_HOME", join(root, "state"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  vi.stubEnv("CODEX_HOME", join(root, "codex"));
  const cwd = join(root, "repo");
  await mkdir(cwd);
  await createWorkspaceStore().trust(cwd);
  const served = await openServedHost({
    cwd,
    onDiagnostic: () => undefined,
    models: offlineModels(),
    runGitHubCommand: github(calls),
  });
  cleanups.push(() => served.close());
  const token = randomToken();
  const serving = await startServe({
    sdk: served.sdk,
    environment: served.environment,
    attach: served.attach,
    version: "test",
    auth: { kind: "token", token },
  });
  cleanups.push(() => serving.close());
  return { cwd, client: createNyteClient({ baseUrl: serving.address, token }) };
}

test("the catalog is the served machine's, and preferences change what its picker lists", async () => {
  const { client } = await serve();
  assert.equal((await client.info()).environment, true);

  const catalog = await client.environment("environment.catalog", undefined);
  assert.deepEqual(catalog.providers, [
    {
      id: "echo",
      name: "Echo",
      enabled: true,
      connection: { kind: "api_key" },
      signIn: [],
    },
  ]);
  assert.deepEqual(
    catalog.models.map((entry) => [entry.key, entry.listed]),
    [["echo/echo", true]],
  );
  assert.deepEqual(catalog.defaults?.model, { provider: "echo", id: "echo" });
  assert.deepEqual(
    (await client.provider.models.list()).map((entry) => entry.id),
    ["echo"],
  );

  const disabled = await client.environment("environment.setPreference", {
    kind: "provider",
    provider: "echo",
    enabled: false,
  });
  assert.equal(disabled.providers[0]?.enabled, false);
  assert.deepEqual(
    disabled.models.map((entry) => [entry.key, entry.listed]),
    [["echo/echo", false]],
  );
  assert.deepEqual(await client.environment("environment.catalog", undefined), disabled);
  assert.deepEqual(await client.provider.models.list(), []);
});

test("usage reads the served folder's chats and nothing else", async () => {
  const { client, cwd } = await serve();
  const session = await client.sessions.create({ name: "served work" });
  await client.messages.send({ sessionId: session.sessionId, content: "hello" });

  const usage = await vi.waitFor(async () => {
    const report = await client.environment("environment.usage", {
      sinceDay: null,
      untilDay: localDay(Date.now()),
    });
    assert.equal(report.entries[0]?.totals.tokens, 2);
    return report;
  });
  assert.deepEqual(
    usage.entries.map((entry) => [entry.workspacePath, entry.sessionId, entry.subject]),
    [[cwd, session.sessionId, { kind: "model", provider: "echo", model: "echo" }]],
  );
  assert.deepEqual(usage.sessions, [
    {
      sessionId: session.sessionId,
      name: "served work",
      workspacePath: cwd,
      lastActivityAt: usage.sessions[0]?.lastActivityAt,
    },
  ]);
  assert.deepEqual(usage.sources, [
    { workspacePath: cwd, status: "ok", sessions: 1, message: null },
  ]);
  assert.equal(usage.nyteError, null);
  assert.deepEqual(usage.claudeCode, { kind: "missing" });
  assert.deepEqual(usage.codex, { kind: "missing" });
});

test("GitHub state reads the served folder's repository", async () => {
  const calls: GitHubCommandRequest[] = [];
  const { client, cwd } = await serve(calls);

  assert.deepEqual(await client.environment("environment.github.state", undefined), {
    kind: "ready",
    repository: {
      owner: "owner",
      name: "repo",
      remoteName: "origin",
      url: "https://github.com/owner/repo",
    },
    account: { login: "octo" },
    pullRequest: { kind: "none" },
  });
  assert.deepEqual(
    [...new Set(calls.filter((call) => call.command === "git").map((call) => call.cwd))],
    [cwd],
  );
});

test("a pull request opens for the served folder's checked-out branch", async () => {
  const calls: GitHubCommandRequest[] = [];
  const { client, cwd } = await serve(calls);

  assert.deepEqual(
    await client.environment("environment.github.createPullRequest", {
      title: "feat: ship it",
      draft: true,
    }),
    { kind: "created", url: "https://github.com/owner/repo/pull/13" },
  );
  const create = calls.find((call) => call.args[1] === "create");
  assert.equal(create?.cwd, cwd);
  assert.equal(create?.args[create.args.indexOf("--title") + 1], "feat: ship it");
  assert.ok(create?.args.includes("--draft"));
});
