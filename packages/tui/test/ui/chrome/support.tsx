/**
 * Mounts a component under `AppProvider` with a static store: `screen()` is
 * `deriveScreen` of a state the test can replace, `dispatch` records every
 * message, and the kit is the dark theme with a stopped ticker. The composer
 * port the component attaches is kept for the test to drive.
 */
import { SyntaxStyle } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender, useRenderer } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal, onCleanup } from "solid-js";
import { AppProvider } from "../../../src/app/context.tsx";
import type { Kit } from "../../../src/app/context.tsx";
import { DARK_THEME } from "../../../src/lib/theme.ts";
import type { Msg } from "../../../src/model/msg.ts";
import type { ComposerPort } from "../../../src/model/native.ts";
import { deriveScreen } from "../../../src/model/screen.ts";
import type { ScreenModel } from "../../../src/model/screen.ts";
import type { State } from "../../../src/model/state.ts";

export interface Mounted extends TestRendererSetup {
  readonly dispatched: Msg[];
  /** Replaces the state the screen derives from, then draws a frame. */
  show(state: State): Promise<void>;
  /** The ComposerPort the Composer attached, once it mounted. */
  composer(): ComposerPort;
}

async function* noBlob(): AsyncIterable<Uint8Array> {}

export async function mount(
  state: State,
  node: () => JSX.Element,
  size: { readonly width: number; readonly height: number } = { width: 100, height: 32 },
  kitOverrides?: Partial<Kit>,
): Promise<Mounted> {
  const [current, setCurrent] = createSignal(state);
  const dispatched: Msg[] = [];
  let port: ComposerPort | null = null;

  const setup = await testRender(
    () => {
      const renderer = useRenderer();
      const normal = SyntaxStyle.create(renderer.nativeScene);
      const subtle = SyntaxStyle.create(renderer.nativeScene);

      onCleanup(() => {
        normal.destroy();
        subtle.destroy();
      });

      const screen = createMemo<ScreenModel>((previous) =>
        deriveScreen(current(), previous ?? null),
      );

      const kit: Kit = {
        theme: () => DARK_THEME,
        syntax: () => ({ normal, subtle }),
        ticker: () => () => 0,
        now: () => 0,
        report: () => undefined,
        highlight: () => null,
        blob: noBlob,
        drawPart: () => null,
        attach: {
          composer: (attached) => {
            port = attached;

            return () => {
              port = null;
            };
          },
          scroll: () => () => undefined,
        },
        ...kitOverrides,
      };

      return (
        <AppProvider app={{ screen, dispatch: (msg) => dispatched.push(msg), kit }}>
          {node()}
        </AppProvider>
      );
    },
    { ...size, kittyKeyboard: true },
  );

  await setup.renderOnce();

  return {
    ...setup,
    dispatched,
    show: async (next) => {
      setCurrent(next);
      await setup.renderOnce();
    },
    composer: () => {
      if (port === null) throw new Error("The composer did not attach a port.");

      return port;
    },
  };
}
