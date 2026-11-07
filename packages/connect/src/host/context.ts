import { HEARTBEAT_INTERVAL_SECONDS, LINK_POLL_INTERVAL_SECONDS } from "../index.ts";
import type { RelayTiming } from "./relay.ts";

export interface ConnectTiming {
  readonly heartbeatMs: number;
  readonly retryMs: number;
  readonly unlinkRetryMs: number;
  readonly readinessWaitMs: number;
  readonly readinessThrottleMs: number;
  readonly readinessRetryMs: number;
  readonly keysMs: number;
  readonly dropDelayMs: number;
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
