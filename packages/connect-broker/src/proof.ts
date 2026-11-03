/**
 * Desktop request proofs the Worker checks itself: those signed under a key's
 * thumbprint while it links, spent once in D1. Proofs signed under an
 * environment id are checked and spent by that environment's relay
 * (`environment-record.ts`).
 */
import { CLOCK_TOLERANCE_SECONDS, CompactJws, PROOF_HEADER } from "@nyte-ai/connect";
import type { ProofClaims, PublicJwk } from "@nyte-ai/connect";
import { keyThumbprint, verifyProof } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import type { Context } from "./context.ts";
import { Refusal } from "./http.ts";
import { consumeProof } from "./store/replays.ts";

/** The request's proof header, refused unless it is a compact JWS. */
export function proofToken(request: Request): string {
  const token = request.headers.get(PROOF_HEADER);

  if (token === null || !Value.Check(CompactJws, token)) throw new Refusal("unauthorized");

  return token;
}

/** Proof of the key being linked, issued under its thumbprint. Returns the thumbprint. */
export async function verifyLinkProof(
  context: Context,
  input: { readonly request: Request; readonly body: string; readonly publicKey: PublicJwk },
): Promise<string> {
  const token = proofToken(input.request);
  const thumbprint = await keyThumbprint(input.publicKey);
  const method = input.request.method;

  if (method !== "GET" && method !== "POST" && method !== "DELETE")
    throw new Refusal("unauthorized");
  let claims: ProofClaims;

  try {
    claims = await verifyProof({
      token,
      key: input.publicKey,
      issuer: thumbprint,
      audience: context.config.origin,
      method,
      path: new URL(input.request.url).pathname,
      body: input.body,
      now: Date.now(),
    });
  } catch {
    throw new Refusal("unauthorized");
  }

  const fresh = await consumeProof(context.db, {
    key: `${thumbprint}:${claims.jti}`,
    expiresAt: (claims.exp + CLOCK_TOLERANCE_SECONDS) * 1000,
  });

  if (!fresh) throw new Refusal("unauthorized");

  return thumbprint;
}
