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
