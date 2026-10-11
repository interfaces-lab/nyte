import type { Credential, CredentialStore } from "@nyte-ai/ai/auth/types";
import type { Json, Ref } from "@nyte-ai/schema";
import { SdkError, decodeKvValue, envelope, kvRef } from "@nyte-ai/core";
import type { Store, StoreConnection } from "@nyte-ai/core";
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

const PREFIX = kvRef("secret", "models", "");

const RETRIES = 5;

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
 * `modify` is. Building it touches nothing; the imported key is kept once
 * `key()` resolves, a rejection is not (§43k). While `key()` rejects (a deploy
 * without `NYTE_SECRET_KEY`), `read` answers undefined, `list` and `delete`
 * work (they need no key) and `modify` rejects that error, so provider keys
 * from the environment still resolve and logins answer `unavailable`. Web
 * Crypto only, no `node:*` (the `./credentials` subpath).
 */
export function credentialStore(store: Store, secrets: SecretsSource): CredentialStore {
  let key: Promise<CryptoKey> | null = null;
  const chains = new Map<string, Promise<unknown>>();

  const keyOf = (): Promise<CryptoKey> => {
    const known =
      key ??
      secrets.key().then((bytes) => {
        if (bytes.length !== 32)
          throw new SdkError(
            "invalid",
            `The secrets key is ${bytes.length} bytes; AES-256 needs 32.`,
          );

        return crypto.subtle.importKey("raw", new Uint8Array(bytes), "AES-GCM", false, [
          "encrypt",
          "decrypt",
        ]);
      });

    key = known;
    known.catch(() => {
      if (key === known) key = null;
    });

    return known;
  };

  const serialised = <T>(
    provider: string,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> => {
    const queued = (chains.get(provider) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        signal?.throwIfAborted();

        return task();
      });

    const tail = queued.catch(() => undefined);
    chains.set(provider, tail);
    void tail.then(() => {
      if (chains.get(provider) === tail) chains.delete(provider);
    });

    return queued;
  };

  return {
    async read(provider, options) {
      options?.signal?.throwIfAborted();
      const { sealed } = await connected(store, (connection) => recordAt(connection, provider));

      if (sealed === null) return undefined;
      const unlocked = await keyOf().catch(() => null);

      return unlocked === null ? undefined : unsealCredential(unlocked, sealed);
    },
    async list(options) {
      options?.signal?.throwIfAborted();

      return connected(store, async (connection) => {
        const refs = await connection.refs.list(PREFIX);

        const rows = await Promise.all(
          refs.map(async (ref) => {
            const sealed =
              ref.target === null
                ? null
                : sealedOf(decodeKvValue(await connection.objects.get(ref.target)));

            return sealed === null
              ? []
              : [{ providerId: ref.name.slice(PREFIX.length), type: sealed.type }];
          }),
        );

        return rows.flat();
      });
    },
    modify(provider, fn, options) {
      return serialised(provider, options?.signal, async () =>
        modifyCredential(store, await keyOf(), provider, fn, options?.signal),
      );
    },
    delete(provider, options) {
      return serialised(provider, options?.signal, () =>
        connected(store, async (connection) => {
          await connection.refs.set([{ name: kvRef("secret", "models", provider), target: null }]);
        }),
      );
    },
  };
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
  let parsed: unknown;

  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.fromBase64(record.iv) },
      key,
      Uint8Array.fromBase64(record.ciphertext),
    );
    parsed = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));

  if (fields.type === "api_key") {
    const env = stringRecord(fields.env);

    if (fields.key !== undefined && typeof fields.key !== "string") return undefined;

    return {
      type: "api_key",
      ...(typeof fields.key === "string" ? { key: fields.key } : {}),
      ...(env === undefined ? {} : { env }),
    };
  }

  const { access, refresh, expires } = fields;

  if (
    fields.type !== "oauth" ||
    typeof access !== "string" ||
    typeof refresh !== "string" ||
    typeof expires !== "number"
  )
    return undefined;

  return { ...fields, type: "oauth", access, refresh, expires };
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
  const name = kvRef("secret", "models", provider);

  return connected(store, async (connection) => {
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      const { ref, sealed } = await recordAt(connection, provider);
      const current = sealed === null ? undefined : await unsealCredential(key, sealed);
      signal?.throwIfAborted();
      const next = await fn(current);

      if (next === undefined) return current;
      const target = await connection.objects.put(
        envelope("kv", await seal(key, next), Date.now()),
      );

      const outcome = await connection.refs.set([
        { name, target, expect: ref === null ? "absent" : ref.revision },
      ]);

      if (outcome.kind === "set") return next;
    }

    throw new SdkError(
      "unavailable",
      `The ${provider} credential kept changing under this write; try again.`,
    );
  });
}

/** Returns a credential encrypted under the key with a fresh 12-byte IV, as the record `SealedCredential` describes. */
async function seal(key: CryptoKey, credential: Credential): Promise<Json> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(credential)),
    ),
  );

  return { type: credential.type, iv: iv.toBase64(), ciphertext: ciphertext.toBase64() };
}

/** Returns a provider's ref and the sealed record it points at, read once, so a write can expect that ref's revision; `sealed` is null when there is no record or it is not one. */
async function recordAt(
  connection: StoreConnection,
  provider: string,
): Promise<{ readonly ref: Ref | null; readonly sealed: SealedCredential | null }> {
  const ref = await connection.refs.get(kvRef("secret", "models", provider));

  return {
    ref,
    sealed:
      ref === null || ref.target === null
        ? null
        : sealedOf(decodeKvValue(await connection.objects.get(ref.target))),
  };
}

/** Returns a `kv` body as a sealed credential, or null when it has another shape. */
function sealedOf(body: Json | undefined): SealedCredential | null {
  if (!isJsonRecord(body)) return null;
  const { type, iv, ciphertext } = body;

  return (type === "api_key" || type === "oauth") &&
    typeof iv === "string" &&
    typeof ciphertext === "string"
    ? { type, iv, ciphertext }
    : null;
}

function isJsonRecord(value: Json | undefined): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns a value as a record of strings, or undefined when it is not one. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);

  return entries.every((entry): entry is [string, string] => typeof entry[1] === "string")
    ? Object.fromEntries(entries)
    : undefined;
}

/** Runs `task` over a fresh store connection and closes it after. */
async function connected<T>(
  store: Store,
  task: (connection: StoreConnection) => Promise<T>,
): Promise<T> {
  const connection = await store.open();

  try {
    return await task(connection);
  } finally {
    await connection.close();
  }
}
