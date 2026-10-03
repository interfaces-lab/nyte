/**
 * Environment routes: list and link with a Clerk session, lease with a
 * machine-key proof, and removal with either.
 */
import {
  LEASE_LIFETIME_SECONDS,
  LinkRequest,
  ONLINE_WINDOW_SECONDS,
  PROOF_HEADER,
  TOKEN_TYPES,
} from "@nyte-ai/connect";
import type { EnvironmentList, LeaseClaims, LeaseResponse, LinkResponse } from "@nyte-ai/connect";
import { nowSeconds, publicKeySet, signClaims } from "@nyte-ai/connect/signing";
import { Type } from "typebox";
import { lookupOwner, ownerStanding, verifySession } from "./clerk.ts";
import { throttle } from "./context.ts";
import type { Context } from "./context.ts";
import { Refusal, json, noContent, parseBody, requestText } from "./http.ts";
import { verifyEnvironmentProof, verifyLinkProof } from "./proof.ts";
import { revokeRelay } from "./relay-stub.ts";
import {
  ENVIRONMENT_LIMIT,
  countLiveEnvironments,
  findEnvironmentByThumbprint,
  findOwnedEnvironment,
  insertEnvironment,
  leaseSnapshot,
  listActiveEnvironments,
  renameEnvironment,
  revokeEnvironment,
  touchEnvironment,
} from "./store.ts";
import type { Environment } from "./store.ts";

const EmptyObject = Type.Object({}, { additionalProperties: false });

/** Refuse an environment whose owner is not in good standing, or cannot be confirmed to be. */
async function requireStanding(context: Context, environment: Environment): Promise<void> {
  const standing = await ownerStanding(context, { userId: environment.owner_id, recheck: true });

  switch (standing) {
    case "active":
      return;
    case "deleted":
      throw new Refusal("revoked");
    case "disabled":
      throw new Refusal("owner_disabled");
    case "unavailable":
      throw new Refusal("internal", 503);
    default: {
      const _exhaustive: never = standing;
      return _exhaustive;
    }
  }
}

/** Online: an authenticated relay socket and a heartbeat within `ONLINE_WINDOW_SECONDS`. */
export async function listEnvironments(context: Context, request: Request): Promise<Response> {
  const session = await verifySession(context, request);

  await throttle(context, "list", session.userId);
  const now = context.now();
  const environments = await listActiveEnvironments(context.db, session.userId);
  const body: EnvironmentList = {
    environments: environments.map((environment) => ({
      id: environment.id,
      name: environment.name,
      online:
        environment.relay_session !== null &&
        environment.last_seen_at !== null &&
        now - environment.last_seen_at <= ONLINE_WINDOW_SECONDS * 1000,
      lastSeenAt: environment.last_seen_at,
    })),
  };

  return json(200, body);
}

/**
 * The environment this key links: a new one within the owner's limit, or the
 * key's existing link, renamed. A key linked to another owner, or revoked, is
 * refused.
 */
async function claimEnvironment(
  context: Context,
  input: {
    readonly userId: string;
    readonly thumbprint: string;
    readonly request: LinkRequest;
  },
): Promise<Environment> {
  const resume = async (environment: Environment): Promise<Environment> => {
    if (environment.owner_id !== input.userId) throw new Refusal("conflict");

    if (environment.state === "revoked") throw new Refusal("revoked");
    await renameEnvironment(context.db, { id: environment.id, name: input.request.name });

    return { ...environment, name: input.request.name };
  };
  const existing = await findEnvironmentByThumbprint(context.db, input.thumbprint);

  if (existing !== undefined) return resume(existing);
  const id = crypto.randomUUID();
  const inserted = await insertEnvironment(context.db, {
    id,
    ownerId: input.userId,
    thumbprint: input.thumbprint,
    publicKey: input.request.publicKey.x,
    name: input.request.name,
    now: context.now(),
  });
  const claimed = await findEnvironmentByThumbprint(context.db, input.thumbprint);

  if (inserted && claimed !== undefined) return claimed;

  if (claimed !== undefined) return resume(claimed);

  throw new Refusal(
    (await countLiveEnvironments(context.db, input.userId)) >= ENVIRONMENT_LIMIT
      ? "limit"
      : "conflict",
  );
}

