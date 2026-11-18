import { verifyToken } from "@clerk/backend";
import { CLOCK_TOLERANCE_SECONDS } from "@nyte-ai/connect";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { rateStatement, withinLimit } from "./context.ts";
import type { Context, RateLimit } from "./context.ts";
import { Refusal, readText } from "./http.ts";
import { errorName } from "./log.ts";
import {
  confirmSessionRevoked,
  deferSessionRevocation,
  deniedStatement,
  ownerStatement,
} from "./store/owners.ts";
import { OwnerRow, one } from "./store/rows.ts";

const CLERK_API = "https://api.clerk.com/v1";

const CLERK_TIMEOUT_MS = 3_000;

const CLERK_REPLY_LIMIT = 65_536;

export const DENIAL_RETENTION_MS = 86_400_000;

const MAX_RETRY_MS = 86_400_000;

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;

const TOKEN_LIMIT = 8192;

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

export const RECONCILE_BATCH = 100;

interface Session {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string | undefined;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === "" ? undefined : trimmed.slice(0, LABEL_LIMIT);
}

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

export async function verifySession(
  context: Context,
  request: Request,
  bucket: RateLimit,
): Promise<Session> {
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

  const [owner, denied, count] = await context.db.batch([
    ownerStatement(context.db, claims.sub),
    deniedStatement(context.db, { sessionId: claims.sid, now: Date.now() }),
    rateStatement(context, bucket, claims.sub),
  ]);
  const standing = one(OwnerRow, owner?.results[0])?.status ?? "active";

  if (standing !== "active") throw new Refusal("owner_disabled");

  if ((denied?.results.length ?? 0) > 0) throw new Refusal("session_revoked");

  if (!withinLimit(bucket, count?.results[0])) throw new Refusal("rate_limited");

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

function clerkStanding(user: { readonly banned: boolean; readonly locked: boolean }) {
  return user.banned || user.locked ? "disabled" : "active";
}

type OwnerLookup =
  | {
      readonly kind: "found";
      readonly label: string | undefined;
      readonly status: "active" | "disabled";
    }
  | { readonly kind: "absent" }
  | { readonly kind: "failed" };

async function lookupOwner(context: Context, userId: string): Promise<OwnerLookup> {
  const answer = Value.Check(ClerkId, userId)
    ? await clerkCall(context, { method: "GET", path: `/users/${userId}` })
    : undefined;

  if (answer?.status === 200 && Value.Check(ClerkUser, answer.body) && answer.body.id === userId)
    return { kind: "found", label: userLabel(answer.body), status: clerkStanding(answer.body) };

  if (answer?.status === 404) return { kind: "absent" };
  context.log.warn("owner.lookup_failed", { status: answer?.status ?? 0 });

  return { kind: "failed" };
}

export async function requireLinkableOwner(context: Context, session: Session): Promise<string> {
  const lookup = await lookupOwner(context, session.userId);

  if (lookup.kind === "failed") throw new Refusal("internal", 503);

  if (lookup.kind === "absent" || lookup.status !== "active") throw new Refusal("owner_disabled");

  return lookup.label ?? session.email ?? session.userId;
}

const ClerkUserList = Type.Array(ClerkUser, { maxItems: RECONCILE_BATCH });

export async function lookupOwners(
  context: Context,
  userIds: readonly string[],
): Promise<
  | ReadonlyMap<string, { readonly status: "active" | "disabled"; readonly version: number }>
  | undefined
> {
  const ids = userIds.filter((id) => Value.Check(ClerkId, id));
  const query = new URLSearchParams([
    ...ids.map((id): [string, string] => ["user_id", id]),
    ["limit", String(RECONCILE_BATCH)],
  ]);
  const answer =
    ids.length === 0
      ? undefined
      : await clerkCall(context, { method: "GET", path: `/users?${query.toString()}` });

  if (answer?.status !== 200 || !Value.Check(ClerkUserList, answer.body)) {
    context.log.warn("owner.reconcile_failed", { status: answer?.status ?? 0 });

    return undefined;
  }

  return new Map(
    answer.body.map((user) => [user.id, { status: clerkStanding(user), version: user.updated_at }]),
  );
}

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

      if ((status >= 200 && status < 300) || status === 404 || status === 410) return true;
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
  const now = Date.now();

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
