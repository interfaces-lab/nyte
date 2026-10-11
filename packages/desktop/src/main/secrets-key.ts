import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SdkError } from "@nyte-ai/sdk";
import type { OpenHostOptions } from "@nyte-ai/sdk";
import type { SecretCipher } from "./account-store.ts";

/** Returns the sealed key file's text, or null when there is none yet. */
async function readSealed(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
    throw cause;
  }
}

/**
 * Returns the host's secrets key sealed by the OS keychain: the 32 bytes at
 * `path`, opened with `cipher`, or minted, sealed and written (mode 0600)
 * on first use. The key is read on the first call, once per process. Where the keychain would
 * store it in plain text the key rejects `unavailable`, so secrets stay
 * unwritable rather than readable on disk.
 */
export function sealedSecretsKey(
  path: string,
  cipher: SecretCipher,
): NonNullable<OpenHostOptions["secrets"]> {
  const read = async (): Promise<Uint8Array> => {
    if (!(await cipher.available()))
      throw new SdkError("unavailable", "This system's keychain can't seal the secrets key.");
    const sealed = await readSealed(path);

    if (sealed !== null) return new Uint8Array(Buffer.from(await cipher.open(sealed), "base64"));
    const key = crypto.getRandomValues(new Uint8Array(32));
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, await cipher.seal(Buffer.from(key).toString("base64")), {
      mode: 0o600,
      flag: "wx",
    });

    return key;
  };

  let key: Promise<Uint8Array> | null = null;

  return { key: () => (key ??= read()) };
}
