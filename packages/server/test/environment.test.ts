/**
 * Environment calls end to end: a real SDK beside a fake environment, the
 * server handler called as a function, and the client driving it through its
 * `fetch` option. The info reply is also read the way a client released before
 * environment operations reads it.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { createNyteClient, NyteWireError } from "@nyte-ai/client";
import { createNyte } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import {
  CallReplySchema,
  ServerInfoSchema,
  sessionId,
  type AccountUsage,
  type Environment,
  type EnvironmentInput,
  type GitHubProviderState,
  type LoginAttempt,
  type ProviderCatalog,
  type ServerDescription,
  type UsageSnapshot,
} from "@nyte-ai/protocol";
import type { Api, Model, Usage } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createNyteServer, type NyteServerOptions, type ServerFailure } from "../src/index.ts";

const TOKEN = "environment-token-0123456789";
const BASE = "http://nyte.test";

const model: Model<Api> = {
  id: "echo-model",
  name: "Echo",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 2, output: 7, cacheRead: 0.2, cacheWrite: 1 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const description: ServerDescription = {
  capabilities: { workspace: true },
  persistence: "durable",
};

/** `/v1/info` as clients released before environment operations parse it. */
const releasedInfo = Type.Object({
  version: Type.String(),
  wireVersion: Type.Literal(1),
  host: Type.Union([
    Type.Object({ kind: Type.Literal("unspecified") }),
    Type.Object(
      {
        kind: Type.Literal("described"),
        capabilities: Type.Object({ workspace: Type.Boolean() }, { additionalProperties: false }),
        persistence: Type.Enum(["durable", "ephemeral", "unknown"]),
      },
      { additionalProperties: false },
    ),
  ]),
});

const zero: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const catalog: ProviderCatalog = {
  source: "local",
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      enabled: true,
      connection: { kind: "api_key", env: "ANTHROPIC_API_KEY" },
      signIn: [
        { kind: "browser", label: "Sign in", subscription: "Claude Pro/Max" },
        { kind: "api_key", label: "Anthropic API key" },
      ],
    },
  ],
  models: [
    {
      key: "anthropic/claude",
      provider: "anthropic",
      id: "claude",
      name: "Claude",
      contextWindow: 200_000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      thinkingLevels: ["off", "medium"],
      fastMode: { kind: "available", settingId: "fast" },
      hidden: false,
      listed: true,
    },
  ],
  defaults: {
    model: { provider: "anthropic", id: "claude" },
    thinkingLevel: "medium",
    fast: false,
  },
};

const usage: UsageSnapshot = {
  readAt: 1_767_225_600_000,
  sinceDay: "2026-01-01",
  untilDay: "2026-01-07",
  entries: [
    {
      day: "2026-01-02",
      workspacePath: null,
      sessionId: sessionId("s1"),
      subject: { kind: "model", provider: "anthropic", model: "claude" },
      totals: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 2,
        tokens: 15,
        cost: 0.01,
        turns: 1,
      },
    },
  ],
  sessions: [
    {
      sessionId: sessionId("s1"),
      name: "Fix the build",
      workspacePath: null,
      lastActivityAt: 1_767_312_000_000,
    },
  ],
  sources: [{ workspacePath: null, status: "ok", sessions: 1, message: null }],
  previous: { cost: 0.02, tokens: 30 },
  earliestDay: "2026-01-02",
  nyteError: null,
  claudeCode: { kind: "missing" },
  codex: {
    kind: "ready",
    summary: {
      models: [{ provider: "openai-codex", model: "gpt", turns: 1, usage: zero }],
      compaction: zero,
      tools: zero,
      total: zero,
    },
    unpricedRecords: 0,
    malformedRecords: 0,
    unreadableFiles: 0,
  },
};

const limits: readonly AccountUsage[] = [
  {
    provider: "anthropic",
    kind: "ready",
    limits: {
      providerId: "anthropic",
      plan: "max",
      windows: [{ id: "five_hour", usedPercent: 12, resetsAt: 1_767_240_000_000 }],
      observedAt: 1_767_225_600_000,
    },
  },
  { provider: "openai-codex", kind: "unavailable" },
];

const running: LoginAttempt = {
  kind: "running",
  browser: { url: "https://claude.ai/oauth/authorize", acceptsCode: true },
  message: "Waiting for the browser",
};

