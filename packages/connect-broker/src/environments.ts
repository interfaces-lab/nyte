/**
 * Environment routes: list and link with a Clerk session, lease with a
 * machine-key proof, and removal with either. Past its D1 index row, an
 * environment is its relay's to decide about.
 */
import { LinkRequest, PROOF_HEADER } from "@nyte-ai/connect";
import type { EnvironmentList, ErrorCode, LinkResponse } from "@nyte-ai/connect";
import { publicKeySet } from "@nyte-ai/connect/signing";
import { requireLinkableOwner, verifySession } from "./clerk.ts";
import type { Context } from "./context.ts";
import type { Actor } from "./environment-api.ts";
import { Refusal, json, noContent, parseBody, requestText, unwrap } from "./http.ts";
import { proofToken, verifyLinkProof } from "./proof.ts";
import { claimEnvironment, listActiveEnvironments } from "./store/environments.ts";
import type { ClaimOutcome } from "./store/environments.ts";

/** The owner's active environments; each relay says whether its desktop is online. */
export async function listEnvironments(context: Context, request: Request): Promise<Response> {
  const session = await verifySession(context, request, "list");
  const environments = await listActiveEnvironments(context.db, session.userId);

  const presences = await Promise.all(
    environments.map((environment) => context.environment(environment.id).status(session.userId)),
  );

  const body: EnvironmentList = {
    environments: environments.flatMap((environment, index) => {
      const presence = presences[index];

      return presence === null || presence === undefined
        ? []
        : [
            {
              id: environment.id,
              name: environment.name,
              online: presence.online,
              lastSeenAt: presence.lastSeenAt,
            },
          ];
    }),
  };

  return json(200, body);
}

/**
 * Link a desktop to the caller's account, or resume the link with the same
 * key. The owner is looked up in Clerk first: a banned, locked, or unknown
 * user links nothing, and neither does any user while Clerk can't answer.
 */
export async function linkEnvironment(context: Context, request: Request): Promise<Response> {
  const session = await verifySession(context, request, "link");
  const text = await requestText(request);
  const body = parseBody(LinkRequest, text);

  const thumbprint = await verifyLinkProof(context, {
    request,
    body: text,
    publicKey: body.publicKey,
  });

  const label = await requireLinkableOwner(context, session);

  const claimed = await claimEnvironment(context.db, {
    kind: "session",
    ownerId: session.userId,
    sessionId: session.sessionId,
    thumbprint,
    publicKey: body.publicKey.x,
    name: body.name,
    now: Date.now(),
  });

  if (claimed.kind !== "linked") throw new Refusal(claimRefusal(claimed));

  const response: LinkResponse = {
    environment: { id: claimed.environment.id, name: claimed.environment.name },
    owner: { id: session.userId, label },
    brokerKeys: publicKeySet(context.config.signing.all),
  };

  return json(201, response);
}

export function claimRefusal(outcome: Exclude<ClaimOutcome, { kind: "linked" }>): ErrorCode {
  switch (outcome.kind) {
    case "conflict":
    case "limit":
    case "revoked":
    case "owner_disabled":
    case "session_revoked":
      return outcome.kind;
    case "recovered":
      return "conflict";
    case "transaction":
      return "forbidden";
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

/**
 * Who asks to remove something: the desktop, when the request carries a
 * proof, else the owner's Clerk session. The relay checks either.
 */
export async function requestActor(context: Context, request: Request): Promise<Actor> {
  if (request.headers.has(PROOF_HEADER))
    return {
      kind: "desktop",
      proof: { token: proofToken(request), body: await requestText(request) },
    };
  const session = await verifySession(context, request, "revoke");

  return { kind: "owner", ownerId: session.userId };
}

/** Revoke the environment; its relay closes the desktop's socket. */
export async function removeEnvironment(
  context: Context,
  request: Request,
  environmentId: string,
): Promise<Response> {
  const actor = await requestActor(context, request);

  unwrap(await context.environment(environmentId).revoke(actor));

  return noContent();
}

/** The signed allowlist a serving desktop renews every heartbeat, answered by its relay. */
export async function issueLease(
  context: Context,
  request: Request,
  environmentId: string,
): Promise<Response> {
  const body = await requestText(request);
  const token = proofToken(request);

  return json(200, unwrap(await context.environment(environmentId).lease({ token, body })));
}
