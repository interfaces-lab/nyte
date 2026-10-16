import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";
import { exposeClerkBridge } from "@clerk/electron/preload";
import { ACCOUNT_CHANNELS } from "../account/protocol.ts";
import type { AccountBridge, AccountCommand } from "../account/protocol.ts";
import { APP_MENU_COMMAND_CHANNEL, APP_MENU_READY_CHANNEL } from "../shared/app-menu.ts";
import type { AppMenuCommand } from "@nyte-ai/app/bridge.ts";
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
import type {
  CallInput,
  CallOutput,
  CallPath,
  CallReplyFor,
  DesktopBridge,
} from "../shared/ipc.ts";
import type { BrowserBoundsMessage, BrowserFocusMessage, HostEvent } from "@nyte-ai/app/bridge.ts";
import { bridgeError } from "@nyte-ai/app/errors.ts";

exposeClerkBridge();

contextBridge.exposeInMainWorld("nyteAccount", {
  config: () => ipcRenderer.invoke(ACCOUNT_CHANNELS.config),
  onCommand(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, command: AccountCommand | null): void => {
      listener(command ?? undefined);
    };

    ipcRenderer.on(ACCOUNT_CHANNELS.command, wrapped);
    ipcRenderer.send(ACCOUNT_CHANNELS.ready);

    return () => ipcRenderer.removeListener(ACCOUNT_CHANNELS.command, wrapped);
  },
  onReturn(listener) {
    const wrapped = (): void => listener();

    ipcRenderer.on(ACCOUNT_CHANNELS.returned, wrapped);

    return () => ipcRenderer.removeListener(ACCOUNT_CHANNELS.returned, wrapped);
  },
  answer: (answer) => ipcRenderer.send(ACCOUNT_CHANNELS.answer, answer),
  report: (report) => ipcRenderer.send(ACCOUNT_CHANNELS.report, report),
} satisfies AccountBridge);

/**
 * One host operation. Only Nyte's main process handles CALL_CHANNEL; it decodes the
 * path's request and answers in the matching `CallReplyFor<P>` envelope.
 */
async function call<P extends CallPath>(path: P, input: CallInput<P>): Promise<CallOutput<P>> {
  const result: CallReplyFor<P> = await ipcRenderer.invoke(CALL_CHANNEL, { path, input });

  if (!result.ok) return Promise.reject(bridgeError(result.error));

  if (result.path !== path) throw new Error("Malformed reply from the host: path mismatch");

  return result.value;
}

type NoneCallPath = {
  [P in CallPath]: [CallInput<P>] extends [undefined] ? P : never;
}[CallPath];

function none<P extends NoneCallPath>(path: P): () => Promise<CallOutput<P>> {
  return () => call(path, undefined);
}

function object<P extends Exclude<CallPath, NoneCallPath>>(
  path: P,
): (input: CallInput<P>) => Promise<CallOutput<P>> {
  return (input) => call(path, input);
}

const canvasShell = process.argv
  .find((argument) => argument.startsWith(`${CANVAS_SHELL_ARGUMENT}=`))
  ?.slice(CANVAS_SHELL_ARGUMENT.length + 1);

