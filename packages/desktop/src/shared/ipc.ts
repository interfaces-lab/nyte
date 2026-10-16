import type { HostBridge, NyteBridge } from "@nyte-ai/app/bridge.ts";
import type { IpcFailure } from "@nyte-ai/app/errors.ts";

export const CALL_CHANNEL = "nyte:call";

export const HOST_EVENT_CHANNEL = "nyte:host-event";

export const THEME_PREFERENCE_CHANNEL = "nyte:theme-preference";

export const BROWSER_BOUNDS_CHANNEL = "nyte:browser-bounds";

export const BROWSER_FOCUS_CHANNEL = "nyte:browser-focus";

export const WINDOW_ZOOM_CHANNEL = "nyte:window-zoom";

export const WINDOW_FULLSCREEN_CHANNEL = "nyte:window-fullscreen";

export const CANVAS_SHELL_ARGUMENT = "--nyte-canvas-shell";

export const HOST_OPERATION_PATHS = [
  "host.endpoint",
  "host.state",
  "host.fonts",
  "host.usage",
  "host.openWorkspace",
  "host.pickWorkspace",
  "host.trustWorkspace",
  "host.closeWorkspace",
  "host.updates.state",
  "host.updates.check",
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
  "host.browser.find",
  "host.browser.cancelDownload",
  "host.browser.login",
  "host.browser.history",
  "host.browser.forgetHistory",
  "host.browser.focusPage",
  "host.terminal.create",
  "host.terminal.write",
  "host.terminal.resize",
  "host.terminal.acknowledge",
  "host.terminal.idle",
  "host.terminal.close",
] as const;

export type HostOperationPath = (typeof HOST_OPERATION_PATHS)[number];

export type CallPath = HostOperationPath;

export type DesktopBridge = {
  readonly clientSurface: NyteBridge["clientSurface"];
  readonly canvasShell?: NyteBridge["canvasShell"];
  readonly host: Pick<
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
        | "pickWorkspace"
        | "trustWorkspace"
        | "updates"
        | "revealPath"
        | "openPluginsFolder"
        | "contextMenu"
        | "terminal"
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

/** The authoritative path-to-method relationship carried by Electron IPC. */
export type CallMethodByPath = {
  readonly [P in CallPath]: BridgeMethod<DesktopBridge, P>;
};

export type CallInput<P extends CallPath> =
  Parameters<CallMethodByPath[P]> extends [] ? undefined : Parameters<CallMethodByPath[P]>[0];

export type CallOutput<P extends CallPath> = Awaited<ReturnType<CallMethodByPath[P]>>;

export type CallRequestFor<P extends CallPath> = P extends CallPath
  ? { readonly path: P; readonly input: CallInput<P> }
  : never;

export type CallRequest = { readonly [P in CallPath]: CallRequestFor<P> }[CallPath];

export type CallReplyFor<P extends CallPath> =
  | { readonly path: P; readonly ok: true; readonly value: CallOutput<P> }
  | { readonly ok: false; readonly error: IpcFailure };

export type CallReply = { readonly [P in CallPath]: CallReplyFor<P> }[CallPath];
