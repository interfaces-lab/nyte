import process from "node:process";
import { fileURLToPath } from "node:url";

/** Whether this runs in the compiled binary, whose modules Bun serves from its virtual filesystem. */
export const compiled =
  import.meta.url.includes("$bunfs") ||
  import.meta.url.includes("~BUN") ||
  import.meta.url.includes("%7EBUN");

/** How to run this nyte again: the binary itself, or bun with the source entry. */
export function selfCommand(): readonly [string, ...string[]] {
  return compiled
    ? [process.execPath]
    : [process.execPath, fileURLToPath(new URL("./binary.ts", import.meta.url))];
}
