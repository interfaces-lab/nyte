/**
 * Clerk: offline session verification, the Backend API calls behind owner
 * rechecks and session revocation, and the owner standing they feed.
 */
import { verifyToken } from "@clerk/backend";
import { CLOCK_TOLERANCE_SECONDS } from "@nyte-ai/connect";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { Context } from "./context.ts";
import { Refusal, readText } from "./http.ts";
import { errorName } from "./log.ts";
import {
  confirmSessionRevoked,
  deferSessionRevocation,
  findOwner,
  isSessionDenied,
  recordOwnerCheck,
} from "./store.ts";

const CLERK_API = "https://api.clerk.com/v1";

const CLERK_TIMEOUT_MS = 3_000;

const CLERK_REPLY_LIMIT = 65_536;

/** How long a Backend API owner lookup stands before a lease asks again. */
export const OWNER_RECHECK_MS = 15 * 60_000;

/**
 * How long a lookup may serve leases while Clerk cannot be asked again. Past
 * it, leases stop until Clerk answers, so an owner banned during an outage
 * that also swallowed the webhook is served for at most this long.
 */
export const OWNER_FRESHNESS_MS = 60 * 60_000;

/**
 * How long a denied session stays denied after Clerk confirms its
 * revocation: far beyond any session JWT minted before it.
 */
export const DENIAL_RETENTION_MS = 86_400_000;

const MAX_RETRY_MS = 86_400_000;

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;

const TOKEN_LIMIT = 8192;

/** Clerk object ids (`user_…`, `sess_…`): safe as a URL path segment. */
export const ClerkId = Type.String({ pattern: "^[A-Za-z0-9_]{1,128}$" });

const SessionClaims = Type.Object({
  iss: Type.String(),
  sub: ClerkId,
  sid: ClerkId,
  aud: Type.Union([Type.String(), Type.Array(Type.String(), { maxItems: 16 })]),
  azp: Type.Optional(Type.String()),
  sts: Type.Optional(Type.String()),
  email: Type.Optional(Type.Unknown()),
});

const OptionalText = Type.Optional(Type.Union([Type.String(), Type.Null()]));

const ClerkUser = Type.Object({
  id: ClerkId,
  banned: Type.Boolean(),
  locked: Type.Boolean(),
  updated_at: Type.Integer({ minimum: 0 }),
  primary_email_address_id: OptionalText,
  email_addresses: Type.Optional(
    Type.Array(Type.Object({ id: Type.String(), email_address: Type.String() }), { maxItems: 100 }),
  ),
  username: OptionalText,
  first_name: OptionalText,
  last_name: OptionalText,
});

type ClerkUser = Static<typeof ClerkUser>;

const LABEL_LIMIT = 320;

export interface Session {
  readonly userId: string;
  readonly sessionId: string;
  /** A non-empty `email` claim, when the operator added one to the session token. */
  readonly email: string | undefined;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === "" ? undefined : trimmed.slice(0, LABEL_LIMIT);
}

/** How Clerk would name the user: primary email, then username, then full name. */
function userLabel(user: ClerkUser): string | undefined {
  const primary = user.email_addresses?.find(
    (address) => address.id === user.primary_email_address_id,
  );

  return (
    nonEmpty(primary?.email_address) ??
    nonEmpty(user.username) ??
    nonEmpty([user.first_name, user.last_name].filter((part) => typeof part === "string").join(" "))
  );
}

/**
 * Verify a Clerk session JWT offline and check what `verifyToken` leaves to
 * the caller: the exact issuer, a required audience naming `CONNECT_ORIGIN`,
 * a session id, an allowed `azp` when one is present, an active session
 * status, and no impersonation. Then refuse disabled owners and denied
 * sessions.
 */
export async function verifySession(context: Context, request: Request): Promise<Session> {
  const token = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];

  if (token === undefined || token.length > TOKEN_LIMIT) throw new Refusal("unauthorized");
  const { clerk, origin } = context.config;
  let claims: unknown;

  try {
    claims = await verifyToken(token, {
      jwtKey: clerk.jwtKey,
      clockSkewInMs: CLOCK_TOLERANCE_SECONDS * 1000,
    });
  } catch {
    throw new Refusal("unauthorized");
  }

  if (typeof claims !== "object" || claims === null || "act" in claims)
    throw new Refusal("unauthorized");

  if (!Value.Check(SessionClaims, claims)) throw new Refusal("unauthorized");
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;

  if (
    claims.iss !== clerk.issuer ||
    !audiences.includes(origin) ||
    (claims.azp !== undefined && !clerk.authorizedParties.includes(claims.azp)) ||
    (claims.sts !== undefined && claims.sts !== "active")
  )
    throw new Refusal("unauthorized");

  const owner = await findOwner(context.db, claims.sub);

  if (owner !== undefined && owner.status !== "active") throw new Refusal("owner_disabled");

  if (await isSessionDenied(context.db, { sessionId: claims.sid, now: context.now() }))
    throw new Refusal("session_revoked");

  return {
    userId: claims.sub,
    sessionId: claims.sid,
    email: typeof claims.email === "string" ? nonEmpty(claims.email) : undefined,
  };
}

