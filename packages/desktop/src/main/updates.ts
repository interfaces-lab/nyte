import type { UpdateChannel, UpdateState } from "@nyte-ai/app/bridge.ts";
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
import { UpdateSettingsStore } from "./update-settings.ts";

const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

const NIGHTLY_UPDATE_INTERVAL_MS = 60 * 60_000;

export async function registerUpdates({
  item,
  activity,
  beforeRelaunch,
  publish,
  publishChannel,
}: {
  readonly item: MenuItem;
  readonly activity: () => Promise<DesktopUpdateActivity>;
  readonly beforeRelaunch: () => Promise<void>;
  readonly publish: (state: UpdateState) => void;
  readonly publishChannel: (channel: UpdateChannel) => void;
}) {
  const settings = new UpdateSettingsStore(join(app.getPath("userData"), "updates.json"));

  let channel =
    (await settings.read()) ?? (app.getVersion().includes("-nightly.") ? "nightly" : "stable");

  const operations = serial();

  const saveChannel = async (next: UpdateChannel): Promise<UpdateChannel> => {
    await settings.write(next);
    channel = next;
    publishChannel(channel);

    return channel;
  };

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

    return {
      state: (): UpdateState => ({ kind: "idle" }),
      click,
      installOnQuit: (): boolean => false,
      channel: (): UpdateChannel => channel,
      setChannel: (next: UpdateChannel) => operations.run(() => saveChannel(next)),
    };
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

  const applyChannel = (): void => {
    autoUpdater.channel = channel === "nightly" ? "nightly" : "latest";
    autoUpdater.allowPrerelease = channel === "nightly";
    autoUpdater.allowDowngrade = channel === "stable" && app.getVersion().includes("-nightly.");
  };

  applyChannel();
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

  const check = (): Promise<void> => operations.run(() => updates.check());
  const click = (): Promise<void> => operations.run(() => updates.click());
  item.click = () => void click();

  let periodic: NodeJS.Timeout | undefined;

  const schedule = (): void => {
    clearInterval(periodic);

    if (process.env["NYTE_SKIP_VERSION_CHECK"] !== undefined) return;

    periodic = setInterval(
      () => void check(),
      channel === "nightly" ? NIGHTLY_UPDATE_INTERVAL_MS : UPDATE_INTERVAL_MS,
    );
    periodic.unref();
  };

  if (process.env["NYTE_SKIP_VERSION_CHECK"] === undefined) {
    const startup = setTimeout(() => void check(), 30_000);
    startup.unref();
    schedule();
    app.once("before-quit", () => {
      clearTimeout(startup);
      clearInterval(periodic);
    });
  }

  return {
    state: updates.state,
    click,
    installOnQuit: (): boolean => {
      if (channel !== "nightly" || updates.state().kind !== "ready") return false;
      autoUpdater.autoRunAppAfterInstall = false;

      return updates.installOnQuit();
    },
    channel: (): UpdateChannel => channel,
    setChannel: (next: UpdateChannel) =>
      operations.run(async () => {
        if (next === channel) return channel;

        if (updates.state().kind === "installing")
          throw new Error("Nyte is restarting to install an update. Change the channel afterward.");

        await saveChannel(next);
        applyChannel();
        updates.reset();
        schedule();
        void check();

        return channel;
      }),
  };
}
