import type { HostBridge, NyteBridge } from "@nyte-ai/app/bridge.ts";
import type { IpcFailure } from "@nyte-ai/app/errors.ts";

export const CALL_CHANNEL = "nyte:call";

export const HOST_EVENT_CHANNEL = "nyte:host-event";

export const THEME_PREFERENCE_CHANNEL = "nyte:theme-preference";

export const BROWSER_BOUNDS_CHANNEL = "nyte:browser-bounds";

export const BROWSER_FOCUS_CHANNEL = "nyte:browser-focus";

export const WINDOW_ZOOM_CHANNEL = "nyte:window-zoom";

export const WINDOW_FULLSCREEN_CHANNEL = "nyte:window-fullscreen";

export const WINDOW_PAINTED_CHANNEL = "nyte:window-painted";

export const HOST_PORT_CHANNEL = "nyte:host-port";

export const CANVAS_SHELL_ARGUMENT = "--nyte-canvas-shell";

export const MACHINE_NAME_ARGUMENT = "--nyte-machine-name";

export const FIRST_WINDOW_ARGUMENT = "--nyte-first-window";

export const MAIN_OPERATION_PATHS = [
  "host.fonts",
  "host.pickWorkspace",
  "host.updates.state",
  "host.updates.check",
  "host.updates.channel",
  "host.updates.setChannel",
  "host.openExternal",
  "host.confirmExternal",
  "host.revealPath",
  "host.openPluginsFolder",
  "host.contextMenu",
  "host.browser.open",
  "host.browser.navigate",
  "host.browser.menu",
  "host.browser.perform",
  "host.browser.close",
  "host.browser.captureFrame",
  "host.browser.pickElement",
  "host.browser.find",
  "host.browser.cancelDownload",
  "host.browser.login",
  "host.browser.history",
  "host.browser.forgetHistory",
] as const;

const HOST_PROCESS_PATHS = [
  "host.endpoint",
  "host.state",
  "host.restore",
  "host.usage",
  "host.openWorkspace",
  "host.trustWorkspace",
  "host.closeWorkspace",
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
  readonly firstWindow: boolean;
  windowPainted(): void;
  readonly canvasShell?: NyteBridge["canvasShell"];
  readonly host: {
    openPort(nonce: string): void;
  } & Pick<
    HostBridge,
    | "onMenuCommand"
    | "setThemePreference"
    | "state"
    | "endpoint"
    | "fonts"
    | "openWorkspace"
    | "closeWorkspace"
    | "server"
    | "remote"
    | "connect"
    | "openExternal"
    | "confirmExternal"
    | "pathForFile"
    | "onEvent"
  > &
    Required<
      Pick<
        HostBridge,
        | "usage"
        | "restore"
        | "pickWorkspace"
        | "trustWorkspace"
        | "updates"
        | "revealPath"
        | "openPluginsFolder"
        | "contextMenu"
        | "browser"
      >
    >;
};

type BridgeMethod<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? BridgeMethod<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
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

export type CallReply = { readonly [P in CallPath]: CallReplyFor<P> }[CallPath];

export type CallHandler<P extends CallPath> = (
  window: number,
  input: CallInput<P>,
) => Promise<CallOutput<P>>;

export type CallTable = { readonly [P in CallPath]?: CallHandler<P> };
