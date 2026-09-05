/**
 * The wire between the Electron main host and the renderer client.
 *
 * The SDK is already wire-shaped (design record, "The SDK"), so the mapping is
 * mechanical: one verb path per SDK verb, the verb's single input object as the
 * payload, its receipt or outcome union as the response. `watch` is the one
 * transport adaptation: an AsyncIterable cannot cross IPC, so it becomes a
 * start/stop pair around a push channel, cursor semantics unchanged.
 */
import type {
  Disposer,
  MentionFile,
  Nyte,
  Seq,
  SessionEvent,
  SessionId,
  ThinkingLevel,
  WorkspaceInfo,
  VcsStatus,
} from "@nyte-ai/core";
import type { Verb } from "@nyte-ai/protocol";
import type { ModelCostRates } from "@nyte-ai/schema";

export const CALL_CHANNEL = "nyte:call";
export const WATCH_START_CHANNEL = "nyte:watch-start";
export const WATCH_STOP_CHANNEL = "nyte:watch-stop";
export const WATCH_EVENT_CHANNEL = "nyte:watch-event";
export const HOST_EVENT_CHANNEL = "nyte:host-event";
export const THEME_PREFERENCE_CHANNEL = "nyte:theme-preference";
export const BROWSER_BOUNDS_CHANNEL = "nyte:browser-bounds";

export type ThemePreference = "system" | "light" | "dark";

/** Every SDK verb the bridge carries, one path per verb. Each is a wire-protocol verb. */
export const SDK_VERB_PATHS = [
  "sessions.create",
  "sessions.get",
  "sessions.snapshot",
  "sessions.list",
  "sessions.rename",
  "sessions.setPinned",
  "sessions.setArchived",
  "sessions.delete",
  "sessions.configure",
  "messages.send",
  "messages.cancel",
  "messages.redeliver",
  "runs.abort",
  "runs.changes",
  "heads.move",
  "workspace.list",
  "workspace.forget",
  "workspace.vcs.diff",
  "provider.models.default",
  "plugins.catalog",
  "plugins.list",
  "plugins.commands.list",
  "plugins.commands.run",
  "plugins.settings.list",
  "plugins.settings.apply",
  "plugins.resources.list",
] as const satisfies readonly Verb[];

export type SdkVerbPath = (typeof SDK_VERB_PATHS)[number];

/** Host verbs beside the SDK: workspace lifecycle and provider auth. */
export const HOST_VERB_PATHS = [
  "host.state",
  "host.fonts",
  "host.openWorkspace",
  "host.pickWorkspace",
  "host.trustWorkspace",
  "host.closeWorkspace",
  "host.catalog",
  "host.login",
  "host.logout",
  "host.setPreference",
  "host.vcs.snapshot",
  "host.files.list",
  "host.github.state",
  "host.github.refresh",
  "host.github.signIn",
  "host.github.signOut",
  "host.openExternal",
  "host.browser.open",
  "host.browser.navigate",
  "host.browser.menu",
  "host.browser.perform",
  "host.browser.close",
  "host.terminal.create",
  "host.terminal.write",
  "host.terminal.resize",
  "host.terminal.acknowledge",
  "host.terminal.close",
] as const;

export type HostVerbPath = (typeof HOST_VERB_PATHS)[number];

export type CallPath = SdkVerbPath | HostVerbPath;

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
  | { readonly watchId: string; readonly kind: "ended"; readonly error?: string };

// ---------------------------------------------------------------------------
// host types
// ---------------------------------------------------------------------------

export interface HostState {
  /** Absent is Cursor's id-only Home target, not the operating-system home folder. */
  readonly workspace: WorkspaceInfo | undefined;
  readonly platform: NodeJS.Platform;
}

/** CSS family names discovered by the native host; font-file paths never cross IPC. */
export interface LocalFontCatalog {
  readonly sans: readonly string[];
  readonly monospace: readonly string[];
}

