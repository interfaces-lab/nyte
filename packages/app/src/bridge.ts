/**
 * The contract between the interface and whatever hosts it: where the host's
 * listener is (the interface connects to it with `@nyte-ai/sdk`), and a host
 * namespace for what lives beside the sdk (workspace selection, files on this
 * machine, terminals, browser surfaces, usage history, GitHub). The desktop
 * carries it over Electron IPC; the web app supplies its own.
 */
import type { CredentialSource, SessionId, Usage, WorkspaceId } from "@nyte-ai/sdk";
import type { ConnectionProblem, HostEndpoint } from "./sdk.tsx";
import { clientActions } from "./client-actions.ts";

type Disposer = () => void;

/**
 * `~/.nyte/settings.json` on the machine the desktop runs on, as main reads
 * it. Keys the terminal UI shares sit beside the desktop's own; main owns the
 * file, the renderer only asks for a patch.
 */
export interface HostSettings {
  readonly cacheWarming: "off" | "streaming" | "idle";
  readonly autoCompaction: boolean;
  readonly compactionKeepRecentTokens: number;
  readonly compactionReserveTokens: number;
  readonly traceEndpoint: string | null;
  readonly workspaceTrust: "ask" | "always" | "never";
  readonly notifications: boolean;
  readonly unreadBadge: boolean;
  readonly keepAwake: boolean;
  readonly terminalShell: string | null;
  readonly blockAds: boolean;
  readonly adblockAllowedHosts: readonly string[];
  readonly upgradeToHttps: boolean;
  readonly browserAccess: "ask" | "full" | "read" | "off";
}

/** One key of the settings file. */
export type HostSettingKey = keyof HostSettings;

/** A change to some keys of the settings file. */
export type HostSettingsPatch = Partial<HostSettings>;

/** Days in the serving machine's time zone. */
export interface UsageWindow {
  /** `YYYY-MM-DD`, inclusive, or `null` for every retained day. */
  readonly sinceDay: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  readonly untilDay: string;
}

/** Recorded tokens and API-equivalent cost. `reasoning` is part of `output`. */
export interface UsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;
  readonly tokens: number;
  readonly cost: number;
  readonly cacheSavings: number;
}

/** What a usage entry was spent on: a model, tools, or compaction. */
export type UsageSubject =
  | { readonly kind: "model"; readonly provider: string; readonly model: string }
  | { readonly kind: "tool" }
  | { readonly kind: "compaction" };

/** One day, workspace, chat, and subject. Totals live only on entries. */
export interface UsageEntry {
  readonly day: string;
  readonly workspacePath: string | null;
  readonly sessionId: SessionId;
  readonly subject: UsageSubject;
  readonly totals: UsageTotals;
}

/** A chat a usage report names. */
export interface UsageSession {
  readonly sessionId: SessionId;
  readonly name?: string;
  readonly workspacePath: string | null;
  readonly lastActivityAt: number;
}

/** How one store's read went. A failed store is a row, not a failed report. */
export interface UsageSource {
  readonly workspacePath: string | null;
  readonly status: "ok" | "failed";
  readonly sessions: number;
  readonly message: string | null;
}

/** Usage entries over a window of days, with the chats and stores they came from. */
export interface UsageReport {
  readonly readAt: number;
  /** The resolved window. An all-time read starts at the earliest retained day. */
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly entries: readonly UsageEntry[];
  readonly sessions: readonly UsageSession[];
  readonly sources: readonly UsageSource[];
  /** The equal-length window just before this one, when history reaches that far. */
  readonly previous?: { readonly cost: number; readonly tokens: number };
  readonly earliestDay?: string;
}

/** One model's turns and usage in another tool's history. */
export interface ModelUsage {
  readonly provider: string;
  readonly model: string;
  readonly turns: number;
  readonly usage: Usage;
}

/** Another tool's history summed by model, compaction and tools. */
export interface UsageSummary {
  readonly models: readonly ModelUsage[];
  readonly compaction: Usage;
  readonly tools: Usage;
  readonly total: Usage;
  readonly cacheSavings: number;
}

/** Another tool's own history on the serving machine, kept apart from Nyte's entries. */
export type LocalHistoryUsage =
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly summary: UsageSummary;
      readonly unpricedRecords: number;
      readonly malformedRecords: number;
      readonly unreadableFiles: number;
    };

