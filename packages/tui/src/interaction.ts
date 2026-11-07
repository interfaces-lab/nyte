import process from "node:process";
import type { Key } from "node:readline";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import open from "open";
import type { Choice, LoginDriver } from "./services/auth.ts";
import { CliError } from "./cli/errors.ts";
import { formatRows, formatStatus, paint, printable } from "./cli/format.ts";
import type { Mode } from "./cli/mode.ts";

/**
 * Column 1, then erase to the end of the screen: what readline writes before a visible prompt, so
 * the hidden one also replaces a progress line such as `Starting a Nyte host…`.
 */
const CLEAR_LINE = "\x1b[1G\x1b[0J";

/**
 * Asks `message` on the terminal through readline, which owns raw mode and editing; a `secret`
 * answer suppresses all of readline's echo, redraws after backspace, paste and cursor moves
 * included. Ctrl+C, Esc and Ctrl+D cancel through `onInterrupt`.
 */
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

  const interrupt = (): void => {
    closed.abort(new Error("Authentication cancelled."));
    onInterrupt?.();
  };

  const escape = (_text: string | undefined, key: Key): void => {
    if (key.name === "escape") interrupt();
  };

  rl.once("SIGINT", interrupt);
  rl.once("close", interrupt);
  process.stdin.on("keypress", escape);

  try {
    const answer = rl.question(secret ? "" : message, {
      signal: AbortSignal.any([signal, closed.signal]),
    });

    if (secret) process.stderr.write(`${CLEAR_LINE}${message}`);

    return await answer;
  } finally {
    rl.off("SIGINT", interrupt);
    rl.off("close", interrupt);
    process.stdin.off("keypress", escape);
    rl.close();
    hidden?.destroy();

    if (secret || signal.aborted) process.stderr.write("\n");
  }
}

/** One line on stderr. Never `console.error`, which Bun paints red on a terminal. */
function say(text: string): void {
  process.stderr.write(`${text}\n`);
}

/**
 * Prompts and sign-in links on stderr. `browser` opens sign-in links on this machine; it is off
 * without an interactive terminal, over SSH and with `--no-open`.
 */
export function cliLoginDriver(
  mode: Mode,
  signal: AbortSignal,
  onInterrupt?: () => void,
  browser: boolean = mode.browser,
): LoginDriver {
  const presentation = mode.stderr;

  const interactive = (): void => {
    signal.throwIfAborted();

    if (!mode.interactive)
      throw new CliError("missing_input", "Can't sign in without an interactive terminal.");
  };

  return {
    signal,
    open(url, code) {
      if (browser) void open(url).catch(() => undefined);
      say("");
      say(
        formatStatus(
          "none",
          browser ? "Opening your browser to sign in…" : "Sign in from a browser on any device:",
          presentation,
        ),
      );

      for (const line of formatRows(
        [
          { label: "Link", value: paint(presentation, "cyan", printable(url)) },
          ...(code === undefined ? [] : [{ label: "Code", value: printable(code) }]),
        ],
        presentation,
      ))
        say(line);
      say("");
    },
    async paste(message, secret, superseded) {
      interactive();

      return ask(
        `${formatStatus("prompt", printable(message), presentation)} `,
        AbortSignal.any([signal, superseded]),
        secret,
        onInterrupt,
      );
    },
    async choose(message, options, superseded) {
      interactive();
      const first = options[0];

      if (first === undefined) throw new Error("No choices to pick from.");

      for (const [index, option] of options.entries())
        say(`  ${String(index + 1)}. ${choiceText(option, index === 0)}`);

      for (;;) {
        const answer = (
          await ask(
            `${formatStatus("prompt", printable(message), presentation)} `,
            AbortSignal.any([signal, superseded]),
            false,
            onInterrupt,
          )
        ).trim();

        if (answer === "") return first.id;
        const choice = /^\d+$/u.test(answer) ? options[Number(answer) - 1] : undefined;

        if (choice !== undefined) return choice.id;
        say(
          formatStatus(
            "warn",
            `Type a number from 1 to ${String(options.length)}, or press Enter for 1.`,
            presentation,
          ),
        );
      }
    },
    progress(message) {
      say(formatStatus("none", message, presentation));
    },
  };
}

/** Enter picks the first choice, so it alone is marked `(default)`; a provider's own marker is dropped. */
function choiceText(option: Choice, first: boolean): string {
  const label = printable(option.label).replace(/ \(default\)$/u, "");

  const tags = [
    ...(first ? ["default"] : []),
    ...(option.description === undefined ? [] : [printable(option.description)]),
  ];

  return tags.length === 0 ? label : `${label} (${tags.join(", ")})`;
}
