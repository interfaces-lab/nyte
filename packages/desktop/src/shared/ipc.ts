/**
 * The wire between the Electron main host and the renderer client.
 *
 * The bridge contract itself lives in `@nyte-ai/app/bridge.ts`; this file
 * is how Electron IPC carries it: one channel per concern, one operation path
 * per bridge method, the method's single input object as the payload, its
 * receipt or outcome union as the response. `watch` is the one transport
 * adaptation: an AsyncIterable cannot cross IPC, so it becomes a start/stop
 * pair around a push channel, cursor semantics unchanged.
 */
import type { Operation, Seq, SessionEvent, SessionId } from "@nyte-ai/protocol";
import type { NyteBridge } from "@nyte-ai/app/bridge.ts";
import type { IpcFailure } from "@nyte-ai/app/errors.ts";
export const CALL_CHANNEL = "nyte:call";

export const WATCH_START_CHANNEL = "nyte:watch-start";

export const WATCH_STOP_CHANNEL = "nyte:watch-stop";

export const WATCH_EVENT_CHANNEL = "nyte:watch-event";

export const HOST_EVENT_CHANNEL = "nyte:host-event";

export const THEME_PREFERENCE_CHANNEL = "nyte:theme-preference";

export const BROWSER_BOUNDS_CHANNEL = "nyte:browser-bounds";

export const WINDOW_ZOOM_CHANNEL = "nyte:window-zoom";

/** Every SDK operation the bridge carries, one path per operation. Each is a wire-protocol operation. */
export const SDK_OPERATION_PATHS = [
  "sessions.create",
  "sessions.get",
  "sessions.snapshot",
  "sessions.metadata",
  "sessions.list",
  "sessions.rename",
  "sessions.setPinned",
  "sessions.setArchived",
  "sessions.delete",
  "sessions.configure",
  "messages.send",
  "messages.cancel",
  "messages.redeliver",
  "jobs.list",
  "jobs.start",
  "jobs.background",
  "jobs.cancel",
  "runs.abort",
  "runs.reply",
  "runs.diff",
  "heads.move",
  "workspace.list",
  "workspace.forget",
  "workspace.files",
  "workspace.read",
  "workspace.save",
  "workspace.format",
  "workspace.search",
  "workspace.blame",
  "workspace.vcs.snapshot",
  "workspace.vcs.diff",
  "workspace.vcs.contents",
  "workspace.vcs.log",
  "workspace.vcs.refs",
  "workspace.vcs.stage",
  "workspace.vcs.discard",
  "workspace.vcs.commit",
  "workspace.vcs.createBranch",
  "workspace.vcs.push",
  "provider.models.default",
  "plugins.catalog",
  "plugins.list",
  "plugins.commands.list",
  "plugins.commands.run",
  "plugins.settings.list",
  "plugins.settings.apply",
  "plugins.resources.list",
] as const satisfies readonly Operation[];

export type SdkOperationPath = (typeof SDK_OPERATION_PATHS)[number];

/** Host operations beside the SDK: workspace lifecycle and provider auth. */
export const HOST_OPERATION_PATHS = [
  "host.state",
  "host.sessionDirectory",
  "host.fonts",
  "host.openWorkspace",
  "host.pickWorkspace",
  "host.trustWorkspace",
  "host.closeWorkspace",
  "host.catalog",
  "host.usage",
  "host.accountLimits",
  "host.login",
  "host.cancelLogin",
  "host.logout",
  "host.setPreference",
  "host.github.state",
  "host.github.signIn",
  "host.github.signOut",
  "host.github.createPullRequest",
  "host.server.state",
  "host.server.connect",
  "host.server.disconnect",
  "host.server.createSession",
  "host.remote.state",
  "host.remote.start",
  "host.remote.stop",
  "host.openExternal",
  "host.confirmExternal",
  "host.revealPath",
  "host.contextMenu",
  "host.browser.open",
  "host.browser.navigate",
  "host.browser.menu",
  "host.browser.perform",
  "host.browser.close",
  "host.browser.captureFrame",
  "host.terminal.create",
  "host.terminal.write",
  "host.terminal.resize",
  "host.terminal.acknowledge",
  "host.terminal.idle",
  "host.terminal.close",
] as const;

export type HostOperationPath = (typeof HOST_OPERATION_PATHS)[number];

export type CallPath = SdkOperationPath | HostOperationPath;

export interface WatchStartInput {
  readonly watchId: string;
  readonly sessionId: SessionId;
  /** Replay from this cursor. Omitted with `live` unset replays from the start. */
  readonly afterSeq?: Seq;
  /** Skip replay and start at the tip; `synced` still arrives first. */
  readonly live?: boolean;
}

export type WatchEnvelope =
  | { readonly watchId: string; readonly kind: "event"; readonly event: SessionEvent }
  | { readonly watchId: string; readonly kind: "ended"; readonly error?: IpcFailure };

/** Walk `sessions.create` / `host.github.state` to the matching NyteBridge method. */
type BridgeMethod<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? BridgeMethod<NonNullable<T[Head]>, Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/** The authoritative path-to-method relationship carried by Electron IPC. */
export type CallMethodByPath = {
  readonly [P in CallPath]: BridgeMethod<NyteBridge, P>;
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
