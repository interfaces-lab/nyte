import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { join } from "node:path";
import {
  BROWSER_BOUNDS_CHANNEL,
  CALL_CHANNEL,
  HOST_EVENT_CHANNEL,
  THEME_PREFERENCE_CHANNEL,
  WATCH_EVENT_CHANNEL,
  WATCH_START_CHANNEL,
  WATCH_STOP_CHANNEL,
} from "../shared/ipc.ts";
import type { HostEvent, WatchEnvelope } from "../shared/ipc.ts";
import type { ThemePreference } from "../shared/ipc.ts";
import { safeExternalUrl } from "./external-url.ts";
import { createBrowserSurfaces } from "./browser.ts";
import { errorMessage } from "../shared/errors.ts";
import { localFonts } from "./fonts.ts";
import type { DesktopHost, DesktopHostDependencies } from "./host.ts";

let mainWindow: BrowserWindow | undefined;
let hostPromise: Promise<DesktopHost> | undefined;
let ipcInputsPromise: Promise<typeof import("./ipc-inputs.ts")> | undefined;

registerBunOAuthFlows();

function macOSWindowChrome(): Partial<Electron.BrowserWindowConstructorOptions> {
  const trafficLightDiameter = Number.parseFloat(process.getSystemVersion()) >= 25 ? 14 : 16;
  const trafficLightInset = Math.floor((35 - trafficLightDiameter) / 2);
  const options: Partial<Electron.BrowserWindowConstructorOptions> = {
    acceptFirstMouse: true,
    hasShadow: true,
    transparent: true,
    titleBarOverlay: true,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: trafficLightInset + 1, y: trafficLightInset },
  };
  if (!nativeTheme.shouldUseHighContrastColors) {
    options.vibrancy = "sidebar";
    options.visualEffectState = "active";
  }
  return options;
}

function windowBackgroundColor(): string {
  if (process.platform !== "darwin" || nativeTheme.shouldUseHighContrastColors) {
    return nativeTheme.shouldUseDarkColors ? "#111111" : "#f4f4f5";
  }
  return "#00000000";
}

app.setName("Nyte");
app.setPath("userData", join(app.getPath("appData"), app.isPackaged ? "Nyte" : "Nyte Dev"));
if (process.platform === "linux") app.commandLine.appendSwitch("gtk-version", "3");

function send(channel: string, payload: HostEvent | WatchEnvelope): void {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

const browserSurfaces = createBrowserSurfaces({
  window: () => mainWindow,
  emit: (event) => send(HOST_EVENT_CHANNEL, event),
  filterListPath: app.isPackaged
    ? join(process.resourcesPath, "adblock.bin")
    : join(app.getAppPath(), "resources", "adblock.bin"),
});

const hostDependencies = {
  emitHostEvent: (event) => send(HOST_EVENT_CHANNEL, event),
  emitWatchEvent: (envelope) => send(WATCH_EVENT_CHANNEL, envelope),
  openExternal: (url) => void shell.openExternal(url),
  browser: browserSurfaces,
  listFonts: localFonts,
  pickFolder: async () => {
    const window = mainWindow;
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      message: "Open a workspace folder",
    };
    const result =
      window === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options);
    return result.canceled ? undefined : result.filePaths[0];
  },
} satisfies DesktopHostDependencies;

function getHost(): Promise<DesktopHost> {
  hostPromise ??= import("./host.ts").then(({ DesktopHost: Host }) => new Host(hostDependencies));
  return hostPromise;
}

function getIpcInputs(): Promise<typeof import("./ipc-inputs.ts")> {
  ipcInputsPromise ??= import("./ipc-inputs.ts");
  return ipcInputsPromise;
}

function assertMainFrame(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  const window = mainWindow;
  if (
    window === undefined ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error("IPC request did not come from the main window");
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function registerIpc(): void {
  ipcMain.on(THEME_PREFERENCE_CHANNEL, (event, value) => {
    assertMainFrame(event);
    if (!isThemePreference(value)) return;
    nativeTheme.themeSource = value;
  });

  ipcMain.on(BROWSER_BOUNDS_CHANNEL, (event, message) => {
    assertMainFrame(event);
    void getIpcInputs().then(({ decodeBrowserBounds }) => {
      browserSurfaces.setBounds(decodeBrowserBounds(message));
    });
  });

  ipcMain.handle(CALL_CHANNEL, async (event, request) => {
    assertMainFrame(event);
    const [{ decodeCallRequest }, host] = await Promise.all([getIpcInputs(), getHost()]);
    const decoded = decodeCallRequest(request);
    try {
      const value = await host.call(decoded.path, decoded.input);
      return { path: decoded.path, ok: true, value };
    } catch (cause) {
      return {
        path: decoded.path,
        ok: false,
        message: errorMessage(cause),
      };
    }
  });

  ipcMain.handle(WATCH_START_CHANNEL, async (event, input) => {
    assertMainFrame(event);
    const [{ decodeWatchStart }, host] = await Promise.all([getIpcInputs(), getHost()]);
    host.watchStart(decodeWatchStart(input));
  });

  ipcMain.handle(WATCH_STOP_CHANNEL, async (event, input) => {
    assertMainFrame(event);
    const [{ decodeWatchStop }, host] = await Promise.all([getIpcInputs(), getHost()]);
    host.watchStop(decodeWatchStop(input));
  });
}

function createWindow(): void {
  if (mainWindow !== undefined) return;
  const options: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 560,
    minHeight: 480,
    show: false,
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (process.platform === "darwin") Object.assign(options, macOSWindowChrome());
  const created = new BrowserWindow(options);
  mainWindow = created;
  const closeTerminals = (): void => {
    void hostPromise?.then((host) => host.closeTerminals()).catch(() => undefined);
  };
  created.webContents.on("render-process-gone", closeTerminals);
  created.webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) closeTerminals();
  });

  const updateWindowBackground = (): void => {
    created.setBackgroundColor(windowBackgroundColor());
    if (process.platform === "darwin") {
      created.setVibrancy(nativeTheme.shouldUseHighContrastColors ? null : "sidebar");
    }
  };
  nativeTheme.on("updated", updateWindowBackground);
  created.once("ready-to-show", () => {
    created.show();
    setTimeout(() => void browserSurfaces.warm(), 1_500);
  });

  created.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(safeExternalUrl(url));
    } catch {
      // Invalid renderer URLs stay closed.
    }
    return { action: "deny" };
  });
  created.webContents.on("will-attach-webview", (event) => event.preventDefault());
  created.webContents.on("will-navigate", (event, url) => {
    if (url !== created.webContents.getURL()) event.preventDefault();
  });

  const developmentUrl = process.env["ELECTRON_RENDERER_URL"];
  if (developmentUrl === undefined)
    void created.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  else void created.loadURL(developmentUrl);

  created.on("closed", () => {
    closeTerminals();
    nativeTheme.off("updated", updateWindowBackground);
    browserSurfaces.dispose();
    if (mainWindow === created) mainWindow = undefined;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  registerIpc();

  app.on("second-instance", () => {
    if (mainWindow?.isMinimized() === true) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  void app.whenReady().then(() => {
    // Packaged apps use the bundle ICNS. The dev PNG shares its macOS inset.
    if (!app.isPackaged && process.platform === "darwin") {
      app.dock?.setIcon(join(app.getAppPath(), "resources", "icon.png"));
    }
    createWindow();
  });

  app.on("before-quit", () => {
    void hostPromise?.then(
      (host) => host.close(),
      () => undefined,
    );
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
