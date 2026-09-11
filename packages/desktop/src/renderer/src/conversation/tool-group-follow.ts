/**
 * Follow rules for the compact work window. The preview tails new output
 * until the reader scrolls up, then tails again once they are back at the
 * bottom or after a quiet spell. The opened window only keeps the quiet-spell
 * timer, which hands the group back to its preview.
 */

/** Sub-pixel layout must never count as scrolled away. */
export const FOLLOW_SLACK_PX = 5;

/** Quiet spell after the reader's last input before following resumes. */
export const FOLLOW_RESUME_MS = 10_000;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

export type FollowWindow = "preview" | "opened";

export interface FollowStep {
  readonly paused: boolean;
  readonly resumeTimer: "arm" | "clear";
}

export function overflows(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight > metrics.clientHeight;
}

export function scrolledAway(metrics: ScrollMetrics): boolean {
  return metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - FOLLOW_SLACK_PX;
}

export function followOnScroll(
  window: FollowWindow,
  paused: boolean,
  metrics: ScrollMetrics,
): FollowStep {
  if (window === "opened") return { paused, resumeTimer: "arm" };
  if (!scrolledAway(metrics)) return { paused: false, resumeTimer: "clear" };
  return { paused: true, resumeTimer: "arm" };
}