export type OpenWorkspaceOutcome =
  | { kind: "opened"; workspace: WorkspaceInfo }
  | { kind: "needs_trust"; path: string }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

/** A way to connect a provider from the desktop. */
export type SignInMethod =
  | { readonly kind: "browser"; readonly label: string; readonly subscription: string }
  | { readonly kind: "api_key"; readonly label: string };

export interface ProviderStatus {
  readonly id: string;
  readonly name: string;
  /** Off keeps the provider's models out of the picker and out of the default. */
  readonly enabled: boolean;
  /** `env` names the variable when the key came from the environment rather than the store. */
  readonly connection:
    | { readonly kind: "disconnected" }
    | { readonly kind: "oauth" }
    | { readonly kind: "api_key"; readonly env: string | undefined };
  readonly signIn: readonly SignInMethod[];
}

/** Desktop-local repository identity and cache revision. Core remains provider-neutral. */
export type DesktopVcsSnapshot =
  | {
      readonly kind: "not_repository";
      readonly repositoryId: string;
      readonly revision: "not-repository";
      readonly status: VcsStatus;
    }
  | {
      readonly kind: "repository";
      readonly repositoryId: string;
      readonly revision: string;
      readonly status: VcsStatus;
    };

export interface GitHubRepository {
  readonly owner: string;
  readonly name: string;
  readonly remoteName: string;
  /** Canonical public URL. Remote credentials and raw remote URLs never cross IPC. */
  readonly url: string;
}

export interface GitHubAccount {
  readonly login: string;
  readonly name: string | undefined;
  readonly avatarUrl: string | undefined;
}

export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly draft: boolean;
  readonly headRefName: string;
  readonly baseRefName: string;
}

export type GitHubPullRequestContext =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "error"; readonly message: string };

/** GitHub is optional enrichment; no variant changes local VCS availability. */
export type GitHubProviderState =
  | { readonly kind: "not_github" }
  | { readonly kind: "cli_missing"; readonly repository: GitHubRepository }
  | { readonly kind: "signed_out"; readonly repository: GitHubRepository }
  | {
      readonly kind: "ready";
      readonly repository: GitHubRepository;
      readonly account: GitHubAccount;
      readonly pullRequest: GitHubPullRequestContext;
    }
  | {
      readonly kind: "error";
      readonly repository: GitHubRepository | undefined;
      readonly message: string;
    };

export interface DesktopModelOption {
  readonly key: string;
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  /** Base rates in dollars per million tokens; the picker compares models by them. */
  readonly cost: ModelCostRates;
  readonly fastMode:
    | { readonly kind: "unavailable" }
    | { readonly kind: "available"; readonly settingId: string };
  readonly thinkingLevels: readonly ThinkingLevel[];
  /** Switched off in Settings › Models. */
  readonly hidden: boolean;
  /** In the picker: the provider is on and connected, and the model is not hidden. */
  readonly listed: boolean;
}

/** Everything the picker and Settings › Models draw from, read in one call. */
export interface DesktopCatalog {
  readonly providers: readonly ProviderStatus[];
  readonly models: readonly DesktopModelOption[];
  /** What a new chat starts with. */
  readonly defaults: {
    readonly model: { readonly provider: string; readonly id: string };
    readonly thinkingLevel: ThinkingLevel;
  };
}

export type PreferenceChange =
  | { readonly kind: "provider"; readonly provider: string; readonly enabled: boolean }
  | {
      readonly kind: "models";
      readonly provider: string;
      readonly ids: readonly string[];
      readonly hidden: boolean;
    }
  | {
      readonly kind: "defaults";
      readonly model?: { readonly provider: string; readonly id: string };
      readonly thinkingLevel?: ThinkingLevel;
    };

// ---------------------------------------------------------------------------
// browser surfaces
// ---------------------------------------------------------------------------

/** One embedded page. The surface id is the workbench view key. */
export interface BrowserSurfaceState {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly secure: "https" | "http" | "none";
  /** False when no filter lists are bundled in this build. */
  readonly blocking: boolean;
  /** Requests blocked since the current page started loading. */
  readonly blocked: number;
  readonly error: { readonly code: number; readonly description: string } | undefined;
}

