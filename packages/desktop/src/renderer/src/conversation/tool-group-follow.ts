/**
 * Follow rules for the compact work window. The preview tails new output
 * until the reader scrolls up, then tails again once they are back at the
 * bottom or after a quiet spell. An opened group stays open until the reader
 * closes it.
 */

/** Sub-pixel layout must never count as scrolled away. */
const FOLLOW_SLACK_PX = 5;

/** Quiet spell after the reader's last input before following resumes. */
export const FOLLOW_RESUME_MS = 10_000;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

interface FollowStep {
  readonly paused: boolean;
  readonly resumeTimer: "arm" | "clear";
}

export function overflows(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight > metrics.clientHeight;
}

export function scrolledAway(metrics: ScrollMetrics): boolean {
  return metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - FOLLOW_SLACK_PX;
}

export function followOnScroll(metrics: ScrollMetrics): FollowStep {
  if (!scrolledAway(metrics)) return { paused: false, resumeTimer: "clear" };
  return { paused: true, resumeTimer: "arm" };
}
