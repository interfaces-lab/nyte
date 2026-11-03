/**
 * Device routes. The environment's relay reserves, enrolls through the
 * desktop's socket, and activates; it also ends devices and owes D1 the
 * session denial a strong revocation makes. The Worker authenticates the
 * caller, and after a strong revocation asks Clerk to revoke the session.
 */
import { EnrollRequest, PROOF_HEADER } from "@nyte-ai/connect";
import { settleSessionRevocation, verifySession } from "./clerk.ts";
import type { Context } from "./context.ts";
import { requestActor } from "./environments.ts";
import { Refusal, json, noContent, parseBody, requestText, unwrap } from "./http.ts";
import { proofToken } from "./proof.ts";
import { pendingSessionRevocation } from "./store/owners.ts";

export async function enrollDevice(
  context: Context,
  request: Request,
  environmentId: string,
): Promise<Response> {
  const session = await verifySession(context, request, "enroll");
  const body = parseBody(EnrollRequest, await requestText(request));

  return json(
    201,
    unwrap(
      await context
        .environment(environmentId)
        .enroll({ ownerId: session.userId, sessionId: session.sessionId, body }),
    ),
  );
}

/**
 * The strong revocation, by the owner's Clerk session or the environment's
 * machine key. The relay has denied the enrolling Clerk session in D1 before
 * it answers; Clerk revokes it now or the cron retries. Repeating it is
 * harmless.
 */
export async function removeDevice(
  context: Context,
  request: Request,
  input: { readonly environmentId: string; readonly deviceId: string },
): Promise<Response> {
  const actor = await requestActor(context, request);

  const revoked = unwrap(
    await context
      .environment(input.environmentId)
      .revokeDevice({ actor, deviceId: input.deviceId }),
  );

  const owed = await pendingSessionRevocation(context.db, revoked.sessionId);

  if (owed !== undefined) context.defer(settleSessionRevocation(context, owed));

  return noContent();
}

/**
 * The weak end, relayed by the desktop after the device's own token asked
 * for it: the device stops like a revoked one, but its Clerk session is
 * neither denied nor revoked. Environment proof only, body exactly `{}`.
 */
export async function releaseDevice(
  context: Context,
  request: Request,
  input: { readonly environmentId: string; readonly deviceId: string },
): Promise<Response> {
  if (!request.headers.has(PROOF_HEADER)) throw new Refusal("unauthorized");
  const token = proofToken(request);
  const body = await requestText(request);

  unwrap(
    await context
      .environment(input.environmentId)
      .release({ proof: { token, body }, deviceId: input.deviceId }),
  );

  return noContent();
}