const bridge = {
  clientSurface: "desktop",
  ...(canvasShell === undefined ? {} : { canvasShell }),
  host: {
    onMenuCommand(listener: (command: AppMenuCommand) => void) {
      // Only the main process sends this private channel; never expose the IPC event.
      const wrapped = (_event: Electron.IpcRendererEvent, command: AppMenuCommand): void => {
        listener(command);
      };

      ipcRenderer.on(APP_MENU_COMMAND_CHANNEL, wrapped);
      ipcRenderer.send(APP_MENU_READY_CHANNEL);

      return () => ipcRenderer.removeListener(APP_MENU_COMMAND_CHANNEL, wrapped);
    },
    setThemePreference: (preference) => ipcRenderer.send(THEME_PREFERENCE_CHANNEL, preference),
    endpoint: none("host.endpoint"),
    state: none("host.state"),
    fonts: none("host.fonts"),
    usage: object("host.usage"),
    openWorkspace: object("host.openWorkspace"),
    pickWorkspace: none("host.pickWorkspace"),
    trustWorkspace: object("host.trustWorkspace"),
    closeWorkspace: none("host.closeWorkspace"),
    updates: {
      state: none("host.updates.state"),
      check: none("host.updates.check"),
    },
    server: {
      state: none("host.server.state"),
      connect: object("host.server.connect"),
      disconnect: none("host.server.disconnect"),
    },
    remote: {
      state: none("host.remote.state"),
      start: object("host.remote.start"),
      stop: none("host.remote.stop"),
      configure: object("host.remote.configure"),
      clear: object("host.remote.clear"),
      pair: object("host.remote.pair"),
      revoke: object("host.remote.revoke"),
    },
    connect: {
      state: none("host.connect.state"),
      link: none("host.connect.link"),
      cancel: none("host.connect.cancel"),
      setEnabled: object("host.connect.setEnabled"),
      unlink: none("host.connect.unlink"),
      revokeDevice: object("host.connect.revokeDevice"),
      openAccount: none("host.connect.openAccount"),
      signOut: none("host.connect.signOut"),
    },
    openExternal: object("host.openExternal"),
    confirmExternal: object("host.confirmExternal"),
    revealPath: object("host.revealPath"),
    openPluginsFolder: none("host.openPluginsFolder"),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    contextMenu: object("host.contextMenu"),
    terminal: {
      create: object("host.terminal.create"),
      write: object("host.terminal.write"),
      resize: object("host.terminal.resize"),
      acknowledge: object("host.terminal.acknowledge"),
      idle: object("host.terminal.idle"),
      close: object("host.terminal.close"),
    },
    browser: {
      open: object("host.browser.open"),
      navigate: object("host.browser.navigate"),
      menu: object("host.browser.menu"),
      perform: object("host.browser.perform"),
      close: object("host.browser.close"),
      captureFrame: object("host.browser.captureFrame"),
      find: object("host.browser.find"),
      cancelDownload: object("host.browser.cancelDownload"),
      login: object("host.browser.login"),
      history: object("host.browser.history"),
      forgetHistory: object("host.browser.forgetHistory"),
      focusPage: object("host.browser.focusPage"),
      setBounds: (message: BrowserBoundsMessage) =>
        ipcRenderer.send(BROWSER_BOUNDS_CHANNEL, message),
      setFocus: (message: BrowserFocusMessage) => ipcRenderer.send(BROWSER_FOCUS_CHANNEL, message),
    },
    onEvent(listener: (event: HostEvent) => void) {
      // HOST_EVENT_CHANNEL is private to Nyte main and emits only HostEvent.
      const wrapped = (_event: Electron.IpcRendererEvent, event: HostEvent): void => {
        listener(event);
      };

      ipcRenderer.on(HOST_EVENT_CHANNEL, wrapped);

      return () => {
        ipcRenderer.removeListener(HOST_EVENT_CHANNEL, wrapped);
      };
    },
  },
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld("nyte", bridge);

let windowZoomFactor: number | undefined;

function syncWindowZoom(): void {
  const zoomFactor = webFrame.getZoomFactor();

  if (zoomFactor === windowZoomFactor) return;
  windowZoomFactor = zoomFactor;
  document.documentElement.style.setProperty("--nyte-window-zoom", String(zoomFactor));
  ipcRenderer.send(WINDOW_ZOOM_CHANNEL);
}

window.addEventListener("resize", syncWindowZoom);

// Only Nyte main sends this private channel, and only a boolean.
ipcRenderer.on(WINDOW_FULLSCREEN_CHANNEL, (_event, fullscreen: boolean) => {
  if (fullscreen) document.documentElement.dataset["fullscreen"] = "";
  else delete document.documentElement.dataset["fullscreen"];
});

window.addEventListener(
  "DOMContentLoaded",
  () => {
    document.documentElement.dataset["platform"] = process.platform;
    syncWindowZoom();
  },
  { once: true },
);
