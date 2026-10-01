import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNyte } from "@nyte-ai/core";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import { SqliteStore } from "@nyte-ai/core/store";
import { createWorkspaceStore } from "@nyte-ai/host";
import { createTestRenderer } from "@opentui/core/testing";
import { mountShell } from "./app/App.tsx";
import { deliveryChoices } from "./lanes.ts";
import { PluginProvider } from "./plugins.ts";
import { DARK_THEME } from "./theme.ts";

async function fixture(wait: string, setupBudgetMs?: number) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-tui-plugin-lifetime-")));
  const previousHome = process.env.NYTE_HOME;
  process.env.NYTE_HOME = join(root, "home");
  const unit = join(root, ".nyte", "plugins", "pending");
  await mkdir(unit, { recursive: true });
  const evidence = join(root, "evidence");
  await writeFile(
    join(unit, "tui.ts"),
    `
    import { appendFileSync, writeFileSync } from "node:fs";
    import { TextRenderable } from "@opentui/core";
    const evidence = ${JSON.stringify(evidence)};
    export default {
      id: "pending",
      async setup(context) {
        const renderer = context.renderer;
        const [read, write] = context.storage.memory("count", { initial: 0 });
        write(1);
        const removeSlot = context.ui.slot("session.composer.top", () =>
          new TextRenderable(renderer, { content: "pending slot" }));
        writeFileSync(evidence, "started\\n");
        ${wait}
        const actions = [
          ["listener", () => context.data.listen(() => {})],
          ["slot", () => context.ui.slot("session.composer.top", () => new TextRenderable(renderer))],
          ["toast", () => context.ui.toast.show({ message: "late toast" })],
          ["memory", () => write(2)],
          ["allocation", () => context.storage.memory("late", { initial: 0 })],
        ];
        for (const [name, action] of actions) {
          try { action(); appendFileSync(evidence, "allowed " + name + "\\n"); }
          catch { appendFileSync(evidence, "blocked " + name + "\\n"); }
        }
        appendFileSync(evidence, "memory " + read() + "\\n");
        return async () => {
          await Promise.resolve();
          removeSlot();
          appendFileSync(evidence, renderer.isDestroyed ? "cleanup dead\\n" : "cleanup live\\n");
        };
      },
    };
  `,
  );
  const workspace = await createWorkspaceStore().trust(root);
  const store = new SqliteStore(":memory:");
  const client = await createNyte({
    models: createModels({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
    }),
    store,
    plugins: [],
    env: { cwd: root },
    model: {
      id: "fixture",
      name: "Fixture",
      provider: "fixture",
      api: "openai-responses",
      baseUrl: "https://example.invalid",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000,
      maxTokens: 1_000,
    },
    streamFn: () => {
      throw new Error("Plugin lifetime test must not request a model");
    },
  });
  const setup = await createTestRenderer({ width: 60, height: 20 });
  const shell = await mountShell({
    renderer: setup.renderer,
    initialTheme: DARK_THEME,
    roles: deliveryChoices,
    openPath: () => undefined,
  });
  const provider = new PluginProvider({
    shell,
    workspace,
    client,
    sessionID: () => undefined,
    setupBudgetMs,
  });
  return {
    provider,
    shell,
    setup,
    evidence,
    async close() {
      await provider.dispose();
      setup.renderer.destroy();
      await client.close();
      await store.close();
      if (previousHome === undefined) delete process.env.NYTE_HOME;
      else process.env.NYTE_HOME = previousHome;
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function waitForEvidence(path: string, text: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!existsSync(path) || !readFileSync(path, "utf8").includes(text)) {
    if (Date.now() >= deadline) throw new Error(`Plugin did not record ${text}`);
    await Bun.sleep(5);
  }
}

const fencedEffects =
  "blocked listener\nblocked slot\nblocked toast\nblocked memory\nblocked allocation\nmemory 1\ncleanup live\n";

test("disposing a pending TUI setup aborts it, fences late effects, and awaits cleanup with a live renderer", async () => {
  const f = await fixture(`await new Promise((resolve) => {
    context.signal.addEventListener("abort", resolve, { once: true });
    if (context.signal.aborted) resolve();
  });`);
  try {
    const loading = f.provider.reconcile();
    await waitForEvidence(f.evidence, "started");
    const closing = f.provider.dispose();
    expect(f.provider.dispose()).toBe(closing);
    await closing;
    await loading;
    expect(readFileSync(f.evidence, "utf8")).toBe(`started\n${fencedEffects}`);
    expect(f.provider.registered()).toEqual([]);
    expect(f.provider.container.isDestroyed).toBe(true);
    expect(f.setup.renderer.isDestroyed).toBe(false);
    expect(f.shell.ui.slot.kind).toBe("empty");
    await f.setup.renderOnce();
    expect(f.setup.captureCharFrame()).not.toContain("late toast");
  } finally {
    await f.close();
  }
});

test("a setup that ignores abort loses its API after the budget and its eventual cleanup still runs", async () => {
  const f = await fixture("await new Promise((resolve) => setTimeout(resolve, 80));", 20);
  try {
    await assert.rejects(f.provider.reconcile({ retry: true }), /setup exceeded 20ms/);
    await f.provider.dispose();
    expect(f.provider.registered()).toEqual([]);
    await waitForEvidence(f.evidence, "cleanup live");
    expect(readFileSync(f.evidence, "utf8")).toBe(`started\n${fencedEffects}`);
    expect(f.shell.ui.slot.kind).toBe("empty");
  } finally {
    await f.close();
  }
});
