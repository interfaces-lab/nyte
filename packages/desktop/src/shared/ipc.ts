import type {
  MentionFile,
  WorkspaceFileDocument,
  WorkspaceFileSaveOutcome,
} from "@nyte-ai/core/files";
/**
 * The wire between the Electron main host and the renderer client.
 *
 * The SDK is already wire-shaped (design record, "The SDK"), so the mapping is
 * mechanical: one operation path per SDK operation, the operation's single input object as the
 * payload, its receipt or outcome union as the response. `watch` is the one
 * transport adaptation: an AsyncIterable cannot cross IPC, so it becomes a
 * start/stop pair around a push channel, cursor semantics unchanged.
 */
import type {
  Disposer,
  Nyte,
  Seq,
  SessionEvent,
  SessionId,
  SessionInfo,
  ThinkingLevel,
  UsageSubject,
  WorkspaceInfo,
  VcsStatus,
} from "@nyte-ai/core";
import type { AccountUsage, ClaudeCodeUsage, CodexUsage } from "@nyte-ai/host/usage";
import type { ModelInfo, Operation, ServerInfo } from "@nyte-ai/protocol";
import type { AppMenuCommand } from "./app-menu.ts";
import type { WorkspaceEditorBridge } from "./workspace-editor.ts";
import type { IpcFailure, IpcResult } from "./errors.ts";

/** Editor work is cancellable and owned by the window, rather than a session host. */
export const WORKSPACE_EDITOR_CHANNEL = "nyte:workspace-editor";
export type WorkspaceEditorOperation = keyof WorkspaceEditorBridge;
export type WorkspaceEditorInput<P extends WorkspaceEditorOperation> = Parameters<
  WorkspaceEditorBridge[P]
>[0];
export type WorkspaceEditorOutput<P extends WorkspaceEditorOperation> = Awaited<
  ReturnType<WorkspaceEditorBridge[P]>
>;
export type WorkspaceEditorRequest = {
  [P in WorkspaceEditorOperation]: {
    readonly operation: P;
    readonly input: WorkspaceEditorInput<P>;
  };
}[WorkspaceEditorOperation];
export type WorkspaceEditorReply<P extends WorkspaceEditorOperation> = IpcResult<
  WorkspaceEditorOutput<P>
>;

export const CALL_CHANNEL = "nyte:call";
export const WATCH_START_CHANNEL = "nyte:watch-start";
export const WATCH_STOP_CHANNEL = "nyte:watch-stop";
export const WATCH_EVENT_CHANNEL = "nyte:watch-event";
export const HOST_EVENT_CHANNEL = "nyte:host-event";
export const THEME_PREFERENCE_CHANNEL = "nyte:theme-preference";
export const BROWSER_BOUNDS_CHANNEL = "nyte:browser-bounds";

export type ThemePreference = "system" | "light" | "dark";

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
  "host.vcs.snapshot",
  "host.files.list",
  "host.files.cancelList",
  "host.files.read",
  "host.files.save",
  "host.github.state",
  "host.github.signIn",
  "host.github.signOut",
  "host.server.state",
  "host.server.connect",
  "host.server.disconnect",
  "host.server.createSession",
  "host.mobile.state",
  "host.mobile.start",
  "host.mobile.stop",
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

// ---------------------------------------------------------------------------
// host types
// ---------------------------------------------------------------------------

/** Sessions live in a local store (Home or a folder) or on the configured server. */
export type WorkspaceSessionDirectory =
  | {
      readonly environment: "local";
      readonly workspacePath: string | null;
      readonly sessions: readonly SessionInfo[];
    }
  | {
      readonly environment: "cloud";
      readonly sessions: readonly SessionInfo[];
      readonly availability:
        | { readonly kind: "ready" }
        | { readonly kind: "unavailable"; readonly message: string };
    };

/** The sessions of one local store: `null` is Home. */
export function localSessions(
  directories: readonly WorkspaceSessionDirectory[],
  workspacePath: string | null,
): readonly SessionInfo[] | undefined {
  return directories.find(
    (directory) => directory.environment === "local" && directory.workspacePath === workspacePath,
  )?.sessions;
}

/** The sessions of the connected server, if one is configured. */
export function cloudSessions(
  directories: readonly WorkspaceSessionDirectory[],
): readonly SessionInfo[] | undefined {
  return directories.find((directory) => directory.environment === "cloud")?.sessions;
}

