/**
 * Drives the production TUI end to end.
 *
 * `boot()` seeds the sandbox world (`test/sandbox`: pre-trusted workspace,
 * mock provider, transcripts written through the real harness), then calls
 * the same `runTui` the binary calls. Every flow is a script of keystrokes
 * plus assertions on the character frame the renderer paints.
 *
 * Headless by default: OpenTUI's test renderer, no pty, no network, no
 * `~/.uji`. With `UJI_QA_SHOW` set a scripted walkthrough runs on the real
 * terminal at a pace a viewer can follow (`pnpm qa:show`).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import type { CapturedFrame, CliRenderer } from "@opentui/core";
import { createMockKeys, createTestRenderer } from "@opentui/core/testing";
import type { MockInput } from "@opentui/core/testing";
import { BUSY_COMPOSER_PLACEHOLDER, COMPOSER_PLACEHOLDER } from "../../src/constants.ts";
import { createTuiRenderer, runTui } from "../../src/interactive.ts";
import { DOUBLE_ESCAPE_MS } from "../../src/lifecycle.ts";
import type { TuiExit } from "../../src/interactive.ts";
import { startMockProvider } from "../sandbox/provider.ts";
import { findScenario } from "../sandbox/scenarios.ts";
import { createSandbox, seedHome, seedSessions } from "../sandbox/seed.ts";
import { DemoProgress } from "./demo-progress.ts";

type KeyInput = Parameters<MockInput["pressKey"]>[0];
type Modifiers = Parameters<MockInput["pressKey"]>[1];

const SHOW = process.env["UJI_QA_SHOW"] !== undefined;
/** At the default 2× show speed, typed input lands at 20 ms per character. */
const BASE_TYPING_MS = 40;

export interface Qa {
  /** The renderer under test, for layout inspection in headless flows. */
  renderer: CliRenderer;
  frame(): string;
  /** Colored cells from the same buffer `frame()` reads as characters. Headless only. */
  spans(): CapturedFrame;
  type(text: string): Promise<void>;
  key(name: KeyInput, modifiers?: Modifiers): Promise<void>;
  /** Empties the composer, whatever a previous step left in it. */
  clear(): Promise<void>;
  /** Escape, then the double-escape window, so the next Escape is a fresh press. */
  escape(): Promise<void>;
  /** Types a prompt, submits it, and returns once the run is busy. */
  submit(text: string): Promise<void>;
  /** Waits for the run to end and the composer to take prompts again. */
  idle(timeoutMs?: number): Promise<string>;
  /** Holds the current `qa:show` case for its playback beat. Headless runs do not wait. */
  pause(durationMs?: number): Promise<void>;
  /** Advances the visible `qa:show` progress header. No-op when boot skipped demoSteps. */
  demo(label: string): Promise<void>;
  /** Polls the frame until `predicate` holds, or throws with the last frame after `timeoutMs`. */
  until(predicate: (frame: string) => boolean, timeoutMs?: number): Promise<string>;
  /** Resolves when `runTui` returns, however the TUI was closed. */
  exited: Promise<TuiExit>;
  /** Destroys the renderer, waits for `runTui` to return, and removes the sandbox. */
  close(): Promise<void>;
}

type Outcome = { kind: "running" } | { kind: "exited" } | { kind: "failed"; error: unknown };

