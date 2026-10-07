import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  screen,
  shell,
} from "electron";
import { createNyteModels } from "@nyte-ai/ai";
import { nyteHome } from "@nyte-ai/host";
import { HostSettingsStore } from "@nyte-ai/host/settings";
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
  WINDOW_FULLSCREEN_CHANNEL,
  WINDOW_ZOOM_CHANNEL,
} from "../shared/ipc.ts";
import type { WatchEnvelope } from "../shared/ipc.ts";
import type { HostEvent, UpdateState } from "@nyte-ai/app/bridge.ts";
import { APP_MENU_COMMAND_CHANNEL, APP_MENU_READY_CHANNEL } from "../shared/app-menu.ts";
import { applicationMenuTemplate, createMenuCommandDelivery } from "./app-menu.ts";
import { safeExternalUrl } from "./external-url.ts";
import { createBrowserSurfaces } from "./browser.ts";
import { showContextMenu } from "./context-menu.ts";
import { ipcResult } from "./errors.ts";
import { callIpc } from "./ipc-call.ts";
import { localFonts } from "./fonts.ts";
import { UsageScanWorker } from "@nyte-ai/host/usage-scan";
import { CloudflareTunnelPlugin } from "./cloudflare-tunnel.ts";
import { registerAccount } from "./account.ts";
import type { AccountSession } from "./account-session.ts";
import { AccountStore } from "./account-store.ts";
import type { SecretCipher } from "./account-store.ts";
import { accountScheme } from "../account/scheme.ts";
import { registerRenderer } from "./renderer.ts";
import { ACCOUNT_CHANNELS } from "../account/protocol.ts";
import { readConnectConfig } from "./connect-config.ts";
import type { ConnectConfig } from "./connect-config.ts";
import { ConnectRuntime } from "@nyte-ai/connect/host";
import { DesktopHost, type DesktopHostDependencies, type HostWindow } from "./host.ts";
import { registerUpdates } from "./updates.ts";
import { ensureShellEnvironment } from "./shell-environment.ts";

import {
  decodeBrowserBounds,
  decodeWatchStart,
  decodeWatchStop,
  themePreference,
} from "./ipc-inputs.ts";

interface NyteWindow {
  readonly window: BrowserWindow;
  readonly menuCommands: ReturnType<typeof createMenuCommandDelivery>;
  /**
   * Whether the window has been shown at least once. Synthesized mouse input
   * is silently dropped until the first show, so the explicit signal avoids
   * a race the fallback (window.isVisible) cannot catch.
   */
  shown: boolean;
}

/** Keyed by the renderer's webContents id; ordered by focus, most recent last. */
const windows = new Map<HostWindow, NyteWindow>();

let desktopHost: DesktopHost | undefined;

/** Account remote access; created in the primary instance only. */
let connect: ConnectRuntime | undefined;

let rendererUrl: string;

registerBunOAuthFlows();

function macOSTrafficLightPosition(zoomFactor: number) {
  const diameter = Number.parseFloat(process.getSystemVersion()) >= 25 ? 14 : 16;

  return {
    x: Math.floor((35 - diameter) / 2) + 1,
    y: Math.max(0, Math.round((35 * zoomFactor - diameter) / 2)),
  };
}

/**
 * Vibrancy needs an opaque window. `transparent: true` gives the NSWindow a
 * clear backing, the vibrancy view behind the page has nothing left to blur,
 * and the sidebar falls back to flat colour, so it must stay unset here.
 * Increased contrast drops the effect entirely rather than blurring a surface
 * the user asked to be legible.
 */
function macOSWindowChrome(): Partial<Electron.BrowserWindowConstructorOptions> {
  const options: Partial<Electron.BrowserWindowConstructorOptions> = {
    acceptFirstMouse: true,
    hasShadow: true,
    titleBarOverlay: true,
    titleBarStyle: "hidden",
    trafficLightPosition: macOSTrafficLightPosition(1),
  };

  if (!nativeTheme.shouldUseHighContrastColors) {
    options.vibrancy = "sidebar";
    options.visualEffectState = "active";
  }

  return options;
}

