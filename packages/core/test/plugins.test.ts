import { asId, asSeq, catalogRowKey, SdkError } from "@nyte-ai/schema";
import type { SessionCatalogView } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { systemPromptPlugin } from "../src/builtins/system-prompt.ts";
import { toolSource } from "../src/extend/registry.ts";
import { LOCAL, text } from "../src/index.ts";
import type { Command, Plugin, PluginApi } from "../src/index.ts";
import { attachSession } from "../src/api/session-attachment.ts";
import { main, setup, until } from "../src/harness.ts";
import { memoryStore } from "../src/store.ts";
import { world } from "./fake-env.ts";
import { ok, echo, opaque, volume, says, provider, loaded } from "./plugin-support.ts";
import { fakeModels, open } from "./fake-models.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("plugin runtime", () => {
  it("loads in order: activated, a duplicate id rejected twice, a second environment kind and a schema without JSON Schema rejected, a throwing activate rolled back", async () => {
    let deactivated: AbortSignal | undefined;

    const broken: Plugin<"core"> = {
      id: "broken",
      hooks: {
        after_tool: () => {
          throw new Error("Still registered.");
        },
      },
      activate(api) {
        deactivated = api.signal;

        throw new Error("No config.");
      },
    };

    const { kernel, session, runtime } = await loaded([]);

    const outcomes = await runtime.load(
      [
        { id: "tools", contribute: { tools: [echo] }, environment: provider("local") },
        { id: "twin" },
        { id: "twin" },
        { id: "sandbox", environment: provider("local") },
        broken,
      ],
      null,
    );

    expect(outcomes.map((outcome) => [outcome.id, outcome.kind])).toEqual([
      ["tools", "activated"],
      ["twin", "rejected"],
      ["twin", "rejected"],
      ["sandbox", "rejected"],
      ["broken", "rejected"],
    ]);
    expect(outcomes[3]?.issues).toEqual([
      {
        severity: "error",
        path: ["environment"],
        message: "Another plugin provides the local environment.",
        source: { plugin: "sandbox" },
      },
    ]);
    expect(outcomes[4]?.issues).toEqual([
      {
        severity: "error",
        path: ["activate"],
        message: "Activation failed: No config.",
        source: { plugin: "broken" },
      },
    ]);
    expect(deactivated?.aborted).toBe(true);
    expect(runtime.api("broken")).toBeUndefined();
    expect(
      toolSource(kernel.plugins.runtime(session.id))
        .list()
        .map((tool) => tool.name),
    ).toEqual(["echo"]);
    expect(
      await runtime.hooks.transform("after_tool", ok, {
        session: session.id,
        head: main,
        run: null,
        principal: LOCAL,
      }),
    ).toEqual(ok);
    expect(kernel.host.current().plugins.map((row) => [row.id, row.issues.length])).toEqual([
      ["test-environment", 0],
      ["tools", 0],
      ["twin", 2],
      ["sandbox", 1],
      ["broken", 1],
    ]);
  });

  it("replaces by id in a new runtime: a new version activates, a failing one keeps the previous running without activating it again, an absent one deactivates", async () => {
    let first: AbortSignal | undefined;
    let gone: AbortSignal | undefined;
    let starts = 0;

    const { kernel, host, session } = await loaded([
      {
        id: "greeter",
        contribute: { commands: [says("hello", "v1")] },
        activate(api) {
          first = api.signal;

          return {};
        },
      },
      {
        id: "gone",
        activate(api) {
          gone = api.signal;

          return {};
        },
      },
    ]);

    const v2: Plugin<"core"> = {
      id: "greeter",
      contribute: { commands: [says("hello", "v2")] },
      activate() {
        starts += 1;

        return {};
      },
    };

    const replaced = await host.plugins.replace([v2], { session: session.id });

    expect(replaced.plugins).toEqual([{ kind: "activated", id: "greeter", issues: [] }]);
    expect(replaced.generation).toBe(kernel.host.current().catalog);
    expect([first?.aborted, gone?.aborted]).toEqual([true, true]);
    expect(await session.command("hello", "")).toEqual({ kind: "ran", output: "v2" });

    const failing = await host.plugins.replace(
      [
        {
          id: "greeter",
          activate() {
            throw new Error("Broken build.");
          },
        },
      ],
      { session: session.id },
    );

    expect(failing.plugins).toEqual([
      {
        kind: "kept-previous",
        id: "greeter",
        issues: [expect.objectContaining({ message: "Activation failed: Broken build." })],
      },
    ]);
    expect(await session.command("hello", "")).toEqual({ kind: "ran", output: "v2" });
    expect(starts).toBe(1);

    const unparsable = await host.plugins.replace(
      [{ id: "greeter", contribute: { tools: [{ ...echo, parameters: opaque }] } }],
      { session: session.id },
    );

    expect(unparsable.plugins.map((outcome) => outcome.kind)).toEqual(["kept-previous"]);
    expect(starts).toBe(1);
    expect(await session.command("hello", "")).toEqual({ kind: "ran", output: "v2" });

    const fresh = await host.plugins.replace(
      [{ id: "new", activate: () => Promise.reject(new Error("No.")) }],
      {
        session: session.id,
      },
    );

    expect(fresh.plugins.map((outcome) => outcome.kind)).toEqual(["rejected"]);
    expect(await session.command("hello", "")).toEqual({ kind: "unknown" });
  });

  it("replaces host-wide: every live session and the plugins new sessions load", async () => {
    const { kernel, host, session } = await loaded([
      { id: "greeter", contribute: { commands: [says("hello", "v1")] } },
    ]);

    const report = await host.plugins.replace([
      { id: "greeter", contribute: { commands: [says("hello", "v2")] } },
    ]);

    expect(report.plugins).toEqual([{ kind: "activated", id: "greeter", issues: [] }]);
    expect(await session.command("hello", "")).toEqual({ kind: "ran", output: "v2" });

    const { session: later } = await host.sessions.start({ content: "Hi." });

    expect(await later.command("hello", "")).toEqual({ kind: "ran", output: "v2" });
    expect(kernel.plugins.host.map((plugin) => plugin.id)).toEqual(["greeter"]);
  });

  it("checks without loading: outcomes and the collisions between plugins", async () => {
    const { kernel, host } = await setup();

    const report = await host.plugins.check([
      { id: "a", contribute: { tools: [echo], settings: [volume] } },
      { id: "b", contribute: { tools: [echo], parts: [text] } },
      { id: "c", contribute: { settings: [{ ...volume, schema: opaque }] } },
    ]);

    expect(report.plugins).toEqual([
      { kind: "activated", id: "a", issues: [] },
      { kind: "activated", id: "b", issues: [] },
      {
        kind: "rejected",
        id: "c",
        issues: [expect.objectContaining({ severity: "error", path: ["settings", "volume"] })],
      },
    ]);
    expect(report.collisions).toEqual([
      {
        severity: "warning",
        path: ["tools", "echo"],
        message: "echo from b collides with the one from a.",
        source: { plugin: "b" },
      },
      {
        severity: "warning",
        path: ["parts", "text"],
        message: "text is a built-in part kind; b's definition is ignored.",
        source: { plugin: "b" },
      },
      {
        severity: "warning",
        path: ["settings", "volume"],
        message: "volume from c collides with the one from a.",
        source: { plugin: "c" },
      },
    ]);
    expect(kernel.plugins.runtimes().size).toBe(0);
    expect(kernel.host.current().plugins).toEqual([]);
  });

  it("rejects the reserved plugin ids models and settings", async () => {
    const { host } = await setup();
    const report = await host.plugins.check([{ id: "models" }, { id: "settings" }, { id: "ok" }]);

    expect(report.plugins.map((outcome) => [outcome.kind, outcome.id])).toEqual([
      ["rejected", "models"],
      ["rejected", "settings"],
      ["activated", "ok"],
    ]);
    expect(report.plugins[0].issues).toEqual([
      expect.objectContaining({ severity: "error", path: ["id"] }),
    ]);
  });

  it("closes a removed session's plugins and forgets its runtime", async () => {
    let signal: AbortSignal | undefined;

    const { kernel, session } = await loaded([
      {
        id: "keeper",
        activate(api) {
          signal = api.signal;

          return {};
        },
      },
    ]);

    expect(await session.remove()).toEqual({ kind: "removed" });
    expect(signal?.aborted).toBe(true);
    expect(kernel.plugins.runtimes().has(session.id)).toBe(false);
  });

  it("rejects a plugin whose activate returns nothing, and says what to return", async () => {
    const { runtime } = await loaded([{ id: "untyped", activate: () => JSON.parse("null") }]);

    expect(runtime.outcomes().find((outcome) => outcome.id === "untyped")).toMatchObject({
      kind: "rejected",
      issues: [
        {
          message:
            "Activation failed: activate returned nothing. Return what the plugin adds, or {} for nothing.",
        },
      ],
    });
  });

  it("keeps an item only while its when is true: by the chat's parent, by a setting as it changes, and never when it throws", async () => {
    const gated: Plugin<"core"> = {
      id: "gated",
      contribute: {
        settings: [
          { id: "gated.on", title: "On", type: "switch" },
          {
            id: "gated.key",
            title: "Key",
            type: "text",
            when: (chat) => chat.settings["gated.on"] === true,
          },
        ],
        tools: [
          { ...echo, name: "by-setting", when: (chat) => chat.settings["gated.on"] === true },
          { ...echo, name: "top-level", when: (chat) => chat.parent === null },
          { ...echo, name: "child-only", when: (chat) => chat.parent !== null },
          {
            ...echo,
            name: "broken",
            when: () => {
              throw new Error("No.");
            },
          },
        ],
        commands: [{ ...says("never", "x"), when: () => false }],
        prompt: [{ id: "hidden", text: "Hidden.", when: () => false }],
      },
    };

    const { kernel, host, runtime } = await loaded([gated]);
    const tools = () => runtime.registries.tools.list().map((tool) => tool.name);
    const settings = () => runtime.registries.settings.list().map((setting) => setting.id);

    expect(tools()).toEqual(["top-level"]);
    expect(settings()).toEqual(["gated.on"]);
    expect(runtime.registries.commands.list()).toEqual([]);
    expect(runtime.registries.prompt.list().map((section) => section.id)).not.toContain("hidden");
    expect(kernel.host.current().plugins.find((row) => row.id === "gated")?.issues).toMatchObject([
      { path: ["tools", "broken", "when"], message: "when failed, so broken is left out: No." },
    ]);

    expect(await host.settings.apply("gated.on", true)).toEqual({ kind: "applied" });
    await until(() => (tools().includes("by-setting") ? true : undefined));

    expect(tools()).toEqual(["by-setting", "top-level"]);
    expect(settings()).toEqual(["gated.on", "gated.key"]);

    expect(await host.settings.apply("gated.on", false)).toEqual({ kind: "applied" });
    await until(() => (tools().includes("by-setting") ? undefined : true));

    expect(settings()).toEqual(["gated.on"]);
  });
});