/** Retained usage on the serving machine: Nyte's stores, and Claude Code's and Codex's own history. */
export interface UsageSnapshot extends UsageReport {
  /** The whole Nyte read failed, apart from any single failed store. */
  readonly nyteError: string | null;
  readonly claudeCode: LocalHistoryUsage;
  readonly codex: LocalHistoryUsage;
}

/** A code the user enters at `verificationUri`. It stays until the attempt ends. */
export interface DeviceCode {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresInSeconds?: number;
  readonly instructions?: string;
}

/** The GitHub repository the selected folder's remote names. */
export interface GitHubRepository {
  readonly owner: string;
  readonly name: string;
  readonly remoteName: string;
  /** The canonical public URL. Remote credentials and raw remote URLs never cross. */
  readonly url: string;
}

/** The account `gh` is signed in as. */
export interface GitHubAccount {
  readonly login: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

/** A pull request for the checked-out branch. */
export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly draft: boolean;
  readonly headRefName: string;
  readonly baseRefName: string;
}

/** Whether the checked-out branch has a pull request. */
export type GitHubPullRequestContext =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "error"; readonly message: string };

/** What opening a pull request takes. */
export interface GitHubPullRequestInput {
  readonly title: string;
  readonly body?: string;
  readonly draft?: boolean;
}

/** Every state `gh` can leave a pull request request in; `exists` carries the one already open. */
export type GitHubPullRequestOutcome =
  | { readonly kind: "created"; readonly url: string }
  | { readonly kind: "exists"; readonly pullRequest: GitHubPullRequest }
  | { readonly kind: "cli_missing" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "no_remote" }
  | { readonly kind: "failed"; readonly message: string };

/** The serving machine's GitHub CLI login and the repository of the selected folder. */
export type GitHubProviderState =
  | { readonly kind: "cli_missing"; readonly repository?: GitHubRepository }
  | { readonly kind: "signed_out"; readonly repository?: GitHubRepository }
  | {
      readonly kind: "signing_in";
      readonly repository?: GitHubRepository;
      readonly deviceCode: DeviceCode;
    }
  | {
      readonly kind: "ready";
      readonly repository?: GitHubRepository;
      readonly account: GitHubAccount;
      readonly pullRequest: GitHubPullRequestContext;
    }
  | {
      readonly kind: "error";
      readonly repository?: GitHubRepository;
      readonly message: string;
    };

export type ThemePreference = "system" | "light" | "dark";

export type ClientSurface = "desktop" | "web";

/** The window commands the menu bar sends; the renderer runs each as its shortcut would. */
export type AppMenuAction =
  | typeof clientActions.newChat.id
  | typeof clientActions.newTab.id
  | typeof clientActions.closeTab.id
  | typeof clientActions.reopenTab.id
  | typeof clientActions.openFolder.id
  | typeof clientActions.newTerminal.id
  | typeof clientActions.newBrowser.id
  | typeof clientActions.settings.id
  | typeof clientActions.search.id
  | typeof clientActions.sidebar.id
  | typeof clientActions.workbench.id
  | typeof clientActions.terminal.id
  | typeof clientActions.splitRight.id
  | typeof clientActions.splitDown.id
  | typeof clientActions.back.id
  | typeof clientActions.forward.id
  | typeof clientActions.focusPane.id;

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

/** The server the desktop reaches, without its token; the renderer never reads that back. */
export type ServerState =
  | { readonly kind: "none" }
  | {
      readonly kind: "connected";
      readonly baseUrl: string;
      readonly version: string;
    }
  | {
      readonly kind: "unavailable";
      readonly baseUrl: string;
      readonly problem: ServerConnectionProblem;
    };

export type ServerConnectionProblem = ConnectionProblem;

export type ServerConnectOutcome =
  | { readonly kind: "connected"; readonly baseUrl: string; readonly version: string }
  | { readonly kind: "failed"; readonly message: string };

/**
 * How far remote access reaches. `local` binds loopback, so only this Mac can
 * open it: a browser here, or a simulator. `tailnet` binds this machine's
 * Tailscale address, so the user's own signed-in devices reach it over
 * cellular or any network, and nothing on the local wifi can. `cloudflare`
 * binds a fixed loopback port that the user's own Cloudflare named tunnel
 * publishes at a hostname they own; Nyte runs `cloudflared` only while serving.
 */
export type RemoteReach = "local" | "tailnet" | RemoteAccessPluginId;

/** The built-in desktop remote-access plugins, each serving the reach of the same name. */
export type RemoteAccessPluginId = "cloudflare";

