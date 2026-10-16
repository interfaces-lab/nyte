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
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_BOUNDS_CHANNEL,
  BROWSER_FOCUS_CHANNEL,
  CALL_CHANNEL,
  CANVAS_SHELL_ARGUMENT,
  HOST_EVENT_CHANNEL,
  FIRST_WINDOW_ARGUMENT,
  MACHINE_NAME_ARGUMENT,
  MAIN_OPERATION_PATHS,
  THEME_PREFERENCE_CHANNEL,
  WINDOW_FULLSCREEN_CHANNEL,
  WINDOW_PAINTED_CHANNEL,
  WINDOW_ZOOM_CHANNEL,
} from "../shared/ipc.ts";
import type { CallHandler, CallRequest, CallTable, MainCallPath } from "../shared/ipc.ts";
import { machineName } from "@nyte-ai/connect/host";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
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
import { callIpc, callTable } from "./ipc-call.ts";
import type { CallRoute } from "./ipc-call.ts";
import { localFonts } from "./fonts.ts";
import { registerAccount } from "./account.ts";
import type { AccountSession } from "./account-session.ts";
import { AccountStore } from "./account-store.ts";
import { accountScheme } from "../account/scheme.ts";
import { canvasShellUrl, registerRenderer } from "./renderer.ts";
import { ACCOUNT_CHANNELS } from "../account/protocol.ts";
import { readConnectConfig } from "./connect-config.ts";
import type { ConnectConfig } from "./connect-config.ts";
import { ExpectedHostError } from "./errors.ts";
import { answerAccount } from "./host-account.ts";
import { answerAgent } from "./host-browser-agent.ts";
import { HostProcess } from "./host-process.ts";
import type { HostWindow } from "./host-window.ts";
import { DEFAULT_DESKTOP_SETTINGS } from "./desktop-settings.ts";
import { LaunchStateStore } from "./launch-state.ts";
import { registerUpdates } from "./updates.ts";

import { decodeBrowserBounds, decodeBrowserFocus, themePreference } from "./ipc-inputs.ts";

interface NyteWindow {
  readonly window: BrowserWindow;
  readonly menuCommands: ReturnType<typeof createMenuCommandDelivery>;
  /** Show the window the first time, in its opening frame; later calls do nothing. */
  readonly present: () => void;
  /**
   * Whether the window has been shown at least once. Synthesized mouse input
   * is silently dropped until the first show, so the explicit signal avoids
   * a race the fallback (window.isVisible) cannot catch.
   */
  shown: boolean;
}

/** Keyed by the renderer's webContents id; ordered by focus, most recent last. */
const windows = new Map<HostWindow, NyteWindow>();

/** Forked when Electron is ready, before the first window; the primary instance only. */
let hostProcess: HostProcess | undefined;

/** Settles once the host process is forked, for work that may start before Electron is ready. */
const hostStarted = Promise.withResolvers<HostProcess>();

/** The Nyte account's sign-in, in a build with Clerk; created in the primary instance only. */
let account: AccountSession | undefined;

let rendererUrl: string;

let canvasShell: string;

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

function keepAwake(awake: boolean): void {
  if (awake) {
    awakeBlocker ??= powerSaveBlocker.start("prevent-app-suspension");

    return;
  }

  if (awakeBlocker === undefined) return;
  powerSaveBlocker.stop(awakeBlocker);
  awakeBlocker = undefined;
}

function startedHost(): HostProcess {
  if (hostProcess === undefined) throw new Error("The host process starts when Electron is ready.");

  return hostProcess;
}

async function confirmExternal(url: string, id: HostWindow) {
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
}

async function pickFolder(id: HostWindow): Promise<string | undefined> {
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
}

