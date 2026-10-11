import type { HostId } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { ListenOptions } from "@nyte-ai/core";
import type { SecretsSource } from "./secrets.ts";

const PKCS8_PREFIX = Uint8Array.fromHex("302e020100300506032b657004220420");

const encoder = new TextEncoder();

/**
 * Returns the signer a listener answers `GET /.nyte/identity?nonce=` with
 * (`ListenOptions.identity`, §43a): `id` the host's id and `sign(nonce)` an
 * Ed25519 signature over the UTF-8 bytes of `nyte/identity\n<id>\n<nonce>`.
 *
 * `sign` answers `{ hostId, nonce, signature, publicKey }`, the signature and
 * the raw 32-byte public key both base64url without padding (§43k).
 * The keys are `identityKeys`'. Web Crypto only, no `node:*`, so a Worker
 * imports it from the `./identity` subpath. Named apart from core's
 * `hostIdentity(store)`, which reads or mints the host's id.
 */
export async function identitySigner(
  id: HostId,
  secrets: SecretsSource,
): Promise<NonNullable<ListenOptions["identity"]>> {
  const { signing, publicKey } = await identityKeys(secrets);

  return {
    id,
    async sign(nonce) {
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          signing,
          encoder.encode(`nyte/identity\n${id}\n${nonce}`),
        ),
      );

      return {
        hostId: id,
        nonce,
        signature: signature.toBase64({ alphabet: "base64url", omitPadding: true }),
        publicKey,
      };
    },
  };
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
  const bytes = await secrets.key();

  if (bytes.length !== 32)
    throw new SdkError("invalid", `The secrets key is ${bytes.length} bytes, not 32.`);
  const base = await crypto.subtle.importKey("raw", new Uint8Array(bytes), "HKDF", false, [
    "deriveBits",
  ]);

  const seed = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: encoder.encode("nyte/identity"),
      },
      base,
      256,
    ),
  );

  const pkcs8 = new Uint8Array([...PKCS8_PREFIX, ...seed]);
  const readable = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
  const { x } = await crypto.subtle.exportKey("jwk", readable);

  if (x === undefined) throw new SdkError("internal", "The identity key has no public half.");
  const signing = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]);

  return { signing, publicKey: x };
}
