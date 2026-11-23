import type { HostActivity } from "@nyte-ai/schema";

export function runningWork(activity: HostActivity): string | undefined {
  const count = (total: number, noun: string): string[] =>
    total === 0 ? [] : [`${total} ${noun}${total === 1 ? "" : "s"}`];

  const running = [...count(activity.runs, "running chat"), ...count(activity.jobs, "job")];

  return running.length === 0 ? undefined : running.join(" and ");
}
