import type { CredentialSource, SessionId, Usage, WorkspaceId } from "@nyte-ai/sdk";
import type { ConnectionProblem, HostEndpoint } from "./sdk.tsx";
import { clientActions } from "./client-actions.ts";

type Disposer = () => void;

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
  readonly pauseOnSleep: boolean;
  readonly terminalShell: string | null;
  readonly blockAds: boolean;
  readonly adblockAllowedHosts: readonly string[];
  readonly upgradeToHttps: boolean;
  readonly browserAccess: "ask" | "full" | "read" | "off";
}

export type HostSettingKey = keyof HostSettings;

export type HostSettingsPatch = Partial<HostSettings>;

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
  | typeof clientActions.back.id
  | typeof clientActions.forward.id
  | typeof clientActions.focusPane.id
  | typeof clientActions.reloadWindow.id;

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

export type RemoteReach = "tailnet" | RemoteAccessPluginId;

export type RemoteAccessPluginId = "cloudflare";

export type TailnetAvailability =
  | { readonly kind: "ready"; readonly ip: string; readonly name: string | undefined }
  | { readonly kind: "unavailable"; readonly state: string }
  | { readonly kind: "missing" };

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
      readonly tailnet: TailnetAvailability;
      readonly cloudflare: CloudflareTunnelView;
    }
  | {
      readonly kind: "serving";
      readonly reach: "tailnet";
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
  readonly binding?: { readonly hostId: string; readonly principal: string };
}

export interface LocalFontCatalog {
  readonly sans: readonly string[];
  readonly monospace: readonly string[];
}

export interface TrustConsent {
  readonly hostId: string;
  readonly id: string;
  readonly path: string;
  readonly identity: string;
}

export type OpenWorkspaceOutcome =
  | { kind: "opened"; workspace: SelectedWorkspace; needsTrust: boolean }
  | { kind: "needs_trust"; path: string; consent?: TrustConsent }
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
  readonly focus: boolean;
}

export interface BrowserFocusMessage {
  readonly surface: string;
  readonly focused: boolean;
}

export type UpdateChannel = "stable" | "nightly";

export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "downloading"; readonly version: string; readonly percent: number }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "installing"; readonly version: string }
  | { readonly kind: "failed"; readonly version: string; readonly message: string };

export type HostEvent =
  | { kind: "update_changed"; state: UpdateState }
  | { kind: "update_channel_changed"; channel: UpdateChannel }
  | { kind: "settings_changed"; settings: HostSettings }
  | { kind: "workspace_opened"; workspace: SelectedWorkspace }
  | { kind: "workspace_trust_required"; path: string }
  | { kind: "workspace_closed" }
  | { kind: "server_changed" }
  | { kind: "remote_access_changed" }
  | { kind: "status"; message: string }
  | { kind: "browser_changed"; surface: string; state: BrowserSurfaceState }
  | { kind: "browser_download"; surface: string; download: BrowserDownload }
  | { kind: "browser_open_tab"; surface: string; url: string; background: boolean }
  | { kind: "browser_key"; surface: string; key: BrowserKey }
  | { kind: "browser_login_requested"; surface: string; host: string; realm: string }
  | {
      kind: "browser_history_changed";
      owner: string | null;
      entries: readonly BrowserHistoryEntry[];
    }
  | {
      kind: "browser_agent_opened";
      owner: string | null;
      url: string;
    };

export interface BrowserElementPick {
  readonly url: string;
  readonly selector: string;
  readonly html: string;
  readonly image: string | undefined;
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
    owner: string | null;
  }): Promise<BrowserMenuAction | undefined>;
  perform(input: { surface: string; action: BrowserAction; owner: string | null }): Promise<void>;
  close(input: { surface: string }): Promise<void>;
  captureFrame(input: { surface: string }): Promise<string | undefined>;
  pickElement(input: { surface: string }): Promise<BrowserElementPick | undefined>;
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
  setBounds(message: BrowserBoundsMessage): void;
  setFocus(message: BrowserFocusMessage): void;
}

export interface HostSettingsBridge {
  get(): Promise<HostSettings>;
  set(patch: HostSettingsPatch): Promise<HostSettings>;
}

export interface HostBridge {
  readonly settings?: HostSettingsBridge;
  onMenuCommand(listener: (command: AppMenuCommand) => void): Disposer;
  setThemePreference(preference: ThemePreference): void;
  state(): Promise<HostState>;
  readonly restore?: (input: { readonly session: string }) => Promise<HostState>;
  endpoint(): Promise<HostEndpoint>;
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly remember?: (credential: CredentialSource) => void;
  fonts(): Promise<LocalFontCatalog>;
  openWorkspace(input: { path: string }): Promise<OpenWorkspaceOutcome>;
  readonly pickWorkspace?: () => Promise<OpenWorkspaceOutcome>;
  readonly trustWorkspace?: (input: {
    path: string;
    consent?: TrustConsent;
  }) => Promise<OpenWorkspaceOutcome>;
  closeWorkspace(): Promise<void>;
  readonly usage?: (input: UsageWindow) => Promise<UsageSnapshot>;
  readonly updates?: {
    state(): Promise<UpdateState>;
    check(): Promise<void>;
    channel(): Promise<UpdateChannel>;
    setChannel(input: { readonly channel: UpdateChannel }): Promise<UpdateChannel>;
  };
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
  onEvent(listener: (event: HostEvent) => void): Disposer;
}

export interface NyteBridge {
  readonly clientSurface: ClientSurface;
  readonly platform: NodeJS.Platform;
  readonly machineName: string | undefined;
  readonly canvasShell?: string;
  readonly relay?: true;
  readonly host: HostBridge;
}
