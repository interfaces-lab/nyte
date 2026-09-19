import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
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
import type { Nyte } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema";
import { InMemoryTelemetryContext } from "@nyte-ai/telemetry";
import { createHost, createWorkspaceStore, resolveModel } from "../src/index.ts";

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

async function fixture() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "nyte-host-")));
  directories.push(cwd);
  vi.stubEnv("NYTE_HOME", join(cwd, "home"));
  vi.stubEnv("HOME", join(cwd, "user"));
  const modelsStore = new InMemoryModelsStore();
  const models = createModels({ credentials: new InMemoryCredentialStore(), modelsStore });
  const prompts: string[] = [];
  const tools: string[][] = [];
  const stream = (
    selected: Parameters<Provider["streamSimple"]>[0],
    context: Parameters<Provider["streamSimple"]>[1],
  ) => {
    prompts.push(context.systemPrompt ?? "");
    tools.push(context.tools?.map((tool) => tool.name) ?? []);
    const message: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: contentText(
            context.messages.findLast((item) => item.role === "user")?.content ?? "",
          ),
        },
      ],
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
    };
    const events = createAssistantMessageEventStream();
    events.push({ type: "done", reason: "stop", message });
    return events;
  };
  const provider: Provider = {
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  };
  models.setProvider(provider);
  const store = (name: string): SqliteStore => {
    const opened = new SqliteStore(join(cwd, name));
    stores.push(opened);
    return opened;
  };
  return { cwd, models, modelsStore, provider, prompts, tools, store };
}

test("chat answers a message without loading workspace tools or configuration", async () => {
  const f = await fixture();
  await mkdir(join(f.cwd, ".nyte"));
  await writeFile(join(f.cwd, ".nyte", "nyte.json"), "invalid manifest must not be read");
  const telemetry = new InMemoryTelemetryContext();
  const host = await createHost({
    store: f.store("sessions.db"),
    models: f.models,
    model,
    plugins: { kind: "chat", system: "Echo the user." },
    telemetry,
  });
  hosts.push(host);
  const session = await host.sessions.create();
  host.attach();
  await host.messages.send({ sessionId: session.sessionId, content: "hello host" });
  await host.runs.wait({ sessionId: session.sessionId });
  const snapshot = await host.sessions.snapshot({ sessionId: session.sessionId });
  assert.ok(snapshot);
  assert.equal((await host.runs.current({ sessionId: session.sessionId }))?.phase.kind, "done");
  assert.deepEqual(
    snapshot.transcript.flatMap((item) =>
      item.kind === "turn"
        ? item.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
        : [],
    ),
    ["hello host"],
  );
  assert.deepEqual(f.prompts, ["Echo the user."]);
  assert.deepEqual(f.tools, [["task", "create", "send", "await", "read", "stop"]]);
  assert.ok(telemetry.spans().some((span) => span.name === "nyte.respond"));
});

test.each(["openai", "openai-codex"])(
  "%s Astra gets the shared context policy in chat and workspace hosts",
  async (providerId) => {
    const f = await fixture();
    const astra: Model<Api> = {
      ...model,
      provider: providerId,
      id: "gpt-6-astra",
      contextWindow: 272_000,
    };
    const requests: Model<Api>[] = [];
    f.models.setProvider({
      ...f.provider,
      id: providerId,
      getModels: () => [astra],
      streamSimple(selected, context, options) {
        requests.push(selected);
        return f.provider.streamSimple(selected, context, options);
      },
    });
    for (const kind of ["chat", "workspace"] as const) {
      const host = await createHost({
        store: f.store(`${kind}.db`),
        models: f.models,
        model: astra,
        plugins: kind === "chat" ? { kind } : { kind, target: { kind: "home" } },
      });
      hosts.push(host);
      const session = await host.sessions.create({ name: "Astra context test" });
      host.attach();
      const first = requests.length;
      await host.messages.send({ sessionId: session.sessionId, content: "hello Astra" });
      await host.runs.wait({ sessionId: session.sessionId });
      assert.equal(requests[first]?.contextWindow, 1_000_000);
      assert.equal(
        (await host.runs.context({ sessionId: session.sessionId })).contextWindow,
        1_000_000,
      );
      assert.equal(f.models.getModel(providerId, astra.id)?.contextWindow, 272_000);
    }
  },
);

