import type { UpdateState } from "@nyte-ai/app/bridge.ts";
import electronUpdater from "electron-updater";
import { app, dialog } from "electron";
import type { MenuItem } from "electron";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { serial } from "@nyte-ai/schema/serial";
import { createUpdateController } from "./update-controller.ts";
import type { UpdateLogDetails } from "./update-controller.ts";
import { updateLabel } from "@nyte-ai/app/updates.ts";
import type { DesktopUpdateActivity } from "./host.ts";

const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

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
  const logWrites = serial();

  const log = (event: string, details: UpdateLogDetails = {}): void => {
    const line = `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`;
    void logWrites.run(() => appendFile(logPath, line)).catch(() => undefined);
  };

  const logError = (message: string): void => log("error", { message });

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = { info: () => undefined, warn: logError, error: () => undefined };
  autoUpdater.on("error", (error: Error) => logError(error.message));

  const updates = createUpdateController({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    activity,
    beforeInstall: beforeRelaunch,
    publish: (state) => {
      item.label = updateLabel(state);
      item.enabled = state.kind !== "downloading" && state.kind !== "installing";
      publish(state);
    },
    message: (options) => dialog.showMessageBox(options),
    log,
  });

  autoUpdater.signals.progress((info) => updates.progress(info.percent));
  log("app-started", { version: app.getVersion() });

  item.click = () => void updates.click();

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

  return { state: updates.state, click: updates.click };
}
