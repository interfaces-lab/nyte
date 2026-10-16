import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createTestRenderer, ManualClock, TestRecorder } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import type { Kit } from "../../src/app/context.tsx";
import { mountApp } from "../../src/app/main.tsx";
import type { AppOptions, MountedApp } from "../../src/app/main.tsx";
import type { Store } from "../../src/app/store.ts";
import { holdTypeahead } from "../../src/app/typeahead.ts";
import type { BootOptions } from "../../src/effects/boot.ts";
import { openCrashLog } from "../../src/effects/crash.ts";
import type { SettingsPort } from "../../src/effects/ports.ts";
import type { Selection } from "../../src/model/state.ts";
import { keyStrokes } from "../../src/lib/constants.ts";
import type { ChatCommand } from "../../src/lib/constants.ts";
import { hostPort } from "../../src/effects/host-port.ts";
import { openTestHost } from "../fixture/host.ts";
import type { TestHost } from "../fixture/host.ts";
import { fakeHost, fakePorts } from "../fixture/ports.ts";
import type { FakeFiles, FakePlugins, FakeShell, FakeTerminal } from "../fixture/ports.ts";

process.env["NYTE_SKIP_VERSION_CHECK"] = "1";

/** How many event-loop turns a wait may take before it fails with the last frame. */
const MAX_TURNS = 3_000;

export interface TuiOptions {
  readonly size?: { readonly width: number; readonly height: number };
  /** The in-process host; the harness opens and closes its own when omitted. */
  readonly fixture?: TestHost;
  /** `false` keeps the host closed until `openHost()`, as a slow service would. */
  readonly opened?: boolean;
  readonly target?: BootOptions["target"];
  /** Keys typed after the renderer starts reading input but before the app mounts. */
  readonly typed?: string;
  readonly kit?: (kit: Kit) => Kit;
  /** Starts `recorder` as soon as the renderer exists, before keys are held or the app mounts, so frame timestamps count from launch. */
  readonly record?: boolean;
  /** What the last launch recorded for the first frame; none when omitted. */
  readonly firstFrame?: Selection;
  /** Replaces the fake settings, which read as `SETTINGS`. */
  readonly settings?: SettingsPort;
}

/** The whole TUI on a test renderer, its timers on a `ManualClock`, over an in-process host. */
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
  /** Presses the first key bound to `command`, as the keymap sees it. */
  press(command: ChatCommand): void;
  /** Types `text` and presses Enter. */
  send(text: string): Promise<void>;
  /** Renders until `done` holds; fails after a bounded number of turns with the last frame. */
  until(done: () => boolean): Promise<void>;
  /** Renders until the frame satisfies `predicate` and returns it. */
  frame(predicate: (frame: string) => boolean): Promise<string>;
  state(predicate: (store: Store) => boolean): Promise<void>;
  ready(): Promise<void>;
}

export async function startTui(options: TuiOptions = {}): Promise<Tui> {
  const fixture = options.fixture ?? (await openTestHost());
  const home = mkdtempSync(join(tmpdir(), "nyte-tui-app-"));
  const fakes = fakePorts(fakeHost());
  fakes.firstFrame.saved = options.firstFrame ?? null;
  const opening = Promise.withResolvers<void>();

  if (options.opened !== false) opening.resolve();
  const clock = new ManualClock();
  clock.setTime(Date.now());

  const setup = await createTestRenderer({
    width: options.size?.width ?? 100,
    height: options.size?.height ?? 32,
    kittyKeyboard: true,
    clock,
  });

  const recorder = new TestRecorder(setup.renderer);

  if (options.record === true) recorder.rec();
  const typeahead = holdTypeahead(setup.renderer);

  if (options.typed !== undefined) await setup.mockInput.typeText(options.typed);

  const mounting: AppOptions = {
    renderer: setup.renderer,
    ports: { ...fakes, settings: options.settings ?? fakes.settings, log: openCrashLog(home) },
    cwd: home,
    typeahead,
    boot: { home, cwd: home, target: options.target ?? { kind: "new" }, model: null, effort: null },
    async open() {
      await opening.promise;

      return {
        host: hostPort(fixture.host, null),
        plugins: fakes.plugins,
        drawPart: () => null,
        close: async () => undefined,
      };
    },
  };

  const app = await mountApp(
    options.kit === undefined ? mounting : { ...mounting, kit: options.kit },
  );

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
      await setup.dispose();

      if (options.fixture === undefined) await fixture.close();
      rmSync(home, { recursive: true, force: true });
    })());

  return {
    ...setup,
    app,
    store: app.store,
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
    async ready() {
      await state(
        (store) => store.state().facts.catalog.catalog !== null && store.screen().blocked === null,
      );
    },
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
}

/** The composer's row reads `❯ text…` inside its border. */
export function composerShows(frame: string, text: string): boolean {
  return frame
    .split("\n")
    .some((line) => line.trimStart().startsWith(`│ ❯ ${text}`) && line.trimEnd().endsWith("│"));
}

/** `text` shows on a row below the composer's bottom border, where menus and panels open. */
export function belowComposer(frame: string, text: string): boolean {
  const lines = frame.split("\n");
  const border = lines.findIndex((line) => composerBorder(line));

  return border >= 0 && lines.slice(border + 1).some((line) => line.includes(text));
}

function composerBorder(line: string): boolean {
  return line.trimStart().startsWith("╰─ ") && line.includes(" │ ");
}

/** The composer's bottom border names the model and thinking level. */
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

/** The cursor's 0-based column and row; `captureSpans` reports it 1-based. */
export function cursorCell(
  setup: Pick<TestRendererSetup, "captureSpans">,
): readonly [number, number] {
  const [column, row] = setup.captureSpans().cursor;

  return [column - 1, row - 1];
}

/** When the first recorded frame that `shows` was drawn, in ms since recording began. */
export function shownAt(
  tui: Pick<Tui, "recorder">,
  shows: (frame: string) => boolean,
): number | undefined {
  return tui.recorder.recordedFrames.find((recorded) => shows(recorded.frame))?.timestamp;
}
