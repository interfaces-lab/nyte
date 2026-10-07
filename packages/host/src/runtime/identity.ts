/**
 * A host profile's identity: one Ed25519 key, created when the profile is,
 * whose RFC 7638 thumbprint is the `HostId`. Clients pin the public half when
 * they pair and verify a signed nonce on every connect, so a URL that starts
 * answering with another key is a different host, not the same one moved.
 *
 * This key is not the Connect machine key. An account link has its own key
 * with its own lifetime (the broker tombstones it on unlink), and records
 * which host identity it belongs to; the host's identity and its session
 * ownership never change because a link did.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { identityChallengeMessage } from "@nyte-ai/protocol";
import type { HostIdentity, IdentityChallenge } from "@nyte-ai/protocol";

const Base64Url32 = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });

export const ProfileKey = Type.Object(
  {
    kty: Type.Literal("OKP"),
    crv: Type.Literal("Ed25519"),
    x: Base64Url32,
    d: Base64Url32,
  },
  { additionalProperties: false },
);

export type ProfileKey = Static<typeof ProfileKey>;

export function generateProfileKey(): ProfileKey {
  const pair = generateKeyPairSync("ed25519");
  const exported: unknown = pair.privateKey.export({ format: "jwk" });

  if (!Value.Check(ProfileKey, exported)) throw new Error("Unexpected Ed25519 key export");

  return { kty: "OKP", crv: "Ed25519", x: exported.x, d: exported.d };
}

/** RFC 7638: SHA-256 over the required members in lexicographic order. */
export function keyThumbprint(publicKey: HostIdentity["publicKey"]): string {
  const canonical = JSON.stringify({ crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x });

  return createHash("sha256").update(canonical).digest("base64url");
}

export function publicKeyOf(key: ProfileKey): HostIdentity["publicKey"] {
  return { kty: "OKP", crv: "Ed25519", x: key.x };
}

export function signIdentityChallenge(input: {
  readonly key: ProfileKey;
  readonly nonce: string;
  readonly epoch: number;
}): IdentityChallenge {
  const publicKey = publicKeyOf(input.key);
  const hostId = keyThumbprint(publicKey);
  const message = identityChallengeMessage({ hostId, nonce: input.nonce, epoch: input.epoch });

  const signature = sign(
    null,
    Buffer.from(message, "utf8"),
    createPrivateKey({ key: input.key, format: "jwk" }),
  ).toString("base64url");

  return { hostId, publicKey, nonce: input.nonce, epoch: input.epoch, signature };
}

/**
 * A client's check: the challenge names the pinned key, that key's thumbprint
 * is the claimed host id, the nonce is the one asked, and the signature holds.
 */
export function verifyIdentityChallenge(input: {
  readonly challenge: IdentityChallenge;
  readonly pinned: HostIdentity;
  readonly nonce: string;
}): boolean {
  const { challenge, pinned } = input;

  if (challenge.nonce !== input.nonce) return false;

  if (challenge.hostId !== pinned.hostId || challenge.publicKey.x !== pinned.publicKey.x) {
    return false;
  }

  if (keyThumbprint(challenge.publicKey) !== challenge.hostId) return false;
  const message = identityChallengeMessage(challenge);

  try {
    return verify(
      null,
      Buffer.from(message, "utf8"),
      createPublicKey({ key: challenge.publicKey, format: "jwk" }),
      Buffer.from(challenge.signature, "base64url"),
    );
  } catch {
    return false;
  }
}
