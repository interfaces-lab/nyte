import { createEffect, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { TerminalPort } from "../effects/ports.ts";
import { TERMINAL_TITLE_BASE, terminalTitle } from "../lib/format.ts";
import { CLEARED, encode } from "../lib/program-status.ts";
import { themeFor } from "../lib/theme.ts";
import type { CliTheme } from "../lib/theme.ts";
import type { Store } from "./store.ts";

interface Sinks {
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

    return themeFor(settings.theme, facts.theme);
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