/** Why a tailnet reach is not offered, so the UI can say what to fix. */
export type TailnetAvailability =
  | { readonly kind: "ready"; readonly ip: string; readonly name: string | undefined }
  | { readonly kind: "unavailable"; readonly state: string }
  | { readonly kind: "missing" };

/** The tunnel the user created in the Cloudflare dashboard. */
export interface CloudflareTunnelSettings {
  /** The public hostname routed to this Mac, without scheme or path. */
  readonly hostname: string;
  /** The loopback port the dashboard's Service URL names. */
  readonly port: number;
  /** The tunnel's connector token. It crosses IPC once and is never read back. */
  readonly tunnelToken: string;
}

/** A device paired over the tunnel. Only a digest of its token is kept. */
export interface RemoteDevice {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly state:
    | { readonly kind: "pending"; readonly expiresAt: number }
    | { readonly kind: "paired"; readonly pairedAt: number };
}

/** Why the connector stopped by itself. The renderer owns the copy; no tool output crosses IPC. */
export type TunnelFailure = "ingress_mismatch" | "ingress_unverified" | "exited";

/**
 * Where `cloudflared` stands. `connected` means it holds a connection and the
 * dashboard's public-hostname routes send only this hostname to this listener.
 * Private network routes on the tunnel are invisible to the connector and
 * are not checked.
 */
export type TunnelConnection =
  | { readonly kind: "stopped" }
  | { readonly kind: "connecting" }
  | { readonly kind: "connected"; readonly connections: number }
  | { readonly kind: "retrying"; readonly attempt: number }
  | { readonly kind: "failed"; readonly reason: TunnelFailure };

/** The Cloudflare plugin as Settings shows it: no tunnel token, no device token. */
export type CloudflareTunnelView =
  /** No plugin is registered here, as in the web app. */
  | { readonly kind: "unregistered" }
  /** Its settings file cannot be read or written; nothing is accepted until that is fixed. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "unconfigured"; readonly cloudflaredInstalled: boolean }
  | {
      readonly kind: "configured";
      readonly hostname: string;
      readonly port: number;
      readonly cloudflaredInstalled: boolean;
      readonly connection: TunnelConnection;
      readonly devices: readonly RemoteDevice[];
    };

/** A new device's credential. The host returns it once and keeps only its digest. */
export interface RemotePairing {
  readonly deviceId: string;
  /** The public `https://` address the device connects to. */
  readonly address: string;
  readonly token: string;
  readonly expiresAt: number;
}

export type ServedTarget =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: SelectedWorkspace };

/**
 * The local store this desktop is serving to browsers and the iOS app. It
 * starts on the target selected when serving began; a client's
 * `workspace.select` moves it afterwards without touching the Mac's own
 * selection. A local or tailnet token lives for this session alone; stopping
 * discards it. `pairingUrl` opens the web app already connected. A tunnel
 * reach accepts the plugin's paired devices instead of one token.
 */
export type RemoteAccessState =
  | {
      readonly kind: "off";
      readonly tailnet: TailnetAvailability;
      readonly cloudflare: CloudflareTunnelView;
    }
  | {
      readonly kind: "serving";
      readonly reach: "local" | "tailnet";
      readonly address: string;
      readonly token: string;
      readonly pairingUrl: string;
      readonly target: ServedTarget;
      readonly cloudflare: CloudflareTunnelView;
    }
  | {
      readonly kind: "serving";
      readonly reach: RemoteAccessPluginId;
      readonly address: string;
      readonly target: ServedTarget;
      readonly cloudflare: CloudflareTunnelView;
    };

import type { ConnectView } from "@nyte-ai/connect";

export type {
  ConnectAccount,
  ConnectDevice,
  ConnectLease,
  ConnectLinkFailure,
  ConnectLinking,
  ConnectNotice,
  ConnectRelay,
  ConnectUnavailable,
  ConnectView,
} from "@nyte-ai/connect";

/**
 * Account remote access over IPC. Every call is local; nothing here is served
 * to remote clients. Session JWTs move between the sign-in dialog and main and
 * never reach this renderer.
 */
