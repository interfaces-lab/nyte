export type DesktopUpdateActivity =
  | { readonly kind: "idle" }
  | {
      readonly kind: "busy";
      readonly taskCount: number;
      readonly terminalCommandCount: number;
    };

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
