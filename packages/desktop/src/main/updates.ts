import electronUpdater from "electron-updater";
import { updater } from "electron-sparkle";
import { app, dialog } from "electron";
import type { MenuItem } from "electron";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createUpdateController } from "./update-controller.ts";
import {
  preflightUpdateCheck,
  runRelaunchCleanup,
  updateActivityDetail,
} from "./update-relaunch.ts";
import type { DesktopUpdateActivity } from "./host.ts";

const CHECK_LABEL = "Check for Updates…";
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;
const ACTIVE_WORK_RETRY_MS = 15 * 60_000;

type UpdateLogValue = boolean | number | string;
type UpdateLogDetails = Readonly<Record<string, UpdateLogValue>>;

export function registerUpdates({
  item,
  activity,
  beforeRelaunch,
}: {
  readonly item: MenuItem;
  readonly activity: () => Promise<DesktopUpdateActivity>;
  readonly beforeRelaunch: () => Promise<void>;
}): void {
  const logPath = join(app.getPath("userData"), "updates.log");
  let logTail = Promise.resolve();
  const log = (event: string, details: UpdateLogDetails = {}): void => {
    const line = `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`;
    logTail = logTail.then(() => appendFile(logPath, line)).catch(() => undefined);
  };
  const logError = (message: string): void => log("error", { message });
  const unavailable = !app.isPackaged
    ? "This is a development build. Install the packaged Nyte app to receive updates."
    : process.env["NYTE_OFFLINE"] !== undefined
      ? "NYTE_OFFLINE is set. Disable it and restart Nyte to check for updates."
      : process.platform === "linux" && process.env["APPIMAGE"] === undefined
        ? "Install the AppImage build to receive desktop updates."
        : undefined;

  let activeWorkRetry: NodeJS.Timeout | undefined;
  if (process.platform === "darwin" && unavailable === undefined) {
    updater.setBeforeRelaunchHandler(async (update) => {
      item.label = "Preparing to Restart…";
      item.enabled = false;
      log("relaunch-requested", {
        fromVersion: app.getVersion(),
        targetVersion: update.displayVersion,
      });
      const cleanup = await runRelaunchCleanup({ cleanup: beforeRelaunch });
      if (cleanup.kind === "completed") log("relaunch-cleanup-completed");
      else if (cleanup.kind === "timed-out") log("relaunch-cleanup-timed-out");
      else log("relaunch-cleanup-failed", { message: cleanup.message });
    });
    updater.on("state-changed", ({ state }) => {
      item.enabled = state.canCheckForUpdates;
    });
    updater.on("update-available", ({ update }) => {
      item.label = "Update Available…";
      log("update-available", { targetVersion: update.displayVersion });
    });
    updater.on("update-not-available", () => log("update-not-available"));
    updater.on("update-downloaded", ({ update }) => {
      item.label = "Preparing Update…";
      log("update-downloaded", { targetVersion: update.displayVersion });
    });
    updater.on("before-install", ({ update }) => {
      item.label = "Installing Update…";
      log("install-started", { targetVersion: update.displayVersion });
    });
    updater.on("before-relaunch", () => {
      item.label = "Restarting Nyte…";
      item.enabled = false;
      log("relaunch-started");
    });
    updater.on("cycle-complete", () => {
      item.label = CHECK_LABEL;
      item.enabled = updater.getState().canCheckForUpdates;
      log("cycle-complete");
    });
    updater.on("error", ({ error }) => logError(error.message));
    log("app-started", { version: app.getVersion() });
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
        const preflight = await preflightUpdateCheck({
          activity,
          manual,
          confirm: async (current) => {
            const { response } = await dialog.showMessageBox({
              type: "warning",
              message: "Work is still in progress",
              detail: updateActivityDetail(current),
              buttons: ["Not Now", "Check Anyway"],
              defaultId: 0,
              cancelId: 0,
            });
            return response === 1;
          },
        });
        if (preflight.kind === "defer") {
          log(manual ? "manual-check-deferred" : "check-deferred-for-active-work", {
            tasks: preflight.activity.taskCount,
            terminalCommands: preflight.activity.terminalCommandCount,
          });
          if (!manual) {
            activeWorkRetry ??= setTimeout(() => {
              activeWorkRetry = undefined;
              void check(false);
            }, ACTIVE_WORK_RETRY_MS);
            activeWorkRetry.unref();
          }
          return;
        }
        if (activeWorkRetry !== undefined) {
          clearTimeout(activeWorkRetry);
          activeWorkRetry = undefined;
        }
        item.label = "Checking for Updates…";
        item.enabled = false;
        log("check-started", { manual });
        if (manual) updater.checkForUpdates();
        else updater.checkForUpdatesInBackground();
        return;
      }
      controller ??= load();
      await controller.check(manual);
    } catch (cause) {
      controller = undefined;
      const detail = errorMessage(cause);
      logError(detail);
      item.label = CHECK_LABEL;
      item.enabled = true;
      if (manual)
        await dialog.showMessageBox({
          type: "error",
          message: "Couldn't check for updates",
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
  const periodic = setInterval(() => void check(false), UPDATE_INTERVAL_MS);
  startup.unref();
  periodic.unref();
  app.once("before-quit", () => {
    clearTimeout(startup);
    clearInterval(periodic);
    if (activeWorkRetry !== undefined) clearTimeout(activeWorkRetry);
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
