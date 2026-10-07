/**
 * The browser's check of a host's identity: the signed nonce on
 * `/v1/identity`, verified with WebCrypto against the key this browser pinned
 * when it first paired. Discovery names an identity; only this proves it.
 */
import { base64Url, fromBase64Url } from "@nyte-ai/connect";
import { identityChallengeMessage } from "@nyte-ai/protocol";
import type { HostIdentity, IdentityChallenge } from "@nyte-ai/protocol";

/** RFC 7638: SHA-256 over the required members in lexicographic order. */
async function keyThumbprint(publicKey: HostIdentity["publicKey"]): Promise<string> {
  const canonical = JSON.stringify({ crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));

  return base64Url(new Uint8Array(digest));
}

export async function verifyIdentityChallenge(input: {
  readonly challenge: IdentityChallenge;
  readonly pinned: HostIdentity;
  readonly nonce: string;
}): Promise<boolean> {
  const { challenge, pinned } = input;

  if (challenge.nonce !== input.nonce) return false;

  if (challenge.hostId !== pinned.hostId || challenge.publicKey.x !== pinned.publicKey.x)
    return false;

  if ((await keyThumbprint(challenge.publicKey)) !== challenge.hostId) return false;
  const signature = fromBase64Url(challenge.signature);

  if (signature === undefined) return false;

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: challenge.publicKey.x },
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      new Uint8Array(signature),
      new TextEncoder().encode(identityChallengeMessage(challenge)),
    );
  } catch {
    return false;
  }
}

export class IdentityChanged extends Error {
  constructor() {
    super("This address answers with a different host identity than the one you paired with.");
    this.name = "IdentityChanged";
  }
}

export function randomNonce(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)));
}
