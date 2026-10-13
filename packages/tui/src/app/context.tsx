/**
 * The one context. Components get the screen, a way to send messages, and
 * the drawing kit (theme, syntax styles, blobs, plugin renderers, tickers).
 * They do not get ports, the SDK or the state: what they draw is
 * `screen()`, what they change is `dispatch(...)`.
 */
import type { Renderable, SyntaxStyle, TextChunk } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createContext, useContext } from "solid-js";
import type { Accessor } from "solid-js";
import type { PartMessage } from "../lib/view-helpers.ts";
import type { CliTheme } from "../lib/theme.ts";
import type { Msg } from "../model/msg.ts";
import type { ComposerPort, ScrollPort } from "../model/native.ts";
import type { ScreenModel } from "../model/screen.ts";
import type { FailureReport } from "../model/state.ts";

export interface App {
  readonly screen: Accessor<ScreenModel>;
  dispatch(msg: Msg): void;
  readonly kit: Kit;
}

export interface Kit {
  readonly theme: Accessor<CliTheme>;
  /** Owned by the kit (`app/kit.ts`): rebuilt on retheme, the previous pair destroyed after the swap. */
  readonly syntax: Accessor<{ readonly normal: SyntaxStyle; readonly subtle: SyntaxStyle }>;
  /** A shared ticker per interval; it runs only while something reads it. */
  ticker(intervalMs: number): Accessor<number>;
  /** The app clock; read it under a `ticker` to redraw as time passes. */
  now(): number;
  /** Writes the crash log and shows the failure with the log's path (a plugin part's boundary). */
  report(origin: FailureReport["origin"], error: unknown): void;
  /**
   * A one-line label (a shell command) highlighted as `filetype`, or null
   * while the grammar answers or when none claims it. Reactive: a reader
   * redraws once the highlights land.
   */
  highlight(text: string, filetype: string): readonly TextChunk[] | null;
  blob(id: string): AsyncIterable<Uint8Array>;
  /** The plugin renderer's view for a part, or null when no plugin draws its kind. */
  drawPart(message: PartMessage): Renderable | null;
  /** The Composer and the Transcript attach their native handles while mounted; only the runner calls them. */
  readonly attach: {
    composer(port: ComposerPort): () => void;
    scroll(port: ScrollPort): () => void;
  };
}

const AppContext = createContext<App>();

export function AppProvider(props: {
  readonly app: App;
  readonly children: JSX.Element;
}): JSX.Element {
  return <AppContext.Provider value={props.app}>{props.children}</AppContext.Provider>;
}

export function useApp(): App {
  const app = useContext(AppContext);

  if (app === undefined) throw new Error("useApp needs an AppProvider above it.");

  return app;
}
