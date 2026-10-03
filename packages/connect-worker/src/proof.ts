/**
 * Desktop request proofs: signed by the machine key, bound to the method,
 * path, and body, and refused the second time. A relay socket's `auth` frame
 * is one too, for `GET` on its relay route.
 */
import { BROKER_ROUTES, CLOCK_TOLERANCE_SECONDS, CompactJws, PROOF_HEADER } from "@nyte-ai/connect";
import type { ProofClaims, PublicJwk } from "@nyte-ai/connect";
import { keyThumbprint, verifyProof } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import type { Context } from "./context.ts";
import { Refusal } from "./http.ts";
import { consumeProof, findEnvironment } from "./store.ts";
import type { Environment } from "./store.ts";

function proofToken(request: Request): string {
  const token = request.headers.get(PROOF_HEADER);

  if (token === null || !Value.Check(CompactJws, token)) throw new Refusal("unauthorized");

  return token;
}

async function checkProof(
  context: Context,
  input: {
    readonly token: string;
    readonly key: PublicJwk;
    readonly issuer: string;
    readonly method: string;
    readonly path: string;
    readonly body: string;
  },
): Promise<ProofClaims> {
  const { method } = input;

  if (method !== "GET" && method !== "POST" && method !== "DELETE")
    throw new Refusal("unauthorized");
  let claims: ProofClaims;

  try {
    claims = await verifyProof({
      token: input.token,
      key: input.key,
      issuer: input.issuer,
      audience: context.config.origin,
      method,
      path: input.path,
      body: input.body,
      now: context.now(),
    });
  } catch {
    throw new Refusal("unauthorized");
  }

  const fresh = await consumeProof(context.db, {
    key: `${input.issuer}:${claims.jti}`,
    expiresAt: (claims.exp + CLOCK_TOLERANCE_SECONDS) * 1000,
  });

  if (!fresh) throw new Refusal("unauthorized");

  return claims;
}

/**
 * The environment whose machine key signed this request, in any state. An
 * unknown id and a bad signature are the same refusal.
 */
export async function verifyEnvironmentProof(
  context: Context,
  input: { readonly request: Request; readonly body: string; readonly environmentId: string },
): Promise<{ readonly environment: Environment; readonly claims: ProofClaims }> {
  const token = proofToken(input.request);
  const environment = await findEnvironment(context.db, input.environmentId);

  if (environment === undefined) throw new Refusal("unauthorized");
  const claims = await checkProof(context, {
    token,
    key: { kty: "OKP", crv: "Ed25519", x: environment.public_key },
    issuer: environment.id,
    method: input.request.method,
    path: new URL(input.request.url).pathname,
    body: input.body,
  });

  return { environment, claims };
}

/**
 * The environment whose machine key signed a relay socket's `auth` frame: a
 * proof for `GET` on that environment's relay route with an empty body, spent
 * once. An unknown id and a bad signature are the same refusal.
 */
export async function verifyRelayProof(
  context: Context,
  input: { readonly token: string; readonly environmentId: string },
): Promise<Environment> {
  const environment = await findEnvironment(context.db, input.environmentId);

  if (environment === undefined) throw new Refusal("unauthorized");
  await checkProof(context, {
    token: input.token,
    key: { kty: "OKP", crv: "Ed25519", x: environment.public_key },
    issuer: environment.id,
    method: "GET",
    path: BROKER_ROUTES.relay(environment.id),
    body: "",
  });

  return environment;
}

/** Proof of the key being linked, issued under its thumbprint. Returns the thumbprint. */
export async function verifyLinkProof(
  context: Context,
  input: { readonly request: Request; readonly body: string; readonly publicKey: PublicJwk },
): Promise<string> {
  const token = proofToken(input.request);
  const thumbprint = await keyThumbprint(input.publicKey);

  await checkProof(context, {
    token,
    key: input.publicKey,
    issuer: thumbprint,
    method: input.request.method,
    path: new URL(input.request.url).pathname,
    body: input.body,
  });

  return thumbprint;
}
