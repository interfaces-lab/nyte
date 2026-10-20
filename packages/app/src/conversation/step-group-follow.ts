const FOLLOW_SLACK_PX = 5;

export const FOLLOW_RESUME_MS = 10_000;

export const FOLLOW_INPUT_MS = 400;

interface ScrollMetrics {
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

export function followOnScroll(metrics: ScrollMetrics, reading: boolean): FollowStep | undefined {
  if (metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - FOLLOW_SLACK_PX)
    return { paused: false, resumeTimer: "clear" };

  return reading ? { paused: true, resumeTimer: "arm" } : undefined;
}
