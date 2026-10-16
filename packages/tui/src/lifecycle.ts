import { constants } from "node:os";
import process from "node:process";
import type { Readable, Writable } from "node:stream";

/** The signals that end a Nyte command. A command whose terminal goes away ends as `SIGHUP`. */
export const ENDINGS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export type Ending = (typeof ENDINGS)[number];

/** How long a command may shut down once it ends before the process exits regardless. */
export const SHUTDOWN_DEADLINE_MS = 1_500;

/** The status a shell reports for a process `ending` stops: 128 plus the signal's number, so 130, 143 or 129. */
export function exitStatus(ending: Ending): number {
  return 128 + constants.signals[ending];
}

/**
 * Calls `end` with each of SIGINT, SIGTERM and SIGHUP the process receives, in place of the
 * default that kills it at once, until the returned function stops listening.
 */
export function onEnding(end: (ending: Ending) => void): () => void {
  const listeners = ENDINGS.map((ending) => {
    const listener = (): void => end(ending);
    process.on(ending, listener);

    return { ending, listener };
  });

  return () => {
    for (const { ending, listener } of listeners) process.off(ending, listener);
  };
}

/**
 * Calls `hangUp` once when the terminal is gone: `input` ends, closes or fails to read (EIO), or
 * an output fails to write (EIO, EPIPE). The returned function stops watching. Every stream
 * keeps its error listener, so a write to a revoked terminal during shutdown is dropped rather
 * than thrown as an uncaught error.
 */
export function watchTerminal(
  input: Readable,
  outputs: readonly Writable[],
  hangUp: () => void,
): () => void {
  let watching = true;

  const lost = (): void => {
    if (!watching) return;
    watching = false;
    hangUp();
  };

  input.on("end", lost);
  input.on("close", lost);

  for (const stream of [input, ...outputs]) stream.on("error", lost);

  return () => {
    watching = false;
    input.off("end", lost);
    input.off("close", lost);
  };
}

let armed = false;

/**
 * Bounds the rest of the process: unless it exits sooner, it exits with `status` once
 * `SHUTDOWN_DEADLINE_MS` pass, so a shutdown that waits on a revoked terminal, a frame that never
 * paints or a request that never settles still ends. `status` is also the exit code if the event
 * loop drains first, and the timer holds nothing open. The first call sets the deadline; later
 * calls keep it.
 */
export function exitWithin(status: number): void {
  if (armed) return;
  armed = true;
  process.exitCode = status;
  setTimeout(() => process.exit(status), SHUTDOWN_DEADLINE_MS).unref();
}
