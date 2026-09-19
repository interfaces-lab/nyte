/**
 * Delegation through a real host: the SDK checks the exact requested model
 * against `models.getAvailable`, so a provider's `filterModels` can refuse it
 * before child creation. The provider is a script; models, auth, trust,
 * plugins, and the SQLite store are real.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import {
  contentText,
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { Provider } from "@nyte-ai/ai";
import type { Nyte, SessionId, TrustedWorkspace } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import type { Api, AssistantMessage, Context, Model } from "@nyte-ai/schema";
import { createHost, createWorkspaceStore } from "../src/index.ts";
import type { HostPlugins } from "../src/index.ts";

const CHILD_PROMPT = "Map the repository.";

function catalogModel(id: string, input: number, output: number): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-responses",
    provider: "echo",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input, output, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 1_000,
  };
}

// Cheapest first so the blocked model wins on price if availability is ignored.
const blocked = catalogModel("tiny", 0.1, 0.2);
const small = catalogModel("small", 1, 2);
const premium = catalogModel("premium", 4, 12);
const catalog = [blocked, small, premium];

interface Request {
  readonly model: Model<Api>;
  readonly prompt: string;
  readonly hasTask: boolean;
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

/**
 * One script for every request. A parent offered `task` delegates to
 * an exact model; a parent holding the child's result finishes; anything else
 * (the child, the background title request) answers its prompt.
 */
async function fixture(
  options: {
    readonly model?: () => string;
    readonly cachedModel?: Model<Api>;
    /** Runs synchronously on each request, before the script answers. */
    readonly onRequest?: (request: Request, block: (ids: readonly string[]) => void) => void;
  } = {},
) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "nyte-delegation-")));
  directories.push(cwd);
  vi.stubEnv("NYTE_HOME", join(cwd, "home"));
  vi.stubEnv("HOME", join(cwd, "user"));
  const modelsStore = new InMemoryModelsStore();
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore,
  });
  const requests: Request[] = [];
  let unavailable: ReadonlySet<string> = new Set([blocked.id]);
  const block = (ids: readonly string[]) => {
    unavailable = new Set(ids);
  };
  const stream = (selected: Model<Api>, context: Context) => {
    const tail = context.messages.findLast((item) => item.role === "user");
    const prompt = tail === undefined ? "" : contentText(tail.content);
    const task = context.tools?.find((tool) => tool.name === "task");
    const request: Request = { model: selected, prompt, hasTask: task !== undefined };
    requests.push(request);
    options.onRequest?.(request, block);
    const result = context.messages.findLast((item) => item.role === "toolResult");
    const content: AssistantMessage["content"] =
      result !== undefined
        ? [{ type: "text", text: `done: ${contentText(result.content)}` }]
        : task !== undefined
          ? [
              {
                type: "toolCall",
                id: "task-1",
                name: "task",
                arguments: { model: options.model?.() ?? "echo/small", prompt: CHILD_PROMPT },
              },
            ]
          : [{ type: "text", text: `found: ${prompt}` }];
    const message: AssistantMessage = {
      role: "assistant",
      content,
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      stopReason: task !== undefined && result === undefined ? "toolUse" : "stop",
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const events = createAssistantMessageEventStream();
    events.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message,
    });
    return events;
  };
  const provider: Provider = {
    id: "echo",
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => catalog,
    filterModels: (all) => all.filter((model) => !unavailable.has(model.id)),
    stream,
    streamSimple: stream,
  };
  models.setProvider(provider);
  const refreshes: boolean[] = [];
  const cached = options.cachedModel;
  if (cached !== undefined) {
    await modelsStore.write(cached.provider, { models: [cached] });
    let restored: readonly Model<Api>[] = [];
    models.setProvider({
      ...provider,
      id: cached.provider,
      getModels: () => restored,
      async refreshModels(context) {
        refreshes.push(context.allowNetwork);
        await context.publish({
          update: () => {
            restored = context.stored?.models ?? [];
          },
        });
      },
    });
  }
  const workspace = await createWorkspaceStore().trust(cwd);
  const open = async (plugins: HostPlugins): Promise<Nyte> => {
    const store = new SqliteStore(join(cwd, "sessions.db"));
    stores.push(store);
    const host = await createHost({ store, models, model: premium, plugins });
    hosts.push(host);
    return host;
  };
  return { workspace, requests, open, refreshes };
}

/** What the parent says once its `task` call settles with the child's report. */
function reported(child: SessionId): string {
  return `done: Background agent ${CHILD_PROMPT} (${child}) finished. Its report:\n\nfound: ${CHILD_PROMPT}`;
}

