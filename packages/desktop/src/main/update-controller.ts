import type { AppUpdater } from "electron-updater";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { installBlockedDialog } from "./update-relaunch.ts";
import type { DesktopUpdateActivity } from "./host.ts";

export interface UpdateDependencies {
  updater: Pick<AppUpdater, "checkForUpdates" | "downloadUpdate" | "quitAndInstall">;
  message: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  activity: () => Promise<DesktopUpdateActivity>;
  status: (label: string, enabled: boolean) => void;
  logError: (message: string) => void;
  version: string;
  unavailable: string | undefined;
}

/** One update operation at a time; a deferred restart keeps its verified download. */
export function createUpdateController(dependencies: UpdateDependencies) {
  const { updater, message, status } = dependencies;
  let busy = false;
  let downloaded: string | undefined;

  async function offerRestart(version: string): Promise<void> {
    const current = await dependencies.activity();

    if (current.kind === "busy") {
      await message(installBlockedDialog(current));

      return;
    }

    const answer = await message({
      type: "info",
      message: `Nyte ${version} is ready to install`,
      detail: "Restart Nyte to finish updating. Running sessions and terminals will close.",
      buttons: ["Restart and Install", "Later"],
      defaultId: 1,
      cancelId: 1,
    });

    if (answer.response === 0) updater.quitAndInstall(false, true);
  }

  async function check(manual: boolean): Promise<void> {
    if (busy) return;
    busy = true;
    let downloadRequested = false;
    status("Checking for Updates…", false);

    try {
      if (dependencies.unavailable !== undefined) {
        if (manual)
          await message({
            type: "info",
            message: "Updates unavailable",
            detail: dependencies.unavailable,
          });

        return;
      }

      if (downloaded !== undefined) {
        if (manual) await offerRestart(downloaded);

        return;
      }

      const result = await updater.checkForUpdates();

      if (result === null) {
        if (manual)
          await message({
            type: "info",
            message: "Updates unavailable",
            detail: "This installation cannot check for updates.",
          });

        return;
      }

      if (!result.isUpdateAvailable) {
        if (manual)
          await message({
            type: "info",
            message: "You're up to date",
            detail: `Nyte ${dependencies.version} is the latest desktop release.`,
          });

        return;
      }

      const version = result.updateInfo.version;

      const answer = await message({
        type: "info",
        message: `Nyte ${version} is available`,
        detail: `You're running ${dependencies.version}. Download the update now and choose when to restart.`,
        buttons: ["Download Update", "Later"],
        defaultId: 0,
        cancelId: 1,
      });

      if (answer.response !== 0) return;
      status("Downloading Update…", false);
      downloadRequested = true;
      await updater.downloadUpdate();
      downloaded = version;
      await offerRestart(version);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      dependencies.logError(detail);

      // A background check stays quiet when offline or before the first release.
      // Once a download was requested, failures must be visible.
      if (manual || downloadRequested || downloaded !== undefined) {
        await message({
          type: "error",
          message: "Couldn't update Nyte",
          detail: `${detail}\n\nYour current installation has not been replaced. Try again from Check for Updates.`,
        });
      }
    } finally {
      busy = false;
      status(downloaded === undefined ? "Check for Updates…" : "Restart to Update…", true);
    }
  }

  return { check };
}
