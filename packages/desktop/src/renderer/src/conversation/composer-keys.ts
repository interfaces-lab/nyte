/**
 * Enter and the lanes it sends to, read from the landing policy the host
 * declared. Core names no lane: the lane that lands at every response boundary
 * is what Enter sends (it steers a live run), and the lane that waits for an
 * idle head is what the modifier sends (it queues a follow-up). Shift+Enter is
 * a newline, and a composition's Enter belongs to the IME.
 */
import type { Landing, Lane, PendingItem } from "@nyte-ai/core";

export interface LaneRoles {
  /** Lands before the next response: what Enter sends. */
  readonly steer: Lane;
  /** Lands once the head is idle: what Cmd/Ctrl+Enter sends. */
  readonly queue: Lane;
}

/** A policy with one lane fills both roles with it, so every keystroke lands somewhere served. */
export function laneRoles(landing: Landing): LaneRoles {
  const first = landing.lanes[0];
  if (first === undefined) throw new Error("The landing policy names no lanes");
  const boundary = landing.lanes.find((policy) => policy.lands === "boundary") ?? first;
  const idle = landing.lanes.find((policy) => policy.lands === "idle") ?? boundary;
  return { steer: boundary.lane, queue: idle.lane };
}

export interface EnterKeyState {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
}

export type SubmitAction = "submit" | "submit-alternate";
export type ComposerEnterAction = SubmitAction | "newline" | "none";

export function composerEnterAction(event: EnterKeyState): ComposerEnterAction {
  if (event.key !== "Enter" || event.isComposing) return "none";
  if (event.shiftKey) return "newline";
  if (event.metaKey || event.ctrlKey) return "submit-alternate";
  return "submit";
}

/**
 * The lane a submit lands in. A new message steers on Enter and queues with
 * the modifier; an edited queued item keeps its own lane on Enter and swaps to
 * the other role with the modifier, so editing never silently re-lanes it.
 */
export function submissionLane(action: SubmitAction, roles: LaneRoles, current?: Lane): Lane {
  if (current === undefined) return action === "submit" ? roles.steer : roles.queue;
  if (action === "submit") return current;
  return current === roles.steer ? roles.queue : roles.steer;
}

export function modifierKeyLabel(mac: boolean): string {
  return mac ? "⌘" : "Ctrl+";
}

/**
 * The message Enter on an empty composer sends now: the first pending item
 * that is not already in the boundary lane, since one there is going out at
 * the next step anyway.
 */
export function nextToSteer(
  items: readonly PendingItem[],
  roles: LaneRoles,
): PendingItem | undefined {
  return items.find((item) => item.lane !== roles.steer);
}
