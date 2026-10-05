import type { UpdateState } from "@nyte-ai/app/bridge.ts";
import electronUpdater from "electron-updater";
import { updater } from "electron-sparkle";
import { app, BrowserWindow, dialog } from "electron";
import type { MenuItem } from "electron";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createUpdateController, errorMessage, requestRestart } from "./update-controller.ts";
import { updateLabel } from "@nyte-ai/app/updates.ts";
import { runRelaunchCleanup } from "./update-relaunch.ts";
import type { DesktopUpdateActivity } from "./host.ts";

const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

type UpdateLogValue = boolean | number | string;

type UpdateLogDetails = Readonly<Record<string, UpdateLogValue>>;

export function registerUpdates({
  item,
  activity,
  beforeRelaunch,
  publish,
}: {
  readonly item: MenuItem;
  readonly activity: () => Promise<DesktopUpdateActivity>;
  readonly beforeRelaunch: () => Promise<void>;
  readonly publish: (state: UpdateState) => void;
}) {
  const unavailable = !app.isPackaged
    ? "This is a development build. Install the packaged Nyte app to receive updates."
    : process.env["NYTE_OFFLINE"] !== undefined
      ? "NYTE_OFFLINE is set. Disable it and restart Nyte to check for updates."
      : process.platform === "linux" && process.env["APPIMAGE"] === undefined
        ? "Install the AppImage build to receive desktop updates."
        : undefined;

  if (unavailable !== undefined) {
    const click = async (): Promise<void> => {
      await dialog.showMessageBox({
        type: "info",
        message: "Updates unavailable",
        detail: unavailable,
      });
    };

    item.click = () => void click();

    return { state: (): UpdateState => ({ kind: "idle" }), click };
  }

  const logPath = join(app.getPath("userData"), "updates.log");
  let logTail = Promise.resolve();

  const log = (event: string, details: UpdateLogDetails = {}): void => {
    const line = `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`;
    logTail = logTail.then(() => appendFile(logPath, line)).catch(() => undefined);
  };

  const logError = (message: string): void => log("error", { message });

  const show = (state: UpdateState): void => {
    item.label = updateLabel(state);
    item.enabled = state.kind !== "downloading";
    publish(state);
  };

  const updates =
    process.platform === "darwin"
      ? sparkleUpdates({ activity, beforeRelaunch, publish: show, log })
      : electronUpdates({ activity, publish: show, logError });

  const click = (): Promise<void> => {
    const { kind } = updates.state();

    return kind === "ready" || kind === "blocked" ? updates.restart() : updates.check();
  };

  item.click = () => void click();

  if (process.env["NYTE_SKIP_VERSION_CHECK"] === undefined) {
    const startup = setTimeout(() => void updates.check(), 15_000);
    const periodic = setInterval(() => void updates.check(), UPDATE_INTERVAL_MS);
    startup.unref();
    periodic.unref();
    app.once("before-quit", () => {
      clearTimeout(startup);
      clearInterval(periodic);
    });
  }

  return { state: updates.state, click };
}

function electronUpdates({
  activity,
  publish,
  logError,
}: {
  readonly activity: () => Promise<DesktopUpdateActivity>;
  readonly publish: (state: UpdateState) => void;
  readonly logError: (message: string) => void;
}) {
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = { info: () => undefined, warn: logError, error: logError };
  autoUpdater.on("error", (error: Error) => logError(error.message));
  const controller = createUpdateController({ updater: autoUpdater, activity, publish, logError });
  autoUpdater.signals.progress((info) => controller.progress(info.percent));

  return controller;
}

/**
 * Sparkle has no download, progress, or install call. Checks run with its automatic
 * download on, so an update downloads silently and surfaces as `ready`; installing
 * reopens Sparkle's own prompt for that download, the one install path it exposes.
 */
function sparkleUpdates({
  activity,
  beforeRelaunch,
  publish,
  log,
}: {
  readonly activity: () => Promise<DesktopUpdateActivity>;
  readonly beforeRelaunch: () => Promise<void>;
  readonly publish: (state: UpdateState) => void;
  readonly log: (event: string, details?: UpdateLogDetails) => void;
}) {
  let state: UpdateState = { kind: "idle" };

  const set = (next: UpdateState): void => {
    state = next;
    publish(next);
  };

  updater.setBeforeRelaunchHandler(async (update) => {
    log("relaunch-requested", {
      fromVersion: app.getVersion(),
      targetVersion: update.displayVersion,
    });
    const cleanup = await runRelaunchCleanup({ cleanup: beforeRelaunch });

    if (cleanup.kind === "completed") log("relaunch-cleanup-completed");
    else if (cleanup.kind === "timed-out") log("relaunch-cleanup-timed-out");
    else log("relaunch-cleanup-failed", { message: cleanup.message });
  });
  updater.on("update-available", ({ update }) => {
    set({ kind: "downloading", version: update.displayVersion, percent: 0 });
    log("update-available", { targetVersion: update.displayVersion });
  });
  updater.on("update-not-available", () => log("update-not-available"));
  updater.on("update-downloaded", ({ update }) => {
    set({ kind: "ready", version: update.displayVersion });
    log("update-downloaded", { targetVersion: update.displayVersion });
  });
  updater.on("before-install", ({ update }) => {
    log("install-started", { targetVersion: update.displayVersion });

    // Sparkle swaps the bundle and relaunches without feedback; leaving the
    // windows up makes the app look hung for those seconds.
    for (const window of BrowserWindow.getAllWindows()) window.hide();
  });
  updater.on("before-relaunch", () => log("relaunch-started"));
  updater.on("cycle-complete", () => log("cycle-complete"));
  updater.on("error", ({ error }) => {
    log("error", { message: error.message });

    if (state.kind === "downloading")
      set({ kind: "failed", version: state.version, message: error.message });
  });
  log("app-started", { version: app.getVersion() });

  const check = async (): Promise<void> => {
    if (state.kind !== "idle" && state.kind !== "failed") return;

    try {
      await updater.start();
      // Nyte owns the schedule on every platform.
      updater.setAutomaticallyChecksForUpdates(false);
      updater.setAutomaticallyDownloadsUpdates(true);

      if (!updater.getState().canCheckForUpdates) return;
      log("check-started");
      updater.checkForUpdatesInBackground();
    } catch (cause) {
      log("error", { message: errorMessage(cause) });
    }
  };

  return {
    state: () => state,
    check,
    restart: () =>
      requestRestart({ state, activity, publish: set, install: () => updater.checkForUpdates() }),
  };
}
