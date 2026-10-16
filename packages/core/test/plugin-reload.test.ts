import { asId, standard } from "@nyte-ai/schema";
import type { Infer, ModelRequest } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import { createHost } from "../src/api/connection.ts";
import { createHostState } from "../src/api/host.ts";
import { createKernel } from "../src/compose.ts";
import { envelope, memoryStore, workspaceRef } from "../src/store.ts";
import type { Plugin, Resources, ToolDefinition } from "../src/index.ts";
import { world } from "./fake-env.ts";
import { chatOnly, fakeModels, open } from "./fake-models.ts";
import { configuration, env, main, script, setup, until, workspace } from "./harness.ts";

const nothing = standard(Type.Object({}));

function tool(name: string, execute?: () => Promise<void>): ToolDefinition<Infer<typeof nothing>> {
  return {
    name,
    description: `The ${name} tool.`,
    parameters: nothing,
    class: () => ({ kind: "custom", label: name }),
    replay: "safe",
    async execute() {
      await execute?.();

      return { content: [{ kind: "text", text: name }] };
    },
  };
}

const empty: Resources = {
  user: null,
  project: null,
  skills: [],
  contextFiles: [],
  prompt: { system: null, append: null, scope: null },
  prompts: [],
};

async function controlled(input: {
  attach(): Promise<typeof env>;
  resources(): Promise<Resources>;
}) {
  const store = await memoryStore().open();

  await store.refs.set([
    {
      name: workspaceRef(workspace),
      target: await store.objects.put(
        envelope(
          "workspace",
          {
            id: workspace,
            target: { kind: "local", path: "/tmp/project" },
            identity: asId("identity"),
            projectResources: true,
            projectSources: [],
            addedBy: asId("local"),
            createdAt: 0,
          },
          0,
        ),
      ),
    },
  ]);

  const kernel = createKernel({
    hostId: asId("h1"),
    store,
    description: { name: "studio", platform: "darwin", version: "0.1.0" },
    host: createHostState({ catalog: asId("g1"), plugins: [], settings: [] }),
    defaultWorkspace: workspace,
    turn: script().driver,
    resolveConfiguration: async () => configuration,
    env: () => input.attach(),
    resources: () => input.resources(),
  });

  return { kernel, host: createHost(kernel, { credential: { kind: "token", token: "x" } }) };
}