export const BROWSER_ACTIONS = [
  "screenshot",
  "hard-reload",
  "copy-url",
  "clear-history",
  "clear-cookies",
  "clear-cache",
] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];
export type BrowserMenuAction = BrowserAction | "toggle-bookmarks";

export type BrowserNavigationAction = "back" | "forward" | "reload" | "stop";

export interface BrowserBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserBoundsMessage {
  readonly surface: string;
  readonly bounds: BrowserBounds;
  readonly visible: boolean;
}

export interface TerminalInfo {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
}

export type HostEvent =
  | { kind: "terminal_data"; id: string; data: string }
  | { kind: "terminal_exit"; id: string; exitCode: number }
  | { kind: "workspace_opened"; workspace: WorkspaceInfo }
  | { kind: "workspace_trust_required"; path: string }
  | { kind: "workspace_closed" }
  /** A sign-in, sign-out, or preference change; re-read the catalog. */
  | { kind: "catalog_changed" }
  | { kind: "github_changed" }
  | { kind: "status"; message: string }
  | { kind: "browser_changed"; surface: string; state: BrowserSurfaceState }
  | { kind: "browser_download_refused"; surface: string; url: string };

// ---------------------------------------------------------------------------
// the renderer-facing bridge, the SDK interfaces verbatim
// ---------------------------------------------------------------------------

/** Brand an id that crossed the wire. The renderer's route params take this path. */
export function asSessionId(value: string): SessionId {
  if (value === "") throw new Error("Invalid session id: empty");
  // SAFETY: the non-empty check establishes the core SessionId brand invariant.
  return value as SessionId;
}

export type SessionsBridge = Pick<
  Nyte["sessions"],
  | "create"
  | "get"
  | "snapshot"
  | "list"
  | "rename"
  | "setPinned"
  | "setArchived"
  | "delete"
  | "configure"
>;

export type MessagesBridge = Pick<Nyte["messages"], "send" | "cancel" | "redeliver">;

export type RunsBridge = Pick<Nyte["runs"], "abort" | "changes">;

export type HeadsBridge = Pick<Nyte["heads"], "move">;

/** `workspace.list` and `workspace.forget` answer from the registry even when no workspace is open. */
export type WorkspaceBridge = Pick<Nyte["workspace"], "list" | "forget"> & {
  readonly vcs: Pick<Nyte["workspace"]["vcs"], "diff">;
};

export type ProviderBridge = {
  readonly models: Pick<Nyte["provider"]["models"], "default">;
};

export type PluginsBridge = Pick<Nyte["plugins"], "catalog" | "list"> & {
  readonly commands: Pick<Nyte["plugins"]["commands"], "list" | "run">;
  readonly settings: Pick<Nyte["plugins"]["settings"], "list" | "apply">;
  readonly resources: Pick<Nyte["plugins"]["resources"], "list">;
};

export type WatchInput =
  | { sessionId: SessionId; afterSeq?: Seq }
  | { sessionId: SessionId; live: true };

