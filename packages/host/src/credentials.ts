import { readCredentialAccounts } from "@nyte-ai/ai/auth/types";
import type { CredentialAccounts, CredentialStore } from "@nyte-ai/ai/auth/types";
import { SdkError } from "@nyte-ai/schema";
import type { Json, Ref } from "@nyte-ai/schema";
import { decodeKvValue, envelope, kvRef } from "@nyte-ai/core/store";
import type { Store, StoreConnection } from "@nyte-ai/core";
import { keyedSerial } from "@nyte-ai/core/server";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { SecretsSource } from "./secrets.ts";

const SealedCredentialSchema = Type.Union([
  Type.Object({
    type: Type.Union([Type.Literal("api_key"), Type.Literal("oauth")]),
    iv: Type.String(),
    ciphertext: Type.String(),
  }),
  Type.Object({
    active: Type.Union([Type.String(), Type.Null()]),
    accounts: Type.Array(
      Type.Object({
        id: Type.String({ minLength: 1 }),
        label: Type.String({ minLength: 1 }),
        type: Type.Union([Type.Literal("api_key"), Type.Literal("oauth")]),
      }),
    ),
    iv: Type.String(),
    ciphertext: Type.String(),
  }),
]);

export type SealedCredential = Static<typeof SealedCredentialSchema>;

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
 * non-secret account metadata per ref under `kv/secret/models/`, `modify` is
 * `modifyCredential`, and `delete` sets the ref to null, serialised as
 * `modify` is. Building it touches nothing, `list` never calls `key()` and
 * `read` calls it only when that provider's record exists (§50b, §55); the
 * imported key is kept once `key()` resolves, a rejection is not (§43k). While `key()` rejects (a deploy
 * without `NYTE_SECRET_KEY`), `read` answers undefined, `list` and `delete`
 * work (they need no key) and `modify` rejects that error, so provider keys
 * from the environment still resolve and logins answer `unavailable`. Web
 * Crypto only, no `node:*` (the `./credentials` subpath).
 */
export function credentialStore(store: Store, secrets: SecretsSource): CredentialStore {
  let key: Promise<CryptoKey> | null = null;
  const writes = keyedSerial<string>();

  const readKey = (): Promise<CryptoKey> => {
    const known = key ?? importedKey(secrets);

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
  ): Promise<T> =>
    writes.run(provider, () => {
      signal?.throwIfAborted();

      return task();
    });

  return {
    async read(provider, options) {
      options?.signal?.throwIfAborted();
      const { sealed } = await connected(store, (connection) => recordAt(connection, provider));

      if (sealed === null) return undefined;
      const unlocked = await readKey().catch(() => null);

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
                : readSealedCredential(decodeKvValue(await connection.objects.get(ref.target)));

            if (sealed === null) return [];
            const providerId = ref.name.slice(PREFIX.length);

            if ("type" in sealed)
              return [
                { providerId, id: "default", label: "Default", type: sealed.type, active: true },
              ];

            return sealed.accounts.map((account) => ({
              providerId,
              ...account,
              active: sealed.active === account.id,
            }));
          }),
        );

        return rows.flat();
      });
    },
    modify(provider, fn, options) {
      return serialised(provider, options?.signal, async () =>
        modifyCredential(store, await readKey(), provider, fn, options?.signal),
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

/** Returns `plain` sealed under the secrets key as `<iv>.<ciphertext>`, both base64; a desktop keeps its account token this way (§55). */
export async function sealSecret(secrets: SecretsSource, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importedKey(secrets),
    new TextEncoder().encode(plain),
  );

  return `${iv.toBase64()}.${new Uint8Array(ciphertext).toBase64()}`;
}

/** Returns the text `sealSecret` sealed; rejects when it was sealed under another key or is not such a text. */
export async function openSecret(secrets: SecretsSource, sealed: string): Promise<string> {
  const [iv = "", ciphertext = ""] = sealed.split(".");

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Uint8Array.fromBase64(iv) },
    await importedKey(secrets),
    Uint8Array.fromBase64(ciphertext),
  );

  return new TextDecoder().decode(plain);
}

async function importedKey(secrets: SecretsSource): Promise<CryptoKey> {
  const bytes = await secrets.key();

  if (bytes.length !== 32)
    throw new SdkError("invalid", `The secrets key is ${bytes.length} bytes; AES-256 needs 32.`);

  return crypto.subtle.importKey("raw", new Uint8Array(bytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function unsealCredential(
  key: CryptoKey,
  record: SealedCredential,
): Promise<CredentialAccounts | undefined> {
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

  return readCredentialAccounts(parsed);
}

async function modifyCredential(
  store: Store,
  key: CryptoKey,
  provider: string,
  fn: (current: CredentialAccounts | undefined) => Promise<CredentialAccounts | undefined>,
  signal: AbortSignal | undefined,
): Promise<CredentialAccounts | undefined> {
  const name = kvRef("secret", "models", provider);
  let started = false;

  return connected(store, async (connection) => {
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      const { ref, sealed } = await recordAt(connection, provider);
      const current = sealed === null ? undefined : await unsealCredential(key, sealed);

      if (!started) signal?.throwIfAborted();
      started = true;
      const next = await fn(current);

      if (next === undefined) return current;

      const target =
        next.accounts.length === 0
          ? null
          : await connection.objects.put(envelope("kv", await seal(key, next), Date.now()));

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

async function seal(key: CryptoKey, credential: CredentialAccounts): Promise<Json> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(credential)),
    ),
  );

  return {
    active: credential.active,
    accounts: credential.accounts.map((account) => ({
      id: account.id,
      label: account.label,
      type: account.credential.type,
    })),
    iv: iv.toBase64(),
    ciphertext: ciphertext.toBase64(),
  };
}

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
        : readSealedCredential(decodeKvValue(await connection.objects.get(ref.target))),
  };
}

function readSealedCredential(body: Json | undefined): SealedCredential | null {
  if (!Value.Check(SealedCredentialSchema, body)) return null;

  if ("type" in body) return body;

  const ids = new Set(body.accounts.map((account) => account.id));

  return ids.size === body.accounts.length && (body.active === null || ids.has(body.active))
    ? body
    : null;
}

async function connected<T>(
  store: Store,
  task: (connection: StoreConnection) => Promise<T>,
): Promise<T> {
  return task(await store.open());
}
