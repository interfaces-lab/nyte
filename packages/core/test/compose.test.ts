import { asId, SdkError, standard } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import { hostIdentity } from "../src/compose.ts";
import { definePart, isPart, text } from "../src/index.ts";
import { decodePartRecord, partRef, hostIdentityRef, memoryStore, runRef } from "../src/store.ts";
import type { Plugin, PluginApi, ToolDefinition } from "../src/index.ts";
import { chatOnly, composed, fakeModels, open } from "./fake-models.ts";
import { label, until } from "./harness.ts";

const echo: ToolDefinition<{ readonly text: string }> = {
  name: "echo",
  description: "Echo the text.",
  parameters: standard(Type.Object({ text: Type.String() })),
  class: () => ({ kind: "custom", label: "Echoing" }),
  replay: "safe",
  execute: async (args) => ({ content: [{ kind: "text", text: `echo: ${args.text}` }] }),
};

const echoing: Plugin<"core"> = { id: "echoing", contribute: { tools: [echo] } };

const ask = definePart({
  kind: "test/ask",
  state: standard(Type.Object({ prompt: Type.String() })),
  actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
  fallback: (state, { id }) => `Ask ${id}: ${state.prompt}`,
});

describe("composeHost", () => {
  it("takes a modal answer a cold host gave before the run parked from the part record, which keeps it (§48i, ADV B N2)", async () => {
    const store = memoryStore();
    const fake = fakeModels();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const asking: ToolDefinition<{ readonly prompt: string }> = {
      name: "ask",
      description: "Ask the user.",
      parameters: standard(Type.Object({ prompt: Type.String() })),
      class: () => ({ kind: "custom", label: "Asking" }),
      replay: "safe",
      async execute(args, invocation) {
        const part = await invocation.session.parts.create(ask, {
          state: args,
          placement: { kind: "modal" },
        });
        await gate;
        const outcome = await invocation.wait({ kind: "part", part: part.id });
        const input = outcome.kind === "part" ? outcome.answer?.input : null;
        const choice =
          typeof input === "object" && input !== null && "choice" in input
            ? String(input.choice)
            : "none";

        return { content: [{ kind: "text", text: choice }] };
      },
    };

    const plugin: Plugin<"core"> = { id: "asker", contribute: { parts: [ask], tools: [asking] } };

    fake.reply(
      { content: [{ type: "toolCall", id: "q", name: "ask", arguments: { prompt: "Ship?" } }] },
      { content: [{ type: "text", text: "Shipping." }] },
    );

    await using warm = await open(fake, { store, plugins: [plugin] });
    const session = await warm.sessions.create();
    const receipt = await session.send("Ask.");
    const asked = await until(async () =>
      (await session.view()).parts.find((part) => part.partKind === ask.kind),
    );

    await using cold = await open(fakeModels(), {
      store,
      plugins: [plugin],
      execution: { kind: "admit-only" },
    });

    expect(await cold.session(session.id).part(asked.id).act("answer", { choice: "yes" })).toEqual({
      kind: "ok",
      output: undefined,
    });

    const connection = await store.open();
    const kept = decodePartRecord(
      await connection.objects.get(
        (await connection.refs.get(partRef(session.id, asked.id)))?.target ?? asId("none"),
      ),
    );

    expect(kept?.status).toMatchObject({
      kind: "live",
      answer: { action: "answer", input: { choice: "yes" } },
    });

    release();
    const end = await receipt.settled();

    assert(end.kind === "completed");
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]?.context.messages.at(-1)).toMatchObject({
      role: "toolResult",
      content: [{ type: "text", text: "yes" }],
    });

    const after = decodePartRecord(
      await connection.objects.get(
        (await connection.refs.get(partRef(session.id, asked.id)))?.target ?? asId("none"),
      ),
    );

    expect(after?.status).toEqual(kept?.status);
  });

  it("resolves a fresh session's effective configuration at creation, with nothing selected (§48c)", async () => {
    await using host = await open(fakeModels());
    const session = await host.sessions.create();

    expect((await session.view()).configuration).toEqual({
      selected: null,
      effective: expect.objectContaining({
        kind: "exact",
        model: { provider: "test", id: "model" },
        agent: null,
      }),
    });
  });

  it("runs a send end to end: create, send, settled", async () => {
    const fake = fakeModels();
    fake.reply({
      content: [{ type: "text", text: "Hello there." }],
      usage: { input: 12, output: 3 },
    });
    await using host = await open(fake);
    const session = await host.sessions.create();
    const receipt = await session.send("Hi.");
    const end = await receipt.settled();

    assert(end.kind === "completed");
    expect(end.usage).toMatchObject({ input: 12, output: 3, total: 15 });
    expect(end.usage.cost.total).toBeCloseTo((12 * 1 + 3 * 2) / 1_000_000);

    const view = await session.view();

    expect(view.messages.map((message) => message.kind)).toEqual(["user", "part"]);
    expect(view.messages[1]).toMatchObject({
      kind: "part",
      partKind: "text",
      role: "answer",
      state: { markdown: "Hello there.", signature: null },
      status: { kind: "settled" },
    });
    expect(view.execution).toMatchObject({ kind: "idle", lastRun: { end: { kind: "completed" } } });
    expect(view.context).toMatchObject({ tokens: 15, window: 100_000 });
    expect(view.configuration.selected).toBeNull();
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].options?.sessionId).toBe(session.id);
  });

  it("keeps host/identity across opens of one store", async () => {
    const store = memoryStore();
    const first = await open(fakeModels(), { store });
    const id = first.hostId;
    await first.close();
    const second = await open(fakeModels(), { store });

    expect(second.hostId).toBe(id);
    await second.close();

    const connection = await store.open();

    expect(await hostIdentity(connection)).toMatchObject({ id });
    expect(await connection.refs.list(hostIdentityRef())).toHaveLength(1);
  });

  it("loads the built-ins first, in decision 13's order, then the host's plugins", async () => {
    await using host = await open(fakeModels(), { plugins: [{ id: "extra" }] });
    const session = await host.sessions.create();

    expect(
      host.kernel.plugins
        .runtime(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toEqual(["system-prompt", "environment", "resources", "delegation", "chat-only", "extra"]);
    expect(host.kernel.sessions.activation(session.id)).toEqual({ kind: "active" });
  });

  it("serves the host view: plugins and settings", async () => {
    await using host = await open(fakeModels());
    await host.sessions.create();
    const iterator = host.watch()[Symbol.asyncIterator]();
    const first = await iterator.next();
    await iterator.return?.();

    assert(first.done !== true);
    const view = first.value;

    expect(view.id).toBe(host.hostId);
    expect(view.settings.map((setting) => setting.id)).toContain("skills.paths");
    expect(view.plugins.map((plugin) => [plugin.id, plugin.source])).toEqual(
      expect.arrayContaining([
        ["system-prompt", "builtin"],
        ["delegation", "builtin"],
        ["chat-only", "inline"],
      ]),
    );
  });

  it("seeds HostView.plugins at open and merges the runtimes' live issues later", async () => {
    let api: PluginApi<"core"> | undefined;

    const reporter: Plugin<"core"> = {
      id: "reporter",
      activate(given) {
        api = given;
      },
    };

    await using host = await open(fakeModels(), { plugins: [reporter] });
    const views = host.watch()[Symbol.asyncIterator]();
    const first = await views.next();
    await views.return?.();

    const seeded = [
      ...["system-prompt", "environment", "resources", "delegation"].map((id) => ({
        id,
        source: "builtin",
        path: null,
        issues: [],
      })),
      { id: "chat-only", source: "inline", path: null, issues: [] },
      { id: "reporter", source: "inline", path: null, issues: [] },
    ];

    assert(first.done !== true);
    expect(first.value.plugins).toEqual(seeded);

    await host.sessions.create();
    assert(api !== undefined);
    api.report({ severity: "warning", path: ["server"], message: "Server went away." });

    const rows = host.kernel.host.current().plugins;

    expect(rows.map((row) => [row.id, row.source])).toEqual(
      seeded.map((row) => [row.id, row.source]),
    );
    expect(rows.find((row) => row.id === "reporter")?.issues).toEqual([
      {
        severity: "warning",
        path: ["server"],
        message: "Server went away.",
        source: { plugin: "reporter" },
      },
    ]);
  });

  it("releases its leases and plugins on close", async () => {
    const store = memoryStore();
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Done." }] });
    const host = await open(fake, { store });
    const session = await host.sessions.create();
    await (await session.send("Go.")).settled();
    const connection = await store.open();

    expect(await connection.refs.list(`sessions/${session.id}/leases/`)).toHaveLength(1);
    await host.close();

    expect(await connection.refs.list(`sessions/${session.id}/leases/`)).toHaveLength(0);
    expect(host.kernel.plugins.runtimes().size).toBe(0);
    await host.close();
  });

  it("closes without waiting on a turn whose stream never ends; the next open resumes the run", async () => {
    const store = memoryStore();
    const first = fakeModels();

    first.reply(
      {
        content: [{ type: "toolCall", id: "call-echo", name: "echo", arguments: { text: "x" } }],
        usage: { input: 100, output: 10 },
      },
      { content: [{ type: "text", text: "Never finishes" }], stall: true },
    );

    const host = await open(first, { store, plugins: [echoing] });
    const session = await host.sessions.create();
    const receipt = await session.send("Go.");

    const run = await until(async () => {
      const execution = (await session.view()).execution;

      return first.requests.length === 2 && execution.kind === "live"
        ? execution.run.id
        : undefined;
    });

    const closed = host.close().then(() => "closed");

    expect(
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 0, "late"))]),
    ).toBe("closed");
    expect(await (await store.open()).refs.get(runRef(session.id, run))).not.toBeNull();

    const second = fakeModels();
    second.reply({
      content: [{ type: "text", text: "Done after all." }],
      usage: { input: 50, output: 5 },
    });
    await using reopened = await open(second, { store, plugins: [echoing] });
    const end = await reopened.session(session.id).run(run).settled();

    assert(end.kind === "completed");
    expect(end.usage).toMatchObject({ input: 150, output: 15, total: 165 });
    expect(await reopened.session(session.id).receipt(receipt.id).settled()).toEqual(end);
    expect(second.requests).toHaveLength(1);

    const view = await reopened.session(session.id).view();
    const answer = view.messages.at(-1);

    assert(answer !== undefined && isPart(answer, text));
    expect(answer).toMatchObject({ id: `${run}:a2:0`, state: { markdown: "Done after all." } });
    expect(view.execution).toMatchObject({ kind: "idle", lastRun: { id: run } });
  });

  it("leaves a run its close aborted live in the store, ending nothing", async () => {
    const store = memoryStore();
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Half an answer" }], hold: true });
    const host = await open(fake, { store });
    const session = await host.sessions.create();
    const logged: string[] = [];

    host.kernel.bus.subscribe(session.id, (event) => {
      if (event.kind !== "patch") logged.push(label(event));
    });

    await session.send("Go.");

    const run = await until(async () => {
      const execution = (await session.view()).execution;

      return fake.requests.length === 1 && execution.kind === "live" ? execution.run.id : undefined;
    });

    await host.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fake.requests[0].options?.signal?.aborted).toBe(true);
    expect(logged).not.toContain("run:ended");
    expect(logged).not.toContain("part:failed");
    expect(await (await store.open()).refs.get(runRef(session.id, run))).not.toBeNull();
  });

  it("refuses plugins the preflight rejects and a workspace no provider serves", async () => {
    const fake = fakeModels();

    await expect(open(fake, { plugins: [{ id: "twin" }, { id: "twin" }] })).rejects.toMatchObject({
      code: "invalid",
    });

    const refused = composed({
      store: memoryStore(),
      models: fake.models,
      plugins: [chatOnly],
      workspace: { kind: "elsewhere", locator: null },
      home: null,
      description: { name: "test", platform: "darwin", version: "0.1.0" },
    });

    await expect(refused).rejects.toBeInstanceOf(SdkError);
    await expect(refused).rejects.toMatchObject({ code: "unavailable" });
  });

  it("seeds settings once: a stored value wins, an unknown id or invalid value is reported with the file's path", async () => {
    const store = memoryStore();

    const looks: Plugin<"core"> = {
      id: "looks",
      contribute: {
        settings: [
          {
            id: "theme",
            label: "Theme",
            schema: standard(Type.Union([Type.Literal("light"), Type.Literal("dark")])),
            default: "light",
            scope: "host",
          },
          {
            id: "size",
            label: "Size",
            schema: standard(Type.Integer()),
            default: 1,
            scope: "host",
          },
          {
            id: "tone",
            label: "Tone",
            schema: standard(Type.String()),
            default: "plain",
            scope: "session",
          },
        ],
      },
    };

    const seeded = (settings: Record<string, Json>) =>
      composed({
        store,
        models: fakeModels().models,
        plugins: [chatOnly, looks],
        workspace: { kind: "chat-only", locator: null },
        home: null,
        description: { name: "test", platform: "darwin", version: "0.1.0" },
        seed: { settings, path: "/home/.nyte/settings.json" },
      });

    const first = await seeded({ theme: "dark", size: "big", nope: 1, tone: "warm" });
    const value = (id: string) =>
      first.kernel.host.current().settings.find((setting) => setting.id === id)?.value;

    expect([value("theme"), value("size")]).toEqual(["dark", 1]);
    expect(first.kernel.host.current().plugins.find((row) => row.id === "settings")).toEqual({
      id: "settings",
      source: "user",
      path: "/home/.nyte/settings.json",
      issues: [
        expect.objectContaining({ severity: "warning", path: ["size"] }),
        expect.objectContaining({ severity: "warning", path: ["nope"] }),
        expect.objectContaining({
          severity: "warning",
          path: ["tone"],
          message: expect.stringContaining("session-scope"),
        }),
      ],
    });
    expect(await first.settings.apply("theme", "light")).toEqual({ kind: "applied" });
    await first.close();

    await using second = await seeded({ theme: "dark" });

    expect(
      second.kernel.host.current().settings.find((setting) => setting.id === "theme")?.value,
    ).toBe("light");
    expect(second.kernel.host.current().plugins.some((row) => row.id === "settings")).toBe(false);
  });

  it("drops and reports a rejected plugin that came from a file; an inline one still fails the open", async () => {
    const bad: Plugin<"core"> = { id: "models" };
    const good: Plugin<"core"> = { id: "good" };

    const compose = (sources: Map<Plugin<"core">, { source: "user"; path: string }>) =>
      composed({
        store: memoryStore(),
        models: fakeModels().models,
        plugins: [chatOnly, bad, good],
        workspace: { kind: "chat-only", locator: null },
        home: null,
        description: { name: "test", platform: "darwin", version: "0.1.0" },
        pluginSources: sources,
      });

    await using host = await compose(
      new Map([
        [bad, { source: "user", path: "/home/.nyte/plugins/bad.ts" }],
        [good, { source: "user", path: "/home/.nyte/plugins/good.ts" }],
      ]),
    );
    const rows = host.kernel.host.current().plugins;

    expect(host.kernel.plugins.host.map((plugin) => plugin.id)).toEqual(["chat-only", "good"]);
    expect(rows.find((row) => row.id === "good")).toMatchObject({
      source: "user",
      path: "/home/.nyte/plugins/good.ts",
    });
    expect(rows.find((row) => row.id === "/home/.nyte/plugins/bad.ts")).toEqual({
      id: "/home/.nyte/plugins/bad.ts",
      source: "user",
      path: "/home/.nyte/plugins/bad.ts",
      issues: [expect.objectContaining({ severity: "error", path: ["id"] })],
    });

    await host.sessions.create();

    expect(
      host.kernel.host.current().plugins.some((row) => row.id === "/home/.nyte/plugins/bad.ts"),
    ).toBe(true);
    await expect(compose(new Map())).rejects.toMatchObject({ code: "invalid" });
  });

  it("checks plugin objects and files alike in-process, each file through loadPlugins in order (§47l)", async () => {
    const loaded: string[] = [];

    await using host = await composed({
      store: memoryStore(),
      models: fakeModels().models,
      plugins: [chatOnly],
      workspace: { kind: "chat-only", locator: null },
      home: null,
      description: { name: "test", platform: "darwin", version: "0.1.0" },
      loadPlugins: async (paths) => {
        loaded.push(...paths);

        return paths.map((path) => ({ id: `file:${path}` }));
      },
    });

    const report = await host.plugins.check([{ path: "a.ts" }, { id: "inline" }, { path: "b.ts" }]);

    expect(loaded).toEqual(["a.ts", "b.ts"]);
    expect(report.plugins.map((outcome) => outcome.id)).toEqual([
      "file:a.ts",
      "inline",
      "file:b.ts",
    ]);
    await using other = await open(fakeModels());

    await expect(other.plugins.check([{ path: "c.ts" }])).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("registers the workspace once and makes it the default", async () => {
    const store = memoryStore();
    const first = await open(fakeModels(), { store });
    const workspace = first.kernel.defaultWorkspace;
    await first.close();
    await using second = await open(fakeModels(), { store });

    expect(workspace).not.toBeNull();
    expect(second.kernel.defaultWorkspace).toBe(workspace);
    expect(await second.workspaces.list()).toMatchObject([
      { id: workspace, addedBy: "local", projectResources: null },
    ]);
  });
});