describe("plugin reload (D4)", () => {
  it("3.2 / D D4: a replace between two requests of one run installs a new runtime, so request 2 has the new tool and hook", async () => {
    const fake = fakeModels();
    const seen: string[] = [];
    let replace = async (): Promise<void> => undefined;

    const v1: Plugin<"core"> = {
      id: "swapped",
      contribute: { tools: [tool("replace", () => replace())] },
    };

    const v2: Plugin<"core"> = {
      id: "swapped",
      contribute: { tools: [tool("replace"), tool("fresh")] },
      hooks: {
        before_request: (request: ModelRequest) => {
          seen.push(`before_request:v2:${request.attempt}`);

          return request;
        },
      },
    };

    fake.reply(
      { content: [{ type: "toolCall", id: "call-1", name: "replace", arguments: {} }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { plugins: [v1] });
    const session = await host.sessions.create();
    const before = host.kernel.pluginsFor(session.id).ready;

    replace = async () => {
      const report = await host.plugins.replace([chatOnly, v2], { session: session.id });

      expect(report.plugins.map((outcome) => [outcome.id, outcome.kind])).toEqual([
        ["chat-only", "activated"],
        ["swapped", "activated"],
      ]);
    };

    expect((await (await session.send("Go.")).settled()).kind).toBe("completed");
    expect(host.kernel.pluginsFor(session.id).ready).not.toBe(before);
    expect(seen).toHaveLength(1);

    const system = fake.requests[1].context.messages[0];

    assert(system?.role === "system");
    expect(system.toolsAdded?.map((entry) => entry.name)).toContain("fresh");
  });

  it("3.3 / D D3: a caller holding the old runtime while a reload starts still runs its handlers, each with its own api", async () => {
    let own: unknown;
    const apis: unknown[] = [];

    const { kernel, host } = await setup();

    kernel.hostPlugins = [
      {
        id: "stamp",
        activate(api) {
          own = api;
        },
        hooks: {
          after_tool: (outcome, { api }) => {
            apis.push(api);

            return { ...outcome, content: [{ kind: "text", text: "stamped" }] };
          },
        },
      },
    ];

    const session = await host.sessions.create();
    const old = kernel.pluginsFor(session.id);
    const reloaded = kernel.reloadPlugins(session.id);

    const outcome = await old.hooks.transform(
      "after_tool",
      { kind: "ok", content: [], output: null, parts: [] },
      { session: session.id, head: main, run: null, principal: asId("local") },
    );

    assert(outcome.kind === "ok");
    expect(outcome.content).toEqual([{ kind: "text", text: "stamped" }]);
    expect(apis).toEqual([own]);
    await reloaded;
  });

  it("3.4 / E E4 (P3): a session replace on an instance that never activated the session reports what HostView shows", async () => {
    const first = await setup();
    const session = await first.host.sessions.create();
    const other = await setup({ store: first.kernel.store });

    expect(other.kernel.runtimes().size).toBe(0);

    const report = await other.host.plugins.replace([{ id: "extra" }], { session: session.id });

    expect(report.plugins).toEqual([{ kind: "activated", id: "extra", issues: [] }]);
    await other.kernel.pluginsFor(session.id).ready;
    expect(other.kernel.host.current().plugins).toEqual([
      { id: "extra", source: "inline", path: null, issues: [] },
    ]);
    expect(
      other.kernel
        .pluginsFor(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toEqual(["extra"]);
  });

  it("3.5 / E E6 + D D13: an activation whose resources cannot be read rejects ready, fails the activation and drops the runtime; the next use activates again", async () => {
    let failing = false;

    const { kernel, host } = await controlled({
      attach: async () => env,
      async resources() {
        if (failing) throw new Error("The scan failed.");

        return empty;
      },
    });

    kernel.hostPlugins = [{ id: "kept" }];
    const session = await host.sessions.create();

    failing = true;
    await expect(kernel.reloadPlugins(session.id)).rejects.toThrow("The scan failed.");
    expect(kernel.activation(session.id)).toEqual({ kind: "failed", message: "The scan failed." });
    await until(() => (kernel.runtimes().has(session.id) ? undefined : true));

    failing = false;
    const again = kernel.pluginsFor(session.id);
    await again.ready;

    expect(again.plugins().map((plugin) => plugin.id)).toEqual(["kept"]);
  });

  it("E E5 (P5): a host-wide replace resolves when another instance removed a session this one holds a runtime for", async () => {
    const first = await setup();
    const session = await first.host.sessions.create();
    const other = await setup({ store: first.kernel.store });

    expect(await other.host.session(session.id).remove()).toEqual({ kind: "removed" });

    const report = await first.host.plugins.replace([{ id: "next" }]);

    expect(report.plugins).toEqual([{ kind: "activated", id: "next", issues: [] }]);
    expect(first.kernel.hostPlugins.map((plugin) => plugin.id)).toEqual(["next"]);
  });

  it("E E7 (runtime side) + D D13: a failed attach rejects ready with its own error and shows failed; no plugin activates on a null env", async () => {
    const reads: unknown[] = [];

    const { kernel, host } = await controlled({
      attach: async () => {
        throw new Error("The disk is gone.");
      },
      resources: async () => empty,
    });

    kernel.hostPlugins = [{ id: "reader", activate: (api) => void reads.push(api.env) }];

    const session = await host.sessions.create();

    await expect(kernel.pluginsFor(session.id).ready).rejects.toThrow("The disk is gone.");
    expect((await session.info()).activation).toEqual({
      kind: "failed",
      message: "The disk is gone.",
    });
    expect(reads).toEqual([]);
  });

  it("3.5 / E E6 (P4): an unknown session's ready rejects unknown and leaves no runtime", async () => {
    const { kernel } = await setup();
    const ids = Array.from({ length: 50 }, () => asId<"session">(crypto.randomUUID()));

    for (const id of ids)
      await expect(kernel.pluginsFor(id).ready).rejects.toMatchObject({ code: "unknown" });

    await until(() => (kernel.runtimes().size === 0 ? true : undefined));
  });

  it("audit 1 (D-3-old-runtime-after-reload): a caller holding the old runtime after the reload settled still runs its handlers", async () => {
    const fixture = await world({
      plugins: [
        {
          id: "stamp",
          hooks: {
            after_tool: (outcome) => ({ ...outcome, content: [{ kind: "text", text: "OLD" }] }),
          },
        },
      ],
    });

    const session = await fixture.host.sessions.create({ workspace: fixture.workspace });
    const old = fixture.kernel.pluginsFor(session.id);
    await fixture.kernel.reloadPlugins(session.id);

    const result = await old.hooks.transform(
      "after_tool",
      { kind: "ok", content: [], output: null, parts: [] },
      { session: session.id, head: main, run: null, principal: asId("local") },
    );

    assert(result.kind === "ok");
    expect(result.content).toEqual([{ kind: "text", text: "OLD" }]);
  });

  it("audit 1 (D-3-inflight-hook-reload): a hook in flight on the old runtime finishes across a reload, never 'was deactivated'", async () => {
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;

    const fixture = await world({
      plugins: [
        {
          id: "long",
          hooks: {
            after_tool: async (outcome, context) => {
              signal = context.api.signal;
              entered.resolve();
              await gate.promise;

              return { ...outcome, content: [{ kind: "text", text: "FINISHED" }] };
            },
          },
        },
      ],
    });

    const session = await fixture.host.sessions.create({ workspace: fixture.workspace });
    const old = fixture.kernel.pluginsFor(session.id);

    const running = old.hooks.transform(
      "after_tool",
      { kind: "ok", content: [], output: null, parts: [] },
      { session: session.id, head: main, run: null, principal: asId("local") },
    );

    await entered.promise;
    await fixture.kernel.reloadPlugins(session.id);

    expect(signal?.aborted).toBe(false);
    gate.resolve();

    const result = await running;

    assert(result.kind === "ok");
    expect(result.content).toEqual([{ kind: "text", text: "FINISHED" }]);
    await until(() => (signal?.aborted === true ? true : undefined));
  });

  it("audit 2 (same-object-preflight): replacing with the running version twice keeps it running, kept-previous", async () => {
    const previous: Plugin<"core"> = { id: "same" };
    const fixture = await world({ plugins: [previous] });
    const session = await fixture.host.sessions.create({ workspace: fixture.workspace });

    const report = await fixture.host.plugins.replace([previous, previous], {
      session: session.id,
    });

    expect(report.plugins.map((outcome) => outcome.kind)).toEqual([
      "kept-previous",
      "kept-previous",
    ]);
    expect(
      fixture.kernel
        .pluginsFor(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toContain("same");
  });

  it("audit 2 (kept-previous-reactivates): a kept-previous plugin keeps running: no activate, no session_activated (§36b)", async () => {
    const counts: string[] = [];

    const previous: Plugin<"core"> = {
      id: "retained",
      contribute: { tools: [tool("retained")] },
      activate() {
        counts.push("activate");
      },
      hooks: {
        session_activated() {
          counts.push("session_activated");
        },
      },
    };

    const fixture = await world({ plugins: [previous] });
    const session = await fixture.host.sessions.create({ workspace: fixture.workspace });
    await until(() => (counts.length === 2 ? true : undefined));

    const report = await fixture.host.plugins.replace([{ id: "retained" }, { id: "retained" }], {
      session: session.id,
    });

    expect(report.plugins.map((outcome) => outcome.kind)).toEqual([
      "kept-previous",
      "kept-previous",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(counts).toEqual(["activate", "session_activated"]);

    const runtime = fixture.kernel.pluginsFor(session.id);

    expect(runtime.plugins()).toContain(previous);
    expect(
      fixture.kernel
        .tools(runtime)
        .list()
        .map((info) => info.name),
    ).toContain("retained");
  });

  it("audit 4 (host-replace-failed-session): an existing session whose activation fails rejects the replacement's plugins with its failure", async () => {
    const fixture = await world();
    const session = await fixture.host.sessions.create({ workspace: fixture.workspace });
    await fixture.kernel.environments.detach(session.id);
    fixture.provider.failure = "Offline now.";

    const report = await fixture.host.plugins.replace([
      { id: "provider", environment: fixture.provider },
      { id: "extra" },
    ]);

    expect((await session.info()).activation).toEqual({ kind: "failed", message: "Offline now." });
    expect(report.plugins.map((outcome) => outcome.kind)).toEqual(["rejected", "rejected"]);
    expect(report.plugins[1]?.issues).toEqual([
      expect.objectContaining({
        severity: "error",
        path: ["sessions", session.id],
        message: expect.stringContaining("Offline now."),
      }),
    ]);
  });
});
