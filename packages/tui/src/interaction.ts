import process from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { AuthInteraction, AuthPrompt } from "@nyte-ai/ai";
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

/** CLI driver for the login funnel: prompts over readline, events to stderr. */
export function cliInteraction(signal: AbortSignal, onInterrupt?: () => void): AuthInteraction {
  return {
    signal,
    async prompt(prompt: AuthPrompt): Promise<string> {
      const promptSignal =
        prompt.signal === undefined ? signal : AbortSignal.any([signal, prompt.signal]);

      promptSignal.throwIfAborted();

      if (!process.stdin.isTTY || !process.stderr.isTTY) {
        throw new Error(
          "Authentication requires input. Run `nyte login <provider>` in an interactive terminal; use --method oauth or --method api_key to choose a login method.",
        );
      }

      if (prompt.type === "select") {
        if (prompt.options.length === 0) throw new Error("No authentication choices available.");

        for (const [index, option] of prompt.options.entries()) {
          const description =
            option.description === undefined
              ? ""
              : ` ${dim(option.description, ansiEnabled(process.stderr))}`;

          console.error(
            `  ${dim(`${String(index + 1)}.`, ansiEnabled(process.stderr))} ${option.label}${description}`,
          );
        }

        const answer = await ask(`${prompt.message} [1] `, promptSignal, false, onInterrupt);
        const choice = prompt.options[Number(answer.trim() || "1") - 1];

        if (choice === undefined) throw new Error(`Invalid choice: ${answer}`);

        return choice.id;
      }

      const hint = prompt.placeholder === undefined ? "" : ` (${prompt.placeholder})`;

      return ask(`${prompt.message}${hint} `, promptSignal, prompt.type === "secret", onInterrupt);
    },
    notify(event) {
      switch (event.type) {
        case "auth_url":
          console.error(
            `\n${event.instructions ?? "Open this URL to continue:"}\n\n  ${cyan(event.url, ansiEnabled(process.stderr))}\n`,
          );
          break;
        case "device_code": {
          const lead = event.instructions === undefined ? "" : `${event.instructions}\n`;
          console.error(
            `\n${lead}Visit ${event.verificationUri} and enter code: ${bold(event.userCode, ansiEnabled(process.stderr))}\n`,
          );
          break;
        }

        case "info":
        case "progress":
          console.error(event.message);
          break;
      }
    },
  };
}
