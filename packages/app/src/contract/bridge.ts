import type { ExcerptSource, TailnetStatus } from "@nyte-ai/schema";
import type { SessionId, Usage, WorkspaceId } from "@nyte-ai/sdk";
import type { OpenSocket } from "@nyte-ai/sdk/client";
import type { ConnectionProblem, HostEndpoint } from "./connection.ts";
import { clientActions } from "./client-actions.ts";
import type { DesktopApp } from "./desktop-app.ts";
import type { AppSwitch, ArrivalSubject } from "./desktop-window.ts";

type Disposer = () => void;

export interface UsageWindow {
  readonly sinceDay: string | null;
  readonly untilDay: string;
}

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

type UsageSubject =
  | { readonly kind: "model"; readonly provider: string; readonly model: string }
  | { readonly kind: "tool" }
  | { readonly kind: "compaction" };

export interface UsageEntry {
  readonly day: string;
  readonly workspacePath: string | null;
  readonly sessionId: SessionId;
  readonly subject: UsageSubject;
  readonly totals: UsageTotals;
}

export interface UsageSession {
  readonly sessionId: SessionId;
  readonly name?: string;
  readonly workspacePath: string | null;
  readonly lastActivityAt: number;
}

export interface UsageSource {
  readonly workspacePath: string | null;
  readonly status: "ok" | "failed";
  readonly sessions: number;
  readonly message: string | null;
}

export interface UsageReport {
  readonly readAt: number;
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly entries: readonly UsageEntry[];
  readonly sessions: readonly UsageSession[];
  readonly sources: readonly UsageSource[];
  readonly previous?: { readonly cost: number; readonly tokens: number };
  readonly earliestDay?: string;
}

interface ModelUsage {
  readonly provider: string;
  readonly model: string;
  readonly turns: number;
  readonly usage: Usage;
}

interface UsageSummary {
  readonly models: readonly ModelUsage[];
  readonly compaction: Usage;
  readonly tools: Usage;
  readonly total: Usage;
  readonly cacheSavings: number;
}

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

export interface UsageSnapshot extends UsageReport {
  readonly nyteError: string | null;
  readonly claudeCode: LocalHistoryUsage;
  readonly codex: LocalHistoryUsage;
}

export interface DeviceCode {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresInSeconds?: number;
  readonly instructions?: string;
}

export type ThemePreference = "system" | "light" | "dark";

export type ClientSurface = "desktop" | "web";

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
  | typeof clientActions.markdownSource.id
  | typeof clientActions.focusPane.id
  | typeof clientActions.reloadWindow.id
  | typeof clientActions.openNyte.id
  | typeof clientActions.openCode.id
  | typeof clientActions.openStudio.id
  | typeof clientActions.flipApp.id;

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
  | { readonly kind: "about"; readonly info: AppInfo }
  | { readonly kind: "open-file"; readonly path: string }
  | { readonly kind: "arrive"; readonly subject: ArrivalSubject | undefined };

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

export type RemoteReach = RemoteAccessPluginId;

export type RemoteAccessPluginId = "cloudflare";

export type TailnetNode = TailnetStatus | { readonly state: "unavailable" };

export interface CloudflareTunnelSettings {
  readonly hostname: string;
  readonly port: number;
  readonly tunnelToken: string;
}

export interface RemoteDevice {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly state:
    | { readonly kind: "pending"; readonly expiresAt: number }
    | { readonly kind: "paired"; readonly pairedAt: number };
}

export type TunnelFailure = "ingress_mismatch" | "ingress_unverified" | "exited";

export type TunnelConnection =
  | { readonly kind: "stopped" }
  | { readonly kind: "connecting" }
  | { readonly kind: "connected"; readonly connections: number }
  | { readonly kind: "retrying"; readonly attempt: number }
  | { readonly kind: "failed"; readonly reason: TunnelFailure };

export type CloudflareTunnelView =
  | { readonly kind: "unregistered" }
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

export interface RemotePairing {
  readonly deviceId: string;
  readonly address: string;
  readonly token: string;
  readonly expiresAt: number;
}

export type ServedTarget =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: SelectedWorkspace };

