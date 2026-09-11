import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import { createNyteModels } from "@nyte-ai/ai";
import { createTrustStore, nyteHome } from "@nyte-ai/host";
import { WorkspaceTrustRequired } from "@nyte-ai/core";
import { createWorkspaceEditor } from "./workspace-files.ts";
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
  WORKSPACE_EDITOR_CHANNEL,
} from "../shared/ipc.ts";
import type { HostEvent, WatchEnvelope } from "../shared/ipc.ts";
import { APP_MENU_COMMAND_CHANNEL, APP_MENU_READY_CHANNEL } from "../shared/app-menu.ts";
import { applicationMenuTemplate, createMenuCommandDelivery } from "./app-menu.ts";
import { safeExternalUrl } from "./external-url.ts";
import { createBrowserSurfaces } from "./browser.ts";
import { ExpectedHostError, ipcResult } from "./errors.ts";
import { callIpc } from "./ipc-call.ts";
import { localFonts } from "./fonts.ts";
import { UsageScanWorker } from "./usage-scan.ts";
import { DesktopHost, type DesktopHostDependencies } from "./host.ts";
import { registerUpdates } from "./updates.ts";
import { createShellEnvironmentRepair } from "./shell-environment.ts";

import {
  decodeBrowserBounds,
  decodeWatchStart,
  decodeWatchStop,
  decodeWorkspaceEditorRequest,
  themePreference,
} from "./ipc-inputs.ts";

let mainWindow: BrowserWindow | undefined;
let desktopHost: DesktopHost | undefined;

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
    return nativeTheme.shouldUseDarkColors ? "#111111" : "#f5f5f6";
  }
  return "#00000000";
}

const updateTest = app.isPackaged && app.getName() === "Nyte Update Test";
app.setName(updateTest ? "Nyte Update Test" : app.isPackaged ? "Nyte" : "Nyte (Dev)");
app.setPath(
  "userData",
  join(
    app.getPath("appData"),
    updateTest ? "Nyte Update Test" : app.isPackaged ? "Nyte" : "Nyte Dev",
  ),
);
// The packaged test must remain isolated after Sparkle relaunches without shell variables.
if (updateTest) process.env["NYTE_HOME"] = join(app.getPath("userData"), "nyte");
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
  createModels: createNyteModels,
  // A sibling entry of this bundle; see the main build's rollup inputs.
  usageScan: new UsageScanWorker(nyteHome(), new URL("./usage-worker.js", import.meta.url)),
  storeWorker: new URL("./store-worker.js", import.meta.url),
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

function getHost(): DesktopHost {
  desktopHost ??= new DesktopHost(hostDependencies);
  return desktopHost;
}

const workspaceEditor = createWorkspaceEditor({
  workspace: async () => {
    const state = await getHost().call("host.state", undefined);
    if (state.workspace === undefined)
      throw new ExpectedHostError({ code: "not_found", message: "No project is open" });
    return state.workspace.path;
  },
  requireTrust: async (path) => {
    try {
      await createTrustStore().require(path);
    } catch (cause) {
      if (cause instanceof WorkspaceTrustRequired) {
        send(HOST_EVENT_CHANNEL, { kind: "workspace_trust_required", path: cause.cwd });
      }
      throw cause;
    }
  },
});

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

function registerIpc(): void {
  ipcMain.on(APP_MENU_READY_CHANNEL, (event) => {
    assertMainFrame(event);
    menuCommands.ready();
  });

  ipcMain.on(THEME_PREFERENCE_CHANNEL, (event, value) => {
    assertMainFrame(event);
    if (!themePreference.Check(value)) return;
    nativeTheme.themeSource = value;
  });

  ipcMain.on(BROWSER_BOUNDS_CHANNEL, (event, message) => {
    assertMainFrame(event);
    browserSurfaces.setBounds(decodeBrowserBounds(message));
  });

  ipcMain.handle(WORKSPACE_EDITOR_CHANNEL, async (event, request) => {
    assertMainFrame(event);
    return ipcResult(() => workspaceEditor.call(decodeWorkspaceEditorRequest(request)));
  });

  ipcMain.handle(CALL_CHANNEL, async (event, request) => {
    assertMainFrame(event);
    return callIpc(getHost, request);
  });

  ipcMain.handle(WATCH_START_CHANNEL, async (event, input) => {
    assertMainFrame(event);
    return ipcResult(() => getHost().watchStart(decodeWatchStart(input)));
  });

  ipcMain.handle(WATCH_STOP_CHANNEL, async (event, input) => {
    assertMainFrame(event);
    return ipcResult(() => getHost().watchStop(decodeWatchStop(input)));
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
    workspaceEditor.dispose();
    void desktopHost?.closeTerminals().catch(() => undefined);
  };
  created.webContents.on("render-process-gone", closeTerminals);
  created.webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) {
      closeTerminals();
      menuCommands.reset();
    }
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
  created.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: "undo", enabled: params.editFlags.canUndo },
      { role: "redo", enabled: params.editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    ]).popup({ window: created, frame: params.frame ?? undefined });
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
    menuCommands.reset();
    closeTerminals();
    nativeTheme.off("updated", updateWindowBackground);
    browserSurfaces.dispose();
    if (mainWindow === created) mainWindow = undefined;
  });
}

const menuCommands = createMenuCommandDelivery({
  openWindow: () => {
    createWindow();
    if (mainWindow?.isMinimized() === true) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  },
  send: (command) => mainWindow?.webContents.send(APP_MENU_COMMAND_CHANNEL, command),
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  const repairShellEnvironment = createShellEnvironmentRepair();
  const environmentReady = repairShellEnvironment();

  app.on("second-instance", () => {
    if (mainWindow?.isMinimized() === true) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  void app.whenReady().then(async () => {
    await environmentReady;
    registerIpc();
    // Packaged apps use the bundle ICNS. The dev PNG shares its macOS inset.
    if (!app.isPackaged && process.platform === "darwin") {
      app.dock?.setIcon(join(app.getAppPath(), "resources", "icon.png"));
    }
    createWindow();
    void getHost()
      .prepare()
      .catch(() => undefined);
    const menu = Menu.buildFromTemplate(
      applicationMenuTemplate({
        platform: process.platform,
        name: app.getName(),
        settings: () => menuCommands.dispatch({ kind: "settings" }),
        about: () =>
          menuCommands.dispatch({
            kind: "about",
            info: {
              name: app.getName(),
              version: app.getVersion(),
              electron: process.versions.electron,
              chrome: process.versions.chrome,
              os: `${process.platform === "darwin" ? "macOS" : process.platform} ${process.getSystemVersion()}`,
              arch: process.arch,
            },
          }),
      }),
    );
    const updateItem = menu.getMenuItemById("check-for-updates");
    if (updateItem !== null)
      registerUpdates(updateItem, async () => {
        await desktopHost?.close();
      });
    Menu.setApplicationMenu(menu);
  });

  app.on("before-quit", () => {
    void desktopHost?.close();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    void app.whenReady().then(async () => {
      await environmentReady;
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
