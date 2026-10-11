import type { OpenOptions } from "@nyte-ai/core";

/** Returns where a host gets the 32-byte key core encrypts secrets with: `OpenOptions.secrets` (decision 10). */
export type SecretsSource = NonNullable<OpenOptions["secrets"]>;

/**
 * Returns the Node host's default secrets key: `<home>/.nyte/secret.key`, 32
 * raw bytes (decision 10; §43d as amended by §43i).
 *
 * The first `key()` reads the file, or mints 32 random bytes into it when it
 * is absent; the returned source memoises that answer itself, so two sources
 * for one home share nothing but the file. Minting is `mintKeyFile`'s. A
 * stored key that is not 32 bytes rejects `SdkError("invalid")` and an
 * unreadable file `SdkError("unavailable")`.
 *
 * There is no keychain here: a desktop supplies its own
 * `OpenOptions.secrets.key()` (Electron `safeStorage`).
 */
export function defaultSecrets(home: string): SecretsSource {
  throw new Error("not implemented");
}

/**
 * Writes 32 random bytes to `path` and returns them: the file created
 * exclusively (`wx`) with mode `0600` and its directory `0700`.
 *
 * A lost creation race (`EEXIST`) reads and returns the winner's file
 * instead, so two processes opening one home at once agree on one key. The
 * mode is not enforced on Windows.
 */
async function mintKeyFile(path: string): Promise<Uint8Array> {
  throw new Error("not implemented");
}
