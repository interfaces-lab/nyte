import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Connection } from "@nyte-ai/sdk";
import { CodeRenderable } from "@opentui/core";
import type { Renderable } from "@opentui/core";
import { createTestRenderer, ManualClock, TestRecorder } from "@opentui/core/testing";
import type { TestRendererOptions, TestRendererSetup } from "@opentui/core/testing";
import type { Kit } from "../../src/app/context.tsx";
import { createKeymap } from "../../src/app/keyboard.ts";
import { mountApp, resumeOptions } from "../../src/app/mount.tsx";
import type { AppOptions, MountedApp } from "../../src/app/mount.tsx";
import type { Store } from "../../src/app/store.ts";
import { holdTypeahead } from "../../src/app/typeahead.ts";
import type { BootOptions } from "../../src/effects/boot.ts";
import { openCrashLog } from "../../src/effects/crash.ts";
import type { SettingsPort, ShellPort } from "../../src/effects/ports.ts";
import { watchTerminal } from "../../src/lifecycle.ts";
import type { Selection } from "../../src/model/state.ts";
import { keyStrokes } from "../../src/lib/constants.ts";
import type { ChatCommand } from "../../src/lib/constants.ts";
import { openTestHost } from "../fixture/host.ts";
import type { TestHost } from "../fixture/host.ts";
import { fakeHost, fakePorts } from "../fixture/ports.ts";
import type { FakeFiles, FakePlugins, FakeShell, FakeTerminal } from "../fixture/ports.ts";

process.env["NYTE_SKIP_VERSION_CHECK"] = "1";

const MAX_TURNS = 3_000;

export interface TuiOptions {
  readonly size?: { readonly width: number; readonly height: number };
  readonly renderer?: Omit<TestRendererOptions, "width" | "height" | "clock" | "kittyKeyboard">;
  readonly fixture?: TestHost;
  readonly host?: Connection;
  readonly opened?: boolean;
  readonly target?: BootOptions["target"];
  readonly typed?: string;
  readonly kit?: (kit: Kit) => Kit;
  readonly local?: { readonly shell?: ShellPort; readonly cwd?: string };
  readonly record?: boolean;
  readonly firstFrame?: Selection;
  readonly settings?: SettingsPort;
}

export interface Tui extends TestRendererSetup {
  readonly app: MountedApp;
  readonly store: Store;
  readonly fixture: TestHost;
  readonly clock: ManualClock;
  readonly recorder: TestRecorder;
  readonly terminal: FakeTerminal;
  readonly files: FakeFiles;
  readonly plugins: FakePlugins;
  readonly shell: FakeShell;
  readonly home: string;
  openHost(): void;
  press(command: ChatCommand): void;
  send(text: string): Promise<void>;
  until(done: () => boolean): Promise<void>;
  frame(predicate: (frame: string) => boolean): Promise<string>;
  state(predicate: (store: Store) => boolean): Promise<void>;
  /** Renders until no code block is still waiting on its syntax highlight. */
  highlighted(): Promise<void>;
  ready(): Promise<void>;
  remount(): Promise<void>;
}

