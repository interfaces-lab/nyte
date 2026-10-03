/**
 * Device routes. Enrollment reserves the device in D1, has the desktop record
 * the digest through its relay, verifies the desktop's signed receipt, and
 * only then compare-and-sets the device active. Revocation tombstones the
 * device and denies the Clerk session that enrolled it; it and a release both
 * end the device's open relay channels.
 */
import {
  DESKTOP_ROUTES,
  ENROLLMENT_LIFETIME_SECONDS,
  EnrollRequest,
  PROOF_HEADER,
  ReceiptClaims,
  ReceiptEnvelope,
  TOKEN_TYPES,
} from "@nyte-ai/connect";
import type { EnrollEnvelope, EnrollResponse, EnrollmentClaims } from "@nyte-ai/connect";
import { nowSeconds, randomId, signClaims, verifyClaims } from "@nyte-ai/connect/signing";
import { settleSessionRevocation, verifySession } from "./clerk.ts";
import { throttle } from "./context.ts";
import type { Context } from "./context.ts";
import { authorizeEnvironment } from "./environments.ts";
import { Refusal, json, noContent, parseBody, parseJson, readText, requestText } from "./http.ts";
import { verifyEnvironmentProof } from "./proof.ts";
import { forwardRequest, resetRelay } from "./relay-stub.ts";
import {
  activateDevice,
  findDevice,
  findOwnedEnvironment,
  pendingSessionRevocation,
  markDeviceReleased,
  releaseReservation,
  reserveDevice,
  revokeDevice,
} from "./store.ts";
import type { Environment } from "./store.ts";

/** How long the broker waits for the desktop to record an enrollment. */
export const ENROLL_TIMEOUT_MS = 10_000;

const RECEIPT_LIMIT = 16_384;

/**
 * Relay the authorization to the desktop's enrollment route and return the
 * receipt it answers with, bounded in time and size.
 */
async function forwardEnrollment(
  context: Context,
  input: { readonly environment: Environment; readonly authorization: string },
): Promise<string | undefined> {
  const envelope: EnrollEnvelope = { authorization: input.authorization };
  const channel = randomId();
  const stub = context.relay(input.environment.id);
  let response: Response;

  try {
    response = await stub.fetch(
      forwardRequest({
        environmentId: input.environment.id,
        channel,
        method: "POST",
        path: DESKTOP_ROUTES.enroll,
        headers: new Headers({ "content-type": "application/json", accept: "application/json" }),
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(ENROLL_TIMEOUT_MS),
      }),
    );
  } catch {
    resetRelay(context, { environmentId: input.environment.id, channel, stub });
    context.log.warn("enroll.unreachable", { environmentId: input.environment.id, status: 0 });

    return undefined;
  }

  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel().catch(() => undefined);
    context.log.warn("enroll.unreachable", {
      environmentId: input.environment.id,
      status: response.status,
    });

    return undefined;
  }

  const text = await readText(response.body, RECEIPT_LIMIT);

  if (text === undefined)
    resetRelay(context, { environmentId: input.environment.id, channel, stub });

  return text === undefined ? undefined : parseJson(ReceiptEnvelope, text)?.receipt;
}

async function receiptConfirms(
  context: Context,
  input: {
    readonly receipt: string;
    readonly environment: Environment;
    readonly grant: EnrollmentClaims;
  },
): Promise<boolean> {
  try {
    const claims = await verifyClaims({
      token: input.receipt,
      key: { kty: "OKP", crv: "Ed25519", x: input.environment.public_key },
      typ: TOKEN_TYPES.receipt,
      issuer: input.environment.id,
      audience: context.config.origin,
      schema: ReceiptClaims,
      lifetime: ENROLLMENT_LIFETIME_SECONDS,
      now: context.now(),
    });

    return (
      claims.req === input.grant.jti &&
      claims.nonce === input.grant.nonce &&
      claims.deviceId === input.grant.deviceId &&
      claims.digest === input.grant.digest
    );
  } catch {
    return false;
  }
}

