import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Connection } from "@nyte-ai/sdk";
import { createTestRenderer, ManualClock, TestRecorder } from "@opentui/core/testing";
import type { TestRendererOptions, TestRendererSetup } from "@opentui/core/testing";
import type { Kit } from "../../src/app/context.tsx";
import { drawnPart, mountApp, nextFrame } from "../../src/app/main.tsx";
import type { AppOptions, MountedApp } from "../../src/app/main.tsx";
import type { Store } from "../../src/app/store.ts";
import { holdTypeahead } from "../../src/app/typeahead.ts";
import type { BootOptions } from "../../src/effects/boot.ts";
import type { ShellPort } from "../../src/effects/ports.ts";
import { openCrashLog } from "../../src/effects/crash.ts";
import { keyStrokes } from "../../src/lib/constants.ts";
import type { ChatCommand } from "../../src/lib/constants.ts";
import { hostPort, pluginsPort } from "../../src/effects/host-port.ts";
import { openTestHost } from "../fixture/host.ts";
import type { TestHost } from "../fixture/host.ts";
import { fakeHost, fakePorts } from "../fixture/ports.ts";
import type { FakeFiles, FakePlugins, FakeShell, FakeTerminal } from "../fixture/ports.ts";

process.env["NYTE_SKIP_VERSION_CHECK"] = "1";

/** How many event-loop turns a wait may take before it fails with the last frame. */
const MAX_TURNS = 3_000;

export interface TuiOptions {
  readonly size?: { readonly width: number; readonly height: number };
  /** Renderer options beside the size, clock and keyboard the harness sets, such as a recording `stdout` and its `environment`. */
  readonly renderer?: Omit<TestRendererOptions, "width" | "height" | "clock" | "kittyKeyboard">;
  /** The in-process host; the harness opens and closes its own when omitted. */
  readonly fixture?: TestHost;
  /**
   * A host to drive in place of the fixture's, such as a bench scenario's `openHost`, with the
   * TUI's own client plugins drawing its parts as `nyte` does. The caller closes it.
   */
  readonly host?: Connection;
  /** `false` keeps the host closed until `openHost()`, as a slow service would. */
  readonly opened?: boolean;
  readonly target?: BootOptions["target"];
  /** Keys typed after the renderer starts reading input but before the app mounts. */
  readonly typed?: string;
  readonly kit?: (kit: Kit) => Kit;
  /** Local ports in place of the fakes, such as a real `shell` running `!` commands; `cwd` is the TUI's folder (default its temp home). */
  readonly local?: { readonly shell?: ShellPort; readonly cwd?: string };
  /** Starts `recorder` just before the app mounts, so frame timestamps count from mount. */
  readonly record?: boolean;
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
  const clock = new ManualClock();
  clock.setTime(Date.now());

  const setup = await createTestRenderer({
    ...options.renderer,
    width: options.size?.width ?? 100,
    height: options.size?.height ?? 32,
    kittyKeyboard: true,
    clock,
  });

  const typeahead = holdTypeahead(setup.renderer);

  if (options.typed !== undefined) await setup.mockInput.typeText(options.typed);
  const fixture = options.fixture ?? (await openTestHost());
  const home = mkdtempSync(join(tmpdir(), "nyte-tui-app-"));
  const fakes = fakePorts(fakeHost());
  const cwd = options.local?.cwd ?? home;
  const opening = Promise.withResolvers<void>();

  if (options.opened !== false) opening.resolve();
  const recorder = new TestRecorder(setup.renderer);

  if (options.record === true) recorder.rec();

  const mounting: AppOptions = {
    renderer: setup.renderer,
    ports: { ...fakes, shell: options.local?.shell ?? fakes.shell, log: openCrashLog(home) },
    cwd,
    typeahead,
    boot: { home, cwd, target: options.target ?? { kind: "new" }, model: null, effort: null },
    async open(dispatch) {
      await opening.promise;

      if (options.host === undefined)
        return {
          host: hostPort(fixture.host, null, () => nextFrame(setup.renderer)),
          plugins: fakes.plugins,
          drawPart: () => null,
          close: async () => undefined,
        };

      const connection = options.host;

      const plugins = await pluginsPort(connection, {
        notify: () => undefined,
        report: (plugin, message) =>
          dispatch({ kind: "inform", tone: "error", text: `plugin ${plugin}: ${message}` }),
      });

      return {
        host: hostPort(connection, null, () => nextFrame(setup.renderer)),
        plugins,
        drawPart: (message) => drawnPart(setup.renderer, plugins.draw(message)),
        close: () => plugins.dispose(),
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
        (store) => store.state().facts.phase.kind === "ready" && store.screen().blocked === null,
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

/** When the first recorded frame showing `text` was drawn, in ms since recording began. */
export function shownAt(tui: Pick<Tui, "recorder">, text: string): number | undefined {
  return tui.recorder.recordedFrames.find((recorded) => recorded.frame.includes(text))?.timestamp;
}
