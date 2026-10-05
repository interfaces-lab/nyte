import type { UpdateState } from "@nyte-ai/app/bridge.ts";
import type { AppUpdater } from "electron-updater";
import type { DesktopUpdateActivity } from "./host.ts";

interface UpdateDependencies {
  updater: Pick<AppUpdater, "checkForUpdates" | "downloadUpdate" | "quitAndInstall">;
  activity: () => Promise<DesktopUpdateActivity>;
  publish: (state: UpdateState) => void;
  logError: (message: string) => void;
}

/** Running work turns the first restart into `blocked`; restarting from `blocked` installs anyway. */
export async function requestRestart({
  state,
  activity,
  publish,
  install,
}: {
  readonly state: UpdateState;
  readonly activity: () => Promise<DesktopUpdateActivity>;
  readonly publish: (state: UpdateState) => void;
  readonly install: () => void;
}): Promise<void> {
  if (state.kind === "ready") {
    const current = await activity();

    if (current.kind === "busy")
      return publish({ ...current, kind: "blocked", version: state.version });
  } else if (state.kind !== "blocked") return;
  install();
}

export function createUpdateController({
  updater,
  activity,
  publish,
  logError,
}: UpdateDependencies) {
  let state: UpdateState = { kind: "idle" };

  const set = (next: UpdateState): void => {
    state = next;
    publish(next);
  };

  const download = async (version: string): Promise<void> => {
    set({ kind: "downloading", version, percent: 0 });

    try {
      await updater.downloadUpdate();
      set({ kind: "ready", version });
    } catch (cause) {
      const message = errorMessage(cause);
      logError(message);
      set({ kind: "failed", version, message });
    }
  };

  return {
    state: () => state,
    async check(): Promise<void> {
      if (state.kind !== "idle" && state.kind !== "failed") return;

      try {
        const result = await updater.checkForUpdates();

        if (result?.isUpdateAvailable === true) await download(result.updateInfo.version);
      } catch (cause) {
        // Offline, or no release published yet: the next check tries again.
        logError(errorMessage(cause));
      }
    },
    progress(percent: number): void {
      if (state.kind === "downloading") set({ ...state, percent });
    },
    restart: () =>
      requestRestart({
        state,
        activity,
        publish: set,
        install: () => updater.quitAndInstall(false, true),
      }),
  };
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
