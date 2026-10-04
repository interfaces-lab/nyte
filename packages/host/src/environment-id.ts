import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isFileError, nyteHome } from "./paths.ts";

/** Connect's `Uuid`: a lowercase v4 UUID, as `crypto.randomUUID()` writes it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function readEnvironmentId(path: string): Promise<string | undefined> {
  const text = await readFile(path, "utf8").catch((cause: unknown) => {
    if (isFileError(cause, ["ENOENT"])) return undefined;
    throw cause;
  });

  if (text === undefined) return undefined;
  const id = text.trim();

  if (!UUID.test(id)) throw new Error(`Corrupt environment id: ${path}`);

  return id;
}

/**
 * This installation's environment id: every host sharing `nyteHome()` reads
 * the same one. Created once and never replaced; a Connect link has its own.
 */
export async function environmentId(): Promise<string> {
  const home = nyteHome();
  const path = join(home, "environment-id");
  const existing = await readEnvironmentId(path);

  if (existing !== undefined) return existing;
  await mkdir(home, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const temporary = `${path}.${id}.tmp`;

  try {
    await writeFile(temporary, `${id}\n`, { flag: "wx", mode: 0o600 });
    // A link appears complete or not at all, and never replaces a concurrent winner.
    await link(temporary, path);

    return id;
  } catch (cause) {
    if (!isFileError(cause, ["EEXIST"])) throw cause;
    const winner = await readEnvironmentId(path);

    if (winner === undefined) throw cause;

    return winner;
  } finally {
    await rm(temporary, { force: true });
  }
}