export type RemoteAccessState =
  | {
      readonly kind: "off";
      readonly tailnet: TailnetNode;
      readonly cloudflare: CloudflareTunnelView;
    }
  | {
      readonly kind: "serving";
      readonly reach: RemoteAccessPluginId;
      readonly address: string;
      readonly target: ServedTarget;
      readonly tailnet: TailnetNode;
      readonly cloudflare: CloudflareTunnelView;
    };

import type { ConnectView } from "@nyte-ai/connect";

export type {
  ConnectDevice,
  ConnectLinkFailure,
  ConnectNotice,
  ConnectUnavailable,
  ConnectView,
} from "@nyte-ai/connect";

export interface ConnectBridge {
  state(): Promise<ConnectView>;
  link(): Promise<ConnectView>;
  cancel(): Promise<void>;
  setEnabled(input: { enabled: boolean }): Promise<ConnectView>;
  unlink(): Promise<void>;
  revokeDevice(input: { deviceId: string }): Promise<void>;
  openAccount(): Promise<void>;
  signOut(): Promise<void>;
}

export interface SelectedWorkspace {
  readonly id: WorkspaceId;
  readonly path: string;
  readonly name: string;
}

export interface HostState {
  readonly workspace: SelectedWorkspace | undefined;
}

export interface LocalFontCatalog {
  readonly sans: readonly string[];
  readonly monospace: readonly string[];
}

export type RegisterWorkspaceOutcome =
  | {
      readonly kind: "registered";
      readonly workspace: SelectedWorkspace;
      readonly needsTrust: boolean;
    }
  | { readonly kind: "failed"; readonly message: string };

export type OpenWorkspaceOutcome =
  | { kind: "opened"; workspace: SelectedWorkspace; needsTrust: boolean }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

export interface BrowserSurfaceState {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly secure: "https" | "http" | "none";
  readonly blocking: "on" | "paused" | "off";
  readonly blocked: number;
  readonly error: BrowserPageError | undefined;
  readonly agentHolders: number;
  readonly fullscreen: boolean;
  readonly deniedPermissions: readonly string[];
  readonly design: BrowserDesign;
}

export interface BrowserPageError {
  readonly code: number;
  readonly description: string;
  readonly untrustedHost?: string;
}

export interface BrowserDownload {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
  readonly path: string;
  readonly received: number;
  readonly total: number;
  readonly state: "progressing" | "completed" | "cancelled" | "interrupted";
}

export interface BrowserFindResult {
  readonly active: number;
  readonly total: number;
}

export interface BrowserHistoryEntry {
  readonly url: string;
  readonly title: string;
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

export interface BrowserKey {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
}

export type ContextMenuRole = "cut" | "copy" | "paste" | "selectAll";

export type ExternalLinkChoice = "open" | "copy" | "trust" | "cancel";

export type ContextMenuTemplateItem =
  | { readonly kind: "separator" }
  | { readonly kind: "role"; readonly role: ContextMenuRole; readonly label: string }
  | {
      readonly kind: "item";
      readonly label: string;
      readonly accelerator?: string;
      readonly enabled?: boolean;
    };

export interface BrowserFocusMessage {
  readonly surface: string;
  readonly focused: boolean;
}

/** The channel a page's preload tells its embedding window on that a person pressed inside the page. */
export const BROWSER_PAGE_PRESS_CHANNEL = "nyte:browser-page-press";

export interface BrowserShownMessage {
  readonly surface: string;
  readonly visible: boolean;
}

/** A wheel an entered page handed back to the board: where and how far, in the page's CSS px at zoom 1. */
export interface BrowserWheel {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  /** A Ctrl-wheel or pinch zooms the board; a ⌘-wheel without Ctrl pans it. */
  readonly zoom: boolean;
}

/** A page this window's renderer hosts in a `<webview>`. Main decides the list; the renderer mounts it. */
export interface BrowserGuest {
  readonly surface: string;
  /** The session partition the element attaches with. */
  readonly partition: string;
  /** Changes when main needs a fresh guest for the same surface, so the element remounts. */
  readonly generation: number;
  /** Whether the guest keeps painting while no slot shows it, because an agent drives it or a capture is due. */
  readonly painting: boolean;
}

export type UpdateChannel = "stable" | "nightly";

export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "downloading"; readonly version: string; readonly percent: number }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "installing"; readonly version: string }
  | { readonly kind: "failed"; readonly version: string; readonly message: string };

