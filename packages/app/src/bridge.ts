/**
 * The contract between the interface and whatever hosts it: the SDK
 * namespaces verbatim, `watch` as a push subscription, and a host namespace
 * for what lives beside the SDK (workspace lifecycle, provider sign-in, files,
 * terminals, browser surfaces). The desktop carries it over Electron IPC; a
 * browser client carries it over `@nyte-ai/client`.
 */
import type {
  AccountUsage,
  BrowserSignIn,
  CatalogModel,
  DeviceCode,
  GitHubProviderState,
  GitHubPullRequestInput,
  GitHubPullRequestOutcome,
  LoginMethod,
  LoginOutcome,
  PreferenceChange,
  ProviderCatalog,
  RemoteNyte,
  Seq,
  ServerInfo,
  SessionEvent,
  SessionId,
  SessionInfo,
  UsageSnapshot,
  UsageWindow,
  WorkspaceInfo,
} from "@nyte-ai/protocol";
import { clientActions } from "./client-actions.ts";

export type {
  AccountUsage,
  BrowserSignIn,
  DeviceCode,
  GitHubAccount,
  GitHubProviderState,
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubPullRequestInput,
  GitHubPullRequestOutcome,
  GitHubRepository,
  LoginMethod,
  LoginOutcome,
  PreferenceChange,
  ProviderStatus,
  SignInMethod,
  UsageEntry,
  UsageReport,
  UsageSession,
  UsageSnapshot,
  UsageSource,
  UsageSubject,
  UsageTotals,
  UsageWindow,
} from "@nyte-ai/protocol";

type Disposer = () => void;

export type ThemePreference = "system" | "light" | "dark";

export type ClientSurface = "desktop" | "web";

export type AppMenuAction =
  | typeof clientActions.newChat.id
  | typeof clientActions.openFolder.id
  | typeof clientActions.newTerminal.id
  | typeof clientActions.newBrowser.id
  | typeof clientActions.settings.id;

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly electron: string;
  readonly chrome: string;
  readonly os: string;
  readonly arch: string;
}

export type AppMenuCommand =
  | { readonly kind: "action"; readonly action: AppMenuAction }
  | { readonly kind: "about"; readonly info: AppInfo };

// ---------------------------------------------------------------------------
// host types
// ---------------------------------------------------------------------------

export type CloudAvailability =
  | { readonly kind: "ready" }
  | { readonly kind: "unavailable"; readonly message: string };

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
      readonly availability: CloudAvailability;
    };

/** Where a session row lives: one local store (`null` is Home) or the configured server. */
export type SessionDirectorySource =
  | { readonly environment: "local"; readonly workspacePath: string | null }
  | { readonly environment: "cloud" };

export type SessionDirectoryChange =
  | {
      readonly kind: "upsert";
      readonly source: SessionDirectorySource;
      readonly session: SessionInfo;
    }
  | { readonly kind: "removed"; readonly sessionId: SessionId }
  | { readonly kind: "dropped"; readonly source: SessionDirectorySource }
  | { readonly kind: "availability"; readonly availability: CloudAvailability };

/** Top-level rows as the host holds them; `revision` is the last change event folded in. */
export interface SessionDirectorySnapshot {
  readonly revision: number;
  readonly directories: readonly WorkspaceSessionDirectory[];
}

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
 * How far remote access reaches. `local` binds loopback, so only this Mac can
 * open it: a browser here, or a simulator. `tailnet` binds this machine's
 * Tailscale address, so the user's own signed-in devices reach it over
 * cellular or any network, and nothing on the local wifi can.
 */
export type RemoteReach = "local" | "tailnet";

/** Why a tailnet reach is not offered, so the UI can say what to fix. */
export type TailnetAvailability =
  | { readonly kind: "ready"; readonly ip: string; readonly name: string | undefined }
  | { readonly kind: "unavailable"; readonly state: string }
  | { readonly kind: "missing" };

/**
 * The local store this desktop is serving to browsers and the iOS app. It
 * starts on the target selected when serving began; a client's
 * `workspace.select` moves it afterwards without touching the Mac's own
 * selection. The token lives for this session alone; stopping discards it.
 * `pairingUrl` opens the web app already connected.
 */
export type RemoteAccessState =
  | { readonly kind: "off"; readonly tailnet: TailnetAvailability }
  | {
      readonly kind: "serving";
      readonly address: string;
      readonly token: string;
      readonly pairingUrl: string;
      readonly reach: RemoteReach;
      readonly target:
        | { readonly kind: "home" }
        | { readonly kind: "project"; readonly workspace: WorkspaceInfo };
    };

