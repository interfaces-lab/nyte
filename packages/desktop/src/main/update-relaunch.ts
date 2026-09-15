import type { DesktopUpdateActivity } from "./host.ts";

const RELAUNCH_CLEANUP_TIMEOUT_MS = 10_000;

type BusyUpdateActivity = Extract<DesktopUpdateActivity, { readonly kind: "busy" }>;

type UpdateCheckPreflight =
  | { readonly kind: "check" }
  | { readonly kind: "defer"; readonly activity: BusyUpdateActivity };

type RelaunchCleanupResult =
  | { readonly kind: "completed" }
  | { readonly kind: "timed-out" }
  | { readonly kind: "failed"; readonly message: string };

export async function runRelaunchCleanup({
  cleanup,
  timeoutMs = RELAUNCH_CLEANUP_TIMEOUT_MS,
}: {
  readonly cleanup: () => Promise<void>;
  readonly timeoutMs?: number;
}): Promise<RelaunchCleanupResult> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<RelaunchCleanupResult>((resolve) => {
    timeout = setTimeout(() => resolve({ kind: "timed-out" }), timeoutMs);
  });
  const operation = (async (): Promise<RelaunchCleanupResult> => {
    try {
      await cleanup();
      return { kind: "completed" };
    } catch (cause) {
      return { kind: "failed", message: errorMessage(cause) };
    }
  })();
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function preflightUpdateCheck({
  activity,
  confirm,
  manual,
}: {
  readonly activity: () => Promise<DesktopUpdateActivity>;
  readonly confirm: (activity: BusyUpdateActivity) => Promise<boolean>;
  readonly manual: boolean;
}): Promise<UpdateCheckPreflight> {
  const current = await activity();
  if (current.kind === "idle") return { kind: "check" };
  if (manual && (await confirm(current))) return { kind: "check" };
  return { kind: "defer", activity: current };
}

export function updateActivityDetail(activity: BusyUpdateActivity): string {
  const descriptions: string[] = [];
  if (activity.taskCount > 0) {
    descriptions.push(`${activity.taskCount} ${activity.taskCount === 1 ? "task" : "tasks"}`);
  }
  if (activity.terminalCommandCount > 0) {
    descriptions.push(
      `${activity.terminalCommandCount} terminal ${
        activity.terminalCommandCount === 1 ? "command" : "commands"
      }`,
    );
  }
  const total = activity.taskCount + activity.terminalCommandCount;
  return `${descriptions.join(" and ")} ${total === 1 ? "is" : "are"} still running. Installing an update will stop ${
    total === 1 ? "it" : "them"
  }.`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
