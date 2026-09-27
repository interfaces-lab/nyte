/**
 * The plugin host contains plugin code: a call that never settles is a
 * failure with a name, a reload never leaves a hook gap, and hooks run in
 * plugin order.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { HOOK_BUDGETS_MS, HookRegistry, type HookInvocation } from "../src/plugins/hooks.ts";
import { createRegistries, PluginHost, type PluginNotice } from "../src/plugins/host.ts";
import { definePlugin, inlinePlugin, type Plugin } from "../src/plugins/index.ts";

const toolCall: HookInvocation<"before_tool"> = {
  head: "main",
  runId: "run-1",
  toolCallId: "call-1",
  toolName: "bash",
  args: {},
};

function hostFor(hooks: HookRegistry, budgetMs: number) {
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
      events: { subscribe: () => () => undefined },
      env: { cwd: "/tmp/nowhere" },
      subscribe: () => () => undefined,
      rebuildAll: () => {
        for (const registry of Object.values(registries)) registry.rebuild();
      },
      emit: async (notice) => {
        notices.push(notice);
      },
    },
    budgetMs,
  );

  return { host, notices };
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
  await host.activate([inlinePlugin(rejecting("guard", "v1"), { version: "1" })]);
  const stuck = definePlugin({ id: "guard", session: () => new Promise(() => undefined) });
  const [info] = await host.activate([inlinePlugin(stuck, { version: "2" })]);
  assert.equal(info?.status, "failed");
  assert.match(
    info?.status === "failed" ? info.error : "",
    /plugin guard session\(\) exceeded 20ms/,
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
  await host.activate([inlinePlugin(rejecting("guard", "v1"), { version: "1" })]);
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reloading = host.activate([inlinePlugin(rejecting("guard", "v2", gate), { version: "2" })]);
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
