import { asId, standard } from "@nyte-ai/schema";
import type { Infer, ModelRequest } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import { createHost } from "../src/api/connection.ts";
import { createHostState } from "../src/api/host.ts";
import { createKernel } from "../src/compose.ts";
import { toolSource } from "../src/extend/registry.ts";
import { envelope, memoryStore, workspaceRef } from "../src/store.ts";
import type { Plugin, ToolDefinition } from "../src/index.ts";
import { world } from "./fake-env.ts";
import { chatOnly, fakeModels, open } from "./fake-models.ts";
import { configuration, env, main, script, setup, until, workspace } from "../src/harness.ts";

const nothing = standard(Type.Object({}));

function tool(name: string, execute?: () => Promise<void>): ToolDefinition<Infer<typeof nothing>> {
  return {
    name,
    description: `The ${name} tool.`,
    parameters: nothing,
    class: () => ({ kind: "custom", label: name }),
    rerun: "safe",
    async execute() {
      await execute?.();

      return { content: [{ kind: "text", text: name }] };
    },
  };
}

async function controlled(attach: () => Promise<typeof env>) {
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
            isolation: null,
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
    host: createHostState({
      catalog: asId("g1"),
      plugins: [],
      settings: [],
      views: [],
      defaultWorkspace: workspace,
      projects: [],
    }),
    turn: script().driver,
    resolveConfiguration: async () => configuration,
    builtins: [
      {
        id: "local",
        environment: {
          kind: "local",
          inspect: async () => ({
            identity: env.identity,
            availability: { kind: "available" },
            projectSources: [],
          }),
          attach,
        },
      },
    ],
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
    const { session } = await host.sessions.start({ content: "Hi." });
    const before = host.kernel.plugins.runtime(session.id).ready;

    replace = async () => {
      const report = await host.plugins.replace([chatOnly, v2], { session: session.id });

      expect(report.plugins.map((outcome) => [outcome.id, outcome.kind])).toEqual([
        ["chat-only", "activated"],
        ["swapped", "activated"],
      ]);
    };

    expect((await (await session.send("Go.")).settled()).kind).toBe("completed");
    expect(host.kernel.plugins.runtime(session.id).ready).not.toBe(before);
    expect(seen).toHaveLength(1);

    const system = fake.requests[1].context.messages[0];

    assert(system?.role === "system");
    expect(system.toolsAdded?.map((entry) => entry.name)).toContain("fresh");
  });

  it("3.3 / D D3: a caller holding the old runtime while a reload starts still runs its handlers, each with its own api", async () => {
    let own: unknown;
    const apis: unknown[] = [];

    const { kernel, host } = await setup();

    kernel.plugins.host = [
      {
        id: "stamp",
        activate(api) {
          own = api;

          return {};
        },
        hooks: {
          after_tool: (outcome, { api }) => {
            apis.push(api);

            return { ...outcome, content: [{ kind: "text", text: "stamped" }] };
          },
        },
      },
    ];

    const { session } = await host.sessions.start({ content: "Hi." });
    const old = kernel.plugins.runtime(session.id);
    const reloaded = kernel.plugins.reload(session.id);

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
    const { session } = await first.host.sessions.start({ content: "Hi." });
    const other = await setup({ store: first.kernel.store });

    expect(other.kernel.plugins.runtimes().size).toBe(0);

    const report = await other.host.plugins.replace([{ id: "extra" }], { session: session.id });

    expect(report.plugins).toEqual([{ kind: "activated", id: "extra", issues: [] }]);
    await other.kernel.plugins.runtime(session.id).ready;
    expect(other.kernel.host.current().plugins).toEqual([
      { id: "test-environment", source: "builtin", path: null, issues: [] },
      { id: "extra", source: "inline", path: null, issues: [] },
    ]);
    expect(
      other.kernel.plugins
        .runtime(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toEqual(["test-environment", "extra"]);
  });

  it("3.5 / E E6 + D D13: an activation whose resources cannot be read rejects ready, fails the activation and drops the runtime; the next use activates again", async () => {
    const { kernel, host } = await controlled(async () => env);

    kernel.plugins.host = [{ id: "kept" }];
    const { session } = await host.sessions.start({ content: "Hi." });
    await kernel.plugins.runtime(session.id).ready;
    const unreadable = Promise.reject(new Error("The scan failed."));
    unreadable.catch(() => undefined);
    kernel.workspaceState.scans.set(session.id, {
      workspace,
      resources: unreadable,
    });

    await expect(kernel.plugins.reload(session.id)).rejects.toThrow("The scan failed.");
    expect(kernel.sessions.activation(session.id)).toEqual({
      kind: "failed",
      message: "The scan failed.",
    });
    await until(() => (kernel.plugins.runtimes().has(session.id) ? undefined : true));

    kernel.workspaceState.scans.delete(session.id);
    const again = kernel.plugins.runtime(session.id);
    await again.ready;

    expect(again.plugins().map((plugin) => plugin.id)).toEqual(["local", "kept"]);
  });

  it("E E5 (P5): a host-wide replace resolves when another instance removed a session this one holds a runtime for", async () => {
    const first = await setup();
    const { session } = await first.host.sessions.start({ content: "Hi." });
    const other = await setup({ store: first.kernel.store });

    expect(await other.host.session(session.id).remove()).toEqual({ kind: "removed" });

    const report = await first.host.plugins.replace([{ id: "next" }]);

    expect(report.plugins).toEqual([{ kind: "activated", id: "next", issues: [] }]);
    expect(first.kernel.plugins.host.map((plugin) => plugin.id)).toEqual(["next"]);
  });

  it("3.5 / E E6 (P4): an unknown session's ready rejects unknown and leaves no runtime", async () => {
    const { kernel } = await setup();
    const ids = Array.from({ length: 50 }, () => asId<"session">(crypto.randomUUID()));

    for (const id of ids) {
      await expect(kernel.plugins.runtime(id).ready).rejects.toMatchObject({ code: "unknown" });
    }

    await until(() => (kernel.plugins.runtimes().size === 0 ? true : undefined));
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

    const { session } = await fixture.host.sessions.start({
      workspace: fixture.workspace,
      content: "Hi.",
    });
    const old = fixture.kernel.plugins.runtime(session.id);
    await fixture.kernel.plugins.reload(session.id);

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

    const { session } = await fixture.host.sessions.start({
      workspace: fixture.workspace,
      content: "Hi.",
    });
    const old = fixture.kernel.plugins.runtime(session.id);

    const running = old.hooks.transform(
      "after_tool",
      { kind: "ok", content: [], output: null, parts: [] },
      { session: session.id, head: main, run: null, principal: asId("local") },
    );

    await entered.promise;
    await fixture.kernel.plugins.reload(session.id);

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
    const { session } = await fixture.host.sessions.start({
      workspace: fixture.workspace,
      content: "Hi.",
    });

    const report = await fixture.host.plugins.replace([previous, previous], {
      session: session.id,
    });

    expect(report.plugins.map((outcome) => outcome.kind)).toEqual([
      "kept-previous",
      "kept-previous",
    ]);
    expect(
      fixture.kernel.plugins
        .runtime(session.id)
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

        return {};
      },
      hooks: {
        session_activated() {
          counts.push("session_activated");
        },
      },
    };

    const fixture = await world({ plugins: [previous] });
    const { session } = await fixture.host.sessions.start({
      workspace: fixture.workspace,
      content: "Hi.",
    });
    await until(() => (counts.length === 2 ? true : undefined));
    const observed = Promise.withResolvers<void>();

    const last: Plugin<"core"> = {
      id: "last",
      hooks: { session_activated: { order: 1, run: () => observed.resolve() } },
    };

    const report = await fixture.host.plugins.replace(
      [{ id: "retained" }, { id: "retained" }, last],
      { session: session.id },
    );

    expect(report.plugins.map((outcome) => outcome.kind)).toEqual([
      "kept-previous",
      "kept-previous",
      "activated",
    ]);
    await observed.promise;
    expect(counts).toEqual(["activate", "session_activated"]);

    const runtime = fixture.kernel.plugins.runtime(session.id);

    expect(runtime.plugins()).toContain(previous);
    expect(
      toolSource(runtime)
        .list()
        .map((info) => info.name),
    ).toContain("retained");
  });

  it("audit 4 (host-replace-failed-session): an existing session whose activation fails rejects the replacement's plugins with its failure", async () => {
    const fixture = await world();
    const { session } = await fixture.host.sessions.start({
      workspace: fixture.workspace,
      content: "Hi.",
    });
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

  it("reloads the full list: a plugin a failed activation rejected is retried, and a session's own list is kept", async () => {
    let broken = true;
    const starts: string[] = [];

    const flaky: Plugin<"core"> = {
      id: "flaky",
      activate() {
        starts.push("flaky");

        if (broken) throw new Error("Not yet.");

        return {};
      },
    };

    const builtin: Plugin<"core"> = {
      id: "builtin",
      activate() {
        starts.push("builtin");

        return {};
      },
    };

    const { kernel, host, workspace } = await world({ plugins: [flaky], builtins: [builtin] });
    const { session } = await host.sessions.start({ workspace, content: "Hi." });
    const first = kernel.plugins.runtime(session.id);

    expect(first.plugins().map((plugin) => plugin.id)).toEqual(["builtin", "fake-environment"]);

    broken = false;
    await host.workspace(workspace).reload();

    expect(first.plugins()).toEqual([]);
    expect(
      kernel.plugins
        .runtime(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toEqual(["builtin", "fake-environment", "flaky"]);

    const own: Plugin<"core"> = { id: "own" };
    await host.plugins.replace([own], { session: session.id });
    await host.workspace(workspace).reload();
    const runtime = kernel.plugins.runtime(session.id);

    expect(runtime.assigned()).toEqual([{ id: "own" }]);
    expect(runtime.plugins().map((plugin) => plugin.id)).toEqual(["builtin", "own"]);
    expect(starts.filter((id) => id === "builtin")).toHaveLength(4);
  });
  it("a session's assigned plugins load again in a fresh process on the same store", async () => {
    const guard: Plugin<"core"> = { id: "guard" };
    const first = await setup();
    first.kernel.plugins.host = [guard, { id: "other" }];
    const { session } = await first.host.sessions.start({ content: "Hi." });
    await first.host.plugins.replace([guard], { session: session.id });

    const restarted = await setup({ store: first.kernel.store });
    restarted.kernel.plugins.host = [guard, { id: "other" }];
    const runtime = restarted.kernel.plugins.runtime(session.id);
    await runtime.ready;

    expect(runtime.plugins().map((plugin) => plugin.id)).toEqual(["test-environment", "guard"]);
    expect(runtime.assigned()).toEqual([{ id: "guard" }]);
  });

  it("a process holding an older runtime loads a session's assigned plugins when it advances the head", async () => {
    const guard: Plugin<"core"> = { id: "guard" };
    const first = await setup();
    first.kernel.plugins.host = [guard];
    const { session } = await first.host.sessions.start({ content: "Hi." });
    const peer = await setup({ store: first.kernel.store });
    peer.kernel.plugins.host = [guard, { id: "other" }];
    await peer.kernel.plugins.runtime(session.id).ready;

    expect(
      peer.kernel.plugins
        .runtime(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toEqual(["test-environment", "guard", "other"]);

    await first.host.plugins.replace([guard], { session: session.id });
    void peer.host.execution.advance({ session: session.id, head: main });

    await until(() =>
      peer.kernel.plugins.runtime(session.id).assigned() === null ? undefined : true,
    );
    await peer.kernel.plugins.runtime(session.id).ready;

    expect(
      peer.kernel.plugins
        .runtime(session.id)
        .plugins()
        .map((plugin) => plugin.id),
    ).toEqual(["test-environment", "guard"]);
  });

  it("a process without a session's assigned plugin refuses the session and never falls back to its own plugins", async () => {
    const first = await setup();
    const { session } = await first.host.sessions.start({ content: "Hi." });
    await first.host.plugins.replace([{ id: "extra" }], { session: session.id });
    const restarted = await setup({ store: first.kernel.store });

    await expect(restarted.kernel.plugins.runtime(session.id).ready).rejects.toMatchObject({
      code: "unavailable",
      message:
        "The plugins assigned to this session did not load: No plugin named extra is loaded on this host.",
    });
  });
});
