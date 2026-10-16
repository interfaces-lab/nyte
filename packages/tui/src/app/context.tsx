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
  readonly syntax: Accessor<{ readonly normal: SyntaxStyle; readonly subtle: SyntaxStyle }>;
  ticker(intervalMs: number): Accessor<number>;
  now(): number;
  report(origin: FailureReport["origin"], error: unknown): void;
  highlight(text: string, filetype: string): readonly TextChunk[] | null;
  blob(id: string): AsyncIterable<Uint8Array>;
  drawPart(message: PartMessage): Renderable | null;
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