export interface ConnectBridge {
  state(): Promise<ConnectView>;
  /** Opens the sign-in dialog if needed, then links this Mac. The answer says how it ended. */
  link(): Promise<ConnectView>;
  /** Abandon a link in progress. */
  cancel(): Promise<void>;
  /** Persist the toggle. On starts serving under the existing folder trust; off stops. */
  setEnabled(input: { enabled: boolean }): Promise<ConnectView>;
  /** Refuse every account device here first, then remove the link at the broker, retrying if offline. */
  unlink(): Promise<void>;
  /** Refuse the device here at once and close its streams, then revoke it at the broker. */
  revokeDevice(input: { deviceId: string }): Promise<void>;
  openAccount(): Promise<void>;
  /** Sign out of the account on this Mac. Remote access stays on. */
  signOut(): Promise<void>;
}

/** The folder a window has selected: its workspace on the host, and the path and name the shell shows. */
export interface SelectedWorkspace {
  readonly id: WorkspaceId;
  readonly path: string;
  readonly name: string;
}

export interface HostState {
  /** Absent selects the id-only Home target, not the operating-system home folder. */
  readonly workspace: SelectedWorkspace | undefined;
  readonly platform: NodeJS.Platform;
  /** This computer's name. The web app's host has none to give. */
  readonly machineName?: string;
  /**
   * The host's verified identity and the principal it named this client.
   * Present on registry hosts, where the selected folder and anything queued
   * for it belong to this binding and no other.
   */
  readonly binding?: { readonly hostId: string; readonly principal: string };
}

/** CSS family names discovered by the native host; font-file paths never cross IPC. */
export interface LocalFontCatalog {
  readonly sans: readonly string[];
  readonly monospace: readonly string[];
}

/**
 * What the host showed the owner before asking for trust: the host, the
 * registry row, and the directory it named at that moment. The grant echoes
 * exactly this, so consent binds to what was seen; a directory that changed
 * since is refused by the host and asked about again.
 */
export interface TrustConsent {
  readonly hostId: string;
  readonly id: string;
  readonly path: string;
  readonly identity: string;
}

export type OpenWorkspaceOutcome =
  /** The folder is current. `needsTrust`: it carries project input and no decision yet, so ask now. */
  | { kind: "opened"; workspace: SelectedWorkspace; needsTrust: boolean }
  /** The host would not make the folder current until it is trusted there; a remote server's answer. */
  | { kind: "needs_trust"; path: string; consent?: TrustConsent }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

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
  /**
   * `off` when the setting is off or no filter lists are bundled in this build;
   * `paused` when the page's host is on the allow list.
   */
  readonly blocking: "on" | "paused" | "off";
  /** Requests blocked since the current page started loading. */
  readonly blocked: number;
  readonly error: BrowserPageError | undefined;
  /** Number of agent (session) holders currently retaining this surface. */
  readonly agentHolders: number;
  /** A `<video>` or the page asked for fullscreen; the page covers the whole window. */
  readonly fullscreen: boolean;
  /** Permissions the page asked for and Nyte refused since this page started loading. */
  readonly deniedPermissions: readonly string[];
}

export interface BrowserPageError {
  readonly code: number;
  readonly description: string;
  /** A local host whose certificate failed; the user may choose to proceed. */
  readonly untrustedHost?: string;
}

/** A file a user-held page is saving to the Downloads folder. */
export interface BrowserDownload {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
  readonly path: string;
  readonly received: number;
  /** 0 when the server did not say. */
  readonly total: number;
  readonly state: "progressing" | "completed" | "cancelled" | "interrupted";
}

/** The position of the active match among all matches; both 0 when nothing matched. */
export interface BrowserFindResult {
  readonly active: number;
  readonly total: number;
}

/** A page a user-held tab visited. History is per cookie jar and newest first. */
export interface BrowserHistoryEntry {
  readonly url: string;
  readonly title: string;
  /** Milliseconds since the epoch. */
  readonly visitedAt: number;
  readonly visits: number;
}

export type BrowserAction =
  | "screenshot"
  | "copy-url"
  | "clear-history"
  | "clear-cookies"
  | "clear-cache";

export type BrowserMenuAction = BrowserAction | "hard-reload" | "toggle-bookmarks";

export type BrowserNavigationAction =
  | "back"
  | "forward"
  | "reload"
  | "hard-reload"
  | "stop"
  | "trust-certificate"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "toggle-devtools";

/** A keydown the focused page left unhandled, as its guest preload saw it. */
export interface BrowserKey {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
}

/**
 * Clipboard and selection roles run in the focused web contents, so a native
 * paste keeps the formats a renderer-side clipboard read cannot reach.
 */
export type ContextMenuRole = "cut" | "copy" | "paste" | "selectAll";

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

