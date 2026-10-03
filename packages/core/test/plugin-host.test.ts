import { withPluginSource } from "../src/plugins/source.ts";
/**
 * The plugin host contains plugin code: a call that never settles is a
 * failure with a name, a reload never leaves a hook gap, and hooks run in
 * plugin order.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { HOOK_BUDGETS_MS, HookRegistry, type HookInvocation } from "../src/plugins/hooks.ts";
import { createRegistries, PluginHost, type PluginNotice } from "../src/plugins/host.ts";
import { definePlugin, type Plugin, type SessionApi } from "../src/plugins/index.ts";

const toolCall: HookInvocation<"before_tool"> = {
  head: "main",
  runId: "run-1",
  toolCallId: "call-1",
  toolName: "bash",
  args: {},
};

function hostFor(
  hooks: HookRegistry,
  budgetMs: number,
  publish = (commit: () => void): boolean => {
    commit();
    return true;
  },
) {
  const registries = createRegistries();
  const notices: PluginNotice[] = [];

  const host = new PluginHost(
    {
      hooks,
      registries,
      session: {
        info: async () => ({ child: false }),
        rename: async () => undefined,
        context: async () => ({ systemPrompt: "", messages: [] }),
        getFact: async () => undefined,
        setFact: async () => undefined,
      },
      events: { subscribe: () => () => undefined, transitions: () => () => undefined },
      env: { cwd: "/tmp/nowhere" },
      subscribe: () => () => undefined,
      rebuildAll: () => {
        for (const registry of Object.values(registries)) registry.rebuild();
      },
      publish,
      defer: (action) => action(),
      emit: async (notice) => {
        notices.push(notice);
      },
    },
    budgetMs,
  );

  return { host, notices, registries };
}

function rejecting(id: string, message: string, before?: Promise<void>): Plugin {
  return definePlugin({
    id,
    async session(api) {
      await before;
      api.hook("before_tool", () => ({ action: "reject", message }));
    },
  });
}

test("a before_tool handler that outlives its budget fails closed and is reported", async () => {
  const reported: string[] = [];
  const hooks = new HookRegistry(
    (error) => {
      reported.push(error.message);
    },
    { ...HOOK_BUDGETS_MS, before_tool: 20 },
  );
  hooks.on("before_tool", () => new Promise(() => undefined), { id: "stuck" });
  const decision = await hooks.run("before_tool", toolCall);
  assert.equal(decision.action, "error");
  assert.match(reported[0] ?? "", /before_tool hook stuck exceeded 20ms/);
});

test("a session factory that outlives its budget is failed and the previous version stays", async () => {
  const hooks = new HookRegistry(() => undefined);
  const { host, notices } = hostFor(hooks, 20);
  await host.activate([rejecting("guard", "v1")]);
  const stuck = definePlugin({ id: "guard", session: () => new Promise(() => undefined) });
  const outcome = await host.activate([stuck]);
  assert.equal(outcome.kind, "rejected");
  assert.match(
    outcome.kind === "rejected" ? outcome.error : "",
    /guard: session\(\) exceeded 20ms/,
  );
  assert.deepEqual(await hooks.run("before_tool", toolCall), { action: "reject", message: "v1" });
  assert.equal(
    notices.some((notice) => notice.kind === "plugins_changed"),
    true,
  );
});

test("a reload keeps the old policy until the new factory has finished", async () => {
  const hooks = new HookRegistry(() => undefined);
  const { host } = hostFor(hooks, 5_000);
  let setups = 0;
  const original = definePlugin({
    id: "guard",
    session(api) {
      setups += 1;
      api.hook("before_tool", () => ({ action: "reject", message: "v1" }));
    },
  });
  await host.activate([original]);
  await host.activate([original]);
  assert.equal(setups, 1);
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reloading = host.activate([rejecting("guard", "v2", gate)]);
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await hooks.run("before_tool", toolCall), { action: "reject", message: "v1" });
  release();
  await reloading;
  assert.deepEqual(await hooks.run("before_tool", toolCall), { action: "reject", message: "v2" });
});

test("hooks run in plugin order, not registration order", async () => {
  const hooks = new HookRegistry(() => undefined);
  hooks.on("transform_context", (event) => ({ systemPrompt: `${event.systemPrompt}b` }), {
    order: 1,
  });
  hooks.on("transform_context", (event) => ({ systemPrompt: `${event.systemPrompt}a` }), {
    order: 0,
  });
  const result = await hooks.run("transform_context", {
    head: "main",
    runId: "run-1",
    messages: [],
    systemPrompt: "",
  });
  assert.equal(result?.systemPrompt, "ab");
});

test("setup hooks and contributions stay private, and a materialization failure retains the whole old set", async () => {
  const hooks = new HookRegistry(() => undefined);
  const { host, registries } = hostFor(hooks, 5_000);
  const initial = withPluginSource(
    definePlugin({
      id: "guard",
      session(api) {
        api.hook("before_tool", () => ({ action: "reject", message: "old" }));
        api.prompt.add((draft) => draft.set("prompt", { text: "old" }));
      },
    }),
    { source: "inline", version: "1" },
  );
  await host.activate([initial]);
  const registered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const replacing = host.activate([
    withPluginSource(
      definePlugin({
        id: "guard",
        async session(api) {
          api.hook("before_tool", () => ({ action: "reject", message: "new" }));
          api.prompt.add((draft) => draft.set("prompt", { text: "new" }));
          api.refresh();
          registered.resolve();
          await finish.promise;
        },
      }),
      { source: "inline", version: "2" },
    ),
    definePlugin({
      id: "broken",
      session(api) {
        api.commands.add(() => {
          throw new Error("cannot materialize");
        });
      },
    }),
  ]);
  await registered.promise;
  assert.deepEqual(await hooks.run("before_tool", toolCall), { action: "reject", message: "old" });
  assert.equal(registries.prompt.get("prompt")?.text, "old");
  finish.resolve();
  assert.deepEqual(await replacing, { kind: "rejected", error: "broken: cannot materialize" });
  assert.deepEqual(await hooks.run("before_tool", toolCall), { action: "reject", message: "old" });
  assert.equal(registries.prompt.get("prompt")?.text, "old");
  assert.equal(host.list()[0]?.version, "1");
  await host.close();
});

test("a timed-out setup cannot register hooks or mutate storage, and late rebuild is harmless", async () => {
  const hooks = new HookRegistry(() => undefined);
  const { host, registries } = hostFor(hooks, 20);
  await host.activate([
    withPluginSource(rejecting("guard", "old"), { source: "inline", version: "1" }),
  ]);
  const finish = Promise.withResolvers<void>();
  const resumed = Promise.withResolvers<void>();
  const refused: string[] = [];
  const outcome = await host.activate([
    withPluginSource(
      definePlugin({
        id: "guard",
        async session(api) {
          await finish.promise;
          for (const action of [
            () => api.hook("before_tool", () => ({ action: "reject", message: "late" })),
            () => api.prompt.add((draft) => draft.set("late", { text: "late" })),
            () => api.storage.set("late", true),
            () => api.session.rename("late"),
            () => api.events.subscribe(() => undefined),
          ]) {
            try {
              await action();
            } catch (cause) {
              refused.push(cause instanceof Error ? cause.message : String(cause));
            }
          }
          assert.doesNotThrow(() => api.refresh());
          assert.equal(api.signal.aborted, true);
          resumed.resolve();
        },
      }),
      { source: "inline", version: "2" },
    ),
  ]);
  assert.equal(outcome.kind, "rejected");
  finish.resolve();
  await resumed.promise;
  assert.equal(refused.length, 5);
  assert.equal(registries.prompt.get("late"), undefined);
  assert.deepEqual(await hooks.run("before_tool", toolCall), { action: "reject", message: "old" });
  await host.close();
});

test("disposed diagnostics and rebuilds are harmless while registration and writes remain refused", async () => {
  const hooks = new HookRegistry(() => undefined);
  const { host, notices } = hostFor(hooks, 5_000);
  let oldApi: SessionApi | undefined;
  await host.activate([
    definePlugin({
      id: "old",
      session(api) {
        oldApi = api;
      },
    }),
  ]);
  await host.activate([]);
  const disposedApi = oldApi;
  assert.ok(disposedApi);
  const count = notices.length;
  assert.doesNotThrow(() => disposedApi.diagnostics.warn("late connection failure"));
  assert.doesNotThrow(() => disposedApi.diagnostics.notify({ message: "late connection failure" }));
  assert.doesNotThrow(() => disposedApi.refresh());
  assert.equal(notices.length, count);
  assert.throws(() => disposedApi.tools.add(() => undefined), /disposed/);
  assert.throws(() => disposedApi.hook("before_tool", () => ({ action: "continue" })), /disposed/);
  assert.throws(() => disposedApi.storage.set("late", true), /disposed/);
  assert.throws(() => disposedApi.session.rename("late"), /disposed/);
  await host.close();
});

test("a staged rebuild tolerates unrelated failures and final validation rejects the candidate", async () => {
  const hooks = new HookRegistry(() => undefined);
  const { host, registries } = hostFor(hooks, 5_000);
  await host.activate([rejecting("guard", "old")]);
  let refreshed = false;
  const outcome = await host.activate([
    definePlugin({
      id: "broken",
      session(api) {
        api.prompt.add(() => {
          throw new Error("broken prompt");
        });
      },
    }),
    definePlugin({
      id: "connection",
      async session(api) {
        await Promise.resolve().then(() => {
          api.refresh();
          refreshed = true;
        });
      },
    }),
  ]);
  assert.equal(refreshed, true);
  assert.deepEqual(outcome, { kind: "rejected", error: "broken: broken prompt" });
  assert.deepEqual(await hooks.run("before_tool", toolCall), { action: "reject", message: "old" });
  assert.equal(registries.prompt.values().length, 0);
  assert.equal(host.list()[0]?.id, "guard");
  await host.close();
});

test("failed queued revalidation republishes the old inventory with a diagnostic", async () => {
  const hooks = new HookRegistry(() => undefined);
  let queued = false;
  let commit = (): void => undefined;
  const { host, notices } = hostFor(hooks, 5_000, (action) => {
    if (!queued) {
      action();
      return true;
    }
    commit = action;
    return false;
  });
  await host.activate([
    withPluginSource(rejecting("guard", "old"), { source: "inline", version: "old" }),
  ]);
  let invalid = false;
  queued = true;
  assert.deepEqual(
    await host.activate([
      withPluginSource(
        definePlugin({
          id: "guard",
          session(api) {
            api.prompt.add((draft) => {
              if (invalid) throw new Error("cannot publish");
              draft.set("prompt", { text: "new" });
            });
          },
        }),
        { source: "inline", version: "new" },
      ),
    ]),
    { kind: "queued" },
  );
  invalid = true;
  const before = notices.length;
  commit();
  assert.equal(host.list()[0]?.version, "old");
  assert.ok(
    notices
      .slice(before)
      .some((notice) => notice.kind === "diagnostic" && notice.message.includes("cannot publish")),
  );
  assert.deepEqual(notices.at(-1), { kind: "plugins_changed", plugins: host.list() });
  assert.deepEqual(await hooks.run("before_tool", toolCall), { action: "reject", message: "old" });
  await host.close();
});
