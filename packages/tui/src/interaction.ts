import process from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import open from "open";
import type { LoginDriver } from "./services/auth.ts";
import { ansiEnabled, bold, cyan, dim } from "./cli-style.ts";

/** Asks `message` on the terminal through readline, which owns raw mode and editing; a `secret` answer suppresses all of readline's echo, redraws after backspace, paste and cursor moves included. */
async function ask(
  message: string,
  signal: AbortSignal,
  secret = false,
  onInterrupt?: () => void,
): Promise<string> {
  signal.throwIfAborted();

  const hidden = secret
    ? new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      })
    : undefined;

  const rl = createInterface({
    input: process.stdin,
    output: hidden ?? process.stderr,
    terminal: true,
    historySize: 0,
  });

  const closed = new AbortController();
  const cancel = (): void => closed.abort(new Error("Authentication cancelled."));

  const interrupt = (): void => {
    cancel();
    onInterrupt?.();
  };

  rl.once("SIGINT", interrupt);
  rl.once("close", cancel);

  try {
    const answer = rl.question(secret ? "" : message, {
      signal: AbortSignal.any([signal, closed.signal]),
    });

    if (secret) process.stderr.write(message);

    return await answer;
  } finally {
    rl.off("SIGINT", interrupt);
    rl.off("close", cancel);
    rl.close();
    hidden?.destroy();

    if (secret || signal.aborted) process.stderr.write("\n");
  }
}

export function cliLoginDriver(signal: AbortSignal, onInterrupt?: () => void): LoginDriver {
  const interactive = (): void => {
    signal.throwIfAborted();

    if (!process.stdin.isTTY || !process.stderr.isTTY)
      throw new Error(
        "Authentication requires input. Run `nyte login <provider>` in an interactive terminal; use --method oauth or --method api_key to choose a login method.",
      );
  };

  return {
    signal,
    open(url, code) {
      const color = ansiEnabled(process.stderr);

      void open(url).catch(() => undefined);
      console.error(
        code === undefined
          ? `\nOpening your browser. If it doesn't open, visit:\n\n  ${cyan(url, color)}\n`
          : `\nVisit ${cyan(url, color)} and enter code: ${bold(code, color)}\n`,
      );
    },
    async paste(message, secret, superseded) {
      interactive();

      return ask(`${message} `, AbortSignal.any([signal, superseded]), secret, onInterrupt);
    },
    async choose(message, options, superseded) {
      interactive();

      if (options.length === 0) throw new Error("No authentication choices available.");

      for (const [index, option] of options.entries())
        console.error(
          `  ${dim(`${String(index + 1)}.`, ansiEnabled(process.stderr))} ${option.label}`,
        );

      const answer = await ask(
        `${message} [1] `,
        AbortSignal.any([signal, superseded]),
        false,
        onInterrupt,
      );

      const choice = options[Number(answer.trim() || "1") - 1];

      if (choice === undefined) throw new Error(`Invalid choice: ${answer}`);

      return choice.id;
    },
    progress(message) {
      console.error(message);
    },
  };
}
