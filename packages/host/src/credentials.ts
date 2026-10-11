import type { Credential, CredentialStore } from "@nyte-ai/ai/auth/types";
import type { Store } from "@nyte-ai/core";
import type { SecretsSource } from "./secrets.ts";

/**
 * Returns one stored model credential, the body of the `kv` envelope at
 * `kvRef("secret", "models", <provider>)` (§42e).
 *
 * `type` is in clear so `list` answers without decrypting; `ciphertext` is the
 * credential's JSON under AES-256-GCM with a fresh random 12-byte `iv`, both
 * base64, the scheme `PluginStorage.secrets` uses. It is never in a view, an
 * event or a log.
 */
export type SealedCredential = {
  readonly type: Credential["type"];
  readonly iv: string;
  readonly ciphertext: string;
};

/**
 * Returns `@nyte-ai/ai`'s `CredentialStore` over a host `Store`, so a host's
 * model logins live with its sessions and pass to
 * `createModels({ credentials })` (§42e); a Durable Object and a Vercel
 * instance keep theirs.
 *
 * Each call opens a store connection and closes it when done; the `Store` is
 * the caller's. `read` is `unsealCredential` over the record, `list` answers
 * `{ providerId, type }` per ref under `kv/secret/models/`, `modify` is
 * `modifyCredential`, and `delete` sets the ref to null, serialised as
 * `modify` is. Building it touches nothing. While `key()` rejects (a deploy
 * without `NYTE_SECRET_KEY`), `read` answers undefined, `list` and `delete`
 * work (they need no key) and `modify` rejects that error, so provider keys
 * from the environment still resolve and logins answer `unavailable`. Web
 * Crypto only, no `node:*` (the `./credentials` subpath).
 */
export function credentialStore(store: Store, secrets: SecretsSource): CredentialStore {
  const pending = async (): Promise<never> => {
    throw new Error("not implemented");
  };

  return { read: pending, list: pending, modify: pending, delete: pending };
}

/**
 * Returns the credential a record holds, decrypted and checked: an `api_key`
 * with an optional string `key`, or an `oauth` with string `access` and
 * `refresh` and a number `expires`, extra fields kept.
 *
 * A record that does not decrypt (the key changed) or does not parse answers
 * undefined, as an absent one does, so the provider reads as logged out and a
 * new login overwrites it.
 */
async function unsealCredential(
  key: CryptoKey,
  record: SealedCredential,
): Promise<Credential | undefined> {
  throw new Error("not implemented");
}

/**
 * Runs `CredentialStore.modify` for one provider: serialised per provider in
 * this process behind a promise chain, then a read of the record with its ref
 * revision, `fn` on the decrypted current, and, when `fn` returns a
 * credential, a sealed write with `expect` that revision (`absent` when there
 * was none).
 *
 * A `stale` answer means another instance wrote in between: it reads the
 * winner and runs `fn` again on it, up to 5 times, then rejects
 * `SdkError("unavailable")`. A credential `fn` returned is written even when
 * `signal` aborts after it returned (ai's rule: a rotated token has no second
 * copy); an abort before `fn` runs rejects. It resolves the credential
 * written, or the current one when `fn` returned undefined.
 */
async function modifyCredential(
  store: Store,
  key: CryptoKey,
  provider: string,
  fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  signal: AbortSignal | undefined,
): Promise<Credential | undefined> {
  throw new Error("not implemented");
}