/** The server the desktop reaches, without its token; the renderer never reads that back. */
export type ServerState =
  | { readonly kind: "none" }
  | { readonly kind: "connected"; readonly baseUrl: string; readonly info: ServerInfo }
  | {
      readonly kind: "unavailable";
      readonly baseUrl: string;
      readonly problem: ServerConnectionProblem;
    };

export interface ServerConnectionProblem {
  readonly kind: "authentication" | "network" | "incompatible" | "server";
  readonly message: string;
}

export type ServerConnectOutcome =
  | { readonly kind: "connected"; readonly baseUrl: string; readonly version: string }
  | { readonly kind: "failed"; readonly message: string };

/**
 * The local store this desktop is serving to the iOS app, frozen at the target
 * selected when sharing started. The listener binds 127.0.0.1 only, so the
 * address reaches a simulator on this Mac and nothing else. The token lives
 * for this share alone; stopping discards it.
 */
export type MobileShareState =
  | { readonly kind: "off" }
  | {
      readonly kind: "sharing";
      readonly address: string;
      readonly token: string;
      readonly target:
        | { readonly kind: "home" }
        | { readonly kind: "project"; readonly workspace: WorkspaceInfo };
    };

export interface HostState {
  /** Absent selects the id-only Home target, not the operating-system home folder. */
  readonly workspace: WorkspaceInfo | undefined;
  readonly platform: NodeJS.Platform;
}

export type { WorkspaceFileDocument, WorkspaceFileSaveOutcome } from "@nyte-ai/core/files";

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

/**
 * What a running sign-in shows while the provider's flow waits on the user.
 * Device codes and their instructions stay until the attempt ends; messages
 * are the latest word from the flow and never replace a code. The device
 * secret never leaves main.
 */
export type LoginProgress =
  | {
      readonly kind: "device_code";
      readonly userCode: string;
      readonly verificationUri: string;
      readonly expiresInSeconds: number | undefined;
      readonly instructions: string | undefined;
    }
  | { readonly kind: "message"; readonly message: string };

/**
 * How a sign-in ended without failing. A saved credential is a connection even
 * when the provider's model list could not be fetched afterwards; what the
 * picker then shows for the provider is up to the provider's catalog, which
 * may be empty for an account-specific list until a later refresh succeeds.
 */
export type LoginOutcome =
  | { readonly kind: "connected"; readonly catalogRefreshed: boolean }
  | { readonly kind: "cancelled" };

