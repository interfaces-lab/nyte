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
import { randomUUID } from "node:crypto";
import { macOSTrafficLightPosition } from "./traffic-lights.ts";
import { macOSWindowChrome, windowBackgroundColor } from "./window-chrome.ts";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  APPS_ARGUMENT,
  BROWSER_FOCUS_CHANNEL,
  BROWSER_SHOWN_CHANNEL,
  CALL_CHANNEL,
  HOST_PORT_CHANNEL,
  CANVAS_SHELL_ARGUMENT,
  HOST_EVENT_CHANNEL,
  LAUNCH_WINDOWS_ARGUMENT,
  MACHINE_NAME_ARGUMENT,
  MAIN_OPERATION_PATHS,
  TERMINAL_NOTIFICATION_CHANNEL,
  THEME_PREFERENCE_CHANNEL,
  UNSAVED_EDITS_CHANNEL,
  VIEWING_CHANNEL,
  WINDOW_APP_ARGUMENT,
  WINDOW_FULLSCREEN_CHANNEL,
  WINDOW_ID_ARGUMENT,
  WINDOW_OPEN_ARGUMENT,
  WINDOW_PAINTED_CHANNEL,
  WINDOW_WORKSPACE_CHANNEL,
  WINDOW_ZOOM_CHANNEL,
} from "../shared/ipc.ts";
import type { CallHandler, CallRequest, CallTable, MainCallPath } from "../shared/ipc.ts";
import { machineName, ConnectRuntime } from "@nyte-ai/connect/host";
import type { HostEvent } from "@nyte-ai/app/contract/bridge.ts";
import type { CanvasPreviewer } from "@nyte-ai/plugin/core/canvas-preview";
import { APP_MENU_COMMAND_CHANNEL, APP_MENU_READY_CHANNEL } from "../shared/app-menu.ts";
import {
  applicationMenuTemplate,
  applyViewCommand,
  createMenuCommandDelivery,
  menuItemForKey,
  menuItemRepeats,
  performMenuRole,
} from "./app-menu.ts";
import { createUnsavedEdits } from "./unsaved-edits.ts";
import { safeExternalUrl } from "./native/external-url.ts";
import { openInBrowser } from "./native/open-in-browser.ts";
import { Alerts } from "./alerts.ts";
import { BrowserSurfaces } from "./browser/browser.ts";
import { BrowserHistoryStore } from "./browser/browser-history.ts";
import { showContextMenu, showEditableMenu } from "./native/context-menu.ts";
import { callIpc, callTable } from "../shared/ipc-call.ts";
import type { CallRoute } from "../shared/ipc-call.ts";
import { localFonts } from "./native/fonts.ts";
import { registerAccount } from "./account/account.ts";
import type { AccountSession } from "@nyte-ai/connect/host";
import { openSecret, sealSecret } from "@nyte-ai/host/credentials";
import { defaultSecrets } from "@nyte-ai/host/secrets";
import { AccountStore } from "./account/account-store.ts";
import { accountScheme } from "../shared/account/scheme.ts";
import { offscreenCanvasPreviewer } from "./canvas-preview.ts";
import { canvasShellUrl, mediaOrigin, registerRenderer } from "./renderer-protocol.ts";
import { ACCOUNT_CHANNELS } from "../shared/account/protocol.ts";
import { readConnectConfig } from "../shared/connect-config.ts";
import type { ConnectConfig } from "../shared/connect-config.ts";
import { adoptStagedCli, inspectBundledCli, stageCli } from "./native/cli.ts";
import { confirmExternal, installStagedCli, pickFolder } from "./dialogs.ts";
import { ExpectedHostError, retainDiagnostic } from "../shared/errors.ts";
import { findPackagedBuild } from "../shared/desktop-builds.ts";
import { throwForRenderer } from "../host/desktop-host.ts";
import type { DesktopHost } from "../host/desktop-host.ts";
import { bridgeHostPort, startHostRuntime } from "./host-runtime.ts";
import { createHostTray } from "./host-tray.ts";
import type { HostTray } from "./host-tray.ts";
import type { HostRuntime } from "./host-runtime.ts";
import type { HostWindow, WindowEnd } from "../shared/host-window.ts";
import { DEFAULT_DESKTOP_SETTINGS } from "@nyte-ai/app/contract/desktop-settings.ts";
import { LaunchStateStore, openingFrame, windowsAfterClose } from "./launch-state.ts";
import { registerUpdates } from "./updates/updates.ts";
import { createOpenWith } from "./open-with.ts";
import type { DesktopApp } from "@nyte-ai/app/contract/desktop-app.ts";
import type { DesktopWindowOpen } from "@nyte-ai/app/contract/desktop-window.ts";
import { besideBounds, createAppSwitch, windowsAppDetails, windowTitle } from "./apps.ts";
import {
  browserFocus,
  browserShown,
  terminalNotice,
  themePreference,
  unsavedEditsHeld,
  viewedChat,
  windowWorkspacePath,
} from "../shared/ipc-inputs.ts";
import { createWindowWorkspaces } from "../shared/window-workspace.ts";

