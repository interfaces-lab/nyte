import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import { createNyteModels } from "@nyte-ai/ai";
import { createWorkspaceStore, nyteHome, WorkspaceTrustRequired } from "@nyte-ai/host";
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
import { showContextMenu } from "./context-menu.ts";
import { ExpectedHostError, ipcResult } from "./errors.ts";
import { callIpc } from "./ipc-call.ts";
import { localFonts } from "./fonts.ts";
import { UsageScanWorker } from "./usage-scan.ts";
import { DesktopHost, type DesktopHostDependencies, type HostWindow } from "./host.ts";
import { registerUpdates } from "./updates.ts";
import { ensureShellEnvironment } from "./shell-environment.ts";

import {
  decodeBrowserBounds,
  decodeWatchStart,
  decodeWatchStop,
  decodeWorkspaceEditorRequest,
  themePreference,
} from "./ipc-inputs.ts";

interface NyteWindow {
  readonly window: BrowserWindow;
  readonly editor: ReturnType<typeof createWorkspaceEditor>;
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

registerBunOAuthFlows();

/**
 * Vibrancy needs an opaque window. `transparent: true` gives the NSWindow a
 * clear backing, the vibrancy view behind the page has nothing left to blur,
 * and the sidebar falls back to flat colour, so it must stay unset here.
 * Increased contrast drops the effect entirely rather than blurring a surface
 * the user asked to be legible.
 */
function macOSWindowChrome(): Partial<Electron.BrowserWindowConstructorOptions> {
  const trafficLightDiameter = Number.parseFloat(process.getSystemVersion()) >= 25 ? 14 : 16;
  const trafficLightInset = Math.floor((35 - trafficLightDiameter) / 2);

  const options: Partial<Electron.BrowserWindowConstructorOptions> = {
    acceptFirstMouse: true,
    hasShadow: true,
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

/**
 * A vibrant window still takes a fill, and its alpha tints the material rather
 * than clearing it. Light stays neutral; dark carries a quarter black so the
 * blur reads dark instead of washing out. Without vibrancy the window needs a
 * real colour, matching `--nyte-chrome-base`.
 */
function windowBackgroundColor(): string {
  if (process.platform !== "darwin" || nativeTheme.shouldUseHighContrastColors) {
    return nativeTheme.shouldUseDarkColors ? "#111111" : "#f8f8f8";
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

const browserSurfaces = createBrowserSurfaces({
  window: (id) =>
    (id === undefined ? undefined : windows.get(id))?.window ?? currentWindow()?.window,
  emit: broadcast,
  filterListPath: app.isPackaged
    ? join(process.resourcesPath, "adblock.bin")
    : join(app.getAppPath(), "resources", "adblock.bin"),
  windowShown: (window) => windows.get(window.webContents.id)?.shown ?? false,
});

const hostDependencies = {
  createModels: createNyteModels,
  appVersion: app.getVersion(),
  // A sibling entry of this bundle; see the main build's rollup inputs.
  usageScan: new UsageScanWorker(nyteHome(), new URL("./usage-worker.js", import.meta.url)),
  storeWorker: new URL("./store-worker.js", import.meta.url),
  emitHostEvent: (event, window) =>
    window === undefined ? broadcast(event) : send(window, HOST_EVENT_CHANNEL, event),
  emitWatchEvent: (envelope, window) => send(window, WATCH_EVENT_CHANNEL, envelope),
  openExternal: (url) => void shell.openExternal(url),
  revealPath: (path) => shell.showItemInFolder(path),
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
  desktopHost ??= new DesktopHost(hostDependencies);

  return desktopHost;
}

/** Editor requests capture the requesting window's workspace. */
function createWindowEditor(window: HostWindow): ReturnType<typeof createWorkspaceEditor> {
  return createWorkspaceEditor({
    workspace: async () => {
      const state = await getHost().call(window, "host.state", undefined);

      if (state.workspace === undefined)
        throw new ExpectedHostError({ code: "not_found", message: "No project is open" });

      return state.workspace.path;
    },
    requireTrust: async (path) => {
      try {
        await createWorkspaceStore().require(path);
      } catch (cause) {
        if (cause instanceof WorkspaceTrustRequired) {
          send(window, HOST_EVENT_CHANNEL, { kind: "workspace_trust_required", path: cause.cwd });
        }

        throw cause;
      }
    },
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

function registerIpc(): void {
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

  ipcMain.handle(WORKSPACE_EDITOR_CHANNEL, async (event, request) => {
    const { editor } = senderWindow(event);

    return ipcResult(() => editor.call(decodeWorkspaceEditorRequest(request)));
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
    editor: createWindowEditor(id),
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
    entry.editor.dispose();
    desktopHost?.releaseWindow(id);
  };

  created.webContents.on("render-process-gone", releaseRendererWork);
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

  const developmentUrl = process.env["ELECTRON_RENDERER_URL"];

  if (developmentUrl === undefined)
    void created.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  else void created.loadURL(developmentUrl);

  created.on("closed", () => {
    entry.menuCommands.reset();
    entry.editor.dispose();
    nativeTheme.off("updated", updateWindowBackground);
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

  app.on("second-instance", () => {
    reveal((currentWindow() ?? createWindow()).window);
  });

  void app.whenReady().then(async () => {
    registerIpc();

    // Packaged apps use the bundle ICNS. The dev PNG shares its macOS inset.
    if (!app.isPackaged && process.platform === "darwin") {
      app.dock?.setIcon(join(app.getAppPath(), "resources", "icon.png"));
    }

    const first = createWindow();
    void getHost()
      .prepare(first.window.webContents.id)
      .catch(() => undefined);

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
      registerUpdates({
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
