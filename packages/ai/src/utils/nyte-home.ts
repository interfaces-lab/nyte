import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/** Root for nyte's per-user files (auth.json, models-store.json). */
export function defaultNyteHome(): string {
  return process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");
}