export async function enrollDevice(
  context: Context,
  request: Request,
  environmentId: string,
): Promise<Response> {
  const session = await verifySession(context, request);

  await throttle(context, "enroll", session.userId);
  const body = parseBody(EnrollRequest, await requestText(request));
  const environment = await findOwnedEnvironment(context.db, {
    id: environmentId,
    ownerId: session.userId,
  });

  if (environment === undefined || environment.state !== "active") throw new Refusal("not_found");

  const reservedAt = context.now();
  const iat = nowSeconds(reservedAt);
  const grant: EnrollmentClaims = {
    iss: context.config.origin,
    aud: environment.id,
    sub: environment.owner_id,
    iat,
    exp: iat + ENROLLMENT_LIFETIME_SECONDS,
    jti: randomId(),
    nonce: randomId(),
    generation: environment.generation,
    deviceId: crypto.randomUUID(),
    clientId: body.clientId,
    clientName: body.clientName,
    digest: body.digest,
  };
  const reserved = await reserveDevice(context.db, {
    id: grant.deviceId,
    environmentId: environment.id,
    ownerId: session.userId,
    clientId: grant.clientId,
    clientName: grant.clientName,
    digest: grant.digest,
    sessionId: session.sessionId,
    grantId: grant.jti,
    nonce: grant.nonce,
    grantExpiresAt: grant.exp * 1000,
    now: reservedAt,
  });

  if (!reserved) {
    const current = await findOwnedEnvironment(context.db, {
      id: environment.id,
      ownerId: session.userId,
    });

    throw new Refusal(current?.state === "active" ? "limit" : "not_found");
  }

  const authorization = await signClaims({
    key: context.config.signing.active,
    typ: TOKEN_TYPES.enrollment,
    claims: grant,
  });
  const receipt = await forwardEnrollment(context, { environment, authorization });

  if (receipt === undefined || !(await receiptConfirms(context, { receipt, environment, grant }))) {
    await releaseReservation(context.db, { id: grant.deviceId, now: context.now() });
    throw new Refusal("unreachable");
  }

  const activated = await activateDevice(context.db, {
    id: grant.deviceId,
    environmentId: environment.id,
    clientId: grant.clientId,
    generation: grant.generation,
    now: context.now(),
  });

  if (!activated) {
    await releaseReservation(context.db, { id: grant.deviceId, now: context.now() });
    throw new Refusal("conflict");
  }

  const response: EnrollResponse = { environmentId: environment.id, deviceId: grant.deviceId };

  return json(201, response);
}

/**
 * The strong revocation, by the owner's Clerk session or the environment's
 * machine key. The enrolling Clerk session is denied at once and revoked in
 * Clerk now or by the cron. It applies to a device a weaker end already
 * stopped, so a release can never stand in for it; repeating it is harmless.
 */
export async function removeDevice(
  context: Context,
  request: Request,
  input: { readonly environmentId: string; readonly deviceId: string },
): Promise<Response> {
  const environment = await authorizeEnvironment(context, {
    request,
    environmentId: input.environmentId,
  });
  const device = await findDevice(context.db, {
    environmentId: environment.id,
    deviceId: input.deviceId,
  });

  if (device === undefined) throw new Refusal("not_found");
  await revokeDevice(context.db, {
    environmentId: environment.id,
    deviceId: device.id,
    ownerId: environment.owner_id,
    now: context.now(),
  });
  resetRelay(context, { environmentId: environment.id, deviceId: device.id });
  const owed = await pendingSessionRevocation(context.db, device.session_id);

  if (owed !== undefined) context.defer(settleSessionRevocation(context, owed));

  return noContent();
}

/**
 * The weak end, relayed by the desktop after the device's own token asked
 * for it: the device stops like a revoked one, but its Clerk session is
 * neither denied nor revoked, and a denial already in place stays.
 * Environment proof only, body exactly `{}`.
 */
export async function releaseDevice(
  context: Context,
  request: Request,
  input: { readonly environmentId: string; readonly deviceId: string },
): Promise<Response> {
  if (!request.headers.has(PROOF_HEADER)) throw new Refusal("unauthorized");
  const text = await requestText(request);
  const { environment } = await verifyEnvironmentProof(context, {
    request,
    body: text,
    environmentId: input.environmentId,
  });

  if (text !== "{}") throw new Refusal("invalid");
  await throttle(context, "revoke", environment.id);
  const device = await findDevice(context.db, {
    environmentId: environment.id,
    deviceId: input.deviceId,
  });

  if (device === undefined) throw new Refusal("not_found");
  await markDeviceReleased(context.db, {
    environmentId: environment.id,
    deviceId: device.id,
    now: context.now(),
  });
  resetRelay(context, { environmentId: environment.id, deviceId: device.id });

  return noContent();
}