export type HostProcess =
  | { readonly kind: "current"; readonly version: string; readonly startedAt: number | null }
  | { readonly kind: "stale"; readonly version: string; readonly startedAt: number | null }
  | { readonly kind: "restarting" }
  | { readonly kind: "offline" };

export type BundledCli =
  | {
      readonly kind: "ready";
      readonly version: string;
      readonly path: string;
      readonly architecture: string;
      readonly signature: string;
    }
  | { readonly kind: "unavailable"; readonly problem: string };

export type HostEvent =
  | { kind: "update_changed"; state: UpdateState }
  | { kind: "update_channel_changed"; channel: UpdateChannel }
  | { kind: "host_process_changed"; state: HostProcess }
  | { kind: "server_changed" }
  | { kind: "open_session"; session: SessionId }
  | { kind: "remote_access_changed" }
  | { kind: "browser_guests"; guests: readonly BrowserGuest[] }
  | { kind: "browser_changed"; surface: string; state: BrowserSurfaceState }
  | { kind: "browser_download"; surface: string; download: BrowserDownload }
  | { kind: "browser_open_tab"; surface: string; url: string; background: boolean }
  | { kind: "browser_key"; surface: string; key: BrowserKey }
  | { kind: "browser_design_pick"; surface: string; pick: BrowserDesignPick }
  | { kind: "browser_login_requested"; surface: string; host: string; realm: string }
  | { kind: "browser_board_leave"; surface: string }
  | { kind: "browser_board_wheel"; surface: string; wheel: BrowserWheel }
  | {
      kind: "browser_history_changed";
      owner: string | null;
      entries: readonly BrowserHistoryEntry[];
    }
  | {
      kind: "browser_agent_opened";
      owner: string | null;
      surface: string;
      url: string;
    };

export interface BrowserDesignViews {
  readonly xray: boolean;
  readonly rulers: boolean;
  readonly grid: boolean;
  readonly contrast: boolean;
}

export interface BrowserDesign {
  readonly on: boolean;
  readonly views: BrowserDesignViews;
}

export const BROWSER_DESIGN_VIEW_KEYS = {
  KeyX: "xray",
  KeyR: "rulers",
  KeyG: "grid",
  KeyC: "contrast",
} as const satisfies Record<string, keyof BrowserDesignViews>;

export const NO_DESIGN: BrowserDesign = {
  on: false,
  views: { xray: false, rulers: false, grid: false, contrast: false },
};

export type BrowserDesignChange =
  | { readonly kind: "on" }
  | { readonly kind: "off" }
  | { readonly kind: "view"; readonly view: keyof BrowserDesignViews; readonly shown: boolean };

export interface BrowserDesignPick {
  readonly source: Extract<ExcerptSource, { kind: "browser" }>;
  readonly text: string;
  readonly image: string | undefined;
}

