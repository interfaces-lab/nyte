import type { HostBridge, NyteBridge } from "@nyte-ai/app/contract/bridge.ts";
import type { DesktopWindow } from "@nyte-ai/app/contract/desktop-window.ts";
import type { IpcFailure } from "@nyte-ai/app/contract/errors.ts";

export const CALL_CHANNEL = "nyte:call";

export const HOST_EVENT_CHANNEL = "nyte:host-event";

export const THEME_PREFERENCE_CHANNEL = "nyte:theme-preference";

export const BROWSER_SHOWN_CHANNEL = "nyte:browser-shown";

export const BROWSER_FOCUS_CHANNEL = "nyte:browser-focus";

export const WINDOW_ZOOM_CHANNEL = "nyte:window-zoom";

export const WINDOW_FULLSCREEN_CHANNEL = "nyte:window-fullscreen";

export const WINDOW_PAINTED_CHANNEL = "nyte:window-painted";

export const HOST_PORT_CHANNEL = "nyte:host-port";

export const VIEWING_CHANNEL = "nyte:viewing";

export const TERMINAL_NOTIFICATION_CHANNEL = "nyte:terminal-notification";

export const UNSAVED_EDITS_CHANNEL = "nyte:unsaved-edits";

export const WINDOW_WORKSPACE_CHANNEL = "nyte:window-workspace";

export const CANVAS_SHELL_ARGUMENT = "--nyte-canvas-shell";

export const MACHINE_NAME_ARGUMENT = "--nyte-machine-name";

export const WINDOW_ID_ARGUMENT = "--nyte-window";

export const LAUNCH_WINDOWS_ARGUMENT = "--nyte-launch-windows";

export const WINDOW_OPEN_ARGUMENT = "--nyte-open";

export const WINDOW_APP_ARGUMENT = "--nyte-app";

export const APPS_ARGUMENT = "--nyte-apps";

export const MAIN_OPERATION_PATHS = [
  "host.fonts",
  "host.pickWorkspace",
  "host.pickFolder",
  "host.updates.state",
  "host.updates.check",
  "host.updates.channel",
  "host.updates.setChannel",
  "host.hostProcess.state",
  "host.hostProcess.confirm",
  "host.hostProcess.start",
  "host.bundledCli",
  "host.openExternal",
  "host.confirmExternal",
  "host.revealPath",
  "host.openInBrowser",
  "host.openPluginsFolder",
  "host.contextMenu",
  "host.browser.open",
  "host.browser.navigate",
  "host.browser.menu",
  "host.browser.perform",
  "host.browser.close",
  "host.browser.captureFrame",
  "host.browser.design",
  "host.browser.find",
  "host.browser.cancelDownload",
  "host.browser.login",
  "host.browser.history",
  "host.browser.forgetHistory",
  "host.browser.guests",
  "host.browser.attach",
  "host.browser.setEntered",
  "host.switchApp",
] as const;

const HOST_PROCESS_PATHS = [
  "host.endpoint",
  "host.restore",
  "host.usage",
  "host.openWorkspace",
  "host.registerWorkspace",
  "host.trustWorkspace",
  "host.server.state",
  "host.server.connect",
  "host.server.disconnect",
  "host.remote.state",
  "host.remote.start",
  "host.remote.stop",
  "host.remote.configure",
  "host.remote.clear",
  "host.remote.pair",
  "host.remote.revoke",
  "host.remote.configureTailnet",
  "host.remote.signOutTailnet",
  "host.connect.state",
  "host.connect.link",
  "host.connect.cancel",
  "host.connect.setEnabled",
  "host.connect.unlink",
  "host.connect.revokeDevice",
  "host.connect.openAccount",
  "host.connect.signOut",
] as const;

export const HOST_OPERATION_PATHS = [...MAIN_OPERATION_PATHS, ...HOST_PROCESS_PATHS] as const;

type HostOperationPath = (typeof HOST_OPERATION_PATHS)[number];

export type CallPath = HostOperationPath;

export type MainCallPath = (typeof MAIN_OPERATION_PATHS)[number];

export type HostCallPath = (typeof HOST_PROCESS_PATHS)[number];

export type DesktopBridge = {
  readonly clientSurface: NyteBridge["clientSurface"];
  readonly platform: NyteBridge["platform"];
  readonly machineName: NyteBridge["machineName"];
  readonly window: DesktopWindow;
  windowPainted(): void;
  readonly canvasShell?: NyteBridge["canvasShell"];
  readonly apps: NonNullable<NyteBridge["apps"]>;
  readonly host: {
    openPort(nonce: string): void;
  } & Pick<
    HostBridge,
    | "onMenuCommand"
    | "setThemePreference"
    | "endpoint"
    | "fonts"
    | "openWorkspace"
    | "registerWorkspace"
    | "server"
    | "remote"
    | "connect"
    | "openExternal"
    | "confirmExternal"
    | "pathForFile"
    | "onEvent"
    | "switchApp"
  > &
    Required<
      Pick<
        HostBridge,
        | "usage"
        | "restore"
        | "pickWorkspace"
        | "pickFolder"
        | "trustWorkspace"
        | "updates"
        | "hostProcess"
        | "bundledCli"
        | "revealPath"
        | "openInBrowser"
        | "openPluginsFolder"
        | "contextMenu"
        | "browser"
        | "attention"
        | "setUnsavedEdits"
        | "setWorkspacePath"
      >
    >;
};

type BridgeMethod<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? BridgeMethod<T[Head], Rest>
    : never
  : P extends keyof T
    ? NonNullable<T[P]>
    : never;

type CallMethodByPath = {
  readonly [P in CallPath]: BridgeMethod<DesktopBridge, P>;
};

export type CallInput<P extends CallPath> =
  Parameters<CallMethodByPath[P]> extends [] ? undefined : Parameters<CallMethodByPath[P]>[0];

export type CallOutput<P extends CallPath> = Awaited<ReturnType<CallMethodByPath[P]>>;

type CallRequestFor<P extends CallPath> = P extends CallPath
  ? { readonly path: P; readonly input: CallInput<P> }
  : never;

export type CallRequest = { readonly [P in CallPath]: CallRequestFor<P> }[CallPath];

export type CallReplyFor<P extends CallPath> =
  | { readonly path: P; readonly ok: true; readonly value: CallOutput<P> }
  | { readonly ok: false; readonly error: IpcFailure };

export type CallHandler<P extends CallPath> = (
  window: number,
  input: CallInput<P>,
) => Promise<CallOutput<P>>;

export type CallTable = { readonly [P in CallPath]?: CallHandler<P> };