/**
 * A vibrant window still takes a fill, and its alpha tints the material rather
 * than clearing it. Light stays neutral; dark carries a quarter black so the
 * blur reads dark instead of washing out. Without vibrancy the window needs a
 * real colour, matching `--nyte-bg-base`.
 */
function windowBackgroundColor(): string {
  if (process.platform !== "darwin" || nativeTheme.shouldUseHighContrastColors) {
    return nativeTheme.shouldUseDarkColors ? "#1b1b1b" : "#ffffff";
  }

  return nativeTheme.shouldUseDarkColors ? "#40000000" : "#00ffffff";
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

function send(window: HostWindow, channel: string, payload: HostEvent | WatchEnvelope): void {
  const entry = windows.get(window);

  if (entry !== undefined && !entry.window.isDestroyed()) {
    entry.window.webContents.send(channel, payload);
  }
}

function broadcast(event: HostEvent): void {
  for (const window of windows.keys()) send(window, HOST_EVENT_CHANNEL, event);
}

/** The window app-level commands act on: the one focused most recently. */
function currentWindow(): NyteWindow | undefined {
  return [...windows.values()].at(-1);
}

function reveal(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** One view of ~/.nyte/settings.json per process, shared by the host and the browser surfaces. */
const settings = new HostSettingsStore();

const browserSurfaces = createBrowserSurfaces({
  settings: settings.current,
  window: (id) =>
    (id === undefined ? undefined : windows.get(id))?.window ?? currentWindow()?.window,
  emit: broadcast,
  filterListPath: app.isPackaged
    ? join(process.resourcesPath, "adblock.bin")
    : join(app.getAppPath(), "resources", "adblock.bin"),
  windowShown: (window) => windows.get(window.webContents.id)?.shown ?? false,
});

settings.subscribe(() => browserSurfaces.settingsChanged());

let updates: ReturnType<typeof registerUpdates> | undefined;

/** The power save blocker Keep awake holds while a chat works. */
let awakeBlocker: number | undefined;

const hostDependencies = {
  settings,
  keepAwake: (awake: boolean) => {
    if (awake) {
      // The system stays up; the display may still sleep.
      awakeBlocker ??= powerSaveBlocker.start("prevent-app-suspension");

      return;
    }

    if (awakeBlocker === undefined) return;
    powerSaveBlocker.stop(awakeBlocker);
    awakeBlocker = undefined;
  },
  updates: {
    state: async (): Promise<UpdateState> => updates?.state() ?? { kind: "idle" },
    check: async () => updates?.click(),
  },
  createModels: createNyteModels,
  appVersion: app.getVersion(),
  appRoot: app.isPackaged
    ? join(process.resourcesPath, "app")
    : join(app.getAppPath(), "..", "app", "dist"),
  // A sibling entry of this bundle; see the main build's rollup inputs.
  usageScan: new UsageScanWorker(nyteHome(), new URL("./usage-worker.js", import.meta.url)),
  storeWorker: new URL("./store-worker.js", import.meta.url),
  // Built-in plugins, registered here; nothing is loaded or discovered at run time.
  remoteAccessPlugins: { cloudflare: new CloudflareTunnelPlugin({ home: nyteHome() }) },
  emitHostEvent: (event, window) =>
    window === undefined ? broadcast(event) : send(window, HOST_EVENT_CHANNEL, event),
  emitWatchEvent: (envelope, window) => send(window, WATCH_EVENT_CHANNEL, envelope),
  openExternal: (url) => void shell.openExternal(url),
  confirmExternal: async (url, id) => {
    const window = windows.get(id)?.window;

    const options: Electron.MessageBoxOptions = {
      type: "question",
      message: "Do you want Nyte to open the external website?",
      detail: url,
      buttons: ["Open", "Copy", `Always Open ${new URL(url).host}`, "Cancel"],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    };

    const { response } =
      window === undefined
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(window, options);

    return (["open", "copy", "trust", "cancel"] as const)[response] ?? "cancel";
  },
  revealPath: (path) => shell.showItemInFolder(path),
  openPath: async (path) => {
    const failure = await shell.openPath(path);

    if (failure !== "") throw new Error(failure);
  },
  trashPath: (path) => shell.trashItem(path),
  showContextMenu: (input, window) =>
    showContextMenu({ window: windows.get(window)?.window, input }),
  browser: browserSurfaces,
  listFonts: localFonts,
  pickFolder: async (id) => {
    const window = windows.get(id)?.window;

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
  desktopHost ??= new DesktopHost({ ...hostDependencies, connect });

  return desktopHost;
}

/**
 * The account sign-in is sealed by the OS keychain; refused where Electron would fall back to plain text. The async
 * API keeps the main process running while macOS asks for Keychain access, and opens what the
 * synchronous API sealed.
 */
const keychain: SecretCipher = {
  available: async () =>
    (await safeStorage.isAsyncEncryptionAvailable()) &&
    (process.platform !== "linux" ||
      !["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend())),
  seal: async (plain) => (await safeStorage.encryptStringAsync(plain)).toString("base64"),
  open: async (sealed) =>
    (await safeStorage.decryptStringAsync(Buffer.from(sealed, "base64"))).result,
};

function createConnect(config: ConnectConfig | undefined): ConnectRuntime {
  let account: AccountSession | undefined;

  if (config !== undefined) {
    try {
      account = registerAccount({
        publishableKey: config.clerk.publishableKey,
        scheme: accountScheme({ packaged: app.isPackaged, updateTest }),
        window: (id) => (id === undefined ? currentWindow() : windows.get(id))?.window,
        onChange: () => connect?.accountChanged(),
        // macOS lets an app read its Keychain item without asking only while the app's
        // signature meets the requirement recorded with the item. Development and update-test
        // builds are ad-hoc signed, which names the exact binary, so they keep the sign-in for
        // one run.
        store:
          app.isPackaged && !updateTest
            ? new AccountStore({
                path: join(app.getPath("userData"), "account.json"),
                cipher: keychain,
              })
            : undefined,
      });
    } catch {
      account = undefined;
      process.emitWarning("Account sign-in could not be registered; linking is unavailable.", {
        code: "NYTE_ACCOUNT_UNAVAILABLE",
      });
    }
  }

  if (account === undefined) {
    ipcMain.handle(ACCOUNT_CHANNELS.config, (event) => {
      senderWindow(event);

      return undefined;
    });
  }

  return new ConnectRuntime({
    config,
    home: nyteHome(),
    account,
    onChange: () => broadcast({ kind: "remote_access_changed" }),
  });
}

function senderWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): NyteWindow {
  const entry = windows.get(event.sender.id);

  if (
    entry === undefined ||
    event.sender !== entry.window.webContents ||
    event.senderFrame !== entry.window.webContents.mainFrame
  ) {
    throw new Error("IPC request did not come from a Nyte window");
  }

  return entry;
}

function syncMacWindowChrome(entry: NyteWindow): void {
  if (process.platform !== "darwin" || entry.window.isDestroyed()) return;

  const zoomFactor = entry.window.webContents.getZoomFactor();

  entry.window.setWindowButtonPosition(macOSTrafficLightPosition(zoomFactor));
  entry.window.webContents.send(WINDOW_FULLSCREEN_CHANNEL, entry.window.isFullScreen());
}

function registerIpc(): void {
  if (process.platform === "darwin") {
    ipcMain.on(WINDOW_ZOOM_CHANNEL, (event) => {
      syncMacWindowChrome(senderWindow(event));
    });
  }

  ipcMain.on(APP_MENU_READY_CHANNEL, (event) => {
    senderWindow(event).menuCommands.ready();
  });

  ipcMain.on(THEME_PREFERENCE_CHANNEL, (event, value) => {
    senderWindow(event);

    if (!themePreference.Check(value)) return;
    nativeTheme.themeSource = value;
  });

  ipcMain.on(BROWSER_BOUNDS_CHANNEL, (event, message) => {
    senderWindow(event);

    try {
      browserSurfaces.setBounds(decodeBrowserBounds(message), event.sender.id);
    } catch {
      return;
    }
  });

  ipcMain.handle(CALL_CHANNEL, async (event, request) => {
    senderWindow(event);

    return callIpc(getHost, event.sender.id, request);
  });

  ipcMain.handle(WATCH_START_CHANNEL, async (event, input) => {
    senderWindow(event);

    return ipcResult(() => getHost().watchStart(event.sender.id, decodeWatchStart(input)));
  });

  ipcMain.handle(WATCH_STOP_CHANNEL, async (event, input) => {
    senderWindow(event);

    return ipcResult(() => getHost().watchStop(decodeWatchStop(input)));
  });
}

function createWindow(): NyteWindow {
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
  const id = created.webContents.id;

  const entry: NyteWindow = {
    window: created,
    menuCommands: createMenuCommandDelivery({
      openWindow: () => reveal(created),
      send: (command) => created.webContents.send(APP_MENU_COMMAND_CHANNEL, command),
    }),
    shown: false,
  };

  windows.set(id, entry);
  created.on("focus", () => {
    windows.delete(id);
    windows.set(id, entry);
  });

  const releaseRendererWork = (): void => {
    desktopHost?.releaseWindow(id);
  };

  created.webContents.on("render-process-gone", releaseRendererWork);
  const syncWindowChrome = (): void => syncMacWindowChrome(entry);
  created.webContents.on("did-finish-load", syncWindowChrome);
  created.webContents.on("zoom-changed", syncWindowChrome);
  created.on("move", syncWindowChrome);
  created.on("resize", syncWindowChrome);
  created.on("enter-full-screen", syncWindowChrome);
  created.on("leave-full-screen", syncWindowChrome);
  screen.on("display-metrics-changed", syncWindowChrome);
  // Only a committed main-frame navigation has left the document behind. The
  // start event fires before `will-navigate` can cancel, and would tear down
  // under a renderer that stays.
  created.webContents.on("did-navigate", () => {
    releaseRendererWork();
    entry.menuCommands.reset();
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
    entry.shown = true;
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

  void created.loadURL(rendererUrl);

  created.on("closed", () => {
    entry.menuCommands.reset();
    nativeTheme.off("updated", updateWindowBackground);
    screen.off("display-metrics-changed", syncWindowChrome);
    windows.delete(id);
    browserSurfaces.releaseWindow(id);
    desktopHost?.closeWindow(id);
  });

  return entry;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // The login shell can take seconds; the window never waits on it.
  void ensureShellEnvironment();

  const config = readConnectConfig(import.meta.env);
  const scheme = accountScheme({ packaged: app.isPackaged, updateTest });

  rendererUrl = registerRenderer({ scheme, frontendApiHost: config?.clerk.frontendApiHost });
  connect = createConnect(config);

  app.on("second-instance", (_event, argv) => {
    // Clerk focuses the window that requested the OAuth callback.
    if (argv.some((arg) => arg.startsWith(`${scheme}:`))) return;
    reveal((currentWindow() ?? createWindow()).window);
  });

  void app.whenReady().then(async () => {
    registerIpc();

    // Packaged apps use the bundle ICNS. The dev PNG shares its macOS inset.
    if (!app.isPackaged && process.platform === "darwin") {
      app.dock?.setIcon(join(app.getAppPath(), "resources", "icon.png"));
    }

    const first = createWindow();
    const firstId = first.window.webContents.id;
    void getHost()
      .prepare(firstId)
      .then(() => getHost().autostartConnect(firstId))
      .catch(() => undefined);
    // A lease held before sleep says nothing about now.
    powerMonitor.on("resume", () => connect?.resume());

    const menu = Menu.buildFromTemplate(
      applicationMenuTemplate({
        platform: process.platform,
        name: app.getName(),
        // A command with no window open reopens one, as the single window did.
        dispatch: (command) => (currentWindow() ?? createWindow()).menuCommands.dispatch(command),
        newWindow: createWindow,
        appInfo: () => ({
          name: app.getName(),
          version: app.getVersion(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          os: `${process.platform === "darwin" ? "macOS" : process.platform} ${process.getSystemVersion()}`,
          arch: process.arch,
        }),
      }),
    );

    const updateItem = menu.getMenuItemById("check-for-updates");

    if (updateItem !== null)
      updates = registerUpdates({
        publish: (state) => broadcast({ kind: "update_changed", state }),
        item: updateItem,
        activity: () => getHost().updateActivity(),
        beforeRelaunch: async () => {
          await desktopHost?.close();
        },
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
    void app.whenReady().then(() => {
      if (windows.size === 0) createWindow();
    });
  });
}
