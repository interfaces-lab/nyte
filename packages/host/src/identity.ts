import type { HostId } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { ListenOptions } from "@nyte-ai/core";

const PKCS8_PREFIX = Uint8Array.fromHex("302e020100300506032b657004220420");

const encoder = new TextEncoder();

/**
 * Returns the signer a listener answers `GET /.nyte/identity?nonce=` with
 * (`ListenOptions.identity`, §43a), over a 32-byte Ed25519 seed: `id` the
 * host's id and `sign(nonce)` a signature over the UTF-8 bytes of
 * `nyte/identity\n<id>\n<nonce>`, answered with the raw public key, both
 * base64url without padding (§43k). The Node host reads the seed from
 * `<home>/.nyte/identity.key` (`identitySigner`); a deploy passes one from its
 * environment (§50a). Web Crypto only, no `node:*` (the `./identity` subpath).
 */
export async function seedSigner(
  id: HostId,
  seed: Uint8Array,
): Promise<NonNullable<ListenOptions["identity"]>> {
  const { signing, publicKey } = await identityKeys(seed);

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
 * Imports an Ed25519 seed in its PKCS#8 form (the fixed prefix
 * `302e020100300506032b657004220420` and the seed; Web Crypto imports no raw
 * private seed). It imports it twice (§43j): once extractable, only to read
 * the public key back through its JWK `x`, and once non-extractable with
 * usage `sign`, the only key it keeps. A seed that is not 32 bytes rejects
 * `SdkError("invalid")`.
 */
async function identityKeys(
  seed: Uint8Array,
): Promise<{ readonly signing: CryptoKey; readonly publicKey: string }> {
  if (seed.length !== 32)
    throw new SdkError("invalid", `The identity seed is ${seed.length} bytes, not 32.`);
  const pkcs8 = new Uint8Array([...PKCS8_PREFIX, ...seed]);
  const readable = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
  const { x } = await crypto.subtle.exportKey("jwk", readable);

  if (x === undefined) throw new SdkError("internal", "The identity key has no public half.");
  const signing = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]);

  return { signing, publicKey: x };
}
