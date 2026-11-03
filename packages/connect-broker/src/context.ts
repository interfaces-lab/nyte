/**
 * What one request or scheduled run works with, and the D1 rate limits it
 * obeys. Limits on an environment's own traffic live in its relay
 * (`environment-record.ts`).
 */
import type { Config, Env } from "./config.ts";
import { parseConfig } from "./config.ts";
import type { D1Database, D1PreparedStatement } from "./d1.ts";
import type { EnvironmentApi } from "./environment-api.ts";
import { Refusal } from "./http.ts";
import { errorName } from "./log.ts";
import type { Logger } from "./log.ts";
import { hitCount, hitStatement } from "./store/replays.ts";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface Dependencies {
  /** Outbound requests: the Clerk Backend API only. */
  readonly fetch: Fetch;
  readonly log: Logger;
}

export interface Context extends Dependencies {
  readonly config: Config;
  readonly db: D1Database;
  /** The relay Durable Object of one environment. */
  readonly environment: (environmentId: string) => EnvironmentApi;
  /** Run after the answer is sent. Failures are logged, never thrown. */
  readonly defer: (task: Promise<unknown>) => void;
}

/** The context for `env`, or undefined when a binding is invalid; the failing names are logged. */
export function createContext(input: {
  readonly env: Env;
  readonly dependencies: Dependencies;
  readonly waitUntil: (task: Promise<unknown>) => void;
}): Context | undefined {
  const { env, dependencies } = input;
  const { log } = dependencies;
  const config = parseConfig(env);

  if ("invalid" in config) {
    log.error("config.invalid", { bindings: config.invalid.join(",") });

    return undefined;
  }

  return {
    ...dependencies,
    config,
    db: env.DB,
    environment: (environmentId) => env.RELAY.getByName(environmentId),
    defer: (task) =>
      input.waitUntil(
        task.catch((error: unknown) => log.error("deferred.failed", { error: errorName(error) })),
      ),
  };
}

const RATE_LIMITS = {
  /** Opening a link transaction, from one client address: the one route that writes D1 for anyone. */
  address: { windowMs: 60_000, limit: 300 },
  list: { windowMs: 60_000, limit: 60 },
  link: { windowMs: 600_000, limit: 10 },
  enroll: { windowMs: 60_000, limit: 10 },
  revoke: { windowMs: 60_000, limit: 30 },
  linkOpen: { windowMs: 600_000, limit: 10 },
  linkLookup: { windowMs: 60_000, limit: 10 },
  linkApprove: { windowMs: 60_000, limit: 10 },
  linkPoll: { windowMs: 60_000, limit: 30 },
} as const;

export type RateLimit = keyof typeof RATE_LIMITS;

/** The statement that counts one request against `bucket` for `subject`; `withinLimit` reads its row. */
export function rateStatement(
  context: Context,
  bucket: RateLimit,
  subject: string,
): D1PreparedStatement {
  return hitStatement(context.db, {
    key: `${bucket}:${subject}`,
    windowMs: RATE_LIMITS[bucket].windowMs,
    now: Date.now(),
  });
}

export function withinLimit(bucket: RateLimit, row: unknown): boolean {
  return hitCount(row) <= RATE_LIMITS[bucket].limit;
}

/** Count one request against `bucket` for `subject`, or refuse it. */
export async function throttle(
  context: Context,
  bucket: RateLimit,
  subject: string,
): Promise<void> {
  if (!withinLimit(bucket, await rateStatement(context, bucket, subject).first()))
    throw new Refusal("rate_limited");
}