test("a provider/id restores its persisted catalog offline and splits only the first slash", async () => {
  const f = await fixture();
  await f.modelsStore.write(model.provider, { models: [model] });
  let catalog: readonly Model<Api>[] = [];
  const refreshes: boolean[] = [];
  f.models.setProvider({
    ...f.provider,
    getModels: () => catalog,
    async refreshModels(context) {
      refreshes.push(context.allowNetwork);
      await context.publish({
        update: () => {
          catalog = context.stored?.models ?? [];
        },
      });
    },
  });
  assert.deepEqual(await resolveModel(f.models, "echo/echo/model"), model);
  assert.deepEqual(refreshes, [false]);
  for (const ref of ["echo", "echo/missing", "/missing", "echo/"]) {
    await assert.rejects(resolveModel(f.models, ref), Error);
  }
});

test("deferred target caches only active composition", async () => {
  const f = await fixture();
  const workspace = await createWorkspaceStore().trust(f.cwd);
  let calls = 0;
  let active = false;
  const host = await createHost({
    store: f.store("lazy.db"),
    models: f.models,
    model,
    plugins: {
      kind: "workspace",
      target: {
        kind: "deferred",
        resolve: async () => {
          calls += 1;
          return active
            ? { kind: "project", workspace }
            : {
                kind: "requires",
                requirement: { kind: "workspace_trust", cwd: f.cwd },
              };
        },
      },
    },
  });
  hosts.push(host);
  const first = await host.sessions.create();
  const second = await host.sessions.create();
  assert.equal(first.activation.kind, "requires");
  assert.equal(second.activation.kind, "requires");
  assert.equal(calls, 2, "blocked results are not cached by the host");

  active = true;
  await host.reactivate();
  assert.equal(
    (await host.sessions.get({ sessionId: first.sessionId }))?.activation.kind,
    "active",
  );
  assert.equal(
    (await host.sessions.get({ sessionId: second.sessionId }))?.activation.kind,
    "active",
  );
  assert.equal(calls, 3, "one active composition serves every session");
});

test("deferred target returns requires without loading project code", async () => {
  const f = await fixture();
  let calls = 0;
  let failures = 0;
  const host = await createHost({
    store: f.store("retry.db"),
    models: f.models,
    model,
    plugins: {
      kind: "workspace",
      target: {
        kind: "deferred",
        resolve: async () => {
          calls += 1;
          return {
            kind: "requires",
            requirement: { kind: "workspace_trust", cwd: f.cwd },
          };
        },
      },
      onFailure: () => {
        failures += 1;
      },
    },
  });
  hosts.push(host);
  const session = await host.sessions.create();
  assert.equal(session.activation.kind, "requires");
  assert.deepEqual(await host.plugins.list({ sessionId: session.sessionId }), []);
  assert.equal(calls, 1);
  assert.equal(failures, 0);
});

test("plugin discovery failures stay on onFailure", async () => {
  const f = await fixture();
  const workspace = await createWorkspaceStore().trust(f.cwd);
  await mkdir(join(f.cwd, ".nyte", "plugins"), { recursive: true });
  await writeFile(
    join(f.cwd, ".nyte", "plugins", "broken.mjs"),
    'throw new Error("broken plugin");',
  );
  const failures: string[] = [];
  const host = await createHost({
    store: f.store("static.db"),
    models: f.models,
    model,
    plugins: {
      kind: "workspace",
      target: { kind: "project", workspace },
      onFailure: (failure) => failures.push(failure.error),
    },
  });
  hosts.push(host);
  assert.equal(failures.length, 1);
  assert.match(failures[0] ?? "", /broken plugin/);
});
