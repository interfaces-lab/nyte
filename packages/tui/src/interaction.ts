import process from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { LoginDriver } from "./services/auth.ts";
import { ansiEnabled, bold, cyan, dim } from "./cli-style.ts";

async function ask(
  message: string,
  signal: AbortSignal,
  secret = false,
  onInterrupt?: () => void,
): Promise<string> {
  signal.throwIfAborted();

  // Readline owns raw mode and editing. Suppress its entire echo for secrets,
  // including redraws after backspace, paste, and cursor movement.
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

    if (secret) process.stderr.write("\n");
  }
}

/** CLI driver for a host login: prompts over readline, steps to stderr. */
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

      console.error(
        code === undefined
          ? `\nOpen this URL to continue:\n\n  ${cyan(url, color)}\n`
          : `\nVisit ${url} and enter code: ${bold(code, color)}\n`,
      );
    },
    async paste(message, secret) {
      interactive();

      return ask(`${message} `, signal, secret, onInterrupt);
    },
    async choose(message, options) {
      interactive();

      if (options.length === 0) throw new Error("No authentication choices available.");

      for (const [index, option] of options.entries())
        console.error(
          `  ${dim(`${String(index + 1)}.`, ansiEnabled(process.stderr))} ${option.label}`,
        );

      const answer = await ask(`${message} [1] `, signal, false, onInterrupt);
      const choice = options[Number(answer.trim() || "1") - 1];

      if (choice === undefined) throw new Error(`Invalid choice: ${answer}`);

      return choice.id;
    },
    progress(message) {
      console.error(message);
    },
  };
}
