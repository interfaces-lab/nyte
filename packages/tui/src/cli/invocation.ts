import { exitStatus, exitWithin, onEnding } from "../lifecycle.ts";
import type { Ending } from "../lifecycle.ts";
import { CliError, errorClass, exitCode } from "./errors.ts";
import { formatError, formatErrorJson } from "./format.ts";
import type { Output } from "./output.ts";

/** How a command ended, as the entry hands it over. */
export type CommandEnd =
  /** The command chose its code: 0, or a child's code. */
  | { readonly kind: "exit"; readonly code: number }
  /** Something was thrown. A `CliError` keeps its reason; anything else becomes `failed` or `internal_error`. */
  | { readonly kind: "error"; readonly error: unknown };

/**
 * Owns the process's ending for every one-shot command. Replaces `PrintInvocation`.
 * - Cleanups run newest first, and each runs even when an earlier one throws.
 * - `signal` aborts on the first SIGINT, SIGTERM or SIGHUP and arms the shutdown deadline with
 *   128 + n. Long-running commands (host, events, account) wait on this signal; there is no second
 *   listener and no `untilInterrupted`.
 * - `finish` runs every deferred cleanup, then reports once: a received signal wins and exits
 *   128 + n, printing only a `canceled` error, which a command throws to say what its cancel
 *   changed; otherwise a `CliError` prints through `formatError` (or `formatErrorJson` on stderr
 *   when `json`) and exits with its class's code.
 * - `handoff` is for the full-screen TUI only, which installs its own handlers.
 */
export interface Invocation {
  readonly signal: AbortSignal;
  defer(cleanup: () => void | Promise<void>): void;
  handoff(): void;
  finish(end: CommandEnd, json: boolean): Promise<number>;
}

export function createInvocation(output: Output): Invocation {
  const controller = new AbortController();
  const cleanups: (() => void | Promise<void>)[] = [];
  let received: Ending | undefined;
  let finishing: Promise<number> | undefined;

  const stopEnding = onEnding((ending) => {
    exitWithin(exitStatus(ending));
    received ??= ending;
    controller.abort(new Error(`Received ${ending}`));
  });

  const report = (error: unknown, json: boolean): number => {
    const failure = toCliError(error);
    output.say(json ? formatErrorJson(failure) : formatError(failure, output.mode.stderr));

    return exitCode(failure.reason);
  };

  const complete = async (end: CommandEnd, json: boolean): Promise<number> => {
    let cleanupFailed = false;

    for (const cleanup of cleanups.toReversed()) {
      try {
        await cleanup();
      } catch {
        cleanupFailed = true;
      }
    }

    stopEnding();

    if (received !== undefined) {
      if (
        end.kind === "error" &&
        end.error instanceof CliError &&
        errorClass(end.error.reason) === "canceled"
      )
        report(end.error, json);

      return exitStatus(received);
    }

    if (end.kind === "error") return report(end.error, json);

    if (cleanupFailed)
      return report(new CliError("failed", "Couldn't clean up before exiting."), json);

    return end.code;
  };

  return {
    signal: controller.signal,
    defer: (cleanup) => void cleanups.push(cleanup),
    handoff: stopEnding,
    finish: (end, json) => {
      finishing ??= complete(end, json);

      return finishing;
    },
  };
}

function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;

  if (error instanceof Error) return new CliError("failed", error.message);

  return new CliError("internal_error", "Nyte stopped on a value that isn't an error.");
}
