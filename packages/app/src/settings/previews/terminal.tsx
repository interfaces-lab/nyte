import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { nyte } from "../../contract/nyte.ts";
import { loadGhostty } from "../../workbench/terminal/ghostty.ts";
import { openTerminalSurface } from "../../workbench/terminal/terminal-surface.ts";
import { terminalShell } from "../terminal.tsx";

const LISTING = "README.md  package.json  \u001b[1;34msrc\u001b[0m";

const encoder = new TextEncoder();

export function TerminalPreview(): ReactElement {
  return (
    <div {...props(styles.host)}>
      <div ref={mountTerminalPreview} {...props(styles.stage)} />
    </div>
  );
}

/** A display-only terminal drawn like the app's, showing a prompt for the configured shell. */
function mountTerminalPreview(host: HTMLDivElement | null): (() => void) | undefined {
  if (host === null) return undefined;
  const unmounted = new AbortController();

  void loadGhostty()
    .then((engine) =>
      openTerminalSurface(engine, host, {
        cursor: true,
        newlineMode: false,
        reply: () => undefined,
        title: () => undefined,
        painted: () => undefined,
        resized: () => undefined,
      }),
    )
    .then((surface) => {
      if (unmounted.signal.aborted) {
        surface.dispose();

        return;
      }

      const showPrompt = (): void => {
        const prompt = shellPrompt(terminalShell.get());
        surface.terminal.reset();
        surface.terminal.write(encoder.encode(`${prompt}ls\r\n${LISTING}\r\n${prompt}`));
        surface.draw(true);
      };

      const stopShell = terminalShell.subscribe(showPrompt);
      surface.show();
      showPrompt();
      unmounted.signal.addEventListener("abort", () => {
        stopShell();
        surface.dispose();
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
  stage: { position: "relative", width: "100%", height: "100%" },
});
