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

import { providerPlugin } from "@nyte-ai/plugin/provider";
import { SqliteStore } from "@nyte-ai/core/store";
import { getCurrentSystemPrompt, getCurrentTools } from "@nyte-ai/schema";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema";
import { InMemoryTelemetryContext } from "@nyte-ai/telemetry";
import {
  createHost,
  createWorkspaceStore,
  resolveHostPlugins,
  resolveModel,
  WorkspaceStore,
} from "../src/index.ts";

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
    prompts.push(getCurrentSystemPrompt(context.messages));
    tools.push(getCurrentTools(context.messages).map((tool) => tool.name));
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

test("global idle mode refreshes a settled request; project settings cannot enable warming", async () => {
  const f = await fixture();
  const cachedModel: Model<Api> = {
    ...model,
    promptCache: { short: 10.2 },
    contextWindow: 1_000_000,
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  };
  const warmed = Promise.withResolvers<void>();
  const warmRequests: string[] = [];
  f.models.setProvider({
    ...f.provider,
    getModels: () => [cachedModel],
    streamSimple(selected, _context, options) {
      const warming = options?.maxTokens === 1;
      if (warming) {
        warmRequests.push(options?.sessionId ?? "");
        warmed.resolve();
      }
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text: warming ? "discarded" : "answered" }],
          api: selected.api,
          provider: selected.provider,
          model: selected.id,
          stopReason: "stop",
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 1,
            cacheRead: 200_000,
            cacheWrite: 0,
            totalTokens: 200_001,
            cost: { input: 0, output: 0.000025, cacheRead: 0.1, cacheWrite: 0, total: 0.100025 },
          },
        },
      });
      return stream;
    },
  });
  await mkdir(join(f.cwd, ".nyte"));
  await mkdir(join(f.cwd, "home"));
  const opened: { host: Nyte; id: SessionId }[] = [];
  for (const mode of [undefined, "off", "idle"] as const) {
    await writeFile(
      join(f.cwd, ".nyte", "settings.json"),
      JSON.stringify({ cacheWarming: mode === "idle" ? "off" : "idle" }),
    );
    if (mode !== undefined)
      await writeFile(join(f.cwd, "home", "settings.json"), JSON.stringify({ cacheWarming: mode }));
    const host = await createHost({
      store: f.store(`${mode ?? "default"}.db`),
      models: f.models,
      model: cachedModel,
      plugins: { kind: "custom", plugins: [], env: { cwd: f.cwd } },
    });
    hosts.push(host);
    const { sessionId: id } = await host.sessions.create();
    host.attach();
    assert.equal(await answer(host, id, "hello"), "answered");
    opened.push({ host, id });
  }
  const enabled = opened.at(-1);
  assert.ok(enabled);
  await warmed.promise;
  assert.deepEqual(warmRequests, [enabled.id]);
  for (const { host, id } of opened) {
    const messages = await host.messages.list({ sessionId: id });
    assert.equal(JSON.stringify(messages).includes("discarded"), false);
  }
});

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

test("plugin discovery failures report onFailure and reject partial activation", async () => {
  const f = await fixture();
  const workspace = await createWorkspaceStore().trust(f.cwd);
  await mkdir(join(f.cwd, ".nyte", "plugins", "broken"), { recursive: true });
  await writeFile(
    join(f.cwd, ".nyte", "plugins", "broken", "index.ts"),
    'throw new Error("broken plugin");',
  );
  const failures: string[] = [];
  await assert.rejects(
    createHost({
      store: f.store("static.db"),
      models: f.models,
      model,
      plugins: {
        kind: "workspace",
        target: { kind: "project", workspace },
        onFailure: (failure) => failures.push(failure.error),
      },
    }),
    /broken plugin/,
  );
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
  const loaded = providerPlugin({ id: "echo-override", provider: replacement });
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
  const compacted = await host.runs.compact({ sessionId: second });
  assert.equal(compacted.kind, "compacted");
  const compactedHistory = await host.messages.list({ sessionId: second });
  const checkpoint = compactedHistory.findLast((item) => item.kind === "checkpoint");
  assert.ok(checkpoint?.kind === "checkpoint");
  assert.equal(checkpoint.body.summary, "override");
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
    });
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
  const directory = join(f.cwd, ".nyte", "plugins", "discovered");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "index.ts"),
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