async function clerkCall(
  context: Context,
  input: { readonly method: "GET" | "POST"; readonly path: string },
): Promise<{ readonly status: number; readonly body: unknown } | undefined> {
  let response: Response;

  try {
    response = await context.fetch(`${CLERK_API}${input.path}`, {
      method: input.method,
      headers: {
        authorization: `Bearer ${context.config.clerk.secretKey}`,
        accept: "application/json",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(CLERK_TIMEOUT_MS),
    });
  } catch {
    return undefined;
  }

  const text = await readText(response.body, CLERK_REPLY_LIMIT);
  let body: unknown;

  try {
    body = text === undefined || text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }

  return { status: response.status, body };
}

export type Standing =
  | "active"
  /** Banned or locked in Clerk, or unknown to it. Not terminal. */
  | "disabled"
  | "deleted"
  /** Clerk has not answered for longer than `OWNER_FRESHNESS_MS`. */
  | "unavailable";

/**
 * Whether the owner may be served now. Deleted is final. With `recheck`, a
 * standing older than `OWNER_RECHECK_MS` is looked up in the Backend API, so
 * a missed webhook is caught within that bound. While Clerk cannot answer,
 * the stored standing serves until its last answered lookup is
 * `OWNER_FRESHNESS_MS` old; after that the owner is unavailable, not active.
 */
export async function ownerStanding(
  context: Context,
  input: { readonly userId: string; readonly recheck: boolean },
): Promise<Standing> {
  const owner = await findOwner(context.db, input.userId);

  if (owner?.status === "deleted") return "deleted";

  if (!input.recheck) return owner?.status ?? "active";
  const now = context.now();
  const checkedAt = owner?.checked_at ?? null;

  if (owner !== undefined && checkedAt !== null && checkedAt + OWNER_RECHECK_MS > now)
    return owner.status;
  const lookup = await lookupOwner(context, input.userId);

  if (lookup.kind === "failed") {
    if (owner?.status === "disabled") return "disabled";

    return owner !== undefined && checkedAt !== null && checkedAt + OWNER_FRESHNESS_MS > now
      ? owner.status
      : "unavailable";
  }

  return (await findOwner(context.db, input.userId))?.status ?? "active";
}

export type OwnerLookup =
  | { readonly kind: "found"; readonly label: string | undefined }
  | { readonly kind: "absent" }
  | { readonly kind: "failed" };

/**
 * Ask the Backend API about the owner and record the standing it reports:
 * disabled when banned, locked, or unknown. Unknown is not terminal, so a
 * misconfigured key cannot revoke every link; only the webhook deletes.
 */
export async function lookupOwner(context: Context, userId: string): Promise<OwnerLookup> {
  const answer = Value.Check(ClerkId, userId)
    ? await clerkCall(context, { method: "GET", path: `/users/${userId}` })
    : undefined;
  const now = context.now();

  if (answer?.status === 200 && Value.Check(ClerkUser, answer.body) && answer.body.id === userId) {
    await recordOwnerCheck(context.db, {
      userId,
      status: answer.body.banned || answer.body.locked ? "disabled" : "active",
      version: answer.body.updated_at,
      now,
    });

    return { kind: "found", label: userLabel(answer.body) };
  }

  if (answer?.status === 404) {
    await recordOwnerCheck(context.db, {
      userId,
      status: "disabled",
      version: (await findOwner(context.db, userId))?.version ?? 0,
      now,
    });

    return { kind: "absent" };
  }

  context.log.warn("owner.lookup_failed", { status: answer?.status ?? 0 });

  return { kind: "failed" };
}

/**
 * Ask Clerk to revoke a denied session, then either confirm the denial's
 * expiry or schedule another attempt. Until Clerk confirms, the D1 denial
 * never lapses; past `SESSION_REVOKE_ATTEMPTS` it is simply kept for good.
 */
export async function settleSessionRevocation(
  context: Context,
  input: { readonly sessionId: string; readonly attempts: number },
): Promise<void> {
  const settled = await (async () => {
    if (!Value.Check(ClerkId, input.sessionId)) return false;

    try {
      const answer = await clerkCall(context, {
        method: "POST",
        path: `/sessions/${input.sessionId}/revoke`,
      });

      if (answer === undefined) return false;
      const { status } = answer;

      if (status >= 200 && status < 300) return true;
      // Already gone. Anything else is retried; the D1 denial holds meanwhile.
      if (status === 404 || status === 410) return true;
      context.log.warn("session.revoke_failed", { status, attempts: input.attempts });

      return false;
    } catch (error) {
      context.log.warn("session.revoke_failed", {
        error: errorName(error),
        attempts: input.attempts,
      });

      return false;
    }
  })();
  const now = context.now();

  if (settled) {
    await confirmSessionRevoked(context.db, {
      sessionId: input.sessionId,
      now,
      expiresAt: now + DENIAL_RETENTION_MS,
    });

    return;
  }

  await deferSessionRevocation(context.db, {
    sessionId: input.sessionId,
    nextAttemptAt: now + Math.min(60_000 * 2 ** Math.min(input.attempts, 20), MAX_RETRY_MS),
  });
}