/** The operations main answers; the host process answers the rest (`HOST_PROCESS_PATHS`). */
const mainCalls: CallTable = {
  "host.fonts": () => localFonts(),
  "host.pickWorkspace": async (window) => {
    const picked = await pickFolder(window);

    if (picked === undefined) return { kind: "cancelled" };

    const reply = await startedHost().call(window, {
      path: "host.openWorkspace",
      input: { path: picked },
    });

    if (!reply.ok) throw new ExpectedHostError(reply.error);

    if (reply.path !== "host.openWorkspace")
      throw new Error("The host answered another operation.");

    return reply.value;
  },
  "host.updates.state": async () => updates?.state() ?? { kind: "idle" },
  "host.updates.check": async () => updates?.click(),
  "host.openExternal": async (_window, { url }) => void shell.openExternal(safeExternalUrl(url)),
  "host.confirmExternal": (window, { url }) => confirmExternal(safeExternalUrl(url), window),
  "host.revealPath": async (_window, { path }) => shell.showItemInFolder(path),
  "host.openPluginsFolder": async () => {
    const folder = join(home, ".nyte", "plugins");
    await mkdir(folder, { recursive: true });
    const failure = await shell.openPath(folder);

    if (failure !== "") throw new Error(failure);
  },
  "host.contextMenu": (window, input) =>
    showContextMenu({ window: windows.get(window)?.window, input }),
  "host.browser.open": async (window, input) => browserSurfaces.open(input, window),
  "host.browser.navigate": async (_window, input) => browserSurfaces.navigate(input),
  "host.browser.menu": (window, input) => browserSurfaces.menu(input, window),
  "host.browser.perform": (window, input) => browserSurfaces.perform(input, window),
  "host.browser.close": async (_window, input) => browserSurfaces.close(input),
  "host.browser.captureFrame": (_window, input) => browserSurfaces.captureFrame(input),
  "host.browser.find": (_window, input) => browserSurfaces.find(input),
  "host.browser.cancelDownload": async (_window, input) => browserSurfaces.cancelDownload(input),
  "host.browser.login": async (_window, input) => browserSurfaces.login(input),
  "host.browser.history": (_window, input) => browserSurfaces.history(input),
  "host.browser.forgetHistory": (_window, input) => browserSurfaces.forgetHistory(input),
} satisfies { readonly [P in MainCallPath]: CallHandler<P> };

const mainRoute: CallRoute = (window, path, input) => callTable(mainCalls, window, path, input);

const mainPaths: ReadonlySet<string> = new Set(MAIN_OPERATION_PATHS);

/** Returns the renderer's origin as Chromium sends it, `scheme://host`; Node reports a custom scheme's `URL.origin` as opaque. */
function rendererOrigin(url: string): string {
  const parsed = new URL(url);

  return `${parsed.protocol}//${parsed.host}`;
}

function startHost(): HostProcess {
  return new HostProcess(
    join(import.meta.dirname, "host-entry.js"),
    {
      home,
      rendererOrigin: rendererOrigin(rendererUrl),
      account: account === undefined ? null : account.state(),
    },
    {
      event: emitHostEvent,
      awake: keepAwake,
      settings: (next) => {
        settings = next;
        browserSurfaces.settingsChanged();
      },
      answer: async (request, signal) => {
        if (request.kind === "agent")
          return { kind: "agent", answer: await answerAgent(browserSurfaces.agent, request.call) };

        if (account === undefined) throw new Error("This build has no Nyte account.");

        return { kind: "account", answer: await answerAccount(account, request.call, signal) };
      },
    },
  );
}

