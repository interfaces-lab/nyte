import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const SECRET_NAMES: ReadonlySet<string> = new Set([
  "auth.json",
  "mcp-auth.json",
  "identity.key",
  "connect.json",
  "host.json",
  "secret.key",
  "secret.sealed",
]);

export function holdsSecrets(path: string): boolean {
  const name = basename(path);

  return SECRET_NAMES.has(name) || name.endsWith(".key") || name.endsWith(".sealed");
}

export function secretFilesIn(names: readonly string[]): string[] {
  return names.filter(holdsSecrets).toSorted();
}

export const NEVER_READ = [...SECRET_NAMES]
  .filter((name) => !name.startsWith("secret."))
  .concat(["*.key", "*.sealed"]);

export async function readShareable(path: string): Promise<string> {
  if (holdsSecrets(path)) throw new Error(`Refusing to read ${basename(path)}: it holds secrets.`);

  return readFile(path, "utf8");
}