export interface HostState {
  /** Absent selects the id-only Home target, not the operating-system home folder. */
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

/**
 * What a running sign-in shows while the provider's flow waits on the user.
 * Device codes and their instructions stay until the attempt ends; messages
 * are the latest word from the flow and never replace a code. The device
 * secret never leaves the host. `browser` names the page to finish on, which
 * only a host that cannot open the serving machine's browser reports.
 */
export type LoginProgress =
  | ({ readonly kind: "device_code" } & DeviceCode)
  | ({ readonly kind: "browser" } & BrowserSignIn)
  | { readonly kind: "message"; readonly message: string };

export type DesktopModelOption = CatalogModel;

/** Everything the picker and Settings › Models draw from, read in one call. */
export type DesktopCatalog = ProviderCatalog;

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
  /** Number of agent (session) holders currently retaining this surface. */
  readonly agentHolders: number;
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

/**
 * Clipboard and selection roles run in the focused web contents, so a native
 * paste keeps the formats a renderer-side clipboard read cannot reach.
 */
export const CONTEXT_MENU_ROLES = ["cut", "copy", "paste", "selectAll"] as const;

export type ContextMenuRole = (typeof CONTEXT_MENU_ROLES)[number];

export type ExternalLinkChoice = "open" | "copy" | "trust" | "cancel";

export type ContextMenuTemplateItem =
  | { readonly kind: "separator" }
  | { readonly kind: "role"; readonly role: ContextMenuRole; readonly label: string }
  | {
      readonly kind: "item";
      readonly label: string;
      /** Electron accelerator shown right-aligned; it is display only here. */
      readonly accelerator?: string;
      readonly enabled?: boolean;
    };

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
  /** The server was connected or disconnected; re-read its state. */
  | { kind: "server_changed" }
  /** Rows changed in the host's session model. Contiguous revisions apply; a gap re-reads the snapshot. */
  | {
      kind: "session_directory";
      revision: number;
      changes: readonly SessionDirectoryChange[];
    }
  /** Remote access started, stopped, or moved folders; re-read its state. */
  | { kind: "remote_access_changed" }
  | { kind: "status"; message: string }
  | { kind: "browser_changed"; surface: string; state: BrowserSurfaceState }
  | { kind: "browser_download_refused"; surface: string; url: string }
  | {
      kind: "browser_agent_opened";
      surface: string;
      /** The chat whose agent opened the page. */
      session: SessionId;
      /** The workspace the page belongs to, or null for home. */
      owner: string | null;
      url: string;
      state: BrowserSurfaceState;
    };

// ---------------------------------------------------------------------------
// the renderer-facing bridge, the SDK interfaces verbatim
// ---------------------------------------------------------------------------

export type SessionsBridge = Pick<
  RemoteNyte["sessions"],
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

export type MessagesBridge = Pick<RemoteNyte["messages"], "send" | "cancel" | "redeliver">;

export type RunsBridge = Pick<RemoteNyte["runs"], "abort" | "reply" | "diff">;

export type HeadsBridge = Pick<RemoteNyte["heads"], "move">;

/** `workspace.list` and `workspace.forget` answer from the registry even when no workspace is open. */
export type WorkspaceBridge = Pick<
  RemoteNyte["workspace"],
  "list" | "forget" | "files" | "read" | "save" | "format" | "search" | "blame" | "vcs"
>;

export type ProviderBridge = {
  readonly models: Pick<RemoteNyte["provider"]["models"], "default">;
};

export type PluginsBridge = Pick<RemoteNyte["plugins"], "catalog" | "list"> & {
  readonly commands: Pick<RemoteNyte["plugins"]["commands"], "list" | "run">;
  readonly settings: Pick<RemoteNyte["plugins"]["settings"], "list" | "apply">;
  readonly resources: Pick<RemoteNyte["plugins"]["resources"], "list">;
};

export type WatchInput =
  | { sessionId: SessionId; afterSeq?: Seq }
  | { sessionId: SessionId; live: true };

export interface TerminalBridge {
  create(input: { id: string; workspacePath: string | null }): Promise<TerminalInfo>;
  write(input: { id: string; data: string }): Promise<void>;
  resize(input: { id: string; cols: number; rows: number }): Promise<void>;
  acknowledge(input: { id: string; length: number }): Promise<void>;
  /** True only when the host can see the shell prompt idle, so closing needs no confirmation. */
  idle(input: { id: string }): Promise<boolean>;
  close(input: { id: string }): Promise<void>;
}

export interface GitHubBridge {
  state(): Promise<GitHubProviderState>;
  /** The renderer can call this only from a user gesture. `gh` owns the credentials. */
  signIn(): Promise<GitHubProviderState>;
  /** Ends a sign-in still waiting for its code; otherwise removes the CLI login. */
  signOut(): Promise<GitHubProviderState>;
  /** Open a pull request for the current branch through `gh`. Needs workspace trust. */
  createPullRequest(input: GitHubPullRequestInput): Promise<GitHubPullRequestOutcome>;
}

export interface BrowserBridge {
  open(input: {
    surface: string;
    url: string;
    owner?: { kind: "home" } | { kind: "project"; path: string };
  }): Promise<BrowserSurfaceState>;
  navigate(input: { surface: string; action: BrowserNavigationAction }): Promise<void>;
  menu(input: {
    surface: string;
    bookmarksVisible: boolean;
    x: number;
    y: number;
  }): Promise<BrowserMenuAction | undefined>;
  perform(input: { surface: string; action: BrowserAction }): Promise<void>;
  close(input: { surface: string }): Promise<void>;
  /**
   * The page's current pixels as a data URL, captured without showing the
   * view. The panel paints it while an overlay forces the page to hide.
   */
  captureFrame(input: { surface: string }): Promise<string | undefined>;
  setBounds(message: BrowserBoundsMessage): void;
}

export interface HostBridge {
  /** Subscribe before main delivers a menu action that reopened the window. */
  onMenuCommand(listener: (command: AppMenuCommand) => void): Disposer;
  /** Keep Electron's native material and controls in the renderer's appearance mode. */
  setThemePreference(preference: ThemePreference): void;
  state(): Promise<HostState>;
  sessionDirectory(): Promise<SessionDirectorySnapshot>;
  /** Installed UI and fixed-pitch families, discovered without renderer font permissions. */
  fonts(): Promise<LocalFontCatalog>;
  /** Select local history by path, even when the folder is unavailable. */
  openWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  /** Native folder picker, then open. Absent where the host has no picker to show. */
  readonly pickWorkspace?: () => Promise<OpenWorkspaceOutcome>;
  /**
   * Grant trust and open in one step; the renderer's trust dialog confirms
   * first. Absent where trust is granted on another machine.
   */
  readonly trustWorkspace?: (input: { path: string }) => Promise<OpenWorkspaceOutcome>;
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
   * and starts once that one has settled. An ID is single-use: one the host
   * still knows, running or recently settled, is refused.
   */
  login(input: { provider: string; method: LoginMethod; attempt: string }): Promise<LoginOutcome>;
  /** Stop a running sign-in. An attempt that already ended is a no-op. */
  cancelLogin(input: { attempt: string }): Promise<void>;
  /**
   * Finish a browser sign-in whose progress `acceptsCode` with the code or
   * redirect address its page ended on. Absent where the host opens that page
   * itself.
   */
  readonly answerLogin?: (input: { attempt: string; code: string }) => Promise<void>;
  logout(input: { provider: string }): Promise<void>;
  /** Apply one preference change and answer with the catalog as it now stands. */
  setPreference(change: PreferenceChange): Promise<DesktopCatalog>;
  /** Absent where no environment answers for `gh`. */
  readonly github?: GitHubBridge;
  server: {
    state(): Promise<ServerState>;
    /** Proves the server answers with this token before remembering either. */
    connect(input: { baseUrl: string; token: string }): Promise<ServerConnectOutcome>;
    disconnect(): Promise<void>;
    /** A new chat on the server; the desktop's selected folder does not change. */
    createSession(): Promise<SessionInfo>;
  };
  remote: {
    state(): Promise<RemoteAccessState>;
    /** Serve the selected local target; a later folder change here does not move it. */
    start(input: { reach: RemoteReach }): Promise<RemoteAccessState>;
    /** Close the listener and its streams. Work a session already accepted continues. */
    stop(): Promise<void>;
  };
  openExternal(input: { url: string }): Promise<void>;
  /** Ask before opening a link that came from conversation content. */
  confirmExternal(input: { url: string }): Promise<ExternalLinkChoice>;
  /** Show a file or folder in the system file manager. Absent where the files live on another machine. */
  readonly revealPath?: (input: { path: string }) => Promise<void>;
  /** The absolute path behind a dropped or picked `File`; empty when nothing on disk backs it. */
  pathForFile(file: File): string;
  /**
   * Pop a native context menu at the cursor and resolve the chosen item's index
   * in `items`, or undefined when it is dismissed. Native menus float above the
   * `WebContentsView`s that browser panels composite over the renderer. Absent
   * where the browser's own menu is the only one.
   */
  readonly contextMenu?: (input: {
    items: readonly ContextMenuTemplateItem[];
    x: number;
    y: number;
  }) => Promise<number | undefined>;
  readonly terminal?: TerminalBridge;
  readonly browser?: BrowserBridge;
  onEvent(listener: (event: HostEvent) => void): Disposer;
}

/** What `window.nyte` is: the SDK verbatim, plus watch-over-push and the host. */
export interface NyteBridge {
  readonly clientSurface: ClientSurface;
  /** The web app's server answers `environment.*`, as `ServerInfo.environment` reported. The desktop always has its own. */
  readonly environment?: true;
  readonly sessions: SessionsBridge;
  readonly messages: MessagesBridge;
  readonly jobs: RemoteNyte["jobs"];
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
