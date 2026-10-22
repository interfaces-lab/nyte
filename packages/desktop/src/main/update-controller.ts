import type { UpdateState } from "@nyte-ai/app/bridge.ts";
import type { MessageBoxOptions } from "electron";
import type { AppUpdater } from "electron-updater";
import type { DesktopUpdateActivity } from "./host.ts";

const RELAUNCH_CLEANUP_TIMEOUT_MS = 10_000;

export type UpdateLogDetails = Readonly<Record<string, boolean | number | string>>;

interface UpdateDependencies {
  updater: Pick<AppUpdater, "checkForUpdates" | "downloadUpdate" | "quitAndInstall">;
  currentVersion: string;
  activity: () => Promise<DesktopUpdateActivity>;
  beforeInstall: () => Promise<void>;
  cleanupTimeoutMs?: number;
  publish: (state: UpdateState) => void;
  message: (options: MessageBoxOptions) => Promise<{ readonly response: number }>;
  log: (event: string, details?: UpdateLogDetails) => void;
}

type Outcome =
  | { readonly kind: "current" }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "failed"; readonly title: string; readonly detail: string };

export function createUpdateController({
  updater,
  currentVersion,
  activity,
  beforeInstall,
  cleanupTimeoutMs = RELAUNCH_CLEANUP_TIMEOUT_MS,
  publish,
  message,
  log,
}: UpdateDependencies) {
  let state: UpdateState = { kind: "idle" };
  let pending: Promise<Outcome> | undefined;

  const set = (next: UpdateState): void => {
    state = next;
    publish(next);
  };

  const run = async (): Promise<Outcome> => {
    if (state.kind === "ready") return { kind: "ready", version: state.version };
    let version: string;

    try {
      log("check-started");
      const result = await updater.checkForUpdates();

      if (result?.isUpdateAvailable !== true) {
        log("update-not-available");

        return { kind: "current" };
      }

      version = result.updateInfo.version;
    } catch (cause) {
      return { kind: "failed", title: "Couldn't check for updates", detail: errorMessage(cause) };
    }

    log("update-available", { targetVersion: version });
    set({ kind: "downloading", version, percent: 0 });

    try {
      await updater.downloadUpdate();
    } catch (cause) {
      const detail = errorMessage(cause);
      set({ kind: "failed", version, message: detail });

      return { kind: "failed", title: `Couldn't download Nyte ${version}`, detail };
    }

    log("update-downloaded", { targetVersion: version });
    set({ kind: "ready", version });

    return { kind: "ready", version };
  };

  const find = (): Promise<Outcome> =>
    (pending ??= run().finally(() => {
      pending = undefined;
    }));

  const restart = async (version: string): Promise<void> => {
    const current = await activity();
    const running = current.kind === "busy" ? runningWork(current) : undefined;

    const { response } = await message({
      type: running === undefined ? "info" : "warning",
      message: `Nyte ${version} is ready to install`,
      detail: running === undefined ? undefined : `Restarting stops ${running}.`,
      buttons: ["Restart to Update", "Later"],
      defaultId: running === undefined ? 0 : 1,
      cancelId: 1,
      noLink: true,
    });

    if (response !== 0 || state.kind !== "ready") return;
    set({ kind: "installing", version });
    log("relaunch-requested", { fromVersion: currentVersion, targetVersion: version });
    let timeout: NodeJS.Timeout | undefined;

    const cleanup = await Promise.race<{ event: string; details: UpdateLogDetails }>([
      beforeInstall().then(
        () => ({ event: "relaunch-cleanup-completed", details: {} }),
        (cause: unknown) => ({
          event: "relaunch-cleanup-failed",
          details: { message: errorMessage(cause) },
        }),
      ),
      new Promise((resolve) => {
        timeout = setTimeout(
          () => resolve({ event: "relaunch-cleanup-timed-out", details: {} }),
          cleanupTimeoutMs,
        );
      }),
    ]);

    clearTimeout(timeout);
    log(cleanup.event, cleanup.details);
    updater.quitAndInstall(false, true);
  };

  return {
    state: () => state,
    reset: (): void => set({ kind: "idle" }),
    installOnQuit: (): boolean => {
      if (state.kind !== "ready") return false;
      const version = state.version;
      set({ kind: "installing", version });
      log("quit-install-requested", { fromVersion: currentVersion, targetVersion: version });
      updater.quitAndInstall(true, false);

      return true;
    },
    check: async (): Promise<void> => {
      await find();
    },
    click: async (): Promise<void> => {
      if (state.kind === "installing") return;
      const outcome = await find();

      switch (outcome.kind) {
        case "current":
          await message({
            type: "info",
            message: `Nyte ${currentVersion} is up to date`,
            buttons: ["OK"],
          });

          return;
        case "failed":
          await message({
            type: "error",
            message: outcome.title,
            detail: outcome.detail,
            buttons: ["OK"],
          });

          return;
        case "ready":
          return restart(outcome.version);
      }
    },
    progress: (percent: number): void => {
      if (state.kind === "downloading") set({ ...state, percent });
    },
  };
}

function runningWork(activity: Extract<DesktopUpdateActivity, { readonly kind: "busy" }>): string {
  const count = (total: number, noun: string): string[] =>
    total === 0 ? [] : [`${total} ${noun}${total === 1 ? "" : "s"}`];

  return [
    ...count(activity.taskCount, "running task"),
    ...count(activity.terminalCommandCount, "terminal command"),
  ].join(" and ");
}

function errorMessage(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).split("\n", 1)[0] ?? "";
}
