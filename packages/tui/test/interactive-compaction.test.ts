import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { createModels, createProvider } from "@nyte-ai/ai";
import { WorkspaceTrustStore, type SessionId } from "@nyte-ai/core";
import { definePlugin, inlinePlugin } from "@nyte-ai/core/plugins";
import { createTestRenderer } from "@opentui/core/testing";
import { parseFlags } from "../src/flags.ts";
import type { Host } from "../src/host.ts";
import { Interactive } from "../src/interactive.ts";
import { laneRoles } from "../src/lanes.ts";
import { FileSettingsStore } from "../src/settings.ts";
import { buildShell } from "../src/shell.ts";
import { DARK_THEME } from "../src/theme.ts";
import { echo, gate, model, openHost, within } from "./helpers.ts";

async function startInteractive(host: Host, sessionId: SessionId) {
  vi.stubEnv("NYTE_SKIP_VERSION_CHECK", "1");
  const setup = await createTestRenderer({
    width: 80,
    height: 24,
    useThread: false,
    kittyKeyboard: true,
    openConsoleOnError: false,
    autoFocus: false,
  });
  const roles = laneRoles(host.nyte.landing);
  const shell = buildShell(setup.renderer, DARK_THEME, roles, () => {});
  const models = createModels();
  const provider = createProvider({
    id: model.provider,
    auth: { apiKey: { name: "Test", resolve: async () => undefined } },
    models: [model],
    api: {
      stream: () => {
        throw new Error("Requests use the host's scripted provider");
      },
      streamSimple: () => {
        throw new Error("Requests use the host's scripted provider");
      },
    },
  });
  models.setProvider(provider);
  const settingsStore = new FileSettingsStore(join(host.cwd, "settings.json"));
  const workspace = await new WorkspaceTrustStore(join(host.cwd, "trust.json")).trust(host.cwd);
  const app = new Interactive({
    renderer: setup.renderer,
    shell,
    host,
    runtime: { models, provider },
    roles,
    settings: await settingsStore.read(host.cwd),
    settingsStore,
    workspace,
    fallback: { model, thinkingLevel: "off" },
    themeMode: "dark",
    onSettings: () => {},
    requestShutdown: () => {},
  });
  await app.start({ ...parseFlags([]), resume: { kind: "session", id: sessionId } });
  setup.renderer.start();
  await setup.renderOnce();
  return {
    setup,
    shell,
    dispose() {
      app.dispose();
      setup.renderer.destroy();
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

test("Escape cancels /compact immediately and a late native result cannot publish", async () => {
  const entered = Promise.withResolvers<AbortSignal>();
  const finish = gate();
  const host = await openHost(echo(), [
    inlinePlugin(
      definePlugin({
        id: "native-compaction",
        session(api) {
          api.hook("before_compaction", async (_event, signal) => {
            assert.ok(signal);
            entered.resolve(signal);
            await finish.opened;
            return {
              material: {
                type: "provider",
                provider: model.provider,
                api: model.api,
                model: model.id,
                data: [{ type: "compaction", encrypted_content: "late result" }],
              },
            };
          });
        },
      }),
    ),
  ]);
  const detach = host.attach();
  const { sessionId } = await host.nyte.sessions.create();
  await host.nyte.messages.send({ sessionId, content: "remember this" });
  await within(host.nyte.runs.wait({ sessionId }));
  const before = await host.nyte.sessions.snapshot({ sessionId });
  assert.ok(before);
  const interactive = await startInteractive(host, sessionId);
  const { setup, shell } = interactive;
  try {
    shell.input.insertText("/compact");
    setup.mockInput.pressEnter();
    const signal = await within(entered.promise);
    shell.scroll.focus();
    setup.mockInput.pressEscape();
    assert.equal(signal.aborted, true);
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /Stopping compaction/);
    finish.release();
    await vi.waitFor(() => assert.match(setup.captureCharFrame(), /Compaction cancelled/));
    const after = await host.nyte.sessions.snapshot({ sessionId });
    assert.ok(after);
    assert.equal(after.tip, before.tip);
    await setup.mockMouse.click(shell.input.screenX, shell.input.screenY);
    setup.mockInput.pressKey("x");
    assert.equal(shell.input.plainText, "x");
  } finally {
    finish.release();
    interactive.dispose();
    detach();
  }
});

test("one Escape stops a streaming reply through the real chat interface", async () => {
  const finish = gate();
  const host = await openHost(echo({ gate: finish }));
  const { sessionId } = await host.nyte.sessions.create();
  const detach = host.attach();
  const interactive = await startInteractive(host, sessionId);
  const { setup, shell } = interactive;
  const watching = new AbortController();
  try {
    const streaming = (async () => {
      for await (const event of host.nyte.watch({ sessionId, signal: watching.signal })) {
        if (event.kind === "text_delta") return;
      }
      throw new Error("The provider did not start streaming");
    })();
    shell.input.insertText("wait");
    setup.mockInput.pressEnter();
    await within(streaming);
    shell.scroll.focus();
    setup.mockInput.pressEscape();
    await within(host.nyte.runs.wait({ sessionId }));
    assert.equal((await host.nyte.runs.current({ sessionId }))?.phase.kind, "aborted");
    await setup.mockMouse.click(shell.input.screenX, shell.input.screenY);
    setup.mockInput.pressKey("x");
    assert.equal(shell.input.plainText, "x");
  } finally {
    watching.abort();
    finish.release();
    interactive.dispose();
    detach();
  }
});
