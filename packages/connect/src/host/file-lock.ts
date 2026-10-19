import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const SQLITE_BUSY = 5;

export function tryLockFile(path: string): (() => void) | null {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = new DatabaseSync(path, { timeout: 0 });

  try {
    lock.exec("BEGIN IMMEDIATE");
  } catch (cause) {
    lock.close();

    if (cause instanceof Error && "errcode" in cause && cause.errcode === SQLITE_BUSY) return null;

    throw cause;
  }

  let released = false;

  return () => {
    if (released) return;
    released = true;
    lock.close();
  };
}

export async function lockFile(path: string, waitMs = 10_000): Promise<() => void> {
  const deadline = Date.now() + waitMs;

  for (;;) {
    const release = tryLockFile(path);

    if (release !== null) return release;

    if (Date.now() > deadline) throw new Error(`${path} stayed locked for ${String(waitMs)} ms.`);
    await sleep(20);
  }
}
