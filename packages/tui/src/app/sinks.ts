/**
 * Derived outputs written to the terminal: the title, OSC 7501 program
 * status, and the palette the kit draws with. Each is an effect over a memo
 * with an idempotent write, so they need no state of their own. Call under a
 * Solid owner; the returned `dispose` resets the title and clears the
 * program status before the renderer goes, once however often it is called.
 */
import { createEffect, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { TerminalPort } from "../effects/ports.ts";
import { TERMINAL_TITLE_BASE, terminalTitle } from "../lib/format.ts";
import { CLEARED, encode } from "../lib/program-status.ts";
import { resolveThemeMode, themeForMode } from "../lib/theme.ts";
import type { CliTheme } from "../lib/theme.ts";
import type { Store } from "./store.ts";

export interface Sinks {
  readonly theme: Accessor<CliTheme>;
  dispose(): void;
}

export function installSinks(store: Store, terminal: TerminalPort): Sinks {
  const title = createMemo(() => {
    const session = store.state().facts.session;

    return session === null ? null : terminalTitle(session.info.name ?? undefined);
  });

  const program = createMemo(() => encode(store.screen().program));

  const theme = createMemo(() => {
    const { settings, terminal: facts } = store.state().facts;

    return themeForMode(resolveThemeMode(settings.theme, facts.theme));
  });

  createEffect(() => {
    const next = title();

    if (next !== null) terminal.setTitle(next);
  });
  createEffect(() => terminal.programStatus(program()));
  let disposed = false;

  return {
    theme,
    dispose() {
      if (disposed) return;
      disposed = true;
      terminal.setTitle(TERMINAL_TITLE_BASE);
      terminal.programStatus(CLEARED);
    },
  };
}
