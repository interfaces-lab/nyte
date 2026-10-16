import "./startup.ts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  screen,
  shell,
} from "electron";
import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_BOUNDS_CHANNEL,
  BROWSER_FOCUS_CHANNEL,
  CALL_CHANNEL,
  CANVAS_SHELL_ARGUMENT,
  HOST_EVENT_CHANNEL,
  THEME_PREFERENCE_CHANNEL,
  WINDOW_FULLSCREEN_CHANNEL,
  WINDOW_ZOOM_CHANNEL,
} from "../shared/ipc.ts";
import type { HostEvent, UpdateState } from "@nyte-ai/app/bridge.ts";
import { APP_MENU_COMMAND_CHANNEL, APP_MENU_READY_CHANNEL } from "../shared/app-menu.ts";
import {
  applicationMenuTemplate,
  createMenuCommandDelivery,
  menuItemForKey,
  menuItemRepeats,
  performMenuRole,
} from "./app-menu.ts";
import type { ViewCommand } from "./app-menu.ts";
import { safeExternalUrl } from "./external-url.ts";
import { BrowserSurfaces } from "./browser.ts";
import { BrowserHistoryStore } from "./browser-history.ts";
import { showContextMenu } from "./context-menu.ts";
import { callIpc } from "./ipc-call.ts";
import { localFonts } from "./fonts.ts";
import { CloudflareTunnelPlugin } from "./cloudflare-tunnel.ts";
import { registerAccount } from "./account.ts";
import type { AccountSession } from "./account-session.ts";
import { AccountStore } from "./account-store.ts";
import { accountScheme } from "../account/scheme.ts";
import { canvasShellUrl, registerRenderer } from "./renderer.ts";
import { ACCOUNT_CHANNELS } from "../account/protocol.ts";
import { readConnectConfig } from "./connect-config.ts";
import type { ConnectConfig } from "./connect-config.ts";
import { ConnectRuntime } from "@nyte-ai/connect/host";
import { dev } from "@nyte-ai/core";
import { defaultSecrets } from "@nyte-ai/host";
import { UsageScanWorker } from "@nyte-ai/host/usage-scan";
import { DesktopHost, type DesktopHostDependencies } from "./host.ts";
import type { HostWindow } from "./host-window.ts";
import { models } from "./models.ts";
import { DEFAULT_DESKTOP_SETTINGS } from "./desktop-settings.ts";
import { LaunchStateStore } from "./launch-state.ts";
import { registerUpdates } from "./updates.ts";

import { decodeBrowserBounds, decodeBrowserFocus, themePreference } from "./ipc-inputs.ts";

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

let canvasShell: string;

registerBunOAuthFlows();

if (process.env.NYTE_DEV_LOG !== undefined) dev.forward(process.env.NYTE_DEV_LOG, "desktop");

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
  app.commandLine.getSwitchValue("user-data-dir") ||
    join(
      app.getPath("appData"),
      updateTest ? "Nyte Update Test" : app.isPackaged ? "Nyte" : "Nyte Dev",
    ),
);

if (updateTest) process.env["NYTE_HOME"] = join(app.getPath("userData"), "nyte");

const launchState = new LaunchStateStore(join(app.getPath("userData"), "launch-state.json"));

const home = updateTest ? app.getPath("userData") : homedir();

if (process.platform === "linux") app.commandLine.appendSwitch("gtk-version", "3");

function send(window: HostWindow, channel: string, payload: HostEvent): void {
  const entry = windows.get(window);

  if (entry !== undefined && !entry.window.isDestroyed()) {
    entry.window.webContents.send(channel, payload);
  }
}

function broadcast(event: HostEvent): void {
  for (const window of windows.keys()) send(window, HOST_EVENT_CHANNEL, event);
}

