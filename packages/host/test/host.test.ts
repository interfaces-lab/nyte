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
import type { Nyte, SessionId } from "@nyte-ai/core";
import { inlinePlugin } from "@nyte-ai/core/plugins";
import { providerPlugin } from "@nyte-ai/plugin/provider";
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
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials, modelsStore });
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
  return { cwd, models, modelsStore, credentials, provider, prompts, tools, store };
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

async function answer(host: Nyte, id: SessionId, content: string): Promise<string | undefined> {
  await host.messages.send({ sessionId: id, content });
  await host.runs.wait({ sessionId: id });
  const turns = await host.messages.list({ sessionId: id });
  return turns
    .flatMap((turn) =>
      turn.kind === "turn"
        ? turn.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
        : [],
    )
    .at(-1);
}

test("provider overrides toggle per session, share credentials, and restore the default after removal", async () => {
  const f = await fixture();
  await f.credentials.modify(model.provider, async () => ({ type: "api_key", key: "stored-key" }));
  const keys: (string | undefined)[] = [];
  const replacement: Provider = {
    ...f.provider,
    auth: {
      apiKey: {
        name: "Override",
        resolve: async ({ credential }) => ({ auth: { apiKey: credential?.key } }),
      },
    },
    streamSimple(selected, context, options) {
      keys.push(options?.apiKey);
      return f.provider.streamSimple(
        selected,
        {
          ...context,
          messages: [{ role: "user", content: "override", timestamp: Date.now() }],
        },
        options,
      );
    },
  };
  const loaded = inlinePlugin(providerPlugin({ id: "echo-override", provider: replacement }));
  const store = f.store("provider-overrides.db");
  const options = {
    store,
    models: f.models,
    model,
    plugins: { kind: "custom", plugins: [loaded], env: { cwd: f.cwd } },
  } satisfies Parameters<typeof createHost>[0];
  const host = await createHost(options);
  hosts.push(host);
  const first = (await host.sessions.create()).sessionId;
  const second = (await host.sessions.create()).sessionId;
  host.attach();
  assert.equal(await answer(host, first, "native"), "override");
  assert.equal(keys[0], "stored-key");
  assert.deepEqual(
    await host.plugins.settings.apply({
      sessionId: first,
      id: "echo-override:enabled",
      choiceId: "off",
    }),
    { kind: "applied" },
  );
  assert.equal(await answer(host, first, "native"), "native");
  assert.equal(await answer(host, second, "native"), "override");
  await host.close();

  const reopened = await createHost(options);
  hosts.push(reopened);
  reopened.attach();
  assert.equal(await answer(reopened, first, "after restart"), "after restart");
  await reopened.plugins.commands.run({ sessionId: first, name: "echo-override", argument: "on" });
  assert.equal(await answer(reopened, first, "native"), "override");
  await reopened.setPlugins([], { sessionId: first });
  assert.equal(await answer(reopened, first, "removed"), "removed");
  assert.equal(await answer(reopened, second, "native"), "override");
  assert.equal(f.models.getProvider(model.provider), f.provider);
});

test("the last enabled provider plugin wins and override failures do not fall through to the default", async () => {
  const f = await fixture();
  const override = (id: string) =>
    inlinePlugin(
      providerPlugin({
        id,
        provider: {
          ...f.provider,
          streamSimple(selected, context, options) {
            if (id === "broken") throw new Error("override failed");
            return f.provider.streamSimple(
              selected,
              {
                ...context,
                messages: [{ role: "user", content: id, timestamp: Date.now() }],
              },
              options,
            );
          },
        },
      }),
    );
  const first = override("first");
  const last = override("last");
  const host = await createHost({
    store: f.store("provider-order.db"),
    models: f.models,
    model,
    plugins: { kind: "custom", plugins: [first, last], env: { cwd: f.cwd } },
  });
  hosts.push(host);
  const id = (await host.sessions.create()).sessionId;
  host.attach();
  assert.equal(await answer(host, id, "native"), "last");
  await host.plugins.commands.run({ sessionId: id, name: "last", argument: "off" });
  assert.equal(await answer(host, id, "native"), "first");
  await host.setPlugins([override("broken")]);
  const count = f.prompts.length;
  await host.messages.send({ sessionId: id, content: "fail" });
  await host.runs.wait({ sessionId: id });
  assert.equal((await host.runs.current({ sessionId: id }))?.phase.kind, "failed");
  assert.equal(f.prompts.length, count);
});

test("workspace discovery installs a provider plugin into the shared host without client wiring", async () => {
  const f = await fixture();
  const directory = join(f.cwd, ".nyte", "plugins");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "discovered.ts"),
    `
    import { createAssistantMessageEventStream } from ${JSON.stringify(new URL("../../ai/src/index.ts", import.meta.url).href)};
    import { providerPlugin } from ${JSON.stringify(new URL("../../plugin/src/provider.ts", import.meta.url).href)};
    const model = ${JSON.stringify(model)};
    const stream = () => {
      const events = createAssistantMessageEventStream();
      events.push({ type: "done", reason: "stop", message: {
        role: "assistant", content: [{ type: "text", text: "discovered provider" }],
        api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
      } });
      return events;
    };
    export default providerPlugin({ id: "discovered", provider: {
      id: model.provider, name: "Echo", getModels: () => [model], stream, streamSimple: stream,
      auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: {} }) } }
    } });
  `,
  );
  const workspace = await createWorkspaceStore().trust(f.cwd);
  const host = await createHost({
    store: f.store("discovered.db"),
    models: f.models,
    model,
    plugins: { kind: "workspace", target: { kind: "project", workspace } },
  });
  hosts.push(host);
  const id = (await host.sessions.create()).sessionId;
  host.attach();
  assert.equal(await answer(host, id, "native"), "discovered provider");
  assert.ok(
    (await host.plugins.settings.list({ sessionId: id })).some(
      (setting) => setting.id === "discovered:enabled",
    ),
  );
  await host.plugins.commands.run({ sessionId: id, name: "discovered", argument: "off" });
  assert.equal(await answer(host, id, "native"), "native");
});