/** A parent parked on its child answers `waiting`; keep asking until the child has woken it. */
async function untilIdle(
  host: Nyte,
  sessionId: Parameters<Nyte["runs"]["wait"]>[0]["sessionId"],
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while ((await host.runs.wait({ sessionId })).kind !== "idle") {
    if (Date.now() > deadline) throw new Error("delegation did not settle in 10s");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function delegate(host: Nyte) {
  const parent = await host.sessions.create();
  host.attach();
  await host.messages.send({ sessionId: parent.sessionId, content: "delegate" });
  await untilIdle(host, parent.sessionId);
  const children = await host.sessions.list({ parent: parent.sessionId });
  assert.equal(children.items.length, 1, "one child session");
  const child = children.items[0];
  assert.ok(child !== undefined);
  const snapshot = await host.sessions.snapshot({ sessionId: parent.sessionId });
  assert.ok(snapshot);
  const answers = snapshot.transcript.flatMap((item) =>
    item.kind === "turn"
      ? item.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
      : [],
  );
  return { parent, child, answers };
}

const compositions: readonly {
  readonly name: string;
  readonly plugins: (workspace: TrustedWorkspace) => HostPlugins;
}[] = [
  {
    name: "static project target",
    plugins: (workspace) => ({ kind: "workspace", target: { kind: "project", workspace } }),
  },
  {
    name: "deferred project target",
    plugins: (workspace) => ({
      kind: "workspace",
      target: { kind: "deferred", resolve: async () => ({ kind: "project", workspace }) },
    }),
  },
];

for (const composition of compositions) {
  test(`${composition.name}: the parent chooses an exact model for the task`, async () => {
    const f = await fixture();
    const host = await f.open(composition.plugins(f.workspace));
    const { child, answers } = await delegate(host);

    const parentRequests = f.requests.filter((request) => request.hasTask);
    assert.equal(parentRequests.length, 2, "the task call and the wake after it");
    for (const request of parentRequests) {
      assert.equal(request.model, premium);
    }

    const childRequests = f.requests.filter((request) => request.prompt === CHILD_PROMPT);
    assert.deepEqual(
      childRequests.map((request) => request.model),
      [small],
    );
    assert.deepEqual(child.config.model, { provider: small.provider, id: small.id });
    assert.deepEqual(
      (await host.runs.current({ sessionId: child.sessionId }))?.config.model,
      child.config.model,
    );
    assert.deepEqual(answers, [reported(child.sessionId)]);
  });
}

test("spawn refuses a requested model that became unavailable", async () => {
  const f = await fixture({
    onRequest: (request, block) => {
      if (request.hasTask) block([blocked.id, small.id, premium.id]);
    },
  });
  const host = await f.open({
    kind: "workspace",
    target: { kind: "project", workspace: f.workspace },
  });
  const parent = await host.sessions.create();
  host.attach();
  await host.messages.send({ sessionId: parent.sessionId, content: "delegate" });
  await untilIdle(host, parent.sessionId);

  assert.deepEqual((await host.sessions.list({ parent: parent.sessionId })).items, []);
  const snapshot = await host.sessions.snapshot({ sessionId: parent.sessionId });
  assert.ok(
    snapshot?.transcript.some(
      (turn) =>
        turn.kind === "turn" &&
        turn.parts.some(
          (part) =>
            part.kind === "assistant" && part.text.includes("model is unavailable: echo/small"),
        ),
    ),
  );
});

test("each delegation uses the model chosen for that call", async () => {
  let selected = "echo/small";
  const f = await fixture({ model: () => selected });
  const host = await f.open({
    kind: "workspace",
    target: { kind: "project", workspace: f.workspace },
  });
  assert.deepEqual((await delegate(host)).child.config.model, { provider: "echo", id: "small" });
  selected = "echo/premium";
  assert.deepEqual((await delegate(host)).child.config.model, { provider: "echo", id: "premium" });
});

test("a task can select another provider's cached model before a picker or network refresh", async () => {
  const cached: Model<Api> = { ...premium, provider: "openai-codex", id: "gpt-6-astra" };
  const f = await fixture({ cachedModel: cached, model: () => "openai-codex/gpt-6-astra" });
  const host = await f.open({
    kind: "workspace",
    target: { kind: "project", workspace: f.workspace },
  });
  const { child, answers } = await delegate(host);
  assert.deepEqual(child.config.model, { provider: cached.provider, id: cached.id });
  assert.deepEqual(
    f.requests
      .filter((request) => request.prompt === CHILD_PROMPT)
      .map((request) => `${request.model.provider}/${request.model.id}`),
    ["openai-codex/gpt-6-astra"],
  );
  assert.deepEqual(answers, [reported(child.sessionId)]);
  assert.ok(f.refreshes.length > 0);
  assert.ok(f.refreshes.every((allowNetwork) => !allowNetwork));
});
