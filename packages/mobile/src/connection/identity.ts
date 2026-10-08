/**
 * The phone's check of a host's identity: a fresh nonce signed on
 * `/v1/identity`, verified against the key this route pinned when it first
 * paired. Discovery names an identity; only this proves it. Hermes has no
 * WebCrypto Ed25519, so the signature check is `@noble/curves`.
 */
import { ed25519 } from "@noble/curves/ed25519";
import type { NyteClient } from "@nyte-ai/client";
import { base64ToBase64Url, base64Url, fromBase64Url } from "@nyte-ai/connect";
import type { DeviceCrypto } from "@nyte-ai/connect/enrollment";
import { identityChallengeMessage } from "@nyte-ai/protocol";
import type { HostIdentity, IdentityChallenge, ServerInfo } from "@nyte-ai/protocol";

/** RFC 7638: SHA-256 over the required members in lexicographic order. */
async function keyThumbprint(
  publicKey: HostIdentity["publicKey"],
  crypto: DeviceCrypto,
): Promise<string> {
  const canonical = JSON.stringify({ crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x });

  return base64ToBase64Url(await crypto.sha256Base64(canonical));
}

export async function verifyIdentityChallenge(input: {
  readonly challenge: IdentityChallenge;
  readonly pinned: HostIdentity;
  readonly nonce: string;
  readonly crypto: DeviceCrypto;
}): Promise<boolean> {
  const { challenge, pinned } = input;

  if (challenge.nonce !== input.nonce) return false;

  if (challenge.hostId !== pinned.hostId || challenge.publicKey.x !== pinned.publicKey.x)
    return false;

  if ((await keyThumbprint(challenge.publicKey, input.crypto)) !== challenge.hostId) return false;
  const signature = fromBase64Url(challenge.signature);
  const publicKey = fromBase64Url(challenge.publicKey.x);

  if (signature === undefined || publicKey === undefined) return false;

  try {
    return ed25519.verify(
      signature,
      new TextEncoder().encode(identityChallengeMessage(challenge)),
      publicKey,
      { zip215: false },
    );
  } catch {
    return false;
  }
}

/** What answered, judged against the route's pin. Client errors are thrown, not returned. */
export type HostProof =
  /** `info.identity` is present only when the host signed for it just now. */
  | { readonly kind: "proven"; readonly info: ServerInfo & { readonly identity: HostIdentity } }
  /** A cursor host that names no identity, on a route that never pinned one. Never called proven. */
  | { readonly kind: "unidentified"; readonly info: ServerInfo }
  /** The route's pinned host did not answer: another key, or none. */
  | { readonly kind: "identityChanged" }
  /** It claimed an identity it could not sign for, or is a registry host naming none. */
  | { readonly kind: "unverified" };

/**
 * `/v1/info`, then the signed nonce for the identity this route trusts: the
 * pin, or with no pin (or an explicit `repair`) the one announced. A repair
 * still needs a signature; a host that names no identity cannot replace a pin.
 */
export async function proveHost(input: {
  readonly client: NyteClient;
  readonly pinned: HostIdentity | undefined;
  readonly repair: boolean;
  readonly crypto: DeviceCrypto;
}): Promise<HostProof> {
  const { client, pinned } = input;
  const info = await client.info();

  if (pinned !== undefined && info.identity === undefined) return { kind: "identityChanged" };

  if (pinned !== undefined && !input.repair && info.identity?.hostId !== pinned.hostId)
    return { kind: "identityChanged" };
  const proving = input.repair ? info.identity : (pinned ?? info.identity);

  if (proving === undefined)
    return info.workspaces?.kind === "registry"
      ? { kind: "unverified" }
      : { kind: "unidentified", info };
  const nonce = base64Url(await input.crypto.randomBytes(24));
  const challenge = await client.identity(nonce);

  if (!(await verifyIdentityChallenge({ challenge, pinned: proving, nonce, crypto: input.crypto })))
    return pinned !== undefined && !input.repair
      ? { kind: "identityChanged" }
      : { kind: "unverified" };

  return { kind: "proven", info: { ...info, identity: proving } };
}
