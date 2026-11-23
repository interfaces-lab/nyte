import type { HostActivity } from "@nyte-ai/schema";

/** What a restart would stop, as in "2 running chats and 1 job", or undefined when nothing runs. */
export function runningWork(activity: HostActivity): string | undefined {
  const count = (total: number, noun: string): string[] =>
    total === 0 ? [] : [`${total} ${noun}${total === 1 ? "" : "s"}`];

  const running = [...count(activity.runs, "running chat"), ...count(activity.jobs, "job")];

  return running.length === 0 ? undefined : running.join(" and ");
}
