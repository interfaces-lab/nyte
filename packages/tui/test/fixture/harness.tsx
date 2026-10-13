// oxlint-disable no-unused-vars -- scaffold: parameters are used once the body is implemented
/**
 * Two harnesses over `testRender` from @opentui/solid.
 *
 * - `renderScreen(state)`: a static store (dispatch records messages) around
 *   a component, for drawing tests. No runner.
 * - `startApp(fixture)`: the real store, runner, keymap and `<Root/>` over
 *   the real in-process host (`openTestHost()` in host.ts) through
 *   `hostPort`, the other ports faked; behaviour tests drive it with
 *   `mockInput` and assert on what the scripted provider received.
 */
import type { TestRendererSetup } from "@opentui/core/testing";
import type { JSX } from "@opentui/solid";
import type { Msg } from "../../src/model/msg.ts";
import type { State } from "../../src/model/state.ts";
import type { Store } from "../../src/app/store.ts";
import type { TestHost } from "./host.ts";

export interface ScreenHarness extends TestRendererSetup {
  readonly dispatched: Msg[];
}

export async function renderScreen(
  state: State,
  node: () => JSX.Element,
  size?: { readonly width: number; readonly height: number },
): Promise<ScreenHarness> {
  throw new Error("not implemented");
}

export interface AppHarness extends TestRendererSetup {
  readonly store: Store;
  readonly host: TestHost;
  /** Drains the store queue and every runner effect, then renders once. */
  settle(): Promise<void>;
}

export async function startApp(
  host: TestHost,
  size?: { readonly width: number; readonly height: number },
): Promise<AppHarness> {
  throw new Error("not implemented");
}
