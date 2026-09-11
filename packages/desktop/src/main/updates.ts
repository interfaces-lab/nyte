import electronUpdater from "electron-updater";
import { updater } from "electron-sparkle";
import { app, dialog } from "electron";
import type { MenuItem } from "electron";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createUpdateController } from "./update-controller.ts";

export function registerUpdates(item: MenuItem, beforeRelaunch: () => Promise<void>): void {
  const logError = (message: string): void => {
    void appendFile(
      join(app.getPath("userData"), "updates.log"),
      `${JSON.stringify({ time: new Date().toISOString(), message })}\n`,
    ).catch(() => undefined);
  };
  const unavailable = !app.isPackaged
    ? "This is a development build. Install the packaged Nyte app to receive updates."
    : process.env["NYTE_OFFLINE"] !== undefined
      ? "NYTE_OFFLINE is set. Disable it and restart Nyte to check for updates."
      : process.platform === "linux" && process.env["APPIMAGE"] === undefined
        ? "Install the AppImage build to receive desktop updates."
        : undefined;
  if (process.platform === "darwin" && unavailable === undefined) {
    updater.setBeforeRelaunchHandler(beforeRelaunch);
    updater.on("error", ({ error }) => logError(error.message));
    updater.on("state-changed", ({ state }) => {
      item.enabled = state.canCheckForUpdates;
    });
    updater.on("before-relaunch", () => logError("Restarting to install update"));
    logError(`Started Nyte ${app.getVersion()}`);
  }
  item.click = () => {
    void check(true);
  };

  let controller: ReturnType<typeof createUpdateController> | undefined;
  const load = () => {
    const { autoUpdater } = electronUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = { info: () => undefined, warn: logError, error: logError };
    autoUpdater.on("error", (error: Error) => logError(error.message));
    autoUpdater.signals.progress((info) => {
      item.label = `Downloading Update… ${Math.floor(info.percent)}%`;
    });
    return createUpdateController({
      updater: autoUpdater,
      message: (options) => dialog.showMessageBox(options),
      status: (label, enabled) => {
        item.label = label;
        item.enabled = enabled;
      },
      logError,
      version: app.getVersion(),
      unavailable,
    });
  };
  async function check(manual: boolean): Promise<void> {
    try {
      if (process.platform === "darwin") {
        if (unavailable !== undefined) {
          if (manual)
            await dialog.showMessageBox({
              type: "info",
              message: "Updates unavailable",
              detail: unavailable,
            });
          return;
        }
        await updater.start();
        // Nyte owns the schedule and environment flags on every platform.
        updater.setAutomaticallyChecksForUpdates(false);
        updater.setAutomaticallyDownloadsUpdates(false);
        if (!updater.getState().canCheckForUpdates) return;
        if (manual) updater.checkForUpdates();
        else updater.checkForUpdatesInBackground();
        return;
      }
      controller ??= load();
      await controller.check(manual);
    } catch (cause) {
      controller = undefined;
      const detail = cause instanceof Error ? cause.message : String(cause);
      logError(detail);
      if (manual)
        await dialog.showMessageBox({
          type: "error",
          message: "Couldn't start the updater",
          detail,
        });
    }
  }
  if (
    !app.isPackaged ||
    process.env["NYTE_OFFLINE"] !== undefined ||
    process.env["NYTE_SKIP_VERSION_CHECK"] !== undefined
  )
    return;
  const startup = setTimeout(() => void check(false), 15_000);
  const periodic = setInterval(() => void check(false), 6 * 60 * 60_000);
  startup.unref();
  periodic.unref();
  app.once("before-quit", () => {
    clearTimeout(startup);
    clearInterval(periodic);
  });
}