export interface ProviderStatus {
  readonly id: string;
  readonly name: string;
  /** Off keeps the provider's models out of the picker and out of the default. */
  readonly enabled: boolean;
  /** `env` names the variable when the key came from the environment rather than the store. */
  readonly connection:
    | { readonly kind: "disconnected" }
    | { readonly kind: "server" }
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
  | { readonly kind: "cli_missing"; readonly repository: GitHubRepository | undefined }
  | { readonly kind: "signed_out"; readonly repository: GitHubRepository | undefined }
  | {
      readonly kind: "ready";
      readonly repository: GitHubRepository | undefined;
      readonly account: GitHubAccount;
      readonly pullRequest: GitHubPullRequestContext;
    }
  | {
      readonly kind: "error";
      readonly repository: GitHubRepository | undefined;
      readonly message: string;
    };

export interface DesktopModelOption extends ModelInfo {
  readonly key: string;
  readonly fastMode:
    | { readonly kind: "unavailable" }
    | { readonly kind: "available"; readonly settingId: string };
  /** Switched off in Settings › Models. */
  readonly hidden: boolean;
  /** In the picker: the provider is on and connected, and the model is not hidden. */
  readonly listed: boolean;
}

/** Everything the picker and Settings › Models draw from, read in one call. */
export interface DesktopCatalog {
  readonly source: "local" | "server";
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
// usage
// ---------------------------------------------------------------------------

/**
 * Recorded token counts and execution-time API cost estimates. Reasoning and
 * cache TTL subcounts overlap their owning buckets and are never added twice.
 */
export interface UsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Part of `output`, reported only by providers that split reasoning out. */
  readonly reasoning: number;
  readonly tokens: number;
  /** API-equivalent dollars, not subscription charges. */
  readonly cost: number;
  /** Usage-bearing commits, including compaction and tools, not user turns. */
  readonly turns: number;
}

export type { UsageSubject } from "@nyte-ai/core";
export type { AccountUsage } from "@nyte-ai/host/usage";

/**
 * The window a report covers, in the host's own local days. `sinceDay` is
 * `null` for all time, which is the one window whose start the caller cannot
 * name before reading.
 */
export interface UsageWindow {
  /** `YYYY-MM-DD`, inclusive, or `null` for every retained day. */
  readonly sinceDay: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  readonly untilDay: string;
}

/**
 * One cell of the report: everything the page groups by is a field here, so
 * every card is the same window summed along a different axis. Totals live
 * only on cells, which is what keeps two cards from disagreeing.
 */
export interface UsageEntry {
  /** `YYYY-MM-DD` in the host's own time zone, which is the renderer's too. */
  readonly day: string;
  readonly workspacePath: string | null;
  readonly sessionId: SessionId;
  readonly subject: UsageSubject;
  readonly totals: UsageTotals;
}

/**
 * Names for the sessions the entries reference. Identity only: a chat's spend
 * is summed from its cells, so it is windowed like everything else.
 */
export interface UsageSession {
  readonly sessionId: SessionId;
  readonly name: string | undefined;
  readonly workspacePath: string | null;
  readonly lastActivityAt: number;
}

/**
 * How one store's read went. A store that fails is a row on the page rather
 * than an error screen: the windows that did answer are still worth showing.
 */
export interface UsageSource {
  readonly workspacePath: string | null;
  readonly status: "ok" | "failed";
  /** Sessions read from this store, whether or not they spent in the window. */
  readonly sessions: number;
  readonly message: string | null;
}

/** One window of retained usage in registered desktop stores, folded once per read. */
export interface UsageReport {
  readonly readAt: number;
  /** The resolved window. For an all-time read `sinceDay` is the earliest day. */
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly entries: readonly UsageEntry[];
  readonly sessions: readonly UsageSession[];
  readonly sources: readonly UsageSource[];
  /**
   * Cost and tokens for the equal-length window immediately before this one.
   * Undefined when the read covers all time, or when nothing was retained
   * that far back, since neither has a rate of change to report.
   */
  readonly previous: { readonly cost: number; readonly tokens: number } | undefined;
  /**
   * Earliest retained day in any store, so an empty window can tell the reader
   * where the data actually starts instead of looking like a broken feature.
   */
  readonly earliestDay: string | undefined;
}

/**
 * One read with independent scopes. Claude Code and Codex are read from their
 * own local history and never contribute desktop cells or chats; both readers
 * fold whole histories, so their totals are all-time regardless of the window.
 */
export interface UsageSnapshot extends UsageReport {
  /** A report-wide Nyte read failure, distinct from individual failed stores. */
  readonly nyteError: string | null;
  readonly claudeCode: ClaudeCodeUsage;
  readonly codex: CodexUsage;
}

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
  /** A host mutation (file save, terminal) was refused. Sessions report trust through their activation. */
  | { kind: "workspace_trust_required"; path: string }
  | { kind: "workspace_closed" }
  /** A sign-in, sign-out, or preference change; re-read the catalog. */
  | { kind: "catalog_changed" }
  | { kind: "github_changed" }
  /** A running sign-in has something to show. `attempt` is the ID the renderer chose for it. */
  | { kind: "login_progress"; attempt: string; provider: string; progress: LoginProgress }
  /** The server was connected or disconnected; re-read its state and the directory. */
  | { kind: "server_changed" }
  /** Sharing with the iOS app started or stopped; re-read its state. */
  | { kind: "mobile_share_changed" }
  | { kind: "status"; message: string }
  | { kind: "browser_changed"; surface: string; state: BrowserSurfaceState }
  | { kind: "browser_download_refused"; surface: string; url: string };

// ---------------------------------------------------------------------------
// the renderer-facing bridge, the SDK interfaces verbatim
// ---------------------------------------------------------------------------

export type SessionsBridge = Pick<
  Nyte["sessions"],
  | "create"
  | "get"
  | "snapshot"
  | "metadata"
  | "list"
  | "rename"
  | "setPinned"
  | "setArchived"
  | "delete"
  | "configure"
>;

export type MessagesBridge = Pick<Nyte["messages"], "send" | "cancel" | "redeliver">;

export type RunsBridge = Pick<Nyte["runs"], "abort" | "reply">;

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
  /** Subscribe before main delivers a menu action that reopened the window. */
  onMenuCommand(listener: (command: AppMenuCommand) => void): Disposer;
  /** Keep Electron's native material and controls in the renderer's appearance mode. */
  setThemePreference(preference: ThemePreference): void;
  state(): Promise<HostState>;
  sessionDirectory(): Promise<readonly WorkspaceSessionDirectory[]>;
  /** Installed UI and fixed-pitch families, discovered without renderer font permissions. */
  fonts(): Promise<LocalFontCatalog>;
  /** Select local history by path, even when the folder is unavailable. */
  openWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  /** Native folder picker, then open. */
  pickWorkspace(): Promise<OpenWorkspaceOutcome>;
  /** Grant trust and open in one step; the renderer's trust dialog confirms first. */
  trustWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  closeWorkspace(): Promise<void>;
  /** A session reads its owning host's catalog. Omit the input for local provider settings. */
  catalog(input?: { readonly sessionId: SessionId }): Promise<DesktopCatalog>;
  /**
   * Fold retained history from Home and registered desktop workspace stores
   * for one window. The window is the request, not a client-side slice, so
   * desktop figures are scoped to the same days. Claude Code is a separate
   * all-time local-history snapshot, independent of this window.
   */
  usage(input: UsageWindow): Promise<UsageSnapshot>;
  /**
   * The subscription windows the signed-in Anthropic and OpenAI accounts
   * report. This is the only usage read that leaves the machine, so the page
   * asks for it once per visit and never on a timer.
   */
  accountLimits(): Promise<readonly AccountUsage[]>;
  /**
   * Browser sign-in needs a user gesture. An API key crosses IPC once and is
   * never read back; the provider's own login flow stores it. `attempt` is a
   * renderer-chosen ID that correlates progress events and a later cancel with
   * this call; a new attempt for the same provider cancels the previous one
   * and starts once that one has settled. An ID stays taken until its attempt
   * has settled, so reusing one that was just cancelled is refused.
   */
  login(input: {
    provider: string;
    method: { kind: "browser" } | { kind: "api_key"; key: string };
    attempt: string;
  }): Promise<LoginOutcome>;
  /** Stop a running sign-in. An attempt that already ended is a no-op. */
  cancelLogin(input: { attempt: string }): Promise<void>;
  logout(input: { provider: string }): Promise<void>;
  /** Apply one preference change and answer with the catalog as it now stands. */
  setPreference(change: PreferenceChange): Promise<DesktopCatalog>;
  vcs: {
    /** Revision is desktop cache identity; status still comes from the generic VCS backend. */
    snapshot(): Promise<DesktopVcsSnapshot>;
  };
  files: WorkspaceEditorBridge & {
    /** Files and their parent folders offered for `@` mentions. */
    list(input: { requestId: string }): Promise<readonly MentionFile[]>;
    cancelList(input: { requestId: string }): Promise<void>;
    read(input: { path: string }): Promise<WorkspaceFileDocument>;
    save(input: {
      path: string;
      contents: string;
      version: string;
    }): Promise<WorkspaceFileSaveOutcome>;
  };
  github: {
    state(): Promise<GitHubProviderState>;
    /** The renderer can call this only from a user gesture. `gh` owns the credentials. */
    signIn(): Promise<GitHubProviderState>;
    signOut(): Promise<GitHubProviderState>;
  };
  server: {
    state(): Promise<ServerState>;
    /** Proves the server answers with this token before remembering either. */
    connect(input: { baseUrl: string; token: string }): Promise<ServerConnectOutcome>;
    disconnect(): Promise<void>;
    /** A new chat on the server; the desktop's selected folder does not change. */
    createSession(): Promise<SessionInfo>;
  };
  mobile: {
    state(): Promise<MobileShareState>;
    /** Serve the selected local target on loopback; a later folder change does not move the share. */
    start(): Promise<MobileShareState>;
    /** Close the listener and its streams. Work a session already accepted continues. */
    stop(): Promise<void>;
  };
  openExternal(input: { url: string }): Promise<void>;
  terminal: {
    create(input: { id: string; workspacePath: string | null }): Promise<TerminalInfo>;
    write(input: { id: string; data: string }): Promise<void>;
    resize(input: { id: string; cols: number; rows: number }): Promise<void>;
    acknowledge(input: { id: string; length: number }): Promise<void>;
    /** True only when the host can see the shell prompt idle, so closing needs no confirmation. */
    idle(input: { id: string }): Promise<boolean>;
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
  readonly jobs: Nyte["jobs"];
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
  readonly "sessions.metadata": NyteBridge["sessions"]["metadata"];
  readonly "sessions.list": NyteBridge["sessions"]["list"];
  readonly "sessions.rename": NyteBridge["sessions"]["rename"];
  readonly "sessions.setPinned": NyteBridge["sessions"]["setPinned"];
  readonly "sessions.setArchived": NyteBridge["sessions"]["setArchived"];
  readonly "sessions.delete": NyteBridge["sessions"]["delete"];
  readonly "sessions.configure": NyteBridge["sessions"]["configure"];
  readonly "messages.send": NyteBridge["messages"]["send"];
  readonly "messages.cancel": NyteBridge["messages"]["cancel"];
  readonly "messages.redeliver": NyteBridge["messages"]["redeliver"];
  readonly "jobs.list": NyteBridge["jobs"]["list"];
  readonly "jobs.start": NyteBridge["jobs"]["start"];
  readonly "jobs.background": NyteBridge["jobs"]["background"];
  readonly "jobs.cancel": NyteBridge["jobs"]["cancel"];
  readonly "runs.abort": NyteBridge["runs"]["abort"];
  readonly "runs.reply": NyteBridge["runs"]["reply"];
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
  readonly "host.sessionDirectory": NyteBridge["host"]["sessionDirectory"];
  readonly "host.fonts": NyteBridge["host"]["fonts"];
  readonly "host.openWorkspace": NyteBridge["host"]["openWorkspace"];
  readonly "host.pickWorkspace": NyteBridge["host"]["pickWorkspace"];
  readonly "host.trustWorkspace": NyteBridge["host"]["trustWorkspace"];
  readonly "host.closeWorkspace": NyteBridge["host"]["closeWorkspace"];
  readonly "host.catalog": NyteBridge["host"]["catalog"];
  readonly "host.usage": NyteBridge["host"]["usage"];
  readonly "host.accountLimits": NyteBridge["host"]["accountLimits"];
  readonly "host.login": NyteBridge["host"]["login"];
  readonly "host.cancelLogin": NyteBridge["host"]["cancelLogin"];
  readonly "host.logout": NyteBridge["host"]["logout"];
  readonly "host.setPreference": NyteBridge["host"]["setPreference"];
  readonly "host.vcs.snapshot": NyteBridge["host"]["vcs"]["snapshot"];
  readonly "host.files.list": NyteBridge["host"]["files"]["list"];
  readonly "host.files.cancelList": NyteBridge["host"]["files"]["cancelList"];
  readonly "host.files.read": NyteBridge["host"]["files"]["read"];
  readonly "host.files.save": NyteBridge["host"]["files"]["save"];
  readonly "host.github.state": NyteBridge["host"]["github"]["state"];
  readonly "host.github.signIn": NyteBridge["host"]["github"]["signIn"];
  readonly "host.github.signOut": NyteBridge["host"]["github"]["signOut"];
  readonly "host.server.state": NyteBridge["host"]["server"]["state"];
  readonly "host.server.connect": NyteBridge["host"]["server"]["connect"];
  readonly "host.server.disconnect": NyteBridge["host"]["server"]["disconnect"];
  readonly "host.server.createSession": NyteBridge["host"]["server"]["createSession"];
  readonly "host.mobile.state": NyteBridge["host"]["mobile"]["state"];
  readonly "host.mobile.start": NyteBridge["host"]["mobile"]["start"];
  readonly "host.mobile.stop": NyteBridge["host"]["mobile"]["stop"];
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
  readonly "host.terminal.idle": NyteBridge["host"]["terminal"]["idle"];
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
  | { readonly ok: false; readonly error: IpcFailure };

export type CallReply = { readonly [P in CallPath]: CallReplyFor<P> }[CallPath];