interface NyteWindow {
  readonly app: DesktopApp;
  readonly window: BrowserWindow;
  readonly menuCommands: ReturnType<typeof createMenuCommandDelivery>;
  readonly present: () => void;
  shown: boolean;
}

const windows = new Map<HostWindow, NyteWindow>();

let desktopHost: DesktopHost | undefined;

let hostRuntime: HostRuntime | undefined;

let hostTray: HostTray | undefined;

let account: AccountSession | undefined;

let rendererUrl: string;

let canvasShell: string;

let previewCanvas: CanvasPreviewer;

let previewsOpen = new AbortController();

const build = app.isPackaged ? findPackagedBuild(app.getName()) : null;

app.setName(build?.name ?? "Nyte (Dev)");

app.setPath(
  "userData",
  app.commandLine.getSwitchValue("user-data-dir") ||
    join(app.getPath("appData"), build?.name ?? "Nyte Dev"),
);

if (build === null ? process.env["NYTE_HOME"] === undefined : build.homeInUserData) {
  process.env["NYTE_HOME"] = join(app.getPath("userData"), "nyte");
}

const launchState = new LaunchStateStore(join(app.getPath("userData"), "launch-state.json"));

const home = build?.homeInUserData === true ? app.getPath("userData") : homedir();

const nyteHome = process.env["NYTE_HOME"] ?? join(home, ".nyte");

const secrets = defaultSecrets(home);

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

function emitHostEvent(event: HostEvent, window?: HostWindow): void {
  if (window === undefined) broadcast(event);
  else send(window, HOST_EVENT_CHANNEL, event);
}

function currentWindow(): NyteWindow | undefined {
  return [...windows.values()].at(-1);
}