export async function startTui(options: TuiOptions = {}): Promise<Tui> {
  const fixture = options.fixture ?? (await openTestHost());
  const home = mkdtempSync(join(tmpdir(), "nyte-tui-app-"));
  const fakes = fakePorts(fakeHost());
  fakes.firstFrame.saved = options.firstFrame ?? null;
  const cwd = options.local?.cwd ?? home;
  const opening = Promise.withResolvers<void>();

  if (options.opened !== false) opening.resolve();
  const clock = new ManualClock();
  clock.setTime(Date.now());

  const setup = await createTestRenderer({
    ...options.renderer,
    width: options.size?.width ?? 100,
    height: options.size?.height ?? 32,
    kittyKeyboard: true,
    clock,
  });

  const recorder = new TestRecorder(setup.renderer);

  if (options.record === true) recorder.rec();
  const typeahead = holdTypeahead(setup.renderer);

  if (options.typed !== undefined) await setup.mockInput.typeText(options.typed);
  const hungUp = new AbortController();
  const unwatchTerminal = watchTerminal(setup.renderer.stdin, [], () => hungUp.abort());
  const connection = options.host ?? fixture.host;

  const mounting: AppOptions = {
    renderer: setup.renderer,
    keymap: createKeymap(setup.renderer),
    hungUp: hungUp.signal,
    host: opening.promise.then(() => ({ connection, endpoint: null, folder: null })),
    ...(options.host === undefined
      ? {
          plugins: async () => ({
            ...fakes.plugins,
            draw: () => undefined,
            dispose: async () => undefined,
          }),
        }
      : {}),
    ports: {
      ...fakes,
      shell: options.local?.shell ?? fakes.shell,
      settings: options.settings ?? fakes.settings,
      log: openCrashLog(home),
    },
    cwd,
    typeahead,
    boot: {
      start: "launch",
      home,
      cwd,
      target: options.target ?? { kind: "new" },
      model: null,
      effort: null,
    },
    ...(options.kit === undefined ? {} : { kit: options.kit }),
  };

  let app = await mountApp(mounting);

  const until = async (done: () => boolean): Promise<void> => {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      await setup.renderOnce();

      if (done()) return;
      await Bun.sleep(1);
    }

    throw new Error(
      `Not settled after ${String(MAX_TURNS)} turns. Last frame:\n${setup.captureCharFrame()}`,
    );
  };

  const frame = async (predicate: (frame: string) => boolean): Promise<string> => {
    await until(() => predicate(setup.captureCharFrame()));

    return setup.captureCharFrame();
  };

  const state = (predicate: (store: Store) => boolean): Promise<void> =>
    until(() => predicate(app.store));

  let disposed: Promise<void> | null = null;

  const dispose = (): Promise<void> =>
    (disposed ??= (async () => {
      opening.resolve();
      recorder.stop();
      await app.close();
      unwatchTerminal();
      await setup.dispose();

      if (options.fixture === undefined) await fixture.close();
      rmSync(home, { recursive: true, force: true });
    })());

  return {
    ...setup,
    get app() {
      return app;
    },
    get store() {
      return app.store;
    },
    async remount() {
      const held = holdTypeahead(setup.renderer);
      const carry = app.carry();
      await app.close();
      app = await mountApp(resumeOptions(mounting, carry, held));
    },
    fixture,
    clock,
    recorder,
    terminal: fakes.terminal,
    files: fakes.files,
    plugins: fakes.plugins,
    shell: fakes.shell,
    home,
    openHost: () => opening.resolve(),
    press(command) {
      const [stroke] = keyStrokes(command);

      if (stroke === undefined) throw new Error(`No key is bound to ${command}.`);
      setup.renderer.keyInput.processParsedKey({
        name: stroke.name,
        ctrl: stroke.ctrl ?? false,
        shift: stroke.shift ?? false,
        meta: false,
        option: stroke.meta ?? false,
        super: stroke.super ?? false,
        sequence: "",
        raw: "",
        number: false,
        eventType: "press",
        source: "kitty",
      });
    },
    async send(text) {
      await setup.mockInput.typeText(text);
      setup.mockInput.pressEnter();
    },
    until,
    frame,
    state,
    highlighted: () => until(() => !highlighting(setup.renderer.root)),
    async ready() {
      await state(
        (store) => store.state().facts.catalog.catalog !== null && store.screen().blocked === null,
      );
    },
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
}

function highlighting(node: Renderable): boolean {
  if (node instanceof CodeRenderable && node.isHighlighting) return true;

  return node.getChildren().some((child) => highlighting(child));
}

export function composerShows(frame: string, text: string): boolean {
  return frame
    .split("\n")
    .some((line) => line.trimStart().startsWith(`│ ❯ ${text}`) && line.trimEnd().endsWith("│"));
}

export function belowComposer(frame: string, text: string): boolean {
  const lines = frame.split("\n");
  const border = lines.findIndex((line) => composerBorder(line));

  return border >= 0 && lines.slice(border + 1).some((line) => line.includes(text));
}

function composerBorder(line: string): boolean {
  return line.trimStart().startsWith("╰─ ") && line.includes(" │ ");
}

export function footerShows(frame: string, model: string, level: string): boolean {
  return frame
    .split("\n")
    .some(
      (line) =>
        composerBorder(line) &&
        line.includes(`│ ${model} │`) &&
        new RegExp(`\\b${level}\\b`, "u").test(line),
    );
}

export function cursorCell(
  setup: Pick<TestRendererSetup, "captureSpans">,
): readonly [number, number] {
  const [column, row] = setup.captureSpans().cursor;

  return [column - 1, row - 1];
}

export function shownAt(
  tui: Pick<Tui, "recorder">,
  shows: (frame: string) => boolean,
): number | undefined {
  return tui.recorder.recordedFrames.find((recorded) => shows(recorded.frame))?.timestamp;
}