const settled: LoginAttempt = {
  kind: "settled",
  outcome: { kind: "connected", catalogRefreshed: false },
};

const account: GitHubProviderState = {
  kind: "ready",
  account: { login: "octocat" },
  pullRequest: { kind: "none" },
};

const signingIn: GitHubProviderState = {
  kind: "signing_in",
  deviceCode: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
};

/** Every handler answers a fixture; `seen` records the input of each call that takes one. */
function fakeEnvironment() {
  const seen: unknown[] = [];

  const environment: Environment = {
    "environment.catalog": async () => catalog,
    "environment.setPreference": async (change) => {
      seen.push(change);

      return catalog;
    },
    "environment.usage": async (window) => {
      seen.push(window);

      return usage;
    },
    "environment.accountLimits": async () => limits,
    "environment.login": async (start) => {
      seen.push(start);

      return running;
    },
    "environment.loginAttempt": async () => settled,
    "environment.answerLogin": async (answer) => {
      seen.push(answer);
    },
    "environment.cancelLogin": async (cancel) => {
      seen.push(cancel);
    },
    "environment.logout": async (logout) => {
      seen.push(logout);
    },
    "environment.github.state": async () => account,
    "environment.github.signIn": async () => signingIn,
    "environment.github.signOut": async () => ({ kind: "signed_out" }),
    "environment.github.createPullRequest": async (input) => {
      seen.push(input);

      return { kind: "created", url: "https://github.com/owner/repo/pull/13" };
    },
  };

  return { environment, seen };
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function serve(
  options: Partial<Pick<NyteServerOptions, "environment" | "permissions" | "describe">> = {},
) {
  const store = new SqliteStore(":memory:");
  const nyte = await createNyte({
    store,
    streamFn: () => {
      throw new Error("Environment calls never reach a model");
    },
    models: {
      getModels: () => [model],
      getModel: (_provider: string, id: string) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
    plugins: [],
    env: { cwd: "/tmp/nowhere" },
  });
  cleanups.push(
    () => nyte.close(),
    () => store.close(),
  );
  const failures: ServerFailure[] = [];
  const server = createNyteServer({
    sdk: nyte,
    version: "0.0.0-test",
    auth: { kind: "token", token: TOKEN },
    heartbeatMs: 0,
    onError: (failure) => failures.push(failure),
    ...options,
  });
  cleanups.push(() => server.close());
  const client = createNyteClient({
    baseUrl: BASE,
    token: TOKEN,
    fetch: (input, init) => server.fetch(new Request(input, init)),
  });
  const request = (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${TOKEN}`);

    return server.fetch(new Request(`${BASE}${path}`, { ...init, headers }));
  };

  return { client, request, failures };
}

test("info names an environment only when the host passed one, so an older server reads as none", async () => {
  const bare = await serve();
  const equipped = await serve({ environment: fakeEnvironment().environment });

  assert.equal((await bare.client.info()).environment, undefined);
  assert.equal((await equipped.client.info()).environment, true);
});

test("an info reply that names the environment still parses under the schema released clients carry", async () => {
  const { request } = await serve({
    environment: fakeEnvironment().environment,
    describe: () => description,
  });
  const reply: unknown = await (await request("/v1/info")).json();

  assert.ok(Value.Check(CallReplySchema, reply) && reply.ok && reply.defined);
  assert.ok(Value.Check(ServerInfoSchema, reply.value) && reply.value.environment === true);
  assert.ok(Value.Check(releasedInfo, reply.value));
});

test("environment calls reach the host's environment parsed and come back checked", async () => {
  const { environment, seen } = fakeEnvironment();
  const { client } = await serve({ environment });

  assert.deepEqual(await client.environment("environment.catalog", undefined), catalog);
  assert.deepEqual(
    await client.environment("environment.setPreference", {
      kind: "models",
      provider: "anthropic",
      ids: ["claude"],
      hidden: true,
    }),
    catalog,
  );
  assert.deepEqual(
    await client.environment("environment.usage", { sinceDay: null, untilDay: "2026-01-07" }),
    usage,
  );
  assert.deepEqual(await client.environment("environment.accountLimits", undefined), limits);
  assert.deepEqual(
    await client.environment("environment.login", {
      provider: "anthropic",
      method: { kind: "api_key", key: "sk-ant-test" },
      attempt: "a1",
    }),
    running,
  );
  assert.deepEqual(
    await client.environment("environment.loginAttempt", { attempt: "a1" }),
    settled,
  );
  assert.equal(
    await client.environment("environment.answerLogin", { attempt: "a1", code: "code#state" }),
    undefined,
  );
  assert.equal(await client.environment("environment.cancelLogin", { attempt: "a1" }), undefined);
  assert.equal(
    await client.environment("environment.logout", { provider: "anthropic" }),
    undefined,
  );
  assert.deepEqual(await client.environment("environment.github.state", undefined), account);
  assert.deepEqual(await client.environment("environment.github.signIn", undefined), signingIn);
  assert.deepEqual(await client.environment("environment.github.signOut", undefined), {
    kind: "signed_out",
  });
  assert.deepEqual(
    await client.environment("environment.github.createPullRequest", { title: "feat: ship" }),
    { kind: "created", url: "https://github.com/owner/repo/pull/13" },
  );
  assert.deepEqual(seen, [
    { kind: "models", provider: "anthropic", ids: ["claude"], hidden: true },
    { sinceDay: null, untilDay: "2026-01-07" },
    { provider: "anthropic", method: { kind: "api_key", key: "sk-ant-test" }, attempt: "a1" },
    { attempt: "a1", code: "code#state" },
    { attempt: "a1" },
    { provider: "anthropic" },
    { title: "feat: ship" },
  ]);
});

test("a server whose host passed no environment answers environment calls as unknown", async () => {
  const { client } = await serve();

  await assert.rejects(
    client.environment("environment.catalog", undefined),
    (error) =>
      error instanceof NyteWireError && error.code === "unknown_operation" && error.status === 404,
  );
});

test("environment input is checked before the environment runs", async () => {
  const { environment, seen } = fakeEnvironment();
  const { request } = await serve({ environment });

  for (const [operation, input] of [
    ["environment.usage", { sinceDay: "last week", untilDay: "2026-01-07" }],
    ["environment.usage", { sinceDay: null, untilDay: "2026-01-07", timeZone: "UTC" }],
    [
      "environment.login",
      { provider: "anthropic", method: { kind: "api_key", key: " " }, attempt: "a1" },
    ],
    ["environment.github.createPullRequest", { title: " " }],
    ["environment.github.createPullRequest", { title: "x".repeat(257) }],
    ["environment.github.createPullRequest", { title: "ok", body: "x".repeat(65_537) }],
    ["environment.github.createPullRequest", { title: "ok", head: "feature" }],
  ] as const) {
    const response = await request(`/v1/call/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const reply: unknown = await response.json();

    assert.equal(response.status, 400);
    assert.ok(Value.Check(CallReplySchema, reply) && !reply.ok);
    assert.equal(reply.error.code, "invalid_input");
  }

  assert.deepEqual(seen, []);
});

test("a permission policy judges parsed environment input and forbids what it does not list", async () => {
  const { environment, seen } = fakeEnvironment();
  const judged: EnvironmentInput<"environment.logout">[] = [];
  const { client } = await serve({
    environment,
    permissions: {
      calls: {},
      environment: {
        "environment.logout": (input) => {
          judged.push(input);

          return input.provider === "anthropic";
        },
      },
    },
  });

  assert.equal(
    await client.environment("environment.logout", { provider: "anthropic" }),
    undefined,
  );

  for (const refused of [
    () => client.environment("environment.logout", { provider: "openai" }),
    () => client.environment("environment.catalog", undefined),
  ]) {
    await assert.rejects(
      refused(),
      (error) =>
        error instanceof NyteWireError && error.code === "forbidden" && error.status === 403,
    );
  }

  assert.deepEqual(judged, [{ provider: "anthropic" }, { provider: "openai" }]);
  assert.deepEqual(seen, [{ provider: "anthropic" }]);
});

test("an environment that throws reaches the client as internal while the host hears which call failed", async () => {
  const cause = new Error("gh wrote to /Users/someone/.config/gh");
  const { client, failures } = await serve({
    environment: {
      ...fakeEnvironment().environment,
      "environment.github.state": () => Promise.reject(cause),
    },
  });

  await assert.rejects(
    client.environment("environment.github.state", undefined),
    (error) =>
      error instanceof NyteWireError &&
      error.code === "internal" &&
      error.message === "Internal error",
  );
  assert.deepEqual(failures, [{ route: "call", operation: "environment.github.state", cause }]);
});