function reveal(entry: NyteWindow): void {
  if (!entry.shown) return;
  const { window } = entry;

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
    : join(app.getAppPath(), "resources", "adblock.generated.bin"),
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

const alerts = new Alerts(() => settings, {
  focused: () =>
    [...windows].find(([, entry]) => !entry.window.isDestroyed() && entry.window.isFocused())?.[0],
  latest: () => (currentWindow() ?? restoreWindows()).window.webContents.id,
  reveal: (window) => {
    const entry = windows.get(window);

    if (entry !== undefined) reveal(entry);
  },
  send: (window, event) => send(window, HOST_EVENT_CHANNEL, event),
});

const unsavedEdits = createUnsavedEdits((options, id) => {
  const window = id === undefined ? undefined : windows.get(id)?.window;

  return window === undefined
    ? dialog.showMessageBoxSync(options)
    : dialog.showMessageBoxSync(window, options);
});

const windowWorkspaces = createWindowWorkspaces();

const openWith = createOpenWith({
  host: startedHost,
  windows: () => [...windows].flatMap(([id, entry]) => (entry.app === "code" ? [id] : [])),
  workspace: (window) => windowWorkspaces.workspace(window),
  send: (window, path) => windows.get(window)?.menuCommands.dispatch({ kind: "open-file", path }),
  open: (opening) => createWindow("code", { opening }),
  failed: (path, message) => dialog.showErrorBox(`Couldn't open ${basename(path)}`, message),
});

const switchApp = createAppSwitch({
  windows: () => windows,
  workspace: (window) => windowWorkspaces.workspace(window),
  arrive: (entry, subject) => entry.menuCommands.dispatch({ kind: "arrive", subject }),
  open: (app, opening, beside) => {
    const bounds = beside.window.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    createWindow(app, { opening, bounds: besideBounds(bounds, workArea, MIN_WIDTH) });
  },
});

let updates: Awaited<ReturnType<typeof registerUpdates>> | undefined;

const updatesReady = Promise.withResolvers<void>();

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

function startedHost(): DesktopHost {
  if (desktopHost === undefined) throw new Error("The host connects when Electron is ready.");

  return desktopHost;
}

const mainCalls: CallTable = {
  "host.fonts": () => localFonts(),
  "host.pickWorkspace": async (window) => {
    const picked = await pickFolder(windows.get(window)?.window);

    if (picked === undefined) return { kind: "cancelled" };

    return startedHost()
      .call(window, "host.openWorkspace", { path: picked })
      .catch(throwForRenderer);
  },
  "host.pickFolder": (window) => pickFolder(windows.get(window)?.window),
  "host.updates.state": async () => updates?.state() ?? { kind: "idle" },
  "host.updates.check": async () => updates?.click(),
  "host.updates.channel": async () => {
    await updatesReady.promise;

    return updates?.channel() ?? "stable";
  },
  "host.updates.setChannel": async (_window, { channel }) => {
    await updatesReady.promise;

    if (updates === undefined) {
      throw new ExpectedHostError({ code: "unavailable", message: "Updates are not ready." });
    }

    return updates.setChannel(channel);
  },
  "host.hostProcess.state": async () => hostRuntime?.hostProcess.state() ?? { kind: "offline" },
  "host.hostProcess.confirm": async (window, { action }) =>
    hostRuntime?.hostProcess.confirm(action, windows.get(window)?.window),
  "host.hostProcess.start": async () => hostRuntime?.hostProcess.start(),
  "host.bundledCli": async () =>
    inspectBundledCli({
      resources: process.resourcesPath,
      packaged: app.isPackaged,
      appVersion: app.getVersion(),
    }),
  "host.openExternal": async (_window, { url }) => void shell.openExternal(safeExternalUrl(url)),
  "host.confirmExternal": (window, { url }) =>
    confirmExternal(safeExternalUrl(url), windows.get(window)?.window),
  "host.revealPath": async (_window, { path }) => shell.showItemInFolder(path),
  "host.openInBrowser": async (_window, { path }) => openInBrowser(path),
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
  "host.browser.close": async (window, input) => browserSurfaces.close(input, window),
  "host.browser.captureFrame": (_window, input) => browserSurfaces.captureFrame(input),
  "host.browser.design": async (_window, input) => browserSurfaces.design(input),
  "host.browser.find": (_window, input) => browserSurfaces.find(input),
  "host.browser.cancelDownload": async (_window, input) => browserSurfaces.cancelDownload(input),
  "host.browser.login": async (_window, input) => browserSurfaces.login(input),
  "host.browser.history": (_window, input) => browserSurfaces.history(input),
  "host.browser.forgetHistory": (_window, input) => browserSurfaces.forgetHistory(input),
  "host.browser.guests": async (window) => browserSurfaces.guests(window),
  "host.browser.attach": async (window, input) => browserSurfaces.attach(input, window),
  "host.browser.setEntered": async (window, input) => browserSurfaces.setEntered(input, window),
  "host.switchApp": async (window, input) => switchApp(window, input),
} satisfies { readonly [P in MainCallPath]: CallHandler<P> };

const mainRoute: CallRoute = (window, path, input) => callTable(mainCalls, window, path, input);

const hostRoute: CallRoute = (window, path, input) =>
  startedHost().call(window, path, input).catch(throwForRenderer);

const mainPaths: ReadonlySet<string> = new Set(MAIN_OPERATION_PATHS);

function startHost(): DesktopHost {
  const runtime = startHostRuntime({
    build,
    home,
    nyteHome,
    connect: new ConnectRuntime({
      config: readConnectConfig(import.meta.env),
      home: join(home, ".nyte"),
      authorizer: account === undefined ? undefined : { kind: "session", account },
      onChange: () => desktopHost?.remoteChanged(),
    }),
    usageWorker: new URL("./usage-worker.js", import.meta.url),
    hostEntry: new URL("./nyte-host.js", import.meta.url),
    agent: browserSurfaces.agent,
    preview: (request, signal) => previewCanvas(request, signal),
    previewSignal: () => previewsOpen.signal,
    openChat: (session) => alerts.openChat(session),
    mediaOrigin: mediaOrigin(accountScheme(build)),
    emitHostEvent,
    keepAwake,
    settingsChanged: (next) => {
      settings = next;
      browserSurfaces.settingsChanged();
    },
    alert: (delivery) => alerts.agent(delivery),
    badge: (count) => alerts.badge(count),
    linkChanged: (state) => {
      hostTray?.refresh();
      openWith.reachable(state.kind === "connected");
    },
    hostProcessChanged: (state) => emitHostEvent({ kind: "host_process_changed", state }),
    registrationChanged: () => hostTray?.refresh(),
  });

  hostRuntime = runtime;

  return runtime.desktop;
}

function createAccount(config: ConnectConfig | undefined): AccountSession | undefined {
  let session: AccountSession | undefined;

  if (config !== undefined) {
    try {
      session = registerAccount({
        publishableKey: config.clerk.publishableKey,
        scheme: accountScheme(build),
        window: (id) => (id === undefined ? currentWindow() : windows.get(id))?.window,
        onChange: () => desktopHost?.accountChanged(),
        store: new AccountStore({
          path: join(app.getPath("userData"), "account.json"),
          sealer: {
            seal: (plain) => sealSecret(secrets, plain),
            open: (sealed) => openSecret(secrets, sealed),
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

function placeWindowButtons(window: BrowserWindow): void {
  if (process.platform !== "darwin" || window.isDestroyed()) return;
  window.setWindowButtonPosition(macOSTrafficLightPosition(window.webContents.getZoomFactor()));
}

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

  ipcMain.on(BROWSER_SHOWN_CHANNEL, (event, message) => {
    senderWindow(event);

    if (browserShown.Check(message)) browserSurfaces.setShown(message, event.sender.id);
  });

  ipcMain.on(VIEWING_CHANNEL, (event, viewed) => {
    senderWindow(event);

    if (viewedChat.Check(viewed)) alerts.viewing(event.sender.id, viewed);
  });

  ipcMain.on(TERMINAL_NOTIFICATION_CHANNEL, (event, notice) => {
    senderWindow(event);

    if (terminalNotice.Check(notice)) alerts.terminal(event.sender.id, notice);
  });

  ipcMain.on(UNSAVED_EDITS_CHANNEL, (event, held) => {
    senderWindow(event);

    if (unsavedEditsHeld.Check(held)) unsavedEdits.report(event.sender.id, held);
  });

  ipcMain.on(WINDOW_WORKSPACE_CHANNEL, (event, path) => {
    const entry = senderWindow(event);

    if (!windowWorkspacePath.Check(path)) return;
    windowWorkspaces.shown(event.sender.id, path ?? undefined);
    entry.window.setTitle(windowTitle(entry.app, path ?? undefined));
  });

  ipcMain.on(BROWSER_FOCUS_CHANNEL, (event, message) => {
    senderWindow(event);

    if (browserFocus.Check(message)) browserSurfaces.setFocus(message, event.sender.id);
  });

  ipcMain.on(HOST_PORT_CHANNEL, (event, nonce: unknown) => {
    senderWindow(event);

    if (typeof nonce !== "string" || hostRuntime === undefined) return;
    event.sender.postMessage(HOST_PORT_CHANNEL, nonce, [bridgeHostPort(hostRuntime.route)]);
  });

  ipcMain.handle(CALL_CHANNEL, async (event, request: CallRequest) => {
    senderWindow(event);

    return callIpc(mainPaths.has(request.path) ? mainRoute : hostRoute, event.sender.id, request);
  });
}

function onScreen(bounds: Electron.Rectangle): boolean {
  return screen
    .getAllDisplays()
    .some(
      ({ workArea }) =>
        bounds.x < workArea.x + workArea.width &&
        bounds.x + bounds.width > workArea.x &&
        bounds.y < workArea.y + workArea.height &&
        bounds.y + bounds.height > workArea.y,
    );
}

const FIRST_FRAME_LIMIT_MS = 4000;

const MIN_WIDTH = 500;

function createWindow(
  app: DesktopApp,
  input: {
    readonly windowId?: string;
    readonly opening?: DesktopWindowOpen;
    readonly bounds?: Electron.Rectangle;
  } = {},
): NyteWindow {
  const windowId = input.windowId ?? randomUUID();
  const opening = input.opening;

  const frame = openingFrame({
    own: launchState.frame(windowId),
    last: launchState.window(),
    first: windows.size === 0,
    onScreen,
  });

  launchState.keepWindow(windowId, app, opening);

  const options: Electron.BrowserWindowConstructorOptions = {
    ...frame.bounds,
    ...input.bounds,
    title: windowTitle(app, opening?.workspace?.path),
    minWidth: MIN_WIDTH,
    minHeight: 520,
    show: false,
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      additionalArguments: [
        `${CANVAS_SHELL_ARGUMENT}=${canvasShell}`,
        `${MACHINE_NAME_ARGUMENT}=${machineName()}`,
        `${WINDOW_ID_ARGUMENT}=${windowId}`,
        `${WINDOW_APP_ARGUMENT}=${app}`,
        ...(windows.size === 0 && (opening === undefined || opening.kind === "app")
          ? [`${LAUNCH_WINDOWS_ARGUMENT}=${launchState.windows().join(",")}`]
          : []),
        ...(opening === undefined ? [] : [`${WINDOW_OPEN_ARGUMENT}=${JSON.stringify(opening)}`]),
        `${APPS_ARGUMENT}=${build === null ? "nyte,code,studio" : "nyte,code"}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  };

  if (process.platform === "darwin") Object.assign(options, macOSWindowChrome());
  const created = new BrowserWindow(options);
  const id = created.webContents.id;

  if (process.platform === "win32") {
    created.setAppDetails(windowsAppDetails(app, build?.appId ?? "ai.nyte.dev", process.execPath));
  }

  const entry: NyteWindow = {
    app,
    window: created,
    menuCommands: createMenuCommandDelivery({
      openWindow: () => reveal(entry),
      send: (command) => created.webContents.send(APP_MENU_COMMAND_CHANNEL, command),
    }),
    present: () => {
      if (entry.shown || created.isDestroyed()) return;

      if (frame.maximized) created.maximize();
      created.show();

      if (opening?.kind === "app") created.focus();

      if (frame.fullscreen) created.setFullScreen(true);

      if (performance.getEntriesByName("nyte:window-shown").length === 0) {
        performance.mark("nyte:window-shown");
      }
      entry.shown = true;
    },
    shown: false,
  };

  windows.set(id, entry);
  created.on("focus", () => {
    windows.delete(id);
    windows.set(id, entry);
  });

  const windowEnded = (end: WindowEnd): void => {
    browserSurfaces.releaseWindow(id);
    windowWorkspaces.windowEnded(id, end);
    alerts.windowEnded(id, end);
    unsavedEdits.windowEnded(id);
    entry.menuCommands.windowEnded();
  };

  created.webContents.on("render-process-gone", () => windowEnded("crashed"));
  created.on("page-title-updated", (event) => event.preventDefault());
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
  created.webContents.on("did-navigate", () => windowEnded("navigated"));

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
  created.webContents.on("context-menu", (_event, params) => showEditableMenu(created, params));
  browserSurfaces.hostGuests(created);
  created.webContents.on("will-navigate", (event, url) => {
    if (url !== created.webContents.getURL()) event.preventDefault();
  });

  windowWorkspaces.opened(id, opening?.workspace?.path);
  void created.loadURL(rendererUrl);

  created.on("close", (event) => {
    if (!quitting && !unsavedEdits.mayClose(id)) {
      event.preventDefault();

      return;
    }

    const bounds = created.getNormalBounds();

    launchState.setWindow(windowId, {
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
    nativeTheme.off("updated", updateWindowBackground);
    screen.off("display-metrics-changed", placeButtons);
    windows.delete(id);

    const saved = windowsAfterClose(launchState.windows(), windowId, {
      quitting,
      remaining: windows.size,
    });

    if (saved !== undefined) launchState.setWindows(saved);
    windowEnded("closed");

    if (windows.size === 0) {
      previewsOpen.abort();
      previewsOpen = new AbortController();
    }
  });

  return entry;
}

function restoreWindows(): NyteWindow {
  const opened = launchState.windows().map((windowId) => {
    const kept = launchState.reopening(windowId);

    return createWindow(kept.app, { windowId, opening: kept.opening });
  });

  return opened[0] ?? createWindow("nyte");
}

function showHostTray(): void {
  if (process.platform !== "darwin" || hostRuntime === undefined) return;

  hostTray = createHostTray({
    agent: hostRuntime.agent,
    link: hostRuntime.link,
    checkForUpdates: () => void updates?.click(),
    openApp: () => {
      app.focus({ steal: true });
      const window = currentWindow();

      if (window === undefined) restoreWindows();
      else reveal(window);
    },
    openSettings: () => {
      app.focus({ steal: true });
      const window = currentWindow() ?? restoreWindows();
      window.menuCommands.dispatch({ kind: "action", action: "settings.open", input: {} });
    },
  });
}

let quitting = false;

function confirmQuit(): boolean {
  quitting ||= unsavedEdits.mayQuit();

  return quitting;
}

const SHUTDOWN_LIMIT_MS = 5000;

let shuttingDown: Promise<void> | undefined;

let shutDown = false;

function shutdown(): Promise<void> {
  shuttingDown ??= Promise.race([
    Promise.allSettled([browserHistory.flush(), hostRuntime?.close()]),
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
  const scheme = accountScheme(build);

  const shellRoot = app.isPackaged
    ? join(process.resourcesPath, "canvas")
    : join(app.getAppPath(), "..", "canvas", "dist", "shell");

  rendererUrl = registerRenderer({
    scheme,
    frontendApiHost: config?.clerk.frontendApiHost,
    shellRoot,
    host: () => hostRuntime?.route.fetch,
  });
  canvasShell = canvasShellUrl(scheme);
  previewCanvas = offscreenCanvasPreviewer(
    scheme,
    shellRoot,
    join(import.meta.dirname, "../preload/canvas-preview.js"),
  );
  account = createAccount(config);

  app.on("open-file", (event, path) => {
    event.preventDefault();
    openWith.add(path);
  });

  app.on("second-instance", (_event, argv) => {
    const clerkCallback = argv.some((arg) => arg.startsWith(`${scheme}:`));

    if (!clerkCallback) reveal(currentWindow() ?? restoreWindows());
  });

  void app.whenReady().then(async () => {
    performance.mark("nyte:electron-ready");
    nativeTheme.themeSource = launchState.theme();
    registerIpc();

    const devDockIcon = !app.isPackaged && process.platform === "darwin";

    if (devDockIcon) app.dock?.setIcon(join(app.getAppPath(), "resources", "icon.png"));

    desktopHost = startHost();
    powerMonitor.on("suspend", () => desktopHost?.suspend());
    powerMonitor.on("resume", () => hostRuntime?.resume());

    const menu = Menu.buildFromTemplate(
      applicationMenuTemplate({
        platform: process.platform,
        name: app.getName(),
        dispatch: (command) => (currentWindow() ?? restoreWindows()).menuCommands.dispatch(command),
        newWindow: () => createWindow("nyte"),
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

    if (updateItem !== null) {
      updates = await registerUpdates({
        publish: (state) => broadcast({ kind: "update_changed", state }),
        publishChannel: (channel) => broadcast({ kind: "update_channel_changed", channel }),
        item: updateItem,
        activity: () => startedHost().updateActivity(),
        confirmQuit,
        beforeRelaunch: () => {
          quitting = true;

          return shutdown();
        },
      });
    }

    updatesReady.resolve();
    showHostTray();
    restoreWindows();
    openWith.ready();

    const cli =
      app.isPackaged && process.platform !== "win32"
        ? stageCli({
            resources: process.resourcesPath,
            stages: join(app.getPath("userData"), "cli"),
          })
        : undefined;

    const cliItem = menu.getMenuItemById("install-cli");

    if (cli !== undefined && cliItem !== null) {
      cliItem.visible = true;
      cliItem.click = () => void installStagedCli(home, cli);
    }

    Menu.setApplicationMenu(menu);
    void cli
      ?.then((staged) => adoptStagedCli(home, staged))
      .catch((cause: unknown) => retainDiagnostic({ correlationId: "desktop-cli-stage", cause }));
  });

  app.on("before-quit", (event) => {
    if (shutDown) return;
    event.preventDefault();

    if (!confirmQuit()) return;
    void shutdown().then(() => {
      if (updates?.installOnQuit() !== true) app.quit();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    void app.whenReady().then(() => {
      if (windows.size === 0) restoreWindows();
    });
  });
}
