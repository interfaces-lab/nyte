import { constants } from "node:os";
import process from "node:process";
import type { Readable, Writable } from "node:stream";

const ENDINGS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export type Ending = (typeof ENDINGS)[number];

const SHUTDOWN_DEADLINE_MS = 1_500;

export function exitStatus(ending: Ending): number {
  return 128 + constants.signals[ending];
}

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

export function exitWithin(status: number): void {
  if (armed) return;
  armed = true;
  process.exitCode = status;
  setTimeout(() => process.exit(status), SHUTDOWN_DEADLINE_MS).unref();
}