describe("plugin api", () => {
  it("shows a reported issue live on HostView.plugins, and marks the built-ins", async () => {
    let api: PluginApi<"core"> | undefined;

    const { host } = await loaded([
      systemPromptPlugin,
      {
        id: "mcp",
        activate(given) {
          api = given;

          return {};
        },
      },
    ]);

    assert(api !== undefined);
    api.report({ severity: "warning", path: ["server"], message: "Server went away." });
    const views = host.watch()[Symbol.asyncIterator]();
    const view = await views.next();
    assert(!view.done);

    expect(view.value.plugins).toEqual([
      { id: "test-environment", source: "builtin", path: null, issues: [] },
      { id: "system-prompt", source: "inline", path: null, issues: [] },
      {
        id: "mcp",
        source: "inline",
        path: null,
        issues: [
          {
            severity: "warning",
            path: ["server"],
            message: "Server went away.",
            source: { plugin: "mcp" },
          },
        ],
      },
    ]);
    await views.return?.();
  });

  it("derives against siblings materialised earlier in the pass, and drops a failing derive's edits", async () => {
    const { kernel, runtime } = await loaded([
      {
        id: "lister",
        activate: () => ({
          contribute: {
            prompt: [
              (draft, siblings) => {
                draft.set("tools", {
                  id: "tools",
                  text: siblings.tools
                    .list()
                    .map((tool) => `${tool.name}: ${tool.exposure ?? "model"}`)
                    .join("\n"),
                });
              },
            ],
          },
        }),
      },
      {
        id: "mcp",
        contribute: { tools: [echo] },
        activate: () => ({
          contribute: {
            tools: [
              (draft) => {
                draft.set("search", { ...echo, name: "search", exposure: "deferred" });
              },
              (draft) => {
                draft.delete("echo");

                throw new Error("Server down.");
              },
            ],
          },
        }),
      },
    ]);

    expect(runtime.registries.tools.list().map((tool) => tool.name)).toEqual(["echo", "search"]);
    expect(runtime.registries.prompt.list().find((section) => section.id === "tools")?.text).toBe(
      "echo: model\nsearch: deferred",
    );
    expect(kernel.host.current().plugins.find((row) => row.id === "mcp")?.issues).toEqual([
      {
        severity: "error",
        path: ["tools"],
        message: "A derivation failed: Server down.",
        source: { plugin: "mcp" },
      },
    ]);
  });

  it("coalesces reloads before a microtask into one pass", async () => {
    let passes = 0;
    let api: PluginApi<"core"> | undefined;

    await loaded([
      {
        id: "counter",
        activate(given) {
          api = given;

          return {
            contribute: {
              prompt: [
                () => {
                  passes += 1;
                },
              ],
            },
          };
        },
      },
    ]);

    assert(api !== undefined);
    const before = passes;
    api.reload();
    api.reload();
    await until(() => (passes > before ? true : undefined));

    expect(passes).toBe(before + 1);
  });

  it("shows a chat's catalog to a client of a restarted host without starting the chat's plugins", async () => {
    const store = memoryStore();
    const plugins = [{ id: "greeter", contribute: { commands: [says("hello", "hi")] } }];
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Hello." }] });
    const first = await open(fake, { store, plugins });
    const { session, receipt } = await first.sessions.start({ content: "Hi." });
    await receipt.settled();
    await until(async () =>
      (await session.view()).catalog.commands.length > 0 ? true : undefined,
    );
    await first.close();

    await using second = await open(fakeModels(), { store, plugins });
    const attached = attachSession(second.kernel, session.id, LOCAL);
    await attached.ready();
    const rows = attached.read(main, { tail: 50 }, null).tables.catalog.upsert;
    attached.release();
    assert(rows[0] !== undefined);

    expect(rows).toHaveLength(1);
    expect((await second.catalogs.read(rows[0].id)).commands).toEqual([
      expect.objectContaining({ name: "hello", owner: "greeter" }),
    ]);
    expect((await second.session(session.id).view()).catalog.commands).toEqual([
      expect.objectContaining({ name: "hello", owner: "greeter" }),
    ]);
    expect(second.kernel.plugins.runtimes().size).toBe(0);
  });

  it("logs a chat's catalog id, serves its content from the store, and keeps the generation", async () => {
    const { kernel, host } = await setup();
    const generation = kernel.host.current().catalog;
    let logged = 0;

    kernel.bus.subscribeAll((_session, event) => {
      if (event.kind === "catalog") logged += 1;
    });

    kernel.plugins.host = [
      {
        id: "greeter",
        contribute: {
          commands: [{ ...says("hello", "hi"), category: "Fun" }],
          agents: [{ id: "reviewer", description: "Reviews.", mode: "subagent" }],
          skills: [{ name: "lint", description: "Lints.", location: "/skills/lint" }],
          tools: [{ ...echo, namespace: { name: "demo" }, exposure: "deferred" }],
        },
      },
    ];

    const { session } = await host.sessions.start({ content: "Hi." });

    const catalog: SessionCatalogView = {
      commands: [
        {
          name: "hello",
          owner: "greeter",
          side: "core",
          title: "hello",
          description: "Says hi.",
          takesText: false,
          completes: false,
          category: "Fun",
        },
      ],
      settings: [],
      skills: [{ name: "lint", owner: "greeter", description: "Lints.", location: "/skills/lint" }],
      agents: [
        {
          id: "reviewer",
          owner: "greeter",
          description: "Reviews.",
          model: null,
          mode: "subagent",
        },
      ],
      tools: [
        {
          name: "echo",
          owner: "greeter",
          namespace: "demo",
          description: echo.description,
          parameters: expect.objectContaining({ type: "object" }),
          output: null,
          exposure: "deferred",
        },
      ],
    };

    const hold = kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();
    const id = hold.state().catalogId;
    assert(id !== null);

    expect(logged).toBe(1);
    expect(await host.catalogs.read(id)).toEqual(catalog);
    expect((await session.view()).catalog).toEqual(catalog);
    expect(kernel.host.current().catalog).toBe(generation);
    await host.plugins.replace([], { session: session.id });

    expect(logged).toBe(2);
    expect(hold.state().catalogId).not.toBe(id);
    expect((await session.view()).catalog.commands).toEqual([]);
    hold.release();
  });

  it("publishes a chat's catalog to a client that attaches on a restarted host and keeps the generation", async () => {
    const store = await memoryStore().open();
    const plugins = [{ id: "greeter", contribute: { commands: [says("hello", "hi")] } }];
    const first = await setup({ store, plugins });
    const { session } = await first.host.sessions.start({ content: "Hi." });
    const second = await setup({ store, plugins });
    const generation = second.kernel.host.current().catalog;
    const attached = attachSession(second.kernel, session.id, second.host.principal);

    await attached.ready();
    const read = attached.read(main, { tail: 50 }, null);
    const rows = new Map(read.tables.catalog.upsert.map((row) => [catalogRowKey(row), row]));
    let cursor = attached.cursor();

    const stop = attached.subscribe(() => {
      const change = attached.changesAfter(cursor);
      cursor = attached.cursor();

      for (const row of change.tables.catalog?.upsert ?? []) rows.set(catalogRowKey(row), row);
    });

    const latest = await until(() => [...rows.values()].at(-1));

    expect((await second.host.catalogs.read(latest.id)).commands).toEqual([
      expect.objectContaining({ name: "hello", owner: "greeter" }),
    ]);
    expect(second.kernel.host.current().catalog).toBe(generation);
    stop();
    attached.release();
  });

  it("gives every callback the plugin's api: a command acts with its caller's authority, the rest as a participant, and only calls get an api of their own", async () => {
    const seen = new Map<string, Record<string, string>>();
    const apis = new Map<string, PluginApi<"core">>();

    const tried = async (run: () => unknown): Promise<string> => {
      try {
        await run();

        return "ok";
      } catch (error) {
        return error instanceof SdkError ? error.code : String(error);
      }
    };

    const probe = async (where: string, api: PluginApi<"core">): Promise<void> => {
      apis.set(where, api);
      seen.set(where, {
        "host.principals.list": await tried(() => api.host.principals.list()),
        env: await tried(() => api.env.cwd),
        project: await tried(() => api.project.contextFiles),
        "registries.tools.list": await tried(() => api.registries.tools.list()),
        "registries.settings.value": await tried(() => api.registries.settings.value("probe.on")),
        "registries.settings.set": await tried(() => api.registries.settings.set("probe.on", true)),
        "storage.set": await tried(() => api.storage.set("k", where)),
        "session.info": await tried(() => api.session.info()),
        wrapEnv: await tried(() => api.wrapEnv((inner) => inner)()),
      });
    };

    const command: Command<"core"> = {
      name: "probe",
      title: "Probe",
      description: "",
      run: async (_text, context) => {
        await probe("command", context.api);

        return "done";
      },
    };

    const plugin: Plugin<"core"> = {
      id: "probe",
      contribute: {
        settings: [{ id: "probe.on", title: "On", type: "switch" }],
        tools: [
          {
            ...echo,
            name: "probe",
            execute: async (_args, invocation) => {
              await probe("tool", invocation.api);

              return { content: [] };
            },
          },
        ],
        commands: [command],
        prompt: [
          {
            id: "probe",
            text: async (context) => {
              if (!seen.has("prompt text")) await probe("prompt text", context.api);

              return null;
            },
          },
        ],
      },
      hooks: {
        before_tool: async (_call, context) => {
          await probe("decide hook", context.api);

          return { action: "continue" };
        },
        run_started: async (_run, context) => {
          await probe("observe hook", context.api);
        },
      },
      async activate(api) {
        await probe("activate", api);

        return {};
      },
    };

    const fake = fakeModels();
    fake.reply(
      { content: [{ type: "toolCall", id: "c", name: "probe", arguments: { text: "x" } }] },
      { content: [{ type: "text", text: "Done." }] },
    );
    await using host = await open(fake, { plugins: [plugin] });
    const { session, receipt } = await host.sessions.start({ content: "Hi." });
    await receipt.settled();
    await until(() => (seen.has("observe hook") ? true : undefined));

    expect(await session.command("probe", "")).toEqual({ kind: "ran", output: "done" });

    const works = {
      env: "ok",
      project: "ok",
      "registries.tools.list": "ok",
      "registries.settings.value": "ok",
      "registries.settings.set": "ok",
      "storage.set": "ok",
      "session.info": "ok",
      wrapEnv: "ok",
    };

    const participant = { ...works, "host.principals.list": "denied" };

    expect(Object.fromEntries(seen)).toEqual({
      activate: participant,
      "observe hook": participant,
      "prompt text": participant,
      "decide hook": participant,
      tool: participant,
      command: { ...works, "host.principals.list": "ok" },
    });
    expect(
      Object.fromEntries([...apis].map(([where, api]) => [where, api === apis.get("activate")])),
    ).toEqual({
      activate: true,
      "observe hook": true,
      "prompt text": true,
      "decide hook": false,
      tool: false,
      command: false,
    });
  });
});

