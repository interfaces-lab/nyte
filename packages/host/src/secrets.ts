import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OpenOptions } from "@nyte-ai/core";
import { SdkError } from "@nyte-ai/core";
import { codeOf } from "./local/tree.ts";

/** Returns where a host gets the 32-byte key core encrypts secrets with: `OpenOptions.secrets` (decision 10). */
export type SecretsSource = NonNullable<OpenOptions["secrets"]>;

/**
 * Returns the Node host's default secrets key: `<home>/.nyte/secret.key`, 32
 * raw bytes (decision 10; §43d as amended by §43i).
 *
 * The first `key()` reads the file, or mints 32 random bytes into it when it
 * is absent; the returned source memoises a resolved answer itself (a
 * rejected one is not kept, so the next call reads again, §43k), and two
 * sources for one home share nothing but the file. Minting is `mintKeyFile`'s. A
 * stored key that is not 32 bytes rejects `SdkError("invalid")` and an
 * unreadable file `SdkError("unavailable")`.
 *
 * There is no keychain here: a desktop supplies its own
 * `OpenOptions.secrets.key()` (Electron `safeStorage`).
 */
export function defaultSecrets(home: string): SecretsSource {
  const path = join(home, ".nyte", "secret.key");
  let key: Promise<Uint8Array> | null = null;

  const read = async (): Promise<Uint8Array> => {
    const bytes = await readFile(path)
      .then(
        (stored) => new Uint8Array(stored),
        (error: unknown) => {
          if (codeOf(error) === "ENOENT") return mintKeyFile(path);

          throw error;
        },
      )
      .catch((error: unknown) => {
        throw new SdkError(
          "unavailable",
          `The secrets key at ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    if (bytes.length !== 32)
      throw new SdkError("invalid", `The secrets key at ${path} is ${bytes.length} bytes, not 32.`);

    return bytes;
  };

  return {
    key: () => {
      const known = key ?? read();
      key = known;
      known.catch(() => {
        if (key === known) key = null;
      });

      return known;
    },
  };
}

/**
 * Writes 32 random bytes to `path` and returns them (§43k): first to
 * `<path>.<random>`, created exclusively with mode `0600` and synced, then
 * `link`ed to `path`, so the key file appears whole or not at all; its
 * directory is made `0700`.
 *
 * A lost race (`EEXIST` on the link) reads and returns the winner's file, so
 * every process opening one home at once agrees on one key; `link`, never
 * `rename`, so a loser never replaces it. The temp file is removed either way.
 * The mode is not enforced on Windows.
 */
async function mintKeyFile(path: string): Promise<Uint8Array> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const temp = `${path}.${crypto.randomUUID()}`;
  const file = await open(temp, "wx", 0o600);

  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }

  try {
    await link(temp, path);

    return bytes;
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error;

    return new Uint8Array(await readFile(path));
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}