export interface BrowserCapture {
  readonly src: string;
  readonly generation: number;
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface BrowserBridge {
  open(input: {
    surface: string;
    url: string;
    owner?: { kind: "home" } | { kind: "project"; path: string };
    holder: "tab" | "board";
  }): Promise<BrowserSurfaceState>;
  navigate(input: { surface: string; action: BrowserNavigationAction }): Promise<void>;
  menu(input: {
    surface: string;
    bookmarksVisible: boolean;
    x: number;
    y: number;
    owner: string | null;
  }): Promise<BrowserMenuAction | undefined>;
  perform(input: { surface: string; action: BrowserAction; owner: string | null }): Promise<void>;
  close(input: { surface: string }): Promise<void>;
  captureFrame(input: { surface: string }): Promise<BrowserCapture | undefined>;
  design(input: { surface: string; change: BrowserDesignChange }): Promise<void>;
  find(input: {
    surface: string;
    text: string;
    direction: "next" | "previous";
  }): Promise<BrowserFindResult>;
  cancelDownload(input: { surface: string; id: string }): Promise<void>;
  login(input: {
    surface: string;
    credentials: { username: string; password: string } | undefined;
  }): Promise<void>;
  history(input: { owner: string | null }): Promise<readonly BrowserHistoryEntry[]>;
  forgetHistory(input: { owner: string | null; url: string }): Promise<void>;
  setFocus(message: BrowserFocusMessage): void;
  guests(): Promise<readonly BrowserGuest[]>;
  attach(input: { surface: string; webContentsId: number; generation: number }): Promise<void>;
  setShown(message: BrowserShownMessage): void;
  /** Whether a page is entered on the Design board, where it hands Esc and zoom gestures back to the board. */
  setEntered(input: { surface: string; entered: boolean }): Promise<void>;
}

export const TERMINAL_NOTICE_LIMITS = { title: 256, body: 1024 } as const;

export interface TerminalNotice {
  readonly title: string;
  readonly body: string;
}

export interface AttentionBridge {
  viewing(session: SessionId | null): void;
  notify(notice: TerminalNotice): void;
}

export interface HostBridge {
  onMenuCommand(listener: (command: AppMenuCommand) => void): Disposer;
  setThemePreference(preference: ThemePreference): void;
  readonly restore?: (input: {
    readonly session: string;
  }) => Promise<SelectedWorkspace | undefined>;
  endpoint(): Promise<HostEndpoint>;
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly socket?: OpenSocket;
  fonts(): Promise<LocalFontCatalog>;
  openWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  registerWorkspace(input: { path: string }): Promise<RegisterWorkspaceOutcome>;
  readonly pickWorkspace?: () => Promise<OpenWorkspaceOutcome>;
  readonly pickFolder?: () => Promise<string | undefined>;
  readonly trustWorkspace?: (input: { path: string }) => Promise<OpenWorkspaceOutcome>;
  readonly usage?: (input: UsageWindow) => Promise<UsageSnapshot>;
  readonly updates?: {
    state(): Promise<UpdateState>;
    check(): Promise<void>;
    channel(): Promise<UpdateChannel>;
    setChannel(input: { readonly channel: UpdateChannel }): Promise<UpdateChannel>;
  };
  readonly hostProcess?: {
    state(): Promise<HostProcess>;
    confirm(input: { readonly action: "restart" | "stop" }): Promise<void>;
    start(): Promise<void>;
  };
  readonly bundledCli?: () => Promise<BundledCli>;
  server: {
    state(): Promise<ServerState>;
    connect(input: { baseUrl: string; token: string }): Promise<ServerConnectOutcome>;
    disconnect(): Promise<void>;
  };
  remote: {
    state(): Promise<RemoteAccessState>;
    start(input: { reach: RemoteReach }): Promise<RemoteAccessState>;
    stop(): Promise<void>;
    configure(input: { plugin: RemoteAccessPluginId } & CloudflareTunnelSettings): Promise<void>;
    clear(input: { plugin: RemoteAccessPluginId }): Promise<void>;
    pair(input: { plugin: RemoteAccessPluginId; name: string }): Promise<RemotePairing>;
    revoke(input: { plugin: RemoteAccessPluginId; deviceId: string }): Promise<void>;
    configureTailnet(input: { enabled: boolean }): Promise<void>;
    signOutTailnet(): Promise<void>;
  };
  connect: ConnectBridge;
  openExternal(input: { url: string }): Promise<void>;
  confirmExternal(input: { url: string }): Promise<ExternalLinkChoice>;
  readonly revealPath?: (input: { path: string }) => Promise<void>;
  readonly openPluginsFolder?: () => Promise<void>;
  pathForFile(file: File): string;
  readonly contextMenu?: (input: {
    items: readonly ContextMenuTemplateItem[];
    x: number;
    y: number;
  }) => Promise<number | undefined>;
  readonly browser?: BrowserBridge;
  readonly attention?: AttentionBridge;
  readonly setWorkspacePath?: (path: string | null) => void;
  readonly setUnsavedEdits?: (held: boolean) => void;
  /** Focuses the app's window on this workspace, or opens one beside this window, and lands it on the subject. */
  readonly switchApp?: (input: {
    readonly to: AppSwitch;
    readonly workspace: SelectedWorkspace | null;
    readonly subject: ArrivalSubject | null;
  }) => Promise<void>;
  onEvent(listener: (event: HostEvent) => void): Disposer;
}

export interface NyteBridge {
  /** Which of Nyte's apps this window is; a client without window kinds is Nyte. */
  readonly app?: DesktopApp;
  /** The apps this build offers, in switcher order; a client without window kinds has none to switch between. */
  readonly apps?: readonly DesktopApp[];
  readonly clientSurface: ClientSurface;
  readonly platform: NodeJS.Platform;
  readonly machineName: string | undefined;
  readonly canvasShell?: string;
  readonly host: HostBridge;
}