/** Keyboard focus entered or left a panel's own controls: the address bar, the toolbar, find. */
export interface BrowserFocusMessage {
  readonly surface: string;
  readonly focused: boolean;
}

/** A found release downloads at once; the renderer only ever hears about the download. */
export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "downloading"; readonly version: string; readonly percent: number }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "installing"; readonly version: string }
  | { readonly kind: "failed"; readonly version: string; readonly message: string };

export type HostEvent =
  | { kind: "update_changed"; state: UpdateState }
  /** settings.json changed: from any window, the terminal UI, or a hand edit. */
  | { kind: "settings_changed"; settings: HostSettings }
  | { kind: "workspace_opened"; workspace: SelectedWorkspace }
  /** A host mutation (file save, terminal) was refused. Sessions report trust through their activation. */
  | { kind: "workspace_trust_required"; path: string }
  | { kind: "workspace_closed" }
  | { kind: "github_changed" }
  /** The server was connected or disconnected; re-read its state. */
  | { kind: "server_changed" }
  /** Remote access started, stopped, or moved folders; re-read its state. */
  | { kind: "remote_access_changed" }
  | { kind: "status"; message: string }
  | { kind: "browser_changed"; surface: string; state: BrowserSurfaceState }
  | { kind: "browser_download"; surface: string; download: BrowserDownload }
  /** The page asked for a new tab: a Cmd+click, a `target="_blank"` link. */
  | { kind: "browser_open_tab"; surface: string; url: string; background: boolean }
  /** The focused page left a key unhandled; the panel showing it treats it as its own keydown. */
  | { kind: "browser_key"; surface: string; key: BrowserKey }
  /** The page answered 401 with a Basic or Digest challenge; the panel asks for credentials. */
  | { kind: "browser_login_requested"; surface: string; host: string; realm: string }
  /** A cookie jar's history changed: the workspace path, or null for home, and all its entries. */
  | {
      kind: "browser_history_changed";
      owner: string | null;
      entries: readonly BrowserHistoryEntry[];
    }
  | {
      kind: "browser_agent_opened";
      /** The workspace the page belongs to, or null for home. */
      owner: string | null;
      url: string;
    };

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
    /** The panel's cookie jar, named when a clear asks to confirm. */
    owner: string | null;
  }): Promise<BrowserMenuAction | undefined>;
  perform(input: {
    surface: string;
    action: BrowserAction;
    /** The panel's cookie jar, for a new tab main holds no page for. */
    owner: string | null;
  }): Promise<void>;
  close(input: { surface: string }): Promise<void>;
  /**
   * The page's current pixels as a data URL, captured without showing the
   * view. The panel paints it while an overlay forces the page to hide.
   */
  captureFrame(input: { surface: string }): Promise<string | undefined>;
  /** Highlights matches and moves to the next or previous one. Empty text clears. */
  find(input: {
    surface: string;
    text: string;
    direction: "next" | "previous";
  }): Promise<BrowserFindResult>;
  cancelDownload(input: { surface: string; id: string }): Promise<void>;
  /** Answers the page's HTTP authentication challenge; no credentials cancels it. */
  login(input: {
    surface: string;
    credentials: { username: string; password: string } | undefined;
  }): Promise<void>;
  /** A cookie jar's history, newest first; `browser_history_changed` carries every change after. */
  history(input: { owner: string | null }): Promise<readonly BrowserHistoryEntry[]>;
  forgetHistory(input: { owner: string | null; url: string }): Promise<void>;
  /** Hands keyboard focus to the page, as dismissing the address bar or find does. */
  focusPage(input: { surface: string }): Promise<void>;
  setBounds(message: BrowserBoundsMessage): void;
  /** Main moves native focus off the page when the panel's controls take it, and menu commands follow it. */
  setFocus(message: BrowserFocusMessage): void;
}

/** ~/.nyte/settings.json on the machine this host runs on. */
export interface HostSettingsBridge {
  get(): Promise<HostSettings>;
  /** Change the given keys and answer with every setting as it now stands. */
  set(patch: HostSettingsPatch): Promise<HostSettings>;
}

