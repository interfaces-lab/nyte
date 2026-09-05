import electronUpdater from "electron-updater";
import { app, dialog, Menu, MenuItem } from "electron";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createUpdateController } from "./update-controller.ts";

export function registerUpdates(): void {
  const logError = (message: string): void => {
    void appendFile(
      join(app.getPath("userData"), "updates.log"),
      `${JSON.stringify({ time: new Date().toISOString(), message })}\n`,
    ).catch(() => undefined);
  };
  const item = new MenuItem({
    label: "Check for Updates…",
    click: () => {
      void check(true);
    },
  });
  const menu =
    Menu.getApplicationMenu() ??
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      { role: "help", submenu: [] },
    ]);
  const target =
    process.platform === "darwin"
      ? menu.items[0]?.submenu
      : menu.items.find((entry) => entry.role === "help")?.submenu;
  if (target !== undefined) target.insert(process.platform === "darwin" ? 1 : 0, item);
  else {
    const submenu = new Menu();
    submenu.append(item);
    menu.append(new MenuItem({ label: "Updates", submenu }));
  }
  Menu.setApplicationMenu(menu);

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
      unavailable: !app.isPackaged
        ? "This is a development build. Install the packaged Nyte app to receive updates."
        : process.env["NYTE_OFFLINE"] !== undefined
          ? "NYTE_OFFLINE is set. Disable it and restart Nyte to check for updates."
          : process.platform === "linux" && process.env["APPIMAGE"] === undefined
            ? "Install the AppImage build to receive desktop updates."
            : undefined,
    });
  };
  async function check(manual: boolean): Promise<void> {
    try {
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
