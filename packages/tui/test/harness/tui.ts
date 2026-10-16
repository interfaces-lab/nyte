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
import type { BootOptions } from "../../src/effects/boot.ts";
import { openCrashLog } from "../../src/effects/crash.ts";
import { hostPort } from "../../src/effects/host-port.ts";
import { openTestHost } from "../fixture/host.ts";
import type { TestHost } from "../fixture/host.ts";
import { fakeHost, fakePorts } from "../fixture/ports.ts";
import type { FakePlugins, FakeTerminal } from "../fixture/ports.ts";

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
  readonly kit?: (kit: Kit) => Kit;
}

/** The whole TUI on a test renderer, its timers on a `ManualClock`, over an in-process host. */
export interface Tui extends TestRendererSetup {
  readonly app: MountedApp;
  readonly store: Store;
  readonly fixture: TestHost;
  readonly clock: ManualClock;
  readonly recorder: TestRecorder;
  readonly terminal: FakeTerminal;
  readonly plugins: FakePlugins;
  readonly home: string;
  /** `performance.now()` just before the app mounted. */
  readonly mountedAt: number;
  openHost(): void;
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
    width: options.size?.width ?? 100,
    height: options.size?.height ?? 32,
    kittyKeyboard: true,
    clock,
  });

  const fixture = options.fixture ?? (await openTestHost());
  const home = mkdtempSync(join(tmpdir(), "nyte-tui-app-"));
  const fakes = fakePorts(fakeHost());
  const opening = Promise.withResolvers<void>();

  if (options.opened !== false) opening.resolve();
  const mountedAt = performance.now();

  const mounting: AppOptions = {
    renderer: setup.renderer,
    ports: { ...fakes, log: openCrashLog(home) },
    cwd: home,
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

  const dispose = async (): Promise<void> => {
    opening.resolve();
    await app.close();
    await setup.dispose();

    if (options.fixture === undefined) await fixture.close();
    rmSync(home, { recursive: true, force: true });
  };

  return {
    ...setup,
    app,
    store: app.store,
    fixture,
    clock,
    recorder: new TestRecorder(setup.renderer),
    terminal: fakes.terminal,
    plugins: fakes.plugins,
    home,
    mountedAt,
    openHost: () => opening.resolve(),
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
