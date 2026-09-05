import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import {
  contentText,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  InMemoryCredentialStore,
} from "@nyte-ai/ai";
import { WorkspaceTrustStore } from "@nyte-ai/core";
import type { StreamFn } from "@nyte-ai/core";
import { definePlugin, inlinePlugin, skillsPlugin, toolsFsPlugin } from "@nyte-ai/core/plugins";
import { questionPlugin } from "@nyte-ai/plugin/examples/question";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema";
import { createCliRenderer } from "@opentui/core";
import type { ClipboardRepresentation, ClipboardService, KeyEvent } from "@opentui/core";
import {
  createMockKeys,
  createMockMouse,
  createTestRenderer,
  TestRecorder,
} from "@opentui/core/testing";
import { loadAuthenticatedModels } from "../../src/catalog.ts";
import { CHAT_KEYBINDS } from "../../src/constants.ts";
import type { ChatCommand } from "../../src/constants.ts";
import { parseFlags } from "../../src/flags.ts";
import { Host } from "../../src/host.ts";
import { Interactive } from "../../src/interactive.ts";
import { laneRoles } from "../../src/lanes.ts";
import { FileSettingsStore } from "../../src/settings.ts";
import { buildShell } from "../../src/shell.ts";
import { DARK_THEME } from "../../src/theme.ts";

export type TranscriptSize = "short" | "long";
export type Mode = "headless" | "show";

const keyNames = new Map([
  ["return", "RETURN"],
  ["escape", "ESCAPE"],
  ["tab", "TAB"],
  ["space", " "],
  ["up", "ARROW_UP"],
  ["down", "ARROW_DOWN"],
  ["pageup", "\u001b[5~"],
  ["pagedown", "\u001b[6~"],
]);

const model: Model<Api> = {
  id: "qa-model",
  name: "QA Model",
  provider: "qa",
  api: "openai-responses",
  baseUrl: "https://example.invalid",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 4000,
};

