import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SQLITE_BUSY = 5;

export interface StoreOwner {
  readonly pid: number;
  readonly program: string;
}

export function readStoreOwner(path: string): StoreOwner | undefined {
  const file = `${path}.owner`;

  if (!existsSync(file)) return undefined;
  const lock = new DatabaseSync(file, { timeout: 0 });

  try {
    try {
      lock.exec("BEGIN IMMEDIATE");
      lock.exec("ROLLBACK");

      return undefined;
    } catch (cause) {
      if (!(cause instanceof Error && "errcode" in cause && cause.errcode === SQLITE_BUSY))
        throw cause;
    }

    const row = lock.prepare("SELECT pid, program FROM owner WHERE id = 1").get();
    const pid = row === undefined ? undefined : Number(row.pid);
    const program = row === undefined ? undefined : row.program;

    return pid !== undefined && Number.isInteger(pid) && pid > 0 && typeof program === "string"
      ? { pid, program }
      : undefined;
  } finally {
    lock.close();
  }
}