test("context activation uses its fingerprinted snapshot and reloads in the same session", async () => {
  const f = await fixture();
  const context = join(f.cwd, "AGENTS.md");
  await writeFile(context, "original context snapshot");
  const workspace = await createWorkspaceStore().trust(f.cwd);
  const target = { kind: "project", workspace } as const;
  const prepared = await resolveHostPlugins(target, { models: f.models, model });
  await writeFile(context, "updated context snapshot");
  const host = await createHost({
    store: f.store("context.db"),
    models: f.models,
    model,
    plugins: { kind: "custom", plugins: prepared.plugins, env: { cwd: f.cwd } },
  });
  hosts.push(host);
  const id = (await host.sessions.create()).sessionId;
  host.attach();
  await answer(host, id, "first");
  assert.match(f.prompts.at(-1) ?? "", /original context snapshot/);
  assert.doesNotMatch(f.prompts.at(-1) ?? "", /updated context snapshot/);
  const next = await resolveHostPlugins(target, { models: f.models, model });
  await host.setPlugins(next.plugins);
  await answer(host, id, "second");
  assert.match(f.prompts.at(-1) ?? "", /updated context snapshot/);
  await mkdir(join(f.cwd, "home"), { recursive: true });
  await writeFile(join(f.cwd, "home", "nyte.json"), "{");
  await assert.rejects(resolveHostPlugins(target, { models: f.models, model }), /nyte.json/);
  await answer(host, id, "third");
  assert.match(f.prompts.at(-1) ?? "", /updated context snapshot/);
});

function toolPluginSource(id: string, name: string): string {
  return `export default { id: ${JSON.stringify(id)}, session(api) {
    api.tools.add((draft) => draft.set(${JSON.stringify(name)}, {
      name: ${JSON.stringify(name)}, label: ${JSON.stringify(name)}, description: "A fresh filesystem plugin tool",
      parameters: { type: "object", properties: {} }, replay: "safe",
      async execute() { return { content: [{ type: "text", text: "fresh" }], details: {} }; },
    }));
  } };`;
}

test("a plugin written by a real tool reaches the immediate next provider request without a watcher", async () => {
  const f = await fixture();
  const workspace = await createWorkspaceStore().trust(f.cwd);
  const requests: string[][] = [];
  const path = join(f.cwd, ".nyte", "plugins", "fresh", "index.ts");
  let written = false;
  const stream: Provider["streamSimple"] = (selected, context, options) => {
    const tools = getCurrentTools(context.messages);
    if (!tools.some((tool) => tool.name === "write"))
      return f.provider.streamSimple(selected, context, options);
    requests.push(tools.map((tool) => tool.name));
    if (written) return f.provider.streamSimple(selected, context, options);
    written = true;
    const message: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "write-plugin",
          name: "write",
          arguments: {
            path,
            content: toolPluginSource("fresh", "fresh_tool"),
          },
        },
      ],
      api: selected.api,
      provider: selected.provider,
      model: selected.id,
      stopReason: "toolUse",
      timestamp: Date.now(),
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const events = createAssistantMessageEventStream();
    events.push({ type: "done", reason: "toolUse", message });
    return events;
  };
  f.models.setProvider({ ...f.provider, streamSimple: stream });
  const host = await createHost({
    store: f.store("response-freshness.db"),
    models: f.models,
    model,
    plugins: { kind: "workspace", target: { kind: "project", workspace } },
  });
  hosts.push(host);
  const id = (await host.sessions.create()).sessionId;
  host.attach();
  await answer(host, id, "create a plugin");
  assert.equal(requests.length, 2);
  assert.ok(!requests[0]?.includes("fresh_tool"));
  assert.ok(requests[1]?.includes("fresh_tool"));
  assert.ok((await host.plugins.list({ sessionId: id })).some((plugin) => plugin.id === "fresh"));
});

test("response preparation follows a relocated session's explicit trust grant rather than the host directory", async () => {
  const f = await fixture();
  const workspace = await createWorkspaceStore().trust(f.cwd);
  const destination = await realpath(await mkdtemp(join(tmpdir(), "nyte-host-relocated-plugins-")));
  directories.push(destination);
  const grant = await new WorkspaceStore(join(f.cwd, "separate-grants.json")).trust(destination);
  assert.equal((await createWorkspaceStore().resolve(destination)).kind, "unknown");
  const host = await createHost({
    store: f.store("relocated-plugins.db"),
    models: f.models,
    model,
    plugins: { kind: "workspace", target: { kind: "project", workspace } },
  });
  hosts.push(host);
  const id = (await host.sessions.create()).sessionId;
  const target = { kind: "project", workspace: grant } as const;
  const prepared = await resolveHostPlugins(target, { models: f.models, model });
  assert.equal(
    (await host.relocate({ sessionId: id, workspace: grant, plugins: prepared.plugins })).kind,
    "relocated",
  );
  for (const [cwd, name] of [
    [f.cwd, "original"],
    [destination, "destination"],
  ]) {
    const unit = join(cwd, ".nyte", "plugins", name);
    await mkdir(unit, { recursive: true });
    await writeFile(join(unit, "index.ts"), toolPluginSource(name, `${name}_tool`));
  }
  host.attach();
  await answer(host, id, "use the relocated plugin");
  assert.ok(f.tools.at(-1)?.includes("destination_tool"));
  assert.ok(!f.tools.at(-1)?.includes("original_tool"));
});