export interface HostBridge {
  /** Keep Electron's native material and controls in the renderer's appearance mode. */
  setThemePreference(preference: ThemePreference): void;
  state(): Promise<HostState>;
  /** Installed UI and fixed-pitch families, discovered without renderer font permissions. */
  fonts(): Promise<LocalFontCatalog>;
  /** Select local history by path, even when the folder is unavailable. */
  openWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  /** Native folder picker, then open. */
  pickWorkspace(): Promise<OpenWorkspaceOutcome>;
  /** Grant trust and open in one step; the renderer's trust dialog confirms first. */
  trustWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  closeWorkspace(): Promise<void>;
  catalog(): Promise<DesktopCatalog>;
  /**
   * Browser sign-in needs a user gesture. An API key crosses IPC once and is
   * never read back; the provider's own login flow stores it.
   */
  login(input: {
    provider: string;
    method: { kind: "browser" } | { kind: "api_key"; key: string };
  }): Promise<void>;
  logout(input: { provider: string }): Promise<void>;
  /** Apply one preference change and answer with the catalog as it now stands. */
  setPreference(change: PreferenceChange): Promise<DesktopCatalog>;
  vcs: {
    /** Revision is desktop cache identity; status still comes from the generic VCS backend. */
    snapshot(): Promise<DesktopVcsSnapshot>;
  };
  files: {
    /** The open workspace's files and folders for `@` mentions; generated trees are skipped. */
    list(): Promise<readonly MentionFile[]>;
  };
  github: {
    state(): Promise<GitHubProviderState>;
    refresh(): Promise<GitHubProviderState>;
    /** The renderer can call this only from a user gesture. `gh` owns the credentials. */
    signIn(): Promise<GitHubProviderState>;
    signOut(): Promise<GitHubProviderState>;
  };
  openExternal(input: { url: string }): Promise<void>;
  terminal: {
    create(input: { id: string; workspacePath: string | null }): Promise<TerminalInfo>;
    write(input: { id: string; data: string }): Promise<void>;
    resize(input: { id: string; cols: number; rows: number }): Promise<void>;
    acknowledge(input: { id: string; length: number }): Promise<void>;
    close(input: { id: string }): Promise<void>;
  };
  browser: {
    open(input: { surface: string; url: string }): Promise<BrowserSurfaceState>;
    navigate(input: { surface: string; action: BrowserNavigationAction }): Promise<void>;
    menu(input: {
      surface: string;
      bookmarksVisible: boolean;
      x: number;
      y: number;
    }): Promise<BrowserMenuAction | undefined>;
    perform(input: { surface: string; action: BrowserAction }): Promise<void>;
    close(input: { surface: string }): Promise<void>;
    setBounds(message: BrowserBoundsMessage): void;
  };
  onEvent(listener: (event: HostEvent) => void): Disposer;
}

/** What `window.nyte` is: the SDK verbatim, plus watch-over-push and the host. */
export interface NyteBridge {
  readonly landing: Nyte["landing"];
  readonly sessions: SessionsBridge;
  readonly messages: MessagesBridge;
  readonly runs: RunsBridge;
  readonly heads: HeadsBridge;
  readonly workspace: WorkspaceBridge;
  readonly provider: ProviderBridge;
  readonly plugins: PluginsBridge;
  /**
   * `onError` hears a watch that ended with an error (the SDK's `watch`
   * threw, or the start itself was refused), so a failure never dissolves
   * into silence.
   */
  watch(
    input: WatchInput,
    onEvent: (event: SessionEvent) => void,
    onError?: (error: Error) => void,
  ): Disposer;
  readonly host: HostBridge;
}

