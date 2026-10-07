/**
 * What one request or scheduled run works with, and the rate limits it obeys.
 */
import type { Config, Env } from "./config.ts";
import { parseConfig } from "./config.ts";
import type { D1Database } from "./d1.ts";
import { Refusal } from "./http.ts";
import { errorName } from "./log.ts";
import type { Logger } from "./log.ts";
import type { RelayStub } from "./relay-stub.ts";
import { hit } from "./store.ts";

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface Dependencies {
  /** Outbound requests: the Clerk Backend API only. */
  readonly fetch: Fetch;
  readonly now: () => number;
  readonly log: Logger;
}

export interface Context extends Dependencies {
  readonly config: Config;
  readonly db: D1Database;
  /** The relay Durable Object of one environment. */
  readonly relay: (environmentId: string) => RelayStub;
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
    relay: (environmentId) => env.RELAY.getByName(environmentId),
    defer: (task) =>
      input.waitUntil(
        task.catch((error: unknown) => log.error("deferred.failed", { error: errorName(error) })),
      ),
  };
}

const RATE_LIMITS = {
  /** Every broker API request from one client address, before authentication. */
  address: { windowMs: 60_000, limit: 300 },
  list: { windowMs: 60_000, limit: 60 },
  link: { windowMs: 600_000, limit: 10 },
  enroll: { windowMs: 60_000, limit: 10 },
  revoke: { windowMs: 60_000, limit: 30 },
  /** Three heartbeats a minute, plus readiness refreshes after enrollments. */
  lease: { windowMs: 60_000, limit: 20 },
  /** Transactions one key may open; a retry of the same operation counts too. */
  linkOpen: { windowMs: 600_000, limit: 10 },
  /** Code lookups by one owner: a code is eight characters, so guessing must stay slow. */
  linkLookup: { windowMs: 60_000, limit: 10 },
  linkApprove: { windowMs: 60_000, limit: 10 },
  /** Polls, completions and cancels of one transaction: one every five seconds, with room to retry. */
  linkPoll: { windowMs: 60_000, limit: 30 },
  /** Every relayed phone request from one client address, before its bearer is checked. */
  relayAddress: { windowMs: 60_000, limit: 1200 },
  /** Relayed phone requests to one environment, after its bearer is checked. */
  relay: { windowMs: 60_000, limit: 1200 },
} as const;

export type RateLimit = keyof typeof RATE_LIMITS;

/** Count one request against `bucket` for `subject`. False once the window is full. */
export async function allow(
  context: Context,
  bucket: RateLimit,
  subject: string,
): Promise<boolean> {
  return hit(context.db, {
    key: `${bucket}:${subject}`,
    ...RATE_LIMITS[bucket],
    now: context.now(),
  });
}

/** Count one request against `bucket` for `subject`, or refuse it. */
export async function throttle(
  context: Context,
  bucket: RateLimit,
  subject: string,
): Promise<void> {
  if (!(await allow(context, bucket, subject))) throw new Refusal("rate_limited");
}