export async function openFixture(size: TranscriptSize, mode: Mode, record: boolean) {
  const root = process.env["NYTE_QA_ROOT"];
  assert.ok(root, "Use the QA launcher to isolate credentials and plugin discovery");
  const cwd = await mkdtemp(join(root, "workspace-"));
  const cleanups: (() => void | Promise<void>)[] = [
    () => rm(cwd, { recursive: true, force: true }),
  ];
  const cleanup = async () => {
    const errors: unknown[] = [];
    for (const dispose of cleanups.splice(0).toReversed()) {
      try {
        await dispose();
      } catch (cause) {
        errors.push(cause);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "QA teardown failed");
  };
  try {
    const skillDir = join(cwd, ".nyte", "skills", "qa-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: qa-skill\ndescription: Local QA skill\n---\nReply with QA skill received.\n",
    );
    const editor = join(cwd, "editor.mjs");
    await writeFile(
      editor,
      'import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], " edited by QA");\n',
    );
    const requests: string[] = [];
    let holding = false;
    let release: (() => void) | undefined;
    const stream = (
      selected: Parameters<StreamFn>[0],
      context: Parameters<StreamFn>[1],
      options?: Parameters<StreamFn>[2],
    ) => {
      const last = context.messages.findLast((message) => message.role === "user");
      const input = last === undefined ? "" : contentText(last.content);
      requests.push(input);
      const text =
        context.messages.at(-1)?.role === "toolResult"
          ? "QA tool finished"
          : input.startsWith("seed")
            ? size === "short"
              ? "One line reply."
              : Array.from(
                  { length: 24 },
                  (_, index) => `Transcript line ${index + 1}: ${input}.`,
                ).join("\n")
            : `QA reply: ${input}`;
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text }],
        api: selected.api,
        provider: selected.provider,
        model: selected.id,
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const events = createAssistantMessageEventStream();
      if (
        context.messages.at(-1)?.role === "user" &&
        (input === "run QA task" || input === "run slow QA task" || input === "ask QA question")
      ) {
        const called: AssistantMessage = {
          ...message,
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: "qa-call",
              name: input !== "ask QA question" ? "bash" : "question",
              arguments:
                input === "run slow QA task"
                  ? { command: "printf 'QA task started\\n'; sleep 30" }
                  : input === "run QA task"
                    ? { command: "printf 'QA task output %s\\n' 1 2 3 4 5 6 7 8 9" }
                    : {
                        question: "QA question",
                        options: [{ label: "First choice" }, { label: "Second choice" }],
                      },
            },
          ],
        };
        events.push({ type: "start", partial: { ...called, content: [] } });
        events.push({ type: "done", reason: "toolUse", message: called });
        return events;
      }
      const finish = async () => {
        events.push({ type: "start", partial: { ...message, content: [] } });
        events.push({
          type: "text_start",
          contentIndex: 0,
          partial: { ...message, content: [{ type: "text", text: "" }] },
        });
        events.push({
          type: "text_delta",
          contentIndex: 0,
          delta: holding ? "Waiting for QA" : text,
          partial: message,
        });
        if (holding) {
          await new Promise<void>((resolve) => {
            release = resolve;
            if (options?.signal?.aborted) resolve();
            else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        if (options?.signal?.aborted) {
          events.push({
            type: "error",
            reason: "aborted",
            error: { ...message, stopReason: "aborted" },
          });
          return;
        }
        events.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
        events.push({ type: "done", reason: "stop", message });
      };
      void finish();
      return events;
    };
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("qa", async () => ({ type: "api_key", key: "fixture-only" }));
    const models = createModels({ credentials });
    const provider = createProvider({
      id: "qa",
      name: "QA Provider",
      models: [model, { ...model, id: "qa-second", name: "QA Second" }],
      auth: {
        apiKey: {
          name: "QA key",
          resolve: async ({ credential }) =>
            credential?.key === undefined ? undefined : { auth: { apiKey: credential.key } },
          login: async (interaction) => ({
            type: "api_key",
            key: await interaction.prompt({ type: "secret", message: "QA key" }),
          }),
        },
      },
      api: { stream, streamSimple: stream },
    });
    models.setProvider(provider);
    await loadAuthenticatedModels(models);
    const host = await Host.open({
      cwd,
      storePath: join(cwd, "sessions.db"),
      models,
      model,
      streamFn: stream,
      watchPollIntervalMs: 5,
      plugins: [
        inlinePlugin(toolsFsPlugin()),
        inlinePlugin(questionPlugin),
        inlinePlugin(skillsPlugin({ directories: [join(cwd, ".nyte", "skills")] })),
        inlinePlugin(
          definePlugin({
            id: "qa-fixture",
            session(api) {
              api.prompt.add((draft) => draft.set("qa", { text: "Local test fixture." }));
              api.commands.add((commands) =>
                commands.set("qa-command", {
                  description: "Local QA command",
                  run: async (argument) => `QA command: ${argument}`,
                }),
              );
              api.settings.add((settings) =>
                settings.set("qa-setting", {
                  label: "QA setting",
                  key: "qa",
                  fallback: "off",
                  choices: [
                    { id: "off", label: "off" },
                    { id: "on", label: "on" },
                  ],
                }),
              );
            },
          }),
        ),
      ],
    });
    cleanups.push(() => host.close());
    const detach = host.attach();
    cleanups.push(detach);
    const info = await host.nyte.sessions.create();
    for (let index = 0; index < (size === "short" ? 1 : 6); index += 1) {
      await host.nyte.messages.send({ sessionId: info.sessionId, content: `seed ${index + 1}` });
      await host.nyte.runs.wait({ sessionId: info.sessionId });
      assert.equal(
        (await host.nyte.runs.current({ sessionId: info.sessionId }))?.phase.kind,
        "done",
        "Seed completed through the real host",
      );
    }
    const setup =
      mode === "headless"
        ? await createTestRenderer({
            width: 100,
            height: 30,
            useThread: false,
            kittyKeyboard: true,
            autoFocus: false,
            openConsoleOnError: false,
          })
        : undefined;
    const renderer =
      setup?.renderer ??
      (await createCliRenderer({
        exitOnCtrlC: false,
        exitSignals: [],
        autoFocus: false,
        useThread: false,
        clearOnShutdown: true,
        openConsoleOnError: false,
        targetFps: 30,
        useKittyKeyboard: {},
      }));
    cleanups.push(() => renderer.destroy());
    const keys = createMockKeys(renderer, { kittyKeyboard: true });
    const mouse = createMockMouse(renderer);
    const recorder = new TestRecorder(renderer);
    if (record) recorder.rec();
    cleanups.push(() => recorder.stop());
    const roles = laneRoles(host.nyte.landing);
    const shell = buildShell(renderer, DARK_THEME, roles, () => {});
    const settingsStore = new FileSettingsStore(join(cwd, "settings.json"));
    cleanups.push(async () => {
      await settingsStore.read(cwd);
    });
    await settingsStore.updateGlobal({
      externalEditor: `${process.execPath} ${editor}`,
      theme: "dark",
      autoUpdate: false,
    });
    let quit = false;
    const copies: string[] = [];
    let clipboardContent: ClipboardRepresentation | Promise<ClipboardRepresentation> = {
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("clipboard QA"),
    };
    // Exercise the native clipboard boundary without reading or overwriting the user's clipboard.
    const clipboard: ClipboardService = {
      read: async () => ({ status: "read", representation: await clipboardContent }),
      writeText: async (text) => {
        copies.push(text);
        return {
          host: { status: "written" },
          terminal: { status: "not-attempted", capability: "unknown" },
        };
      },
      clear: async () => ({
        host: { status: "cleared" },
        terminal: { status: "not-attempted", capability: "unknown" },
      }),
      dispose: async () => {},
    };
    const app = new Interactive({
      renderer,
      shell,
      host,
      runtime: { models, provider },
      roles,
      settings: await settingsStore.read(cwd),
      settingsStore,
      workspace: await new WorkspaceTrustStore(join(cwd, "trust.json")).trust(cwd),
      fallback: { model, thinkingLevel: "off" },
      themeMode: "dark",
      onSettings: () => {},
      requestShutdown: () => {
        quit = true;
      },
      clipboard,
    });
    cleanups.push(() => app.dispose());
    await app.start({ ...parseFlags([]), resume: { kind: "session", id: info.sessionId } });
    const interrupted = new AbortController();
    let driving = false;
    const onKey = (event: KeyEvent) => {
      if (mode !== "show" || driving || !event.ctrl || event.name !== "c") return;
      event.preventDefault();
      event.stopPropagation();
      interrupted.abort();
    };
    renderer.keyInput.prependListener("keypress", onKey);
    cleanups.push(() => {
      renderer.keyInput.off("keypress", onKey);
    });
    renderer.start();
    let lastFrame = "";
    const frame = () => {
      if (!renderer.isDestroyed)
        lastFrame = new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes(true));
      return lastFrame;
    };
    const paint = async () => {
      if (renderer.isDestroyed) return;
      if (setup !== undefined) await setup.renderOnce();
      else {
        renderer.requestRender();
        await setTimeout(40);
      }
    };
    const until = async (check: () => boolean | Promise<boolean>, description: string) => {
      const deadline = Date.now() + 5000;
      do {
        interrupted.signal.throwIfAborted();
        await paint();
        if (await check()) return;
        await setTimeout(10);
      } while (Date.now() < deadline);
      throw new Error(`${description}\n${frame()}`);
    };
    const see = (text: string) =>
      until(() => frame().includes(text), `Expected frame to contain ${JSON.stringify(text)}`);
    const key = async (name: string, modifiers: Parameters<typeof keys.pressKey>[1] = {}) => {
      driving = true;
      try {
        keys.pressKey(name, modifiers);
      } finally {
        driving = false;
      }
      await paint();
    };
    const type = async (text: string) => {
      await keys.typeText(text, mode === "show" ? 12 : 0);
      await paint();
    };
    const command = async (name: string) => {
      assert.equal(shell.input.plainText, "", "Command starts from an empty composer");
      await type(`/${name}`);
      await key("RETURN");
    };
    const shortcut = async (name: ChatCommand) => {
      const binding = CHAT_KEYBINDS[name].split(",")[0] ?? "";
      const parts = binding.split("+");
      const button = parts.at(-1) ?? "";
      await key(keyNames.get(button) ?? button, {
        ctrl: parts.includes("ctrl"),
        shift: parts.includes("shift"),
      });
    };
    await paint();
    await see(size === "short" ? "One line reply." : "Transcript line 24: seed 6.");
    return {
      app,
      host,
      shell,
      renderer,
      keys,
      mouse,
      copies,
      setClipboard(content: ClipboardRepresentation | Promise<ClipboardRepresentation>) {
        clipboardContent = content;
      },
      models,
      credentials,
      settingsStore,
      requests,
      size,
      sessionId: info.sessionId,
      frame,
      until,
      see,
      key,
      type,
      command,
      shortcut,
      didQuit: () => quit,
      wasInterrupted: () => interrupted.signal.aborted,
      cancel() {
        interrupted.abort();
        holding = false;
        release?.();
      },
      hold() {
        holding = true;
      },
      release() {
        holding = false;
        release?.();
      },
      async resize(width: number, height: number) {
        renderer.resize(width, height);
        await paint();
      },
      async pause() {
        if (mode === "show" && !renderer.isDestroyed)
          await setTimeout(500, undefined, { signal: interrupted.signal });
      },
      async close() {
        holding = false;
        release?.();
        await cleanup();
      },
      recordedFrames: () => recorder.recordedFrames,
    };
  } catch (cause) {
    await cleanup();
    throw cause;
  }
}

export type Fixture = Awaited<ReturnType<typeof openFixture>>;
