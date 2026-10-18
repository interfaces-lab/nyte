import { resolve } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { SdkError } from "@nyte-ai/schema";
import { STORE_VERSION } from "@nyte-ai/core/store";
import { parseNumber, parseText } from "./store-rows.ts";

const CONTEND_MS = 1_000;

const SQLITE_BUSY = 5;

interface Claim {
  readonly lock: DatabaseSync;
  holders: number;
}

const claims = new Map<string, Claim>();

/** Another live process owns the store, so this one can't open it; the message names the owner. */
export class StoreOwned extends SdkError {
  constructor(message: string) {
    super("unavailable", message);
  }
}

/**
 * Makes this process the one owner of the file store at `path`, which alone opens,
 * migrates and writes it, and returns what gives the claim up. The claim is a write lock
 * this process holds on `<path>.owner`, a SQLite file whose one row names the owner's pid,
 * program and store version; the operating system drops the lock when the process exits,
 * so a crashed owner leaves no claim to clear. Claims of one path in this process share
 * the lock until the last is given up. Throws `StoreOwned`, an `SdkError("unavailable")`
 * naming the owner, when another process holds the claim.
 */
export function claimStore(path: string): () => void {
  const key = resolve(path);
  const claim = claims.get(key) ?? { lock: lockStore(key), holders: 0 };
  claims.set(key, claim);
  claim.holders += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    claim.holders -= 1;

    if (claim.holders > 0) return;
    claims.delete(key);
    claim.lock.close();
  };
}

function lockStore(path: string): DatabaseSync {
  const lock = new DatabaseSync(`${path}.owner`, { timeout: CONTEND_MS });

  try {
    reserve(lock, path);
    lock.exec(
      "CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, program TEXT NOT NULL, store INTEGER NOT NULL)",
    );
    lock
      .prepare("INSERT OR REPLACE INTO owner (id, pid, program, store) VALUES (1, ?, ?, ?)")
      .run(process.pid, process.execPath, STORE_VERSION);
    lock.exec("COMMIT");
    reserve(lock, path);
  } catch (cause) {
    lock.close();

    throw cause;
  }

  return lock;
}

function reserve(lock: DatabaseSync, path: string): void {
  try {
    lock.exec("BEGIN IMMEDIATE");
  } catch (cause) {
    if (!(cause instanceof Error && "errcode" in cause && cause.errcode === SQLITE_BUSY))
      throw cause;

    throw new StoreOwned(
      `${describeOwner(lock)} has ${path} open. Nyte opens a store in one process at a time; quit that one and try again.`,
    );
  }
}

function describeOwner(lock: DatabaseSync): string {
  try {
    const row = lock.prepare("SELECT pid, program, store FROM owner WHERE id = 1").get();

    if (row === undefined) return "Another Nyte process";

    return `Another Nyte process (pid ${String(parseNumber(row.pid))}, ${parseText(row.program)}, store version ${String(parseNumber(row.store))})`;
  } catch {
    return "Another Nyte process";
  }
}
