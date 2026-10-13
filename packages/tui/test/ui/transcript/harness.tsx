/**
 * Renders transcript components under a static `App`: the screen is derived
 * from a `State` signal the test can replace, dispatches are recorded, the
 * kit is the real one (`createKit`) over the test renderer, and the tickers
 * run on a manual schedule the test advances.
 */
import type { TestRendererOptions, TestRendererSetup } from "@opentui/core/testing";
import { useRenderer } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { AppProvider } from "../../../src/app/context.tsx";
import type { App } from "../../../src/app/context.tsx";
import { createKit } from "../../../src/app/kit.ts";
import { createTickers } from "../../../src/app/ticker.ts";
import { DARK_THEME } from "../../../src/lib/theme.ts";
import type { Msg } from "../../../src/model/msg.ts";
import { deriveScreen } from "../../../src/model/screen.ts";
import type { ScreenModel } from "../../../src/model/screen.ts";
import type { State } from "../../../src/model/state.ts";
import { render } from "../../fixture/render.tsx";

export interface ManualSchedule {
  readonly schedule: (callback: () => void, intervalMs: number) => () => void;
  /** Fires every live interval once. */
  advance(): void;
  /** Intervals scheduled and not yet cleared. */
  active(): number;
}

export function manualSchedule(): ManualSchedule {
  const callbacks = new Set<() => void>();

  return {
    schedule(callback) {
      callbacks.add(callback);

      return () => callbacks.delete(callback);
    },
    advance() {
      for (const callback of callbacks) callback();
    },
    active: () => callbacks.size,
  };
}

export interface TranscriptHarness extends TestRendererSetup {
  readonly dispatched: Msg[];
  readonly screen: Accessor<ScreenModel>;
  readonly setState: (state: State) => void;
  readonly clock: ManualSchedule;
}

async function* noBytes(): AsyncIterable<Uint8Array> {
  yield new Uint8Array();
}

export async function renderWithApp(
  initial: State,
  node: (app: App) => JSX.Element,
  options?: TestRendererOptions,
): Promise<TranscriptHarness> {
  const dispatched: Msg[] = [];
  const clock = manualSchedule();
  const [state, setState] = createSignal(initial);
  const screen = createMemo(() => deriveScreen(state(), null));

  const setup = await render(() => {
    const renderer = useRenderer();
    const tickers = createTickers({ now: () => 0 }, clock.schedule);

    const kit = createKit({
      renderer,
      theme: () => DARK_THEME,
      tickers,
      blob: () => noBytes(),
      drawPart: () => null,
      attach: { composer: () => () => undefined, scroll: () => () => undefined },
      report: (origin, error) =>
        dispatched.push({
          kind: "failure",
          failure: { origin, message: String(error), logPath: "/home/.nyte/logs/tui.log" },
        }),
    });

    const app: App = { screen, dispatch: (msg) => dispatched.push(msg), kit };

    return <AppProvider app={app}>{node(app)}</AppProvider>;
  }, options);

  return { ...setup, dispatched, screen, setState, clock };
}
