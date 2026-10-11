import type { HostId } from "@nyte-ai/schema";
import type { ListenOptions } from "@nyte-ai/core";
import type { SecretsSource } from "./secrets.ts";

/**
 * Returns the signer a listener answers `GET /.nyte/identity?nonce=` with
 * (`ListenOptions.identity`, §43a): `id` the host's id and `sign(nonce)` an
 * Ed25519 signature over the UTF-8 bytes of `nyte/identity\n<id>\n<nonce>`.
 *
 * `sign` answers `{ nonce, signature, publicKey }`, the signature and the raw
 * 32-byte public key both base64url without padding; the route adds `hostId`.
 * The keys are `identityKeys`'. Web Crypto only, no `node:*`, so a Worker
 * imports it from the `./identity` subpath. Named apart from core's
 * `hostIdentity(store)`, which reads or mints the host's id.
 */
export async function identitySigner(
  id: HostId,
  secrets: SecretsSource,
): Promise<NonNullable<ListenOptions["identity"]>> {
  throw new Error("not implemented");
}

/**
 * Derives the host's Ed25519 pair from the secrets key, read once: HKDF-SHA-256
 * over its 32 bytes with an empty salt and info `nyte/identity` yields a
 * 32-byte seed, imported in its PKCS#8 form (the fixed prefix
 * `302e020100300506032b657004220420` and the seed; Web Crypto imports no raw
 * private seed).
 *
 * It imports the seed twice (§43j): once extractable, only to read the public
 * key back through its JWK `x`, and once non-extractable with usage `sign`,
 * the only key it keeps. One secrets key always derives one pair. A key that
 * is not 32 bytes rejects `SdkError("invalid")`.
 */
async function identityKeys(
  secrets: SecretsSource,
): Promise<{ readonly signing: CryptoKey; readonly publicKey: string }> {
  throw new Error("not implemented");
}