export interface HostBridge {
  /** Absent where the settings file is on another machine: the web app and mobile. */
  readonly settings?: HostSettingsBridge;
  /** Subscribe before main delivers a menu action that reopened the window. */
  onMenuCommand(listener: (command: AppMenuCommand) => void): Disposer;
  /** Keep Electron's native material and controls in the renderer's appearance mode. */
  setThemePreference(preference: ThemePreference): void;
  state(): Promise<HostState>;
  /**
   * Where the host's listener is and the credential to reach it with. The
   * interface connects with `sdk.connect` and holds that one connection.
   */
  endpoint(): Promise<HostEndpoint>;
  /** Keeps the device token a pairing connect yielded, so the next start connects with it. Absent where the credential is not paired. */
  readonly remember?: (credential: CredentialSource) => void;
  /** Installed UI and fixed-pitch families, discovered without renderer font permissions. */
  fonts(): Promise<LocalFontCatalog>;
  /** Select local history by path, even when the folder is unavailable. */
  openWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  /** Native folder picker, then open. Absent where the host has no picker to show. */
  readonly pickWorkspace?: () => Promise<OpenWorkspaceOutcome>;
  /**
   * Grant trust and open in one step; the renderer's trust dialog confirms
   * first. Absent where trust is granted on another machine. A registry host
   * needs the `consent` its open answered with and refuses without it.
   */
  readonly trustWorkspace?: (input: {
    path: string;
    consent?: TrustConsent;
  }) => Promise<OpenWorkspaceOutcome>;
  closeWorkspace(): Promise<void>;
  /**
   * Fold retained history from Home and registered desktop workspace stores
   * for one window. The window is the request, not a client-side slice, so
   * desktop figures are scoped to the same days. Claude Code is a separate
   * all-time local-history snapshot, independent of this window. Absent
   * where the host keeps no usage history; Settings hides the Usage page.
   */
  readonly usage?: (input: UsageWindow) => Promise<UsageSnapshot>;
  /** Absent where the host does not update itself. */
  readonly updates?: {
    state(): Promise<UpdateState>;
    /** What the Check for Updates menu item does in this state. */
    check(): Promise<void>;
  };
  /** Absent where no environment answers for `gh`. */
  readonly github?: GitHubBridge;
  server: {
    state(): Promise<ServerState>;
    /** Proves the server answers with this token before remembering either. */
    connect(input: { baseUrl: string; token: string }): Promise<ServerConnectOutcome>;
    disconnect(): Promise<void>;
  };
  remote: {
    state(): Promise<RemoteAccessState>;
    /** Serve the selected local target; a later folder change here does not move it. */
    start(input: { reach: RemoteReach }): Promise<RemoteAccessState>;
    /** Close the listener and its streams. Work a session already accepted continues. */
    stop(): Promise<void>;
    /** Save a plugin's settings. Refused while it serves; a new hostname forgets every device. */
    configure(input: { plugin: RemoteAccessPluginId } & CloudflareTunnelSettings): Promise<void>;
    /** Forget a plugin's settings and devices. Refused while it serves. */
    clear(input: { plugin: RemoteAccessPluginId }): Promise<void>;
    /** Add a device while the plugin serves; its token is in this answer and nowhere else. */
    pair(input: { plugin: RemoteAccessPluginId; name: string }): Promise<RemotePairing>;
    /** Refuse a device's token from now on and end its open streams. */
    revoke(input: { plugin: RemoteAccessPluginId; deviceId: string }): Promise<void>;
  };
  /** Remote access through the user's Nyte account. The web app answers `unavailable`. */
  connect: ConnectBridge;
  openExternal(input: { url: string }): Promise<void>;
  /** Ask before opening a link that came from conversation content. */
  confirmExternal(input: { url: string }): Promise<ExternalLinkChoice>;
  /** Show a file or folder in the system file manager. Absent where the files live on another machine. */
  readonly revealPath?: (input: { path: string }) => Promise<void>;
  /** Open the folder the user's own plugins load from, creating it first. Absent where files live elsewhere. */
  readonly openPluginsFolder?: () => Promise<void>;
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
  readonly browser?: BrowserBridge;
  onEvent(listener: (event: HostEvent) => void): Disposer;
}

/** What `window.nyte` is: the shell's surface and the host namespace. Sessions, files and git are the connection's. */
export interface NyteBridge {
  readonly clientSurface: ClientSurface;
  /** Where the inline canvas runtime shell loads from. Absent, `/canvas/index.html` on this origin. */
  readonly canvasShell?: string;
  /** The web app reaches a desktop through the Nyte account relay. That desktop's provider and GitHub sign-ins stay on it. */
  readonly relay?: true;
  readonly host: HostBridge;
}
