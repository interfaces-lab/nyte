import { readFile } from "node:fs/promises";
import { basename } from "node:path";

/**
 * Files under ~/.nyte that hold credentials or keys. doctor checks their modes
 * with stat; nothing in doctor or triage opens them.
 */
const SECRET_NAMES: ReadonlySet<string> = new Set([
  "auth.json",
  "mcp-auth.json",
  "identity.key",
  "connect.json",
  "host.json",
  "secret.key",
  "secret.sealed",
]);

/** True for a file name doctor and triage must never read. */
export function holdsSecrets(path: string): boolean {
  const name = basename(path);

  return SECRET_NAMES.has(name) || name.endsWith(".key") || name.endsWith(".sealed");
}

/** The secret files among directory entry names. Listing names reads no contents. */
export function secretFilesIn(names: readonly string[]): string[] {
  return names.filter(holdsSecrets).toSorted();
}

/** The names triage lists as never read, for the person deciding whether to share. */
export const NEVER_READ = [...SECRET_NAMES]
  .filter((name) => !name.startsWith("secret."))
  .concat(["*.key", "*.sealed"]);

/** Reads a text file, refusing any secret file by name. Every triage read goes through this. */
export async function readShareable(path: string): Promise<string> {
  if (holdsSecrets(path)) throw new Error(`Refusing to read ${basename(path)}: it holds secrets.`);

  return readFile(path, "utf8");
}