/** Push a host event to one window, or to every window when `window` is omitted. */
function emitHostEvent(event: HostEvent, window?: HostWindow): void {
  if (window === undefined) broadcast(event);
  else send(window, HOST_EVENT_CHANNEL, event);
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

let settings = DEFAULT_DESKTOP_SETTINGS;

let forwardingSurface: string | undefined;

const browserHistory = new BrowserHistoryStore(
  join(app.getPath("userData"), "browser-history.json"),
);

const browserSurfaces = new BrowserSurfaces({
  settings: () => settings,
  history: browserHistory,
  window: (id) =>
    (id === undefined ? undefined : windows.get(id))?.window ?? currentWindow()?.window,
  emit: emitHostEvent,
  filterListPath: app.isPackaged
    ? join(process.resourcesPath, "adblock.bin")
    : join(app.getAppPath(), "resources", "adblock.bin"),
  windowShown: (window) => windows.get(window.webContents.id)?.shown ?? false,
  pagePreload: join(import.meta.dirname, "../preload/browser-page.js"),
  forwardKey: ({ surface, window, contents, key }) => {
    const entry = windows.get(window);

    if (entry === undefined || entry.window.isDestroyed()) return;
    const menu = Menu.getApplicationMenu();

    const item =
      menu === null ? undefined : menuItemForKey(menu, key, process.platform === "darwin");

    if (item === undefined) {
      send(window, HOST_EVENT_CHANNEL, { kind: "browser_key", surface, key });

      return;
    }

    if (key.repeat && !menuItemRepeats(item)) return;
    forwardingSurface = surface;

    try {
      const performed = performMenuRole(item.role ?? "", {
        app,
        window: entry.window,
        contents,
        sendAction: (action) => Menu.sendActionToFirstResponder(action),
      });

      if (!performed) item.click(undefined, entry.window, entry.window.webContents);
    } finally {
      forwardingSurface = undefined;
    }
  },
});

function applyViewCommand(contents: Electron.WebContents, command: ViewCommand): void {
  switch (command) {
    case "reload":
      contents.reload();

      return;
    case "hard-reload":
      contents.reloadIgnoringCache();

      return;
    case "toggle-devtools":
      contents.toggleDevTools();

      return;
    case "zoom-reset":
      contents.setZoomLevel(0);

      return;
    case "zoom-in":
      contents.setZoomLevel(contents.getZoomLevel() + 0.5);

      return;
    case "zoom-out":
      contents.setZoomLevel(contents.getZoomLevel() - 0.5);

      return;
    default: {
      const _exhaustive: never = command;

      return _exhaustive;
    }
  }
}

let updates: ReturnType<typeof registerUpdates> | undefined;

let awakeBlocker: number | undefined;

const hostDependencies = {
  home,
  models,
  usageScan: new UsageScanWorker(home, new URL("./usage-worker.js", import.meta.url)),
  settingsChanged: (next) => {
    settings = next;
    browserSurfaces.settingsChanged();
  },
  keepAwake: (awake: boolean) => {
    if (awake) {
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
  // Built-in plugins, registered here; nothing is loaded or discovered at run time.
  remoteAccessPlugins: { cloudflare: new CloudflareTunnelPlugin({ home: join(home, ".nyte") }) },
  emitHostEvent,
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
} satisfies Omit<DesktopHostDependencies, "rendererOrigin" | "connect">;

/** Returns the renderer's origin as Chromium sends it, `scheme://host`; Node reports a custom scheme's `URL.origin` as opaque. */
function rendererOrigin(url: string): string {
  const parsed = new URL(url);

  return `${parsed.protocol}//${parsed.host}`;
}

function getHost(): DesktopHost {
  desktopHost ??= new DesktopHost({
    ...hostDependencies,
    connect,
    rendererOrigin: rendererOrigin(rendererUrl),
  });

  return desktopHost;
}

function createConnect(config: ConnectConfig | undefined): ConnectRuntime {
  let account: AccountSession | undefined;

  if (config !== undefined) {
    try {
      account = registerAccount({
        publishableKey: config.clerk.publishableKey,
        scheme: accountScheme({ packaged: app.isPackaged, updateTest }),
        window: (id) => (id === undefined ? currentWindow() : windows.get(id))?.window,
        onChange: () => connect?.accountChanged(),
        store: new AccountStore({
          path: join(app.getPath("userData"), "account.json"),
          secrets: defaultSecrets(home),
        }),
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
    home: join(home, ".nyte"),
    authorizer: account === undefined ? undefined : { kind: "session", account },
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

/** Re-centres the macOS traffic lights on the titlebar for the window's zoom factor. */
function placeWindowButtons(window: BrowserWindow): void {
  if (process.platform !== "darwin" || window.isDestroyed()) return;
  window.setWindowButtonPosition(macOSTrafficLightPosition(window.webContents.getZoomFactor()));
}

/** Tells the renderer whether the window is fullscreen, which moves its macOS titlebar inset. */
function sendFullscreen(window: BrowserWindow): void {
  if (process.platform !== "darwin" || window.isDestroyed()) return;
  window.webContents.send(WINDOW_FULLSCREEN_CHANNEL, window.isFullScreen());
}

function registerIpc(): void {
  if (process.platform === "darwin") {
    ipcMain.on(WINDOW_ZOOM_CHANNEL, (event) => {
      placeWindowButtons(senderWindow(event).window);
    });
  }

  ipcMain.on(APP_MENU_READY_CHANNEL, (event) => {
    senderWindow(event).menuCommands.ready();
  });

  ipcMain.on(THEME_PREFERENCE_CHANNEL, (event, value) => {
    senderWindow(event);

    if (!themePreference.Check(value)) return;
    nativeTheme.themeSource = value;
    launchState.setTheme(value);
  });

  ipcMain.on(BROWSER_BOUNDS_CHANNEL, (event, message) => {
    senderWindow(event);

    try {
      browserSurfaces.setBounds(decodeBrowserBounds(message), event.sender.id);
    } catch {
      return;
    }
  });

  ipcMain.on(BROWSER_FOCUS_CHANNEL, (event, message) => {
    senderWindow(event);

    try {
      browserSurfaces.setFocus(decodeBrowserFocus(message), event.sender.id);
    } catch {
      return;
    }
  });

  ipcMain.handle(CALL_CHANNEL, async (event, request) => {
    senderWindow(event);

    return callIpc(getHost, event.sender.id, request);
  });
}

interface OpeningFrame {
  readonly bounds: Partial<Electron.Rectangle>;
  readonly maximized: boolean;
  readonly fullscreen: boolean;
}

/**
 * The frame a new window opens in. The first window takes the last closed window's place,
 * size, and maximized or fullscreen state, when a display's work area still shows that place;
 * a window opened beside others takes only the size, and the system places it.
 */
function openingFrame(): OpeningFrame {
  const saved = launchState.window();

  if (saved === undefined)
    return { bounds: { width: 1200, height: 800 }, maximized: false, fullscreen: false };
  const { bounds } = saved;

  const shown = screen
    .getAllDisplays()
    .some(
      ({ workArea }) =>
        bounds.x < workArea.x + workArea.width &&
        bounds.x + bounds.width > workArea.x &&
        bounds.y < workArea.y + workArea.height &&
        bounds.y + bounds.height > workArea.y,
    );

  if (windows.size === 0 && shown) return saved;

  return {
    bounds: { width: bounds.width, height: bounds.height },
    maximized: false,
    fullscreen: false,
  };
}

function createWindow(): NyteWindow {
  const frame = openingFrame();

  const options: Electron.BrowserWindowConstructorOptions = {
    ...frame.bounds,
    minWidth: 560,
    minHeight: 480,
    show: false,
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      additionalArguments: [`${CANVAS_SHELL_ARGUMENT}=${canvasShell}`],
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
  const placeButtons = (): void => placeWindowButtons(created);

  const fullscreenChanged = (): void => {
    placeWindowButtons(created);
    sendFullscreen(created);
  };

  created.webContents.on("did-finish-load", fullscreenChanged);
  created.webContents.on("zoom-changed", placeButtons);
  created.on("move", placeButtons);
  created.on("resize", placeButtons);
  created.on("enter-full-screen", fullscreenChanged);
  created.on("leave-full-screen", fullscreenChanged);
  screen.on("display-metrics-changed", placeButtons);
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
    if (frame.maximized) created.maximize();
    created.show();

    if (frame.fullscreen) created.setFullScreen(true);

    if (performance.getEntriesByName("nyte:window-shown").length === 0)
      performance.mark("nyte:window-shown");
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

  created.on("close", () => {
    const bounds = created.getNormalBounds();

    launchState.setWindow({
      bounds: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
      maximized: created.isMaximized(),
      fullscreen: created.isFullScreen(),
    });
  });

  created.on("closed", () => {
    entry.menuCommands.reset();
    nativeTheme.off("updated", updateWindowBackground);
    screen.off("display-metrics-changed", placeButtons);
    windows.delete(id);
    browserSurfaces.releaseWindow(id);
    desktopHost?.releaseWindow(id);
  });

  return entry;
}

/** How long quitting waits for the history flush and the host close before it exits anyway. */
const SHUTDOWN_LIMIT_MS = 5_000;

let shuttingDown: Promise<void> | undefined;

let shutDown = false;

/** Flushes browser history and closes the host, once; quit and relaunch both wait for it. */
function shutdown(): Promise<void> {
  shuttingDown ??= Promise.race([
    Promise.allSettled([browserHistory.flush(), desktopHost?.close()]),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_LIMIT_MS)),
  ]).then(() => {
    shutDown = true;
  });

  return shuttingDown;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  const config = readConnectConfig(import.meta.env);
  const scheme = accountScheme({ packaged: app.isPackaged, updateTest });

  rendererUrl = registerRenderer({
    scheme,
    frontendApiHost: config?.clerk.frontendApiHost,
    shellRoot: app.isPackaged
      ? join(process.resourcesPath, "canvas")
      : join(app.getAppPath(), "..", "canvas", "dist", "shell"),
  });
  canvasShell = canvasShellUrl(scheme);
  connect = createConnect(config);

  app.on("second-instance", (_event, argv) => {
    // Clerk focuses the window that requested the OAuth callback.
    if (argv.some((arg) => arg.startsWith(`${scheme}:`))) return;
    reveal((currentWindow() ?? createWindow()).window);
  });

  void app.whenReady().then(async () => {
    performance.mark("nyte:electron-ready");
    nativeTheme.themeSource = launchState.theme();
    registerIpc();

    // Packaged apps use the bundle ICNS. The dev PNG shares its macOS inset.
    if (!app.isPackaged && process.platform === "darwin") {
      app.dock?.setIcon(join(app.getAppPath(), "resources", "icon.png"));
    }

    createWindow();
    void getHost()
      .autostartConnect()
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
        developer: !app.isPackaged,
        view: (command, window) => {
          const host = [...windows].find(([, entry]) => entry.window === window)?.[0];
          const surface = forwardingSurface ?? browserSurfaces.focused(host);

          if (surface !== undefined) {
            browserSurfaces.navigate({ surface, action: command });

            return;
          }

          if (window instanceof BrowserWindow) applyViewCommand(window.webContents, command);
        },
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
        beforeRelaunch: shutdown,
      });
    Menu.setApplicationMenu(menu);
  });

  app.on("before-quit", (event) => {
    if (shutDown) return;
    event.preventDefault();
    void shutdown().then(() => app.quit());
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
