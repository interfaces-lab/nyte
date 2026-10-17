import { asId, asSeq, standard } from "@nyte-ai/schema";
import type { SessionCatalogView } from "@nyte-ai/schema";
import { Type } from "typebox";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { systemPromptPlugin } from "../src/builtins/system-prompt.ts";
import { toolSource } from "../src/extend/registry.ts";
import { LOCAL, text } from "../src/index.ts";
import type { Plugin, PluginApi } from "../src/index.ts";
import { main, setup } from "../src/harness.ts";
import { memoryStore } from "../src/store.ts";
import { ok, echo, opaque, volume, says, provider, loaded } from "./plugin-support.ts";

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
        api.contribute.tools.add({ ...echo, name: "half" });

        throw new Error("No config.");
      },
    };

    const { kernel, session, runtime } = await loaded([]);

    const outcomes = await runtime.load([
      { id: "tools", contribute: { tools: [echo] }, environment: provider("local") },
      { id: "twin" },
      { id: "twin" },
      { id: "sandbox", environment: provider("local") },
      { id: "opaque", contribute: { commands: [{ ...says("odd", "odd"), arguments: opaque }] } },
      broken,
    ]);

    expect(outcomes.map((outcome) => [outcome.id, outcome.kind])).toEqual([
      ["tools", "activated"],
      ["twin", "rejected"],
      ["twin", "rejected"],
      ["sandbox", "rejected"],
      ["opaque", "rejected"],
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
      expect.objectContaining({ path: ["commands", "odd", "arguments"] }),
    ]);
    expect(outcomes[5]?.issues).toEqual([
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
      ["opaque", 1],
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
        },
      },
      {
        id: "gone",
        activate(api) {
          gone = api.signal;
        },
      },
    ]);

    const v2: Plugin<"core"> = {
      id: "greeter",
      contribute: { commands: [says("hello", "v2")] },
      activate() {
        starts += 1;
      },
    };

    const replaced = await host.plugins.replace([v2], { session: session.id });

    expect(replaced.plugins).toEqual([{ kind: "activated", id: "greeter", issues: [] }]);
    expect(replaced.generation).toBe(kernel.host.current().catalog);
    expect([first?.aborted, gone?.aborted]).toEqual([true, true]);
    expect(await session.command("hello")).toEqual({ kind: "ran", output: "v2" });

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
    expect(await session.command("hello")).toEqual({ kind: "ran", output: "v2" });
    expect(starts).toBe(1);

    const unparsable = await host.plugins.replace(
      [{ id: "greeter", contribute: { tools: [{ ...echo, parameters: opaque }] } }],
      { session: session.id },
    );

    expect(unparsable.plugins.map((outcome) => outcome.kind)).toEqual(["kept-previous"]);
    expect(starts).toBe(1);
    expect(await session.command("hello")).toEqual({ kind: "ran", output: "v2" });

    const fresh = await host.plugins.replace(
      [{ id: "new", activate: () => Promise.reject(new Error("No.")) }],
      {
        session: session.id,
      },
    );

    expect(fresh.plugins.map((outcome) => outcome.kind)).toEqual(["rejected"]);
    expect(await session.command("hello")).toEqual({ kind: "unknown" });
  });

  it("replaces host-wide: every live session and the plugins new sessions load", async () => {
    const { kernel, host, session } = await loaded([
      { id: "greeter", contribute: { commands: [says("hello", "v1")] } },
    ]);

    const report = await host.plugins.replace([
      { id: "greeter", contribute: { commands: [says("hello", "v2")] } },
    ]);

    expect(report.plugins).toEqual([{ kind: "activated", id: "greeter", issues: [] }]);
    expect(await session.command("hello")).toEqual({ kind: "ran", output: "v2" });

    const { session: later } = await host.sessions.start({ content: "Hi." });

    expect(await later.command("hello")).toEqual({ kind: "ran", output: "v2" });
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
        },
      },
    ]);

    expect(await session.remove()).toEqual({ kind: "removed" });
    expect(signal?.aborted).toBe(true);
    expect(kernel.plugins.runtimes().has(session.id)).toBe(false);
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
        },
      },
    ]);

    assert(api !== undefined);
    api.report({ severity: "warning", path: ["server"], message: "Server went away." });
    const views = host.watch()[Symbol.asyncIterator]();
    const view = await views.next();
    assert(!view.done);

    expect(view.value.plugins).toEqual([
      { id: "test-environment", source: "inline", path: null, issues: [] },
      { id: "system-prompt", source: "builtin", path: null, issues: [] },
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
        activate(api) {
          api.contribute.prompt.add((draft, siblings) => {
            draft.set("tools", {
              id: "tools",
              text: siblings.tools
                .list()
                .map((tool) => `${tool.name}: ${tool.exposure ?? "model"}`)
                .join("\n"),
            });
          });
        },
      },
      {
        id: "mcp",
        contribute: { tools: [echo] },
        activate(api) {
          api.contribute.tools.add((draft) => {
            draft.set("search", { ...echo, name: "search", exposure: "deferred" });
          });
          api.contribute.tools.add((draft) => {
            draft.delete("echo");

            throw new Error("Server down.");
          });
        },
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

  it("coalesces registry writes and reloads before a microtask into one pass", async () => {
    let passes = 0;
    let api: PluginApi<"core"> | undefined;

    const { kernel, session } = await loaded([
      {
        id: "counter",
        activate(given) {
          api = given;
          given.contribute.prompt.add(() => {
            passes += 1;
          });
        },
      },
    ]);

    assert(api !== undefined);
    const before = passes;
    api.contribute.tools.add({ ...echo, name: "a" });
    api.contribute.tools.add({ ...echo, name: "b" });
    api.reload();
    api.reload();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(passes).toBe(before + 1);
    expect(
      toolSource(kernel.plugins.runtime(session.id))
        .list()
        .map((tool) => tool.name),
    ).toEqual(["a", "b"]);
  });

  it("publishes the catalog as a seq-0 event a warm fold takes and a cold fold seeds, and keeps the generation", async () => {
    const { kernel, host } = await setup();
    const generation = kernel.host.current().catalog;
    const events: SessionCatalogView[] = [];

    kernel.bus.subscribeAll((_session, event) => {
      if (event.kind === "catalog") events.push(event.catalog);
    });

    kernel.plugins.host = [
      {
        id: "greeter",
        contribute: {
          commands: [{ ...says("hello", "hi"), category: "Fun" }],
          agents: [{ id: "reviewer", description: "Reviews.", mode: "subagent" }],
          skills: [{ name: "lint", description: "Lints.", location: "/skills/lint" }],
          tools: [{ ...echo, namespace: "demo", exposure: "deferred" }],
        },
      },
    ];

    const { session } = await host.sessions.start({ content: "Hi." });

    const catalog: SessionCatalogView = {
      commands: [
        {
          name: "greeter/hello",
          owner: "greeter",
          side: "core",
          title: "hello",
          description: "Says hi.",
          arguments: null,
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

    expect(events).toEqual([catalog]);
    expect((await session.view()).catalog).toEqual(catalog);
    expect(kernel.host.current().catalog).toBe(generation);

    const hold = kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();
    await host.plugins.replace([], { session: session.id });

    expect(hold.state().catalog.commands).toEqual([]);
    hold.release();
  });

  it("keeps the generation when a restarted host opens a chat's watch", async () => {
    const store = await memoryStore().open();
    const plugins = [{ id: "greeter", contribute: { commands: [says("hello", "hi")] } }];
    const first = await setup({ store, plugins });
    const { session } = await first.host.sessions.start({ content: "Hi." });
    const second = await setup({ store, plugins });
    const generation = second.kernel.host.current().catalog;
    const views = second.host.session(session.id).watch()[Symbol.asyncIterator]();

    await views.next();
    await second.kernel.plugins.runtime(session.id).ready;

    expect(second.kernel.sessions.catalog(session.id).commands).toEqual([
      expect.objectContaining({ name: "greeter/hello" }),
    ]);
    expect(second.kernel.host.current().catalog).toBe(generation);
    await views.return?.();
  });
});

describe("commands", () => {
  it("answers ran, sent, invalid, unknown and failed", async () => {
    const { kernel, session } = await loaded([
      {
        id: "cmds",
        contribute: {
          commands: [
            {
              name: "say",
              title: "Say",
              description: "Says it.",
              arguments: standard(Type.String()),
              run: (args) => `said ${String(args)}`,
            },
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

    expect(await session.command("cmds/say", "hi")).toEqual({ kind: "ran", output: "said hi" });
    expect(await session.command("other/say")).toEqual({ kind: "ran", output: "other" });
    expect(await session.command("say", "hi")).toEqual({ kind: "unknown" });
    expect(await session.command("quiet")).toEqual({ kind: "ran", output: null });
    expect(await session.command("cmds/say", 3)).toMatchObject({
      kind: "invalid",
      issues: [expect.objectContaining({ severity: "error" })],
    });
    expect(await session.command("boom")).toEqual({ kind: "failed", message: "Exploded." });
    expect(await session.command("nope")).toEqual({ kind: "unknown" });

    const sent = await session.command("ask");
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
      source: { kind: "action", label: "Ask", command: "cmds/ask" },
    });
  });
});