/** The authoritative path-to-method relationship carried by Electron IPC. */
export interface CallMethodByPath {
  readonly "sessions.create": NyteBridge["sessions"]["create"];
  readonly "sessions.get": NyteBridge["sessions"]["get"];
  readonly "sessions.snapshot": NyteBridge["sessions"]["snapshot"];
  readonly "sessions.list": NyteBridge["sessions"]["list"];
  readonly "sessions.rename": NyteBridge["sessions"]["rename"];
  readonly "sessions.setPinned": NyteBridge["sessions"]["setPinned"];
  readonly "sessions.setArchived": NyteBridge["sessions"]["setArchived"];
  readonly "sessions.delete": NyteBridge["sessions"]["delete"];
  readonly "sessions.configure": NyteBridge["sessions"]["configure"];
  readonly "messages.send": NyteBridge["messages"]["send"];
  readonly "messages.cancel": NyteBridge["messages"]["cancel"];
  readonly "messages.redeliver": NyteBridge["messages"]["redeliver"];
  readonly "runs.abort": NyteBridge["runs"]["abort"];
  readonly "runs.changes": NyteBridge["runs"]["changes"];
  readonly "heads.move": NyteBridge["heads"]["move"];
  readonly "workspace.list": NyteBridge["workspace"]["list"];
  readonly "workspace.forget": NyteBridge["workspace"]["forget"];
  readonly "workspace.vcs.diff": NyteBridge["workspace"]["vcs"]["diff"];
  readonly "provider.models.default": NyteBridge["provider"]["models"]["default"];
  readonly "plugins.catalog": NyteBridge["plugins"]["catalog"];
  readonly "plugins.list": NyteBridge["plugins"]["list"];
  readonly "plugins.commands.list": NyteBridge["plugins"]["commands"]["list"];
  readonly "plugins.commands.run": NyteBridge["plugins"]["commands"]["run"];
  readonly "plugins.settings.list": NyteBridge["plugins"]["settings"]["list"];
  readonly "plugins.settings.apply": NyteBridge["plugins"]["settings"]["apply"];
  readonly "plugins.resources.list": NyteBridge["plugins"]["resources"]["list"];
  readonly "host.state": NyteBridge["host"]["state"];
  readonly "host.fonts": NyteBridge["host"]["fonts"];
  readonly "host.openWorkspace": NyteBridge["host"]["openWorkspace"];
  readonly "host.pickWorkspace": NyteBridge["host"]["pickWorkspace"];
  readonly "host.trustWorkspace": NyteBridge["host"]["trustWorkspace"];
  readonly "host.closeWorkspace": NyteBridge["host"]["closeWorkspace"];
  readonly "host.catalog": NyteBridge["host"]["catalog"];
  readonly "host.login": NyteBridge["host"]["login"];
  readonly "host.logout": NyteBridge["host"]["logout"];
  readonly "host.setPreference": NyteBridge["host"]["setPreference"];
  readonly "host.vcs.snapshot": NyteBridge["host"]["vcs"]["snapshot"];
  readonly "host.files.list": NyteBridge["host"]["files"]["list"];
  readonly "host.github.state": NyteBridge["host"]["github"]["state"];
  readonly "host.github.refresh": NyteBridge["host"]["github"]["refresh"];
  readonly "host.github.signIn": NyteBridge["host"]["github"]["signIn"];
  readonly "host.github.signOut": NyteBridge["host"]["github"]["signOut"];
  readonly "host.openExternal": NyteBridge["host"]["openExternal"];
  readonly "host.browser.open": NyteBridge["host"]["browser"]["open"];
  readonly "host.browser.navigate": NyteBridge["host"]["browser"]["navigate"];
  readonly "host.browser.menu": NyteBridge["host"]["browser"]["menu"];
  readonly "host.browser.perform": NyteBridge["host"]["browser"]["perform"];
  readonly "host.browser.close": NyteBridge["host"]["browser"]["close"];
  readonly "host.terminal.create": NyteBridge["host"]["terminal"]["create"];
  readonly "host.terminal.write": NyteBridge["host"]["terminal"]["write"];
  readonly "host.terminal.resize": NyteBridge["host"]["terminal"]["resize"];
  readonly "host.terminal.acknowledge": NyteBridge["host"]["terminal"]["acknowledge"];
  readonly "host.terminal.close": NyteBridge["host"]["terminal"]["close"];
}

export type CallInput<P extends CallPath> =
  Parameters<CallMethodByPath[P]> extends [] ? undefined : Parameters<CallMethodByPath[P]>[0];

export type CallOutput<P extends CallPath> = Awaited<ReturnType<CallMethodByPath[P]>>;

export type CallRequestFor<P extends CallPath> = P extends CallPath
  ? { readonly path: P; readonly input: CallInput<P> }
  : never;

export type CallRequest = { readonly [P in CallPath]: CallRequestFor<P> }[CallPath];

export type CallReplyFor<P extends CallPath> =
  | { readonly path: P; readonly ok: true; readonly value: CallOutput<P> }
  | { readonly path: P; readonly ok: false; readonly message: string };

export type CallReply = { readonly [P in CallPath]: CallReplyFor<P> }[CallPath];