/**
 * Link a desktop to the caller's account, or resume the link with the same
 * key. The owner is looked up in Clerk first: a banned, locked, or unknown
 * user links nothing, and the owner label is Clerk's primary email, username,
 * or name, falling back to a session `email` claim and then the user id.
 * Clerk being unreachable does not block a link; the first lease asks again.
 */
export async function linkEnvironment(context: Context, request: Request): Promise<Response> {
  const session = await verifySession(context, request);

  await throttle(context, "link", session.userId);
  const text = await requestText(request);
  const body = parseBody(LinkRequest, text);
  const thumbprint = await verifyLinkProof(context, {
    request,
    body: text,
    publicKey: body.publicKey,
  });
  const lookup = await lookupOwner(context, session.userId);

  if ((await ownerStanding(context, { userId: session.userId, recheck: false })) !== "active")
    throw new Refusal("owner_disabled");
  const label =
    (lookup.kind === "found" ? lookup.label : undefined) ?? session.email ?? session.userId;
  const environment = await claimEnvironment(context, {
    userId: session.userId,
    thumbprint,
    request: body,
  });
  const response: LinkResponse = {
    environment: { id: environment.id, name: environment.name },
    owner: { id: session.userId, label },
    brokerKeys: publicKeySet(context.config.signing.all),
  };

  return json(201, response);
}

/**
 * The environment a removal names: proven by its machine key, or owned by
 * the Clerk session. Another owner's environment is not found.
 */
export async function authorizeEnvironment(
  context: Context,
  input: { readonly request: Request; readonly environmentId: string },
): Promise<Environment> {
  if (input.request.headers.has(PROOF_HEADER)) {
    const { environment } = await verifyEnvironmentProof(context, {
      request: input.request,
      body: await requestText(input.request),
      environmentId: input.environmentId,
    });

    await throttle(context, "revoke", environment.id);

    return environment;
  }

  const session = await verifySession(context, input.request);

  await throttle(context, "revoke", session.userId);
  const environment = await findOwnedEnvironment(context.db, {
    id: input.environmentId,
    ownerId: session.userId,
  });

  if (environment === undefined) throw new Refusal("not_found");

  return environment;
}

/** Revoke, then close the environment's relay sockets. */
export async function removeEnvironment(
  context: Context,
  request: Request,
  environmentId: string,
): Promise<Response> {
  const environment = await authorizeEnvironment(context, { request, environmentId });

  if (environment.state !== "revoked") {
    await revokeEnvironment(context.db, { id: environment.id, now: context.now() });
    revokeRelay(context, environment.id);
  }

  return noContent();
}

/**
 * The signed allowlist a serving desktop renews every heartbeat. Asks Clerk
 * about the owner at most every 15 minutes.
 */
export async function issueLease(
  context: Context,
  request: Request,
  environmentId: string,
): Promise<Response> {
  const text = await requestText(request);
  const { environment, claims } = await verifyEnvironmentProof(context, {
    request,
    body: text,
    environmentId,
  });

  parseBody(EmptyObject, text);

  if (environment.state === "revoked") throw new Refusal("revoked");
  await throttle(context, "lease", environment.id);
  await requireStanding(context, environment);
  const snapshot = await leaseSnapshot(context.db, environment.id);

  if (snapshot === undefined || snapshot.environment.state === "revoked")
    throw new Refusal("revoked");
  const now = context.now();
  const iat = nowSeconds(now);
  const lease: LeaseClaims = {
    iss: context.config.origin,
    aud: snapshot.environment.id,
    sub: snapshot.environment.owner_id,
    iat,
    exp: iat + LEASE_LIFETIME_SECONDS,
    req: claims.jti,
    generation: snapshot.environment.generation,
    policy: snapshot.environment.policy,
    devices: snapshot.devices,
  };
  const body: LeaseResponse = {
    lease: await signClaims({
      key: context.config.signing.active,
      typ: TOKEN_TYPES.lease,
      claims: lease,
    }),
  };

  await touchEnvironment(context.db, { id: environment.id, now });

  return json(200, body);
}
