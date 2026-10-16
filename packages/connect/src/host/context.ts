import { HEARTBEAT_INTERVAL_SECONDS, LINK_POLL_INTERVAL_SECONDS } from "../index.ts";
import type { RelayTiming } from "./relay.ts";

export interface ConnectTiming {
  readonly heartbeatMs: number;
  /** After a failed lease request, how soon to ask again. */
  readonly retryMs: number;
  readonly unlinkRetryMs: number;
  /** Longest a request from a just-enrolled device waits for a fresh lease. */
  readonly readinessWaitMs: number;
  /** Least time between two such refreshes for one device once one came back. */
  readonly readinessThrottleMs: number;
  /** After one that failed or timed out, least time before the device's next request may try again. */
  readonly readinessRetryMs: number;
  /** Least time between two reads of the broker's key set. */
  readonly keysMs: number;
  /** How long a self-revocation's own response has before every stream is dropped. */
  readonly dropDelayMs: number;
  /** How often a linking host asks the broker whether the owner approved. */
  readonly linkPollMs: number;
  readonly relay?: Partial<RelayTiming>;
}

export const DEFAULT_TIMING: ConnectTiming = {
  heartbeatMs: HEARTBEAT_INTERVAL_SECONDS * 1_000,
  retryMs: 5_000,
  unlinkRetryMs: 300_000,
  readinessWaitMs: 5_000,
  readinessThrottleMs: 30_000,
  readinessRetryMs: 2_000,
  keysMs: 300_000,
  dropDelayMs: 250,
  linkPollMs: LINK_POLL_INTERVAL_SECONDS * 1_000,
};