describe("commands", () => {
  it("answers ran, sent, unknown and failed, and refuses names no client can offer", async () => {
    const { kernel, session } = await loaded([
      {
        id: "cmds",
        contribute: {
          commands: [
            {
              name: "echo",
              title: "Echo",
              description: "Says it.",
              takesText: true,
              run: (text) => `said ${text}`,
            },
            says("say", "cmds"),
            says("new", "shadowed"),
            says("Odd_Name", "untypable"),
            { name: "quiet", title: "Quiet", description: "Says nothing.", run: () => undefined },
            {
              name: "ask",
              title: "Ask",
              description: "Asks.",
              run: () => ({ prompt: "Review the diff." }),
            },
            {
              name: "boom",
              title: "Boom",
              description: "Throws.",
              run: () => {
                throw new Error("Exploded.");
              },
            },
          ],
        },
      },
      { id: "other", contribute: { commands: [says("say", "other")] } },
    ]);

    expect(await session.command("echo", "  hi  ")).toEqual({ kind: "ran", output: "said hi" });
    expect(await session.command("say", "")).toEqual({ kind: "ran", output: "other" });
    expect(await session.command("cmds/say", "")).toEqual({ kind: "unknown" });
    expect(await session.command("quiet", "")).toEqual({ kind: "ran", output: null });
    expect(await session.command("new", "")).toEqual({ kind: "unknown" });
    expect(await session.command("Odd_Name", "")).toEqual({ kind: "unknown" });
    expect(
      kernel.host
        .current()
        .plugins.find((row) => row.id === "cmds")
        ?.issues.map((issue) => issue.message),
    ).toEqual([
      "/new is a built-in command; give the plugin's command another name.",
      'The command name Odd_Name can\'t be typed after "/": use lowercase letters, digits and "-".',
    ]);
    expect(await session.command("boom", "")).toEqual({ kind: "failed", message: "Exploded." });
    expect(await session.command("nope", "")).toEqual({ kind: "unknown" });

    const sent = await session.command("ask", "");
    assert(sent.kind === "sent");

    const admitted = (await kernel.store.refs.log(session.id, asSeq(0), 100)).find(
      (event) =>
        event.kind === "input" &&
        event.change === "admitted" &&
        event.message === asId<"message">(sent.receipt),
    );

    expect(admitted).toMatchObject({
      message: sent.receipt,
      content: "Review the diff.",
      source: { kind: "action", label: "Ask", command: "ask" },
    });
  });

  it("suggests a command's text from what is typed, none from a missing or failing one", async () => {
    const { kernel, session } = await loaded([
      {
        id: "keys",
        contribute: {
          commands: [
            {
              ...says("key", "saved"),
              complete: (prefix) =>
                ["exa", "tavily"]
                  .filter((name) => name.startsWith(prefix))
                  .map((name) => ({ value: `${name} `, label: name })),
            },
            {
              ...says("broken", "never"),
              complete: () => {
                throw new Error("No list.");
              },
            },
          ],
        },
      },
    ]);

    expect((await session.view()).catalog.commands).toEqual([
      expect.objectContaining({ name: "key", takesText: true, completes: true }),
      expect.objectContaining({ name: "broken", takesText: true, completes: true }),
    ]);
    expect(await session.completeCommand("key", "ta")).toEqual([
      { value: "tavily ", label: "tavily" },
    ]);
    expect(await session.completeCommand("nope", "")).toEqual([]);
    expect(await session.completeCommand("broken", "")).toEqual([]);
    expect(
      kernel.host
        .current()
        .plugins.find((row) => row.id === "keys")
        ?.issues.map((issue) => issue.message),
    ).toEqual(["Suggesting text for /broken failed: No list."]);
  });

  it("lists and runs a new chat's commands and modes before any chat, the folder's own only while it is trusted", async () => {
    const imported: string[] = [];

    const folder: Plugin<"core"> = {
      id: "folder",
      activate: () => ({
        contribute: {
          settings: [
            {
              id: "mode.folder",
              title: "Folder",
              type: "switch",
              scope: "chat",
              mode: { icon: "bug" },
            },
          ],
          commands: [
            {
              name: "probe",
              title: "Probe",
              description: "Answers from the folder.",
              run: () => "answered",
            },
            {
              name: "ask",
              title: "Ask",
              description: "Starts a chat.",
              run: () => ({ prompt: "Review this." }),
            },
          ],
        },
      }),
    };

    const chatOnly: Plugin<"core"> = {
      id: "chat-only",
      async activate(api) {
        await api.session.info();

        return {
          contribute: {
            commands: [
              {
                name: "never",
                title: "Never",
                description: "Needs a chat.",
                run: () => "never",
              },
            ],
          },
        };
      },
    };

    const { host, workspace } = await world({
      plugins: [
        {
          id: "host",
          contribute: {
            commands: [says("hello", "hi")],
            settings: [
              {
                id: "mode.host",
                title: "Host",
                type: "switch",
                scope: "chat",
                mode: { icon: "atom" },
              },
            ],
          },
        },
        chatOnly,
      ],
      loadPluginDirectory: async (dir) => {
        imported.push(dir);

        return { loaded: [{ plugin: folder, path: `${dir}/x.ts` }], failed: [] };
      },
    });
    const at = host.workspace(workspace);

    const listed = await at.catalog();

    expect(listed.commands.map((command) => command.name)).toEqual(["hello", "probe", "ask"]);
    expect(listed.modes.map((mode) => mode.id)).toEqual(["mode.host", "mode.folder"]);
    expect(imported).toEqual(["/work/project/.nyte/plugins"]);
    expect(await at.command("probe", "")).toEqual({ kind: "ran", output: "answered" });
    expect(await at.command("ask", "")).toEqual({ kind: "prompt", content: "Review this." });
    expect(await at.command("never", "")).toEqual({ kind: "unknown" });
    expect((await host.sessions.list()).items).toEqual([]);

    expect(await at.update({ trusted: false })).toEqual({ kind: "updated" });
    expect((await at.catalog()).commands.map((command) => command.name)).toEqual(["hello"]);
    expect((await at.catalog()).modes.map((mode) => mode.id)).toEqual(["mode.host"]);
    await expect(host.workspace(asId("missing")).catalog()).rejects.toMatchObject({
      code: "unknown",
    });
  });
});
