/**
 * The two delivery roles the shell knows, read from the landing policy the
 * host declared. Core has no lane by name: a lane that lands at every
 * response boundary is what the composer's Enter means, and a lane that waits
 * for an idle head is what ctrl+enter means. The words on screen are the
 * lane's own name, so a host that renames a lane renames the UI with it.
 */
import type { Landing, Lane, PendingItem } from "@nyte-ai/core";

export interface LaneRoles {
  /** Lands before the next response: what Enter sends while a run is live. */
  readonly steer: Lane;
  /** Lands once the head is idle: what ctrl+enter sends. */
  readonly queue: Lane;
}

/**
 * Pick the two roles from the policy in force. A policy with one lane fills
 * both roles with it, so every keystroke still lands somewhere the runner
 * serves.
 */
export function laneRoles(landing: Landing): LaneRoles {
  const first = landing.lanes[0];
  if (first === undefined) throw new Error("The landing policy names no lanes");
  const boundary = landing.lanes.find((policy) => policy.lands === "boundary") ?? first;
  const idle = landing.lanes.find((policy) => policy.lands === "idle") ?? boundary;
  return { steer: boundary.lane, queue: idle.lane };
}

/**
 * The message Enter on an empty composer sends now: the first pending item
 * that is not already in the boundary lane, since one there is going out at
 * the next step anyway.
 *
 * Based on OpenCode v2, where enter on an empty prompt steers the first queued
 * prompt: https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/routes/session/index.tsx
 */
export function nextToSteer(
  items: readonly PendingItem[],
  roles: LaneRoles,
): PendingItem | undefined {
  return items.find((item) => item.lane !== roles.steer);
}
