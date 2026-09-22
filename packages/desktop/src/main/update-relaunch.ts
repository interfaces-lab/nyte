import type { MessageBoxOptions } from "electron";
import type { DesktopUpdateActivity } from "./host.ts";

const RELAUNCH_CLEANUP_TIMEOUT_MS = 10_000;

export type BusyUpdateActivity = Extract<DesktopUpdateActivity, { readonly kind: "busy" }>;

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

/** An install may only start on an idle app, so busy work blocks it instead of prompting. */
export function installBlockedDialog(activity: BusyUpdateActivity): MessageBoxOptions {
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

  return {
    type: "warning",
    message: "Nyte can't install an update while work is running",
    detail: `${descriptions.join(" and ")} ${
      total === 1 ? "is" : "are"
    } still running. Choose Restart to Update once ${total === 1 ? "it finishes" : "they finish"}.`,
    buttons: ["OK"],
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