function createAccount(config: ConnectConfig | undefined): AccountSession | undefined {
  let session: AccountSession | undefined;

  if (config !== undefined) {
    try {
      session = registerAccount({
        publishableKey: config.clerk.publishableKey,
        scheme: accountScheme({ packaged: app.isPackaged, updateTest }),
        window: (id) => (id === undefined ? currentWindow() : windows.get(id))?.window,
        onChange: () => {
          if (session !== undefined) hostProcess?.accountChanged(session.state());
        },
        store: new AccountStore({
          path: join(app.getPath("userData"), "account.json"),
          sealer: {
            seal: async (plain) => (await hostStarted.promise).seal(plain),
            open: async (sealed) => (await hostStarted.promise).open(sealed),
          },
        }),
      });
    } catch {
      session = undefined;
      process.emitWarning("Account sign-in could not be registered; linking is unavailable.", {
        code: "NYTE_ACCOUNT_UNAVAILABLE",
      });
    }
  }

  if (session === undefined) {
    ipcMain.handle(ACCOUNT_CHANNELS.config, (event) => {
      senderWindow(event);

      return undefined;
    });
  }

  return session;
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

  ipcMain.on(WINDOW_PAINTED_CHANNEL, (event) => {
    senderWindow(event).present();
  });

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

  ipcMain.handle(CALL_CHANNEL, async (event, request: CallRequest) => {
    senderWindow(event);

    return mainPaths.has(request.path)
      ? callIpc(mainRoute, event.sender.id, request)
      : startedHost().call(event.sender.id, request);
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

/**
 * How long a loaded window stays hidden waiting for the interface's first frame. A renderer that
 * crashed or failed before it painted is shown anyway.
 */
const FIRST_FRAME_LIMIT_MS = 2_000;

/**
 * Opens a Nyte window, shown once the interface has drawn its first frame. Its host work is released when the renderer
 * goes away or a committed main-frame navigation leaves the document behind; the navigation's
 * start event fires before `will-navigate` can cancel, so it would tear down under a renderer
 * that stays. A link that would open a window goes to the system browser instead, and an
 * invalid one stays closed.
 */
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
      additionalArguments: [
        `${CANVAS_SHELL_ARGUMENT}=${canvasShell}`,
        `${MACHINE_NAME_ARGUMENT}=${machineName()}`,
        ...(windows.size === 0 ? [FIRST_WINDOW_ARGUMENT] : []),
      ],
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
    present: () => {
      if (entry.shown || created.isDestroyed()) return;

      if (frame.maximized) created.maximize();
      created.show();

      if (frame.fullscreen) created.setFullScreen(true);

      if (performance.getEntriesByName("nyte:window-shown").length === 0)
        performance.mark("nyte:window-shown");
      entry.shown = true;
    },
    shown: false,
  };

  windows.set(id, entry);
  created.on("focus", () => {
    windows.delete(id);
    windows.set(id, entry);
  });

  const releaseRendererWork = (): void => {
    hostProcess?.release(id);
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
    setTimeout(entry.present, FIRST_FRAME_LIMIT_MS);
  });

  created.webContents.setWindowOpenHandler(({ url }) => {
    void Promise.try(() => shell.openExternal(safeExternalUrl(url))).catch(() => undefined);

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
    hostProcess?.release(id);
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
    Promise.allSettled([browserHistory.flush(), hostProcess?.close(SHUTDOWN_LIMIT_MS)]),
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
  account = createAccount(config);

  app.on("second-instance", (_event, argv) => {
    const clerkCallback = argv.some((arg) => arg.startsWith(`${scheme}:`));

    if (!clerkCallback) reveal((currentWindow() ?? createWindow()).window);
  });

  void app.whenReady().then(async () => {
    performance.mark("nyte:electron-ready");
    nativeTheme.themeSource = launchState.theme();
    registerIpc();

    const devDockIcon = !app.isPackaged && process.platform === "darwin";

    if (devDockIcon) app.dock?.setIcon(join(app.getAppPath(), "resources", "icon.png"));

    hostProcess = startHost();
    hostStarted.resolve(hostProcess);
    createWindow();
    powerMonitor.on("resume", () => hostProcess?.resume());

    const menu = Menu.buildFromTemplate(
      applicationMenuTemplate({
        platform: process.platform,
        name: app.getName(),
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
        activity: () => startedHost().activity(),
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
