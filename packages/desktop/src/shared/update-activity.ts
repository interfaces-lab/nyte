import type { SessionInfo } from "@nyte-ai/sdk/client";

export type DesktopUpdateActivity =
  | { readonly kind: "idle" }
  | {
      readonly kind: "busy";
      readonly taskCount: number;
      readonly terminalCommandCount: number;
    };

/** Every chat with a head that isn't idle counts, subagents and archived chats alike. */
export function busyTaskCount(rows: readonly SessionInfo[]): number {
  return rows.filter((row) => row.heads.some((head) => head.execution.kind !== "idle")).length;
}

export function runningWork(
  activity: Extract<DesktopUpdateActivity, { readonly kind: "busy" }>,
): string {
  const count = (total: number, noun: string): string[] =>
    total === 0 ? [] : [`${total} ${noun}${total === 1 ? "" : "s"}`];

  return [
    ...count(activity.taskCount, "running task"),
    ...count(activity.terminalCommandCount, "terminal command"),
  ].join(" and ");
}