export async function boot(
  options: {
    resume?: boolean;
    width?: number;
    height?: number;
    demoSteps?: number;
    scenario?: string;
  } = {},
): Promise<Qa> {
  const provider = await startMockProvider();
  const root = await mkdtemp(join(tmpdir(), "uji-qa-"));
  const scenario = findScenario(options.scenario ?? "tools");
  const sandbox = await createSandbox(root, scenario);
  await seedHome(sandbox, provider.baseUrl);
  await seedSessions(sandbox, scenario);

  // Skill and plugin discovery also reads `~/.claude`, `~/.agents`, `~/.uji`.
  // Bun fixes `os.homedir()` at startup, so the scripts point `HOME` at an
  // empty directory before this process exists.
  process.env["HOME"] = sandbox.home;
  process.env["UJI_HOME"] = sandbox.home;
  process.env["UJI_SKIP_VERSION_CHECK"] = "1";

  // The headless renderer paints only when asked; the terminal one runs its own loop.
  const stage = SHOW
    ? {
        renderer: await createTuiRenderer(),
        paint: async (): Promise<void> => undefined,
        captureSpans: undefined as (() => CapturedFrame) | undefined,
      }
    : await (async () => {
        const setup = await createTestRenderer({
          width: options.width ?? 100,
          height: options.height ?? 30,
          kittyKeyboard: true,
        });
        return {
          renderer: setup.renderer,
          paint: setup.renderOnce,
          captureSpans: (): CapturedFrame => setup.captureSpans(),
        };
      })();
  const { renderer, paint } = stage;
  const keys = createMockKeys(renderer, { kittyKeyboard: !SHOW });
  let driving = false;
  const invocationCwd = process.cwd();
  process.chdir(sandbox.workspace);
  let exited: Promise<TuiExit>;
  try {
    exited = runTui(
      {
        resume: { kind: options.resume === true ? "latest" : "new" },
        print: false,
        json: false,
        quiet: false,
        rest: [],
      },
      { renderer },
    );
  } finally {
    process.chdir(invocationCwd);
  }
  let demoProgress: DemoProgress | undefined;
  if (options.demoSteps !== undefined) {
    const app = renderer.root.findDescendantById("app");
    if (app === undefined) throw new Error("TUI did not mount its app root");
    demoProgress = new DemoProgress(renderer, app, options.demoSteps, {
      isDriving: () => driving,
    });
  }
  // runTui captures its launch directory before its first await. Keeping the
  // test runner in the repository prevents Bun from printing test paths
  // relative to a throwaway workspace.
  // A boot failure would otherwise surface as an `until` timeout.
  let outcome: Outcome = { kind: "running" };
  exited.then(
    () => {
      outcome = { kind: "exited" };
    },
    (error: unknown) => {
      outcome = { kind: "failed", error };
    },
  );

  const decoder = new TextDecoder();
  const frame = (): string => decoder.decode(renderer.currentRenderBuffer.getRealCharBytes(true));
  const until: Qa["until"] = async (predicate, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (outcome.kind === "failed") throw outcome.error;
      await paint();
      const current = frame();
      if (predicate(current)) return current;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for frame\n${current}`);
      }
      await sleep(15);
    }
  };
  const step = async (): Promise<void> => {
    await paint();
    await demoProgress?.checkpoint();
  };
  const drive = async (action: () => void | Promise<void>): Promise<void> => {
    await demoProgress?.checkpoint();
    driving = true;
    try {
      await action();
    } finally {
      driving = false;
    }
  };

  const qa: Qa = {
    renderer,
    frame,
    spans: () => {
      if (stage.captureSpans === undefined) {
        throw new Error("spans() needs the headless renderer");
      }
      return stage.captureSpans();
    },
    type: async (text) => {
      await drive(() => keys.typeText(text, demoProgress?.typingDelay(BASE_TYPING_MS) ?? 0));
      await step();
    },
    key: async (name, modifiers) => {
      await drive(() => keys.pressKey(name, modifiers));
      await step();
    },
    clear: async () => {
      // The cursor may sit anywhere in the draft: erase behind it, then ahead of it.
      await drive(async () => {
        await keys.pressKeys(Array.from({ length: 200 }, () => "BACKSPACE"));
        await keys.pressKeys(Array.from({ length: 200 }, () => "DELETE"));
      });
      await until((current) => current.includes(COMPOSER_PLACEHOLDER));
    },
    escape: async () => {
      await drive(() => keys.pressEscape());
      await step();
      await sleep(DOUBLE_ESCAPE_MS);
    },
    submit: async (text) => {
      await drive(async () => {
        await keys.typeText(text, demoProgress?.typingDelay(BASE_TYPING_MS) ?? 0);
        keys.pressEnter();
      });
      await until((current) => current.includes(BUSY_COMPOSER_PLACEHOLDER));
      await demoProgress?.checkpoint();
    },
    idle: (timeoutMs) =>
      until(
        (current) => current.includes(COMPOSER_PLACEHOLDER) && !current.includes("Working"),
        timeoutMs,
      ),
    pause: async (durationMs) => {
      if (demoProgress !== undefined && durationMs === undefined) {
        await demoProgress.finishFrame();
        return;
      }
      await sleep(durationMs ?? 0);
    },
    demo: async (label) => {
      demoProgress?.advance(label);
      await step();
    },
    until,
    exited,
    close: async () => {
      // After `/quit` the app has already torn the renderer down.
      if (outcome.kind === "running") renderer.destroy();
      try {
        await exited;
      } finally {
        await provider.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  };
  // The powerline lands after the host opens; a flow may start typing then.
  await qa.until((current) => current.includes("uji-sandbox"));
  return qa;
}
