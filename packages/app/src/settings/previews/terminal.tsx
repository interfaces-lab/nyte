import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { nyte } from "../../contract/nyte.ts";
import { loadGhostty } from "../../workbench/terminal/ghostty.ts";
import { openThemedTerminal } from "../../workbench/terminal/terminal-runtime.ts";
import { terminalShell } from "../terminal.tsx";

const LISTING = "README.md  package.json  \u001b[1;34msrc\u001b[0m";

export function TerminalPreview(): ReactElement {
  return <div ref={mountTerminalPreview} {...props(styles.host)} />;
}

/** A display-only terminal opened like the app's, showing a prompt for the configured shell. */
function mountTerminalPreview(host: HTMLDivElement | null): (() => void) | undefined {
  if (host === null) return undefined;
  const unmounted = new AbortController();

  void loadGhostty().then((engine) => {
    if (unmounted.signal.aborted) return;

    const themed = openThemedTerminal(
      engine,
      host,
      { smoothScrollDuration: 0, disableStdin: true, cursorWithoutFocus: true },
      () => themed.fit.fit(),
    );

    const showPrompt = (): void => {
      const prompt = shellPrompt(terminalShell.get());
      themed.terminal.write(`\u001bc${prompt}ls\r\n${LISTING}\r\n${prompt}`);
    };

    const stopShell = terminalShell.subscribe(showPrompt);
    themed.fit.fit();
    themed.fit.observeResize();
    showPrompt();
    unmounted.signal.addEventListener("abort", () => {
      stopShell();
      themed.dispose();
    });
  });

  return () => unmounted.abort();
}

/** Each shell's default prompt. Without a configured shell it's the login shell, zsh on macOS. */
function shellPrompt(shell: string | null | undefined): string {
  const name = shell?.split("/").at(-1) ?? (nyte.platform === "darwin" ? "zsh" : "bash");

  if (name === "fish") return "~/nyte> ";

  if (name === "zsh") return "~/nyte % ";

  return "~/nyte $ ";
}

const styles = create({
  host: {
    height: 80,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    boxSizing: "border-box",
  },
});
