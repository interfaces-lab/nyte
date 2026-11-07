import process from "node:process";
import { fileURLToPath } from "node:url";

export const compiled =
  import.meta.url.includes("$bunfs") ||
  import.meta.url.includes("~BUN") ||
  import.meta.url.includes("%7EBUN");

export function selfCommand(): readonly [string, ...string[]] {
  return compiled
    ? [process.execPath]
    : [process.execPath, fileURLToPath(new URL("./binary.ts", import.meta.url))];
}
