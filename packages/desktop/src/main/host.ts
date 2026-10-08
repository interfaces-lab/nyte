/**
 * The desktop host keeps workspace SDKs open independently. Selection chooses
 * the destination for new chats; session ids route existing chats to their
 * owning SDK. Runners attach per session, so switching folders preserves work. Every renderer request lands in `call` as an operation path plus
 * one input object — the SDK's own wire shape — and `watch` becomes a pump per
 * subscription that pushes events back over IPC.
 *
 * Electron specifics (windows, dialogs, shell) are injected, so this class
 * tests headless under Vitest.
 */
import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { MutableModels } from "@nyte-ai/ai";
import { createNyte, dispatch } from "@nyte-ai/core";
import { localEnvironmentPlugin } from "@nyte-ai/core/plugins";
import type { PluginFailure } from "@nyte-ai/host/plugins";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { Environment, OperationInput } from "@nyte-ai/protocol";
import type {
  Disposer,
  SessionId,
  SessionInfo,
  Nyte,
  WorkspaceBackend,
  WorkspaceInfo,
  WorkspaceSelectInput,
  WorkspaceSelectOutcome,
  WorkspaceSelection,
  WorkspaceTrust,
} from "@nyte-ai/core";
import { createNyteClient, sessionMark } from "@nyte-ai/client";
import { createCloudSession, serverRequest } from "./cloud-session.ts";
import type { NyteClient } from "@nyte-ai/client";
// Hosts name their storage backend through the store entry; the worker keeps
// SQLite off Electron's main thread.
import { WorkerStore } from "@nyte-ai/core/store";
import type { Store } from "@nyte-ai/core/store";
import {
  createGitHubService,
  createGitVcs,
  createHost,
  createWorkspaceBackend,
  createWorkspaceStore,
  environmentId,
  nyteHome,
  userPluginDirectory,
  runGitHubCommand,
  workspaceStorePath,
  WorkspaceTrustRequired,
} from "@nyte-ai/host";
import type { DeferredPluginTarget, GitHubCommandResult, GitHubCommandRunner } from "@nyte-ai/host";
import { createModelPreferencesStore, readCatalog } from "@nyte-ai/host/catalog";
import type { ResolvedCatalog } from "@nyte-ai/host/catalog";
import { createProviderEnvironment } from "@nyte-ai/host/environment";
import { createOtelExport } from "@nyte-ai/host/otel";
import {
  compactionSettings,
  HostSettingsStore,
  UnreadableSettingsFile,
} from "@nyte-ai/host/settings";
import { catalogForUsage, projectUsageReport, UsageScanner } from "@nyte-ai/host/store-usage";
import type {
  StoreLocation,
  StoreRead,
  UsageScan,
  UsageScanReader,
} from "@nyte-ai/host/store-usage";
import { SDK_OPERATION_PATHS } from "../shared/ipc.ts";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";
import type {
  CallInput,
  CallOutput,
  CallPath,
  SdkOperationPath,
  WatchEnvelope,
  WatchStartInput,
} from "../shared/ipc.ts";
import type {
  LoginOutcome,
  LoginProgress,
  HostEvent,
  HostState,
  HostBridge,
  LocalFontCatalog,
  OpenWorkspaceOutcome,
  RemoteAccessPluginId,
  RemoteAccessState,
  RemotePairing,
  RemoteReach,
  ServerConnectOutcome,
  ServerState,
  SessionDirectorySnapshot,
  SessionDirectorySource,
  TailnetAvailability,
  UsageSnapshot,
  UsageWindow,
} from "@nyte-ai/app/bridge.ts";
import { safeExternalUrl } from "./external-url.ts";
import type { BrowserSurfaces } from "./browser.ts";
import { browserToolsPlugin } from "./browser-tools.ts";
import { TerminalSessions } from "./terminals.ts";
import { CALL_INPUT_SCHEMAS } from "./ipc-inputs.ts";
import { ExpectedHostError, ipcFailure, retainDiagnostic } from "./errors.ts";
import type { IpcFailure } from "@nyte-ai/app/errors.ts";
import { ensureShellEnvironment } from "./shell-environment.ts";
import { readAccountUsage } from "@nyte-ai/host/usage";
import type { AccountUsage } from "@nyte-ai/host/usage";
import {
  findTailnetAddress,
  pairingOrigin,
  pairingUrl,
  randomToken,
  startServe,
} from "@nyte-ai/serve";
import type { ServeOptions, Serving } from "@nyte-ai/serve";
import type { RemoteAccessPlugins, RemoteExposure } from "./remote-access-plugin.ts";
import type { ConnectRuntime, ConnectShare } from "@nyte-ai/connect/host";
import { ServerSettingsStore } from "./server-settings.ts";
import type { ServerSettings } from "./server-settings.ts";
import { serverCatalog, serverConnectionProblem } from "@nyte-ai/app/server-connection.ts";
import { machineName } from "@nyte-ai/connect/host";
import { SessionDirectory } from "./session-directory.ts";
import { createBrowserAccessStore, readLastWorkspace, rememberWorkspace } from "./workspaces.ts";

export type DesktopUpdateActivity =
  | { readonly kind: "idle" }
  | {
      readonly kind: "busy";
      readonly taskCount: number;
      readonly terminalCommandCount: number;
    };

export interface DesktopHostDependencies {
  /** The provider catalog this host answers from. Tests inject an offline one. */
  createModels(): MutableModels;
  /** The release a shared SDK reports on `/v1/info`; absent outside the packaged app. */
  readonly appVersion?: string;
  /** The built web app remote access serves beside the API; API only when absent or unbuilt. */
  readonly appRoot?: string;
  /** Where usage history is scanned. The app uses a worker thread. */
  readonly usageScan?: UsageScanReader;
  /**
   * The built-in remote-access plugins `index.ts` registers. Without them, as
   * in tests that never serve through one, their reaches are refused.
   */
  readonly remoteAccessPlugins?: RemoteAccessPlugins;
  /**
   * Account remote access, served beside the remote access above on its own
   * loopback listener. Absent, as in tests that never link, it reads as unavailable.
   */
  readonly connect?: ConnectRuntime;
  readonly updates?: HostBridge["updates"];
  /** ~/.nyte/settings.json. Absent, as in tests, the host opens the real one. */
  readonly settings?: HostSettingsStore;
  /** Called on each change: true while Keep awake is on and a chat on this machine is working. */
  readonly keepAwake?: (awake: boolean) => void;
  readonly createHost?: typeof createHost;
  /** The store's worker thread module, so SQLite work never runs on the main thread. */
  readonly storeWorker: URL;
  readonly runGitHubCommand?: GitHubCommandRunner;
  readonly createOtelExport?: typeof createOtelExport;
  /** Push a host event to one window, or to every window when `window` is omitted. */
  emitHostEvent(event: HostEvent, window?: HostWindow): void;
  /** Push one watch envelope to the subscribing window. */
  emitWatchEvent(envelope: WatchEnvelope, window: HostWindow): void;
  openExternal(url: string): void;
  /** Native prompt before a conversation link leaves the app. */
  confirmExternal(url: string, window: HostWindow): ReturnType<HostBridge["confirmExternal"]>;
  /** Show a file or folder in the system file manager. */
  revealPath(path: string): void;
  /** Open a folder in the system file manager. Absent, the host reveals it instead. */
  readonly openPath?: (path: string) => Promise<void>;
  /** Where a discarded untracked file goes; the app uses the OS trash. Absent, the host's own trash. */
  readonly trashPath?: (path: string) => Promise<void>;
  /** Native right-click menu, with the renderer's own signature. */
  showContextMenu(
    input: CallInput<"host.contextMenu">,
    window: HostWindow,
  ): Promise<CallOutput<"host.contextMenu">>;
  browser: BrowserSurfaces;
  listFonts(): Promise<LocalFontCatalog>;
  /** Native folder picker; resolves undefined on cancel. */
  pickFolder(window: HostWindow): Promise<string | undefined>;
}

/** The renderer a request came from; each window selects its own workspace. */
export type HostWindow = number;

interface WatchLifetime {
  readonly window: HostWindow;
  readonly controller: AbortController;
  readonly sessionId: SessionId;
}

interface SessionAttachment {
  readonly detach: Disposer;
  generation: number;
}

/** A main-side status watch: no attach, events only mark the row dirty for a re-read. */
interface TrackedSession {
  readonly open: OpenTarget;
  readonly controller: AbortController;
}

interface OpenTargetBase {
  readonly sdk: Nyte;
  readonly workspaceBackend: WorkspaceBackend;
  readonly store: Store;
  readonly sessionAttachments: Map<SessionId, SessionAttachment>;
}

interface OpenHomeTarget extends OpenTargetBase {
  readonly kind: "home";
}

interface OpenProjectTarget extends OpenTargetBase {
  readonly kind: "project";
  readonly workspace: WorkspaceInfo;
}

/** The configured server: its own store, its own runner; the desktop only speaks the wire to it. */
interface OpenServerTarget {
  readonly kind: "server";
  readonly baseUrl: string;
  readonly sdk: NyteClient;
  /**
   * Aborts when this server stops being the configured one. A local target
   * lives as long as the host, so only the server needs a lifetime of its own
   * for its watches to end with it.
   */
  readonly closing: AbortController;
}

type OpenLocalTarget = OpenHomeTarget | OpenProjectTarget;

type OpenTarget = OpenLocalTarget | OpenServerTarget;

type WorkspaceTarget =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: WorkspaceInfo };

/** Keep desktop history outside the project, including when the project is deleted. */
function storePath(target: WorkspaceTarget): Promise<string> {
  return workspaceStorePath(target.kind === "home" ? homedir() : target.workspace.path);
}

function serverTarget(settings: ServerSettings): OpenServerTarget {
  return {
    kind: "server",
    baseUrl: settings.baseUrl,
    closing: new AbortController(),
    sdk: createNyteClient({
      baseUrl: settings.baseUrl,
      token: settings.token,
      fetch: serverRequest,
    }),
  };
}

const CLOUD_SOURCE = { environment: "cloud" } as const satisfies SessionDirectorySource;

function sourceOf(open: OpenTarget): SessionDirectorySource {
  if (open.kind === "server") return CLOUD_SOURCE;

  return {
    environment: "local",
    workspacePath: open.kind === "home" ? null : open.workspace.path,
  };
}

/** Nothing runs in a settled session, so only an attachment keeps its status watch. */
function isSettled(session: SessionInfo): boolean {
  const mark = sessionMark(session);

  return mark === "idle" || mark === "failed";
}

/** How often open stores and the server are listed for changes no watch can see. */
const SWEEP_INTERVAL_MS = 5_000;

/**
 * Rows an open store lists per read. Each page lands in the directory before
 * the next is read, so a large store fills the sidebar as it is walked.
 */
const SWEEP_PAGE_SIZE = 32;

/**
 * How long the first snapshot read waits for the local sweep. A store the
 * sweep is still walking answers with the rows landed so far; the rest are
 * pushed as they land, behind the mounted screen.
 */
const DIRECTORY_HYDRATION_BUDGET_MS = 1_500;

const CLOSED_DIRECTORY_MAX_AGE_MS = 60_000;

const CLOSED_DIRECTORY_REFRESH_BATCH = 4;

/** Server status watches are SSE connections; beyond this the sweep answers. */
const SERVER_TRACK_LIMIT = 16;

/** Operations whose reply leaves the session row changed without an event this host watches. */
const ROW_MUTATIONS: ReadonlySet<string> = new Set([
  "sessions.rename",
  "sessions.setPinned",
  "sessions.configure",
]);

/** Remote access's own cursor; a window's selection may move without it. */
interface ShareCursor {
  open: OpenLocalTarget;
  readonly sessionOwners: Map<SessionId, OpenLocalTarget>;
}

/** Who reaches the listener: one token for this session, or a plugin's devices through its connector. */
type RemoteListener =
  | { readonly reach: "local" | "tailnet"; readonly token: string; readonly pairingUrl: string }
  | { readonly reach: RemoteAccessPluginId; readonly exposure: RemoteExposure };

/** The remote access listener and the local target it currently serves. */
interface ActiveRemoteAccess extends ShareCursor {
  readonly serving: Serving;
  readonly listener: RemoteListener;
  /** Ends the sign-ins remote clients started; runs once the listener is closed. */
  readonly closeEnvironment: () => void;
}

/** A store the page will read, or why its location could not be resolved. */
interface LocatedStore {
  readonly location: StoreLocation;
  readonly failure: IpcFailure | null;
}

/** Long enough for a provider round trip, short enough that Usage still paints. */
const ACCOUNT_LIMITS_TIMEOUT_MS = 10_000;

const CATALOG_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

/** The bridge's own SDK subset: `landing` is a protocol operation the desktop never carries. */
const SDK_OPERATIONS: ReadonlySet<string> = new Set(SDK_OPERATION_PATHS);

const TRUSTED_RUN_OPERATIONS: ReadonlySet<string> = new Set(["runs.diff", "runs.revert"]);

function isSdkOperation(path: CallPath): path is SdkOperationPath {
  return SDK_OPERATIONS.has(path);
}

export class DesktopHost {
  private readonly dependencies: DesktopHostDependencies;
  private readonly workspaces = createWorkspaceStore();
  private readonly workspaceBackend = createWorkspaceBackend(this.workspaces);
  private readonly preferences = createModelPreferencesStore();
  private readonly browserAccess = createBrowserAccessStore();
  private readonly serverSettings = new ServerSettingsStore(join(nyteHome(), "server.json"));
  private readonly usageScan: UsageScanReader;
  private readonly otel: ReturnType<typeof createOtelExport>;
  private readonly settings: HostSettingsStore;
  private modelsPromise: Promise<MutableModels> | undefined;
  private catalogPromise: Promise<ResolvedCatalog> | undefined;
  private catalogRefreshTimer: ReturnType<typeof setInterval> | undefined;
  private readonly selections = new Map<HostWindow, OpenLocalTarget>();
  private readonly openTargets = new Map<string | null, OpenLocalTarget>();
  private server: OpenServerTarget | undefined;
  /** In flight from start until stopped, so two Start presses share one listener. */
  private remoteAccess: Promise<ActiveRemoteAccess> | undefined;
  /**
   * Runs remote access starts, stops, and plugin changes one at a time. Nothing
   * holding it waits on the lifecycle lock once `close` has begun, so teardown
   * may wait on it.
   */
  private remoteLock: Promise<void> = Promise.resolve();
  /** Listeners account remote access holds open; their targets stay open with them. */
  private connectShares = 0;
  private readonly sessionOwners = new Map<SessionId, OpenTarget | WorkspaceTarget>();
  /** When each closed store was last listed; the rows themselves live in the directory. */
  private readonly closedDirectories = new Map<string | null, number>();
  private readonly directory = new SessionDirectory((event) => {
    this.dependencies.emitHostEvent(event);
    this.holdAwake();
  });
  private readonly tracked = new Map<SessionId, TrackedSession>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private localSweep: Promise<void> | undefined;
  private localSweepAgain = false;
  private serverSweep: Promise<void> | undefined;
  private serverSweepAgain = false;
  /** The first local sweep: the snapshot waits for it so a new window never starts empty. */
  private hydrated: Promise<void> | undefined;
  private lifecycle: Promise<void> = Promise.resolve();
  private readonly watches = new Map<string, WatchLifetime>();
  /**
   * This Mac's provider environment: the catalog, preferences, credentials,
   * and usage. Renderer calls and remote clients share it, so a sign-in from
   * either side supersedes the other's and a sign-out waits for both. Each
   * side still owns what it started: a released window and a stopped share
   * cancel their own sign-ins.
   */
  private readonly environment = createProviderEnvironment({
    catalog: async () => (await this.catalog()).catalog,
    setPreference: async (change) => {
      await this.preferences.update(change);
      this.catalogChanged();
    },
    usage: (window) => this.usage(window),
    accountLimits: () => this.accountLimits(),
    login: async (...input) => (await this.models()).login(...input),
    refresh: async (provider, signal) => {
      try {
        const refreshed = await (
          await this.models()
        ).refresh({ providers: [provider], force: true, signal });

        return !refreshed.aborted && refreshed.errors.size === 0;
      } finally {
        this.catalogChanged();
      }
    },
    logout: async (provider) => {
      await (await this.models()).logout(provider);
      this.catalogChanged();
    },
  });
  private closed = false;
  /** What `keepAwake` was last told. */
  private awake = false;
  private readonly terminalSessions = new Map<HostWindow, TerminalSessions>();
  /** Aborts with the window, cancelling the sign-ins it started. */
  private readonly windowSignIns = new Map<HostWindow, AbortController>();

  constructor(dependencies: DesktopHostDependencies) {
    this.dependencies = dependencies;
    this.usageScan = dependencies.usageScan ?? new UsageScanner(nyteHome());
    this.settings = dependencies.settings ?? new HostSettingsStore();
    this.otel = (dependencies.createOtelExport ?? createOtelExport)({
      serviceName: "nyte-desktop",
      endpoint: this.settings.current().traceEndpoint ?? undefined,
    });
    this.settings.subscribe((next, previous) => {
      this.dependencies.emitHostEvent({ kind: "settings_changed", settings: next });
      this.holdAwake();

      if (next.workspaceTrust !== previous.workspaceTrust)
        void this.serialize(() => this.reactivateOpenTargets());

      if (next.cacheWarming === previous.cacheWarming) return;

      for (const open of this.openTargets.values()) open.sdk.cacheWarming.modeChanged();
    });
  }

  /** The trust answer changed, by a grant or the setting: every blocked session asks again. Call under `serialize`. */
  private async reactivateOpenTargets(): Promise<void> {
    await Promise.all([...this.openTargets.values()].map((open) => open.sdk.reactivate()));
  }

  /**
   * Every directory change and settings change lands here. Cloud chats run on
   * the server, and one waiting on a reply is waiting on a person: neither
   * needs this machine awake.
   */
  private holdAwake(): void {
    const awake =
      this.settings.current().keepAwake &&
      this.directory.some((session, source) => {
        const mark = sessionMark(session);

        return source.environment === "local" && (mark === "working" || mark === "retry");
      });

    if (awake === this.awake) return;
    this.awake = awake;
    this.dependencies.keepAwake?.(awake);
  }

  /** The one renderer entry point: an operation path and its single input object. */
  call<P extends CallPath>(
    window: HostWindow,
    path: P,
    input: CallInput<P>,
  ): Promise<CallOutput<P>>;
  async call(
    window: HostWindow,
    path: CallPath,
    input: CallInput<CallPath>,
  ): Promise<CallOutput<CallPath>> {
    if (isSdkOperation(path)) return this.callSdk(window, path, input);

    switch (path) {
      case "host.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        await this.prepare(window);

        return this.state(window);
      case "host.sessionDirectory":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.sessionDirectory();
      case "host.fonts":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.dependencies.listFonts();
      case "host.openWorkspace":
        return this.openWorkspace(window, CALL_INPUT_SCHEMAS[path].Parse(input).path);
      case "host.pickWorkspace":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.pickWorkspace(window);
      case "host.trustWorkspace":
        return this.trustWorkspace(CALL_INPUT_SCHEMAS[path].Parse(input).path);
      case "host.closeWorkspace":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.closeWorkspace(window);
      case "host.catalog": {
        const query = CALL_INPUT_SCHEMAS[path].Parse(input);
        const owner = query === undefined ? undefined : await this.owner(window, query.sessionId);

        if (owner?.kind !== "server") return (await this.catalog()).catalog;

        const [models, defaultModel] = await Promise.all([
          owner.sdk.provider.models.list(),
          owner.sdk.provider.models.default(),
        ]);

        if (defaultModel === undefined) {
          throw new ExpectedHostError({
            code: "not_found",
            message: "This server does not report a default model.",
          });
        }

        return serverCatalog(models, defaultModel);
      }

      case "host.usage":
        return this.usage(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.accountLimits":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.accountLimits();
      case "host.login":
        return this.login(window, CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.cancelLogin":
        return this.environment.operations["environment.cancelLogin"](
          CALL_INPUT_SCHEMAS[path].Parse(input),
        );
      case "host.logout":
        return this.environment.operations["environment.logout"](
          CALL_INPUT_SCHEMAS[path].Parse(input),
        );
      case "host.setPreference":
        return this.environment.operations["environment.setPreference"](
          CALL_INPUT_SCHEMAS[path].Parse(input),
        );
      case "host.github.createPullRequest": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject(window);
        await this.requireTrust(project.workspace.path, window);

        return this.github.createPullRequest(decoded, project.workspace.path);
      }

      case "host.settings.get":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.settings.read();
      case "host.settings.set":
        return this.settings.set(CALL_INPUT_SCHEMAS[path].Parse(input)).catch((cause: unknown) => {
          if (cause instanceof UnreadableSettingsFile)
            throw new ExpectedHostError({ code: "internal", message: cause.message });
          throw cause;
        });
      case "host.updates.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.dependencies.updates?.state() ?? { kind: "idle" };
      case "host.updates.check":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.dependencies.updates?.check();
      case "host.github.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.github.state(this.githubWorkspace(window));
      case "host.github.signIn":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.github.signIn(this.githubWorkspace(window)).then(this.githubChanged);
      case "host.github.signOut":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.github.signOut(this.githubWorkspace(window)).then(this.githubChanged);
      case "host.server.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.serverState();
      case "host.server.connect":
        return this.connectServer(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.server.disconnect":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.disconnectServer();
      case "host.server.createSession": {
        CALL_INPUT_SCHEMAS[path].Parse(input);
        const server = await this.openServer();

        if (server === undefined)
          throw new ExpectedHostError({ code: "not_found", message: "No server is connected" });
        const session = await createCloudSession(server.sdk.sessions);
        this.sessionOwners.set(session.sessionId, server);
        this.directory.upsert(CLOUD_SOURCE, session);

        return session;
      }

      case "host.remote.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.remoteAccessState();
      case "host.remote.start": {
        const { reach } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.remoteSerial(() => this.startRemoteAccess(window, reach));
      }

      case "host.remote.stop":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.remoteSerial(() => this.stopRemoteAccess());
      case "host.remote.configure": {
        const { plugin, ...settings } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.remoteSerial(() => this.remotePlugin(plugin).configure(settings)).then(
          this.remoteAccessChanged,
        );
      }

      case "host.remote.clear": {
        const { plugin } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.remoteSerial(() => this.remotePlugin(plugin).clear()).then(
          this.remoteAccessChanged,
        );
      }

      case "host.remote.pair": {
        const { plugin, name } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.remoteSerial(() => this.remotePlugin(plugin).pair({ name })).then(
          (pairing: RemotePairing) => {
            this.remoteAccessChanged();

            return pairing;
          },
        );
      }

      case "host.remote.revoke":
        return this.remoteSerial(() =>
          this.revokeRemoteDevice(CALL_INPUT_SCHEMAS[path].Parse(input)),
        );
      case "host.connect.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return (
          this.dependencies.connect?.view() ?? { kind: "unavailable", reason: "not_configured" }
        );
      case "host.connect.link":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.connect().link();
      case "host.connect.cancel":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.connect().cancel();
      case "host.connect.setEnabled": {
        const { enabled } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.connect().setEnabled({ enabled, share: this.connectShare(window, true) });
      }

      case "host.connect.unlink":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.connect().unlink();
      case "host.connect.revokeDevice":
        return this.connect().revokeDevice(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.connect.openAccount":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.connect().openAccount();
      case "host.connect.signOut":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.connect().signOut();
      case "host.openExternal": {
        const { url } = CALL_INPUT_SCHEMAS[path].Parse(input);
        this.dependencies.openExternal(safeExternalUrl(url));

        return undefined;
      }

      case "host.confirmExternal":
        return this.dependencies.confirmExternal(
          safeExternalUrl(CALL_INPUT_SCHEMAS[path].Parse(input).url),
          window,
        );
      case "host.revealPath": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        this.dependencies.revealPath(decoded.path);

        return undefined;
      }

      case "host.openPluginsFolder": {
        CALL_INPUT_SCHEMAS[path].Parse(input);
        const folder = userPluginDirectory();
        await mkdir(folder, { recursive: true });

        if (this.dependencies.openPath === undefined) this.dependencies.revealPath(folder);
        else await this.dependencies.openPath(folder);

        return undefined;
      }

      case "host.contextMenu":
        return this.dependencies.showContextMenu(CALL_INPUT_SCHEMAS[path].Parse(input), window);
      case "host.browser.open":
        return this.dependencies.browser.open(CALL_INPUT_SCHEMAS[path].Parse(input), window);
      case "host.browser.navigate":
        this.dependencies.browser.navigate(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.browser.menu":
        return this.dependencies.browser.menu(CALL_INPUT_SCHEMAS[path].Parse(input), window);
      case "host.browser.perform":
        return this.dependencies.browser.perform(CALL_INPUT_SCHEMAS[path].Parse(input), window);
      case "host.browser.close":
        this.dependencies.browser.close(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.browser.captureFrame":
        return this.dependencies.browser.captureFrame(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.find":
        return this.dependencies.browser.find(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.cancelDownload":
        this.dependencies.browser.cancelDownload(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.browser.login":
        this.dependencies.browser.login(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.browser.history":
        return this.dependencies.browser.history(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.forgetHistory":
        return this.dependencies.browser.forgetHistory(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.create": {
        const terminals = this.terminals(window);
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const cwd = decoded.workspacePath ?? homedir();

        if (decoded.workspacePath !== null) {
          if (this.requireProject(window).workspace.path !== decoded.workspacePath) {
            throw new ExpectedHostError({
              code: "forbidden",
              message: "Open this workspace before starting a terminal",
            });
          }

          await this.requireTrust(cwd, window);
        }

        await ensureShellEnvironment();

        if (this.closed || this.terminalSessions.get(window) !== terminals)
          throw new ExpectedHostError({ code: "closed", message: "Terminal window closed" });

        return terminals.create({ id: decoded.id, cwd });
      }

      case "host.terminal.write":
        return this.terminals(window).write(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.resize":
        return this.terminals(window).resize(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.acknowledge":
        return this.terminals(window).acknowledge(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.idle":
        return this.terminals(window).idle(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.close":
        return this.terminals(window).close(CALL_INPUT_SCHEMAS[path].Parse(input));
      default:
        path satisfies never;
        throw new Error("Unknown operation");
    }
  }

  private async workspaceOperationCwd(
    project: OpenProjectTarget,
    target: OperationInput<"workspace.read">["target"],
  ): Promise<string> {
    const cwd =
      target.kind === "workspace"
        ? project.workspace.path
        : target.kind === "session"
          ? await project.sdk.sessionCwd({ sessionId: target.sessionId })
          : undefined;

    if (cwd !== undefined) return cwd;

    throw new ExpectedHostError({
      code: "not_found",
      message: "The session workspace could not be resolved",
    });
  }

  /**
   * Route an SDK operation to the workspace that owns its session. The cases are
   * the operations that answer without a workspace open or that record ownership;
   * every other operation reaches its SDK unchanged.
   */
  private async callSdk(
    window: HostWindow,
    path: SdkOperationPath,
    input: CallInput<CallPath>,
  ): Promise<CallOutput<SdkOperationPath>> {
    switch (path) {
      // The workspace store answers before any workspace is open, so the rail's recents
      // speak the same operation the SDK defines.
      case "workspace.list":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.workspaces.list();
      case "workspace.forget":
        return this.forgetWorkspace(CALL_INPUT_SCHEMAS[path].Parse(input).path);
      // The model catalog is user-scoped. Reading its fallback must not force a
      // directory choice just so the blank composer can render truthfully.
      case "provider.models.default": {
        CALL_INPUT_SCHEMAS[path].Parse(input);
        const { catalog } = await this.catalog();
        const defaults = catalog.defaults;

        if (defaults === undefined) return undefined;

        return catalog.models.find(
          (model) => model.id === defaults.model.id && model.provider === defaults.model.provider,
        );
      }

      case "sessions.create": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.prepare(window);
        const session = await open.sdk.sessions.create(decoded);
        this.sessionOwners.set(session.sessionId, open);
        this.directory.upsert(sourceOf(open), session);

        return session;
      }

      case "sessions.list": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.owner(window, decoded?.parent ?? undefined);
        const page = await open.sdk.sessions.list(decoded);

        for (const session of page.items) this.sessionOwners.set(session.sessionId, open);

        return page;
      }

      case "sessions.setArchived": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.owner(window, decoded.sessionId);
        await open.sdk.sessions.setArchived(decoded);

        if (decoded.archived) {
          await this.releaseSessionIfIdle(open, decoded.sessionId).catch(() => undefined);
        }

        await this.refreshRow(open, decoded.sessionId);

        return;
      }

      case "sessions.delete": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.owner(window, decoded.sessionId);
        await open.sdk.sessions.delete(decoded);
        this.forgetSession(open, decoded.sessionId);

        return;
      }

      case "messages.send": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.owner(window, decoded.sessionId);
        this.attachSession(open, decoded.sessionId);

        return open.sdk.messages.send(decoded);
      }

      case "workspace.files": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject(window);

        const cwd =
          decoded.target.kind === "workspace"
            ? project.workspace.path
            : decoded.target.kind === "session"
              ? await project.sdk.sessionCwd({ sessionId: decoded.target.sessionId })
              : undefined;

        if (cwd === undefined) return [];

        return this.workspaceBackend.files({ cwd, query: decoded.query });
      }

      case "workspace.read": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject(window);
        const cwd = await this.workspaceOperationCwd(project, decoded.target);

        return project.workspaceBackend.read({ cwd, path: decoded.path });
      }

      case "workspace.save": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject(window);
        const cwd = await this.workspaceOperationCwd(project, decoded.target);

        return project.workspaceBackend.save({
          cwd,
          path: decoded.path,
          contents: decoded.contents,
          version: decoded.version,
        });
      }

      case "workspace.format": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject(window);
        const cwd = await this.workspaceOperationCwd(project, decoded.target);

        return project.workspaceBackend.format({
          cwd,
          path: decoded.path,
          contents: decoded.contents,
          version: decoded.version,
        });
      }

      case "workspace.search": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject(window);
        const { target, ...request } = decoded;
        const cwd = await this.workspaceOperationCwd(project, target);

        return project.workspaceBackend.search({ cwd, ...request });
      }

      case "workspace.blame": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject(window);
        const cwd = await this.workspaceOperationCwd(project, decoded.target);

        return project.workspaceBackend.blame({ cwd, path: decoded.path });
      }

      case "workspace.vcs.snapshot":
      case "workspace.vcs.diff":
      case "workspace.vcs.changes":
      case "workspace.vcs.contents":
      case "workspace.vcs.log":
      case "workspace.vcs.refs":
      case "workspace.vcs.stage":
      case "workspace.vcs.discard":
      case "workspace.vcs.commit":
      case "workspace.vcs.createBranch":
      case "workspace.vcs.push": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const sessionId = decoded.target.kind === "session" ? decoded.target.sessionId : undefined;
        const open = await this.owner(window, sessionId);

        if (open.kind === "project")
          await this.requireTrust(await this.workspaceOperationCwd(open, decoded.target), window);

        return dispatch(open.sdk, path, decoded);
      }

      default: {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);

        const sessionId =
          decoded !== undefined && "sessionId" in decoded ? decoded.sessionId : undefined;

        const open = await this.owner(window, sessionId);

        if (TRUSTED_RUN_OPERATIONS.has(path) && open.kind === "project") {
          if (sessionId === undefined) {
            throw new ExpectedHostError({
              code: "not_found",
              message: "The session workspace could not be resolved",
            });
          }

          const cwd = await open.sdk.sessionCwd({ sessionId });

          if (cwd === undefined) {
            throw new ExpectedHostError({
              code: "not_found",
              message: "The session workspace could not be resolved",
            });
          }

          await this.requireTrust(cwd, window);
        }

        const output = await dispatch(open.sdk, path, decoded);

        if (ROW_MUTATIONS.has(path) && sessionId !== undefined) {
          await this.refreshRow(open, sessionId);
        }

        return output;
      }
    }
  }

  watchStart(window: HostWindow, input: WatchStartInput): void {
    if (this.watches.has(input.watchId))
      throw new ExpectedHostError({
        code: "invalid_input",
        message: "Watch already exists. Stop it before starting it again.",
        issues: [],
      });
    const stop = new AbortController();

    const lifetime = {
      window,
      controller: stop,
      sessionId: input.sessionId,
    } satisfies WatchLifetime;

    this.watches.set(input.watchId, lifetime);
    void (async () => {
      let open: OpenTarget | undefined;

      try {
        open = await this.owner(window, input.sessionId);

        if (stop.signal.aborted) return;
        this.attachSession(open, input.sessionId);
        // Disconnecting the server ends its watches; a request the renderer
        // did not stop would otherwise keep streaming from the old base URL
        // with a token the desktop has already forgotten.
        const closing = open.kind === "server" ? open.closing.signal : undefined;

        const signal =
          closing === undefined ? stop.signal : AbortSignal.any([stop.signal, closing]);

        const source =
          input.live === true
            ? open.sdk.watch({ sessionId: input.sessionId, live: true, signal })
            : input.afterSeq === undefined
              ? open.sdk.watch({ sessionId: input.sessionId, signal })
              : open.sdk.watch({
                  sessionId: input.sessionId,
                  afterSeq: input.afterSeq,
                  signal,
                });

        for await (const event of source) {
          if (stop.signal.aborted) return;
          this.dependencies.emitWatchEvent(
            { watchId: input.watchId, kind: "event", event },
            window,
          );
        }

        if (!stop.signal.aborted) {
          // An aborted stream ends the iterator rather than throwing, so the
          // disconnect is reported here instead of from the catch below.
          this.dependencies.emitWatchEvent(
            closing?.aborted === true
              ? {
                  watchId: input.watchId,
                  kind: "ended",
                  error: { code: "closed", message: "The server was disconnected." },
                }
              : { watchId: input.watchId, kind: "ended" },
            window,
          );
        }
      } catch (cause) {
        if (!stop.signal.aborted) {
          this.dependencies.emitWatchEvent(
            { watchId: input.watchId, kind: "ended", error: ipcFailure(cause) },
            window,
          );
        }
      } finally {
        if (this.watches.get(input.watchId) === lifetime) this.watches.delete(input.watchId);

        const stillWatched = [...this.watches.values()].some(
          (watch) => watch.sessionId === input.sessionId,
        );

        if (!stillWatched && open !== undefined) {
          await this.releaseSessionIfIdle(open, input.sessionId).catch(() => undefined);
        }
      }
    })();
  }

  watchStop(watchId: string): void {
    this.watches.get(watchId)?.controller.abort();
    this.watches.delete(watchId);
  }

  /**
   * A reloaded renderer never sends its stops, cannot show a device code, and
   * owns no terminals anymore; its work would otherwise run into a dead frame.
   */
  releaseWindow(window: HostWindow): void {
    for (const [watchId, watch] of this.watches) {
      if (watch.window !== window) continue;
      watch.controller.abort();
      this.watches.delete(watchId);
    }

    this.windowSignIns.get(window)?.abort();
    this.windowSignIns.delete(window);

    const terminals = this.terminalSessions.get(window);
    this.terminalSessions.delete(window);
    terminals?.dispose();
  }

  /** A closed window also forgets its workspace selection. */
  closeWindow(window: HostWindow): void {
    this.selections.delete(window);
    this.releaseWindow(window);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const terminals of this.terminalSessions.values()) terminals.dispose();
    this.terminalSessions.clear();
    clearInterval(this.sweepTimer);
    clearInterval(this.catalogRefreshTimer);
    this.directory.close();
    this.holdAwake();

    for (const tracked of this.tracked.values()) tracked.controller.abort();
    this.tracked.clear();

    try {
      // Account devices lose access and the connector stops before anything they read from closes.
      await this.dependencies.connect?.close().catch(() => undefined);
      this.github.close();
      await this.environment.close();
      // The server list may sit behind a stalled connection; the local sweep is the one worth waiting for.
      await this.localSweep?.catch(() => undefined);
      await this.serialize(() => this.teardownOpen());
    } finally {
      await Promise.all([this.otel.shutdown(), this.usageScan.close()]);
    }
  }

  async updateActivity(): Promise<DesktopUpdateActivity> {
    const terminalCommandCount = [...this.terminalSessions.values()].reduce(
      (total, terminals) => total + terminals.busyCount(),
      0,
    );

    const taskCount = await this.serialize(async () => {
      const counts = await Promise.all(
        [...this.openTargets.values()].map((open) => this.updateTaskCount(open)),
      );

      return counts.reduce((total, count) => total + count, 0);
    });

    return taskCount === 0 && terminalCommandCount === 0
      ? { kind: "idle" }
      : { kind: "busy", taskCount, terminalCommandCount };
  }

  private async updateTaskCount(open: OpenLocalTarget): Promise<number> {
    const { items } = await open.sdk.sessions.list({ includeArchived: true });

    const active = await Promise.all(
      items.map(async (session) => {
        if (
          session.heads.some((head) => head.run !== undefined && !isTerminalPhase(head.run.phase))
        )
          return true;

        const jobs = await Promise.all(
          session.heads.map((head) =>
            open.sdk.jobs.list({ sessionId: session.sessionId, head: head.head }),
          ),
        );

        return jobs.some((group) => group.some((job) => job.phase.kind === "running"));
      }),
    );

    return active.filter((value) => value).length;
  }

  private terminals(window: HostWindow): TerminalSessions {
    const existing = this.terminalSessions.get(window);

    if (existing !== undefined) return existing;

    const terminals = new TerminalSessions(
      (event) => this.dependencies.emitHostEvent(event, window),
      () => this.settings.current().terminalShell,
    );

    this.terminalSessions.set(window, terminals);

    return terminals;
  }

  private state(window: HostWindow): HostState {
    const open = this.selections.get(window);

    return {
      workspace: open?.kind === "project" ? open.workspace : undefined,
      platform: process.platform,
      machineName: machineName(),
    };
  }

  private requireProject(window: HostWindow): OpenProjectTarget {
    const open = this.selections.get(window);

    if (open?.kind !== "project")
      throw new ExpectedHostError({ code: "not_found", message: "No project is open" });

    return open;
  }

  /**
   * Gate a host mutation on trust. Session work never comes here: the SDK
   * reports its own activation, and the renderer prompts from that.
   */
  private async requireTrust(path: string, window?: HostWindow): Promise<void> {
    try {
      await this.workspaces.require(path);
    } catch (cause) {
      if (cause instanceof WorkspaceTrustRequired) {
        this.dependencies.emitHostEvent(
          { kind: "workspace_trust_required", path: cause.cwd },
          window,
        );
      }

      throw cause;
    }
  }

  /** Prepare local storage while Chromium starts; IPC joins the same initialization. */
  prepare(window: HostWindow): Promise<OpenLocalTarget> {
    const selected = this.selections.get(window);

    if (selected !== undefined) return Promise.resolve(selected);

    return this.serialize(async () => {
      const current = this.selections.get(window);

      if (current !== undefined) return current;
      const path = await readLastWorkspace();

      if (path !== null) {
        const workspace = (await this.workspaces.list()).find((entry) => entry.path === path);

        if (workspace !== undefined) {
          // A broken saved project must not prevent opening the desktop on Home.
          const restored = await this.compose({ kind: "project", workspace }).catch(
            () => undefined,
          );

          if (restored !== undefined) {
            this.selections.set(window, restored);

            return restored;
          }
        }
      }

      const open = await this.compose({ kind: "home" });
      this.selections.set(window, open);

      return open;
    });
  }

  /** Volunteer this process as the session's runner. A server runs its own sessions. */
  private attachSession(open: OpenTarget, sessionId: SessionId): void {
    this.track(open, sessionId);

    if (open.kind === "server") return;
    const existing = open.sessionAttachments.get(sessionId);

    if (existing !== undefined) {
      existing.generation += 1;

      return;
    }

    open.sessionAttachments.set(sessionId, {
      detach: open.sdk.attach({ sessions: [sessionId] }),
      generation: 0,
    });
  }

  private releaseSessionAttachment(open: OpenTarget, sessionId: SessionId): boolean {
    if (open.kind === "server") return false;
    const attachment = open.sessionAttachments.get(sessionId);

    if (attachment === undefined) return false;
    open.sessionAttachments.delete(sessionId);
    attachment.detach();

    return true;
  }

  private releaseSessionResources(open: OpenTarget, sessionId: SessionId): void {
    if (!this.releaseSessionAttachment(open, sessionId)) return;
    this.dependencies.browser.agent.release({ session: sessionId });
    const row = this.directory.get(sessionId);

    if (row !== undefined && isSettled(row)) this.tracked.get(sessionId)?.controller.abort();
  }

  /** A deleted session leaves every host structure at once. */
  private forgetSession(open: OpenTarget, sessionId: SessionId): void {
    this.releaseSessionAttachment(open, sessionId);
    this.tracked.get(sessionId)?.controller.abort();
    this.sessionOwners.delete(sessionId);
    this.directory.remove(sessionId);
  }

  private async releaseSessionIfIdle(open: OpenTarget, sessionId: SessionId): Promise<void> {
    if (open.kind === "server") return;
    const attachment = open.sessionAttachments.get(sessionId);

    if (attachment === undefined) return;
    const generation = attachment.generation;
    const session = await open.sdk.sessions.get({ sessionId });
    const descendants = new Set<SessionId>();

    if (session !== undefined) this.directory.upsert(sourceOf(open), session);

    if (session !== undefined && (await this.sessionTreeHasLiveWork(open, session, descendants))) {
      return;
    }

    if (
      open.sessionAttachments.get(sessionId) !== attachment ||
      attachment.generation !== generation
    ) {
      return;
    }

    this.releaseSessionResources(open, sessionId);

    for (const childId of descendants) {
      if (childId !== sessionId && !open.sessionAttachments.has(childId)) {
        this.dependencies.browser.agent.release({ session: childId });
      }
    }
  }

  private async sessionTreeHasLiveWork(
    open: OpenLocalTarget,
    session: SessionInfo,
    seen: Set<SessionId>,
  ): Promise<boolean> {
    if (seen.has(session.sessionId)) return false;
    seen.add(session.sessionId);

    if (session.heads.some((head) => head.run !== undefined && !isTerminalPhase(head.run.phase))) {
      return true;
    }

    const activity = await Promise.all(
      session.heads.map(async (head) => {
        const input = { sessionId: session.sessionId, head: head.head };

        const [pending, jobs] = await Promise.all([
          open.sdk.messages.pending(input),
          open.sdk.jobs.list(input),
        ]);

        return pending.length > 0 || jobs.some((job) => job.phase.kind === "running");
      }),
    );

    if (activity.some(Boolean)) return true;

    let page = await open.sdk.sessions.list({
      parent: session.sessionId,
      includeArchived: true,
    });

    for (;;) {
      for (const child of page.items) {
        if (await this.sessionTreeHasLiveWork(open, child, seen)) return true;
      }

      if (page.next === undefined) break;
      page = await open.sdk.sessions.list({
        parent: session.sessionId,
        includeArchived: true,
        cursor: page.next,
      });
    }

    return false;
  }

  /** The workspace that owns a known session; the window's selection for anything else. */
  private owner(window: HostWindow, sessionId: SessionId | undefined): Promise<OpenTarget> {
    if (sessionId === undefined) return this.prepare(window);
    const owner = this.sessionOwners.get(sessionId);

    if (owner === undefined) return this.prepare(window);

    if ("sdk" in owner) return Promise.resolve(owner);

    return this.serialize(async () => {
      const current = this.sessionOwners.get(sessionId);

      if (current === undefined) {
        throw new ExpectedHostError({ code: "not_found", message: "Session not found" });
      }

      if ("sdk" in current) return current;
      const open = await this.compose(current);
      this.sessionOwners.set(sessionId, open);

      return open;
    });
  }

  private models(): Promise<MutableModels> {
    this.modelsPromise ??= (async () => {
      const models = this.dependencies.createModels();
      // Restore persisted catalogs from disk. Boot must work offline.
      await models.refresh({
        providers: models.getProviders().map((provider) => provider.id),
        allowNetwork: false,
      });
      const empty = models.getModels().length === 0;
      const refreshed = this.refreshModels(models, empty ? AbortSignal.timeout(10_000) : undefined);

      if (empty) await refreshed;
      else void refreshed;

      if (!this.closed && this.catalogRefreshTimer === undefined) {
        this.catalogRefreshTimer = setInterval(
          () => void this.refreshModels(models),
          CATALOG_REFRESH_INTERVAL_MS,
        );
        this.catalogRefreshTimer.unref();
      }

      return models;
    })();

    return this.modelsPromise;
  }

  private async refreshModels(models: MutableModels, signal?: AbortSignal): Promise<void> {
    try {
      const result = await models.refresh(signal === undefined ? undefined : { signal });

      for (const [provider, cause] of result.errors) {
        retainDiagnostic({ correlationId: `model-catalog:${provider}`, cause });
      }

      if (!result.aborted && !this.closed) this.catalogChanged();
    } catch (cause) {
      retainDiagnostic({ correlationId: "model-catalog", cause });
    }
  }

  private catalog(): Promise<ResolvedCatalog> {
    if (this.catalogPromise !== undefined) return this.catalogPromise;

    const reading = this.models()
      .then(async (models) => readCatalog(models, await this.preferences.read()))
      .finally(() => {
        if (this.catalogPromise === reading) this.catalogPromise = undefined;
      });

    this.catalogPromise = reading;

    return reading;
  }

  /** After a sign-in, sign-out, or preference change. The next read is fresh, and windows re-read. */
  private catalogChanged(): void {
    this.catalogPromise = undefined;
    this.dependencies.emitHostEvent({ kind: "catalog_changed" });
  }

  /** Serialize workspace lifecycle so a double-click cannot compose twice. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async pickWorkspace(window: HostWindow): Promise<OpenWorkspaceOutcome> {
    const path = await this.dependencies.pickFolder(window);

    if (path === undefined) return { kind: "cancelled" };

    return this.openWorkspace(window, path);
  }

  private trustWorkspace(path: string): Promise<OpenWorkspaceOutcome> {
    return this.serialize<OpenWorkspaceOutcome>(async () => {
      await this.workspaces.trust(path);
      await this.reactivateOpenTargets();

      return { kind: "cancelled" };
    }).catch((cause): OpenWorkspaceOutcome => ({
      kind: "failed",
      message: ipcFailure(cause).message,
    }));
  }

  private openWorkspace(window: HostWindow, path: string): Promise<OpenWorkspaceOutcome> {
    return this.serialize(() => this.selectProject(window, path)).catch(
      (cause): OpenWorkspaceOutcome => ({
        kind: "failed",
        message: ipcFailure(cause).message,
      }),
    );
  }

  /** Selection opens local history. Core resolves the execution path when sending. */
  private async selectProject(window: HostWindow, path: string): Promise<OpenWorkspaceOutcome> {
    const cwd = await realpath(resolve(path)).catch(() => resolve(path));
    const selected = this.selections.get(window);

    // Decided here so the renderer can ask at open rather than after the first session activates.
    // A folder that cannot be resolved, because it is gone, has nothing to ask for.
    const needsTrust = await this.workspaces.resolve(cwd).then(
      (resolution) => resolution.kind === "unknown",
      () => false,
    );

    if (selected?.kind === "project" && selected.workspace.path === cwd) {
      return { kind: "opened", workspace: selected.workspace, needsTrust };
    }

    await this.workspaces.touch(cwd);
    const workspace = (await this.workspaces.list()).find((entry) => entry.path === cwd);

    if (workspace === undefined) throw new Error(`Workspace was not recorded: ${cwd}`);
    const target = { kind: "project", workspace } as const;
    // Keep the current session open if local storage cannot be composed.
    const open = await this.compose(target);
    this.selections.set(window, open);
    await rememberWorkspace(cwd);
    this.dependencies.emitHostEvent(
      { kind: "workspace_opened", workspace: open.workspace },
      window,
    );

    return { kind: "opened", workspace: open.workspace, needsTrust };
  }

  /** Where this target's plugins load from, or why they cannot load yet. */
  private async pluginTarget(target: WorkspaceTarget): Promise<DeferredPluginTarget> {
    if (target.kind === "home") return { kind: "home" };

    const current = (await this.workspaces.list()).find(
      (workspace) => workspace.path === target.workspace.path,
    );

    if (current?.available !== true) return { kind: "inactive" };
    const resolution = await this.workspaces.resolve(target.workspace.path);

    switch (resolution.kind) {
      case "trusted":
        return { kind: "project", workspace: resolution.workspace };
      case "unknown":
        return { kind: "requires", requirement: { kind: "workspace_trust", cwd: resolution.cwd } };
      default: {
        const _exhaustive: never = resolution;

        return _exhaustive;
      }
    }
  }

  /** Compose storage now; resolve directories and plugins only when a session activates. */
  private compose(target: { readonly kind: "home" }): Promise<OpenHomeTarget>;
  private compose(target: {
    readonly kind: "project";
    readonly workspace: WorkspaceInfo;
  }): Promise<OpenProjectTarget>;
  private compose(target: WorkspaceTarget): Promise<OpenLocalTarget>;
  private async compose(target: WorkspaceTarget): Promise<OpenLocalTarget> {
    // Nothing composes after teardown: a caller queued on the lifecycle lock
    // would otherwise build a store into the cleared map that nothing closes.
    if (this.closed)
      throw new ExpectedHostError({ code: "closed", message: "The window is closed" });
    const key = target.kind === "home" ? null : target.workspace.path;
    const existing = this.openTargets.get(key);

    if (existing !== undefined) return existing;
    const open = await this.createTarget(target);
    this.openTargets.set(key, open);

    if (this.sweepTimer === undefined) this.startSweeping();
    else void this.requestLocalSweep();

    return open;
  }

  private async createTarget(target: WorkspaceTarget): Promise<OpenLocalTarget> {
    const models = await this.models();
    const { catalog, defaultModel: fallback } = await this.catalog();

    if (fallback === undefined || catalog.defaults === undefined) {
      throw new ExpectedHostError({
        code: "not_found",
        message: "No models are available. Check your connection or sign in to a provider.",
      });
    }

    const projectCwd = target.kind === "project" ? target.workspace.path : undefined;
    const cwd = projectCwd ?? homedir();

    const store = new WorkerStore({
      path: await storePath(target),
      worker: this.dependencies.storeWorker,
    });

    const trashPath = this.dependencies.trashPath;

    const workspaceBackend = this.workspaceBackend;
    const shellEnvironment = ensureShellEnvironment();

    const configuredWorkspaceBackend = {
      ...workspaceBackend,
      save: async (input: Parameters<typeof workspaceBackend.save>[0]) => {
        await this.requireTrust(input.cwd);

        return workspaceBackend.save(input);
      },
      format: async (input: Parameters<typeof workspaceBackend.format>[0]) => {
        await this.requireTrust(input.cwd);
        await shellEnvironment;

        return workspaceBackend.format(input);
      },
      blame: async (input: Parameters<typeof workspaceBackend.blame>[0]) => {
        await shellEnvironment;

        return workspaceBackend.blame(input);
      },
      vcs:
        projectCwd === undefined
          ? undefined
          : createGitVcs(
              trashPath === undefined
                ? { beforeCommand: ensureShellEnvironment }
                : { beforeCommand: ensureShellEnvironment, discard: trashPath },
            ),
    };

    let sdk: Nyte | undefined;

    try {
      await store.ready();

      const codemode = codemodeRuntimeOptions();

      const extraPlugins = [
        browserToolsPlugin({
          agent: this.dependencies.browser.agent,
          access: this.browserAccess,
          defaultAccess: () => this.settings.current().browserAccess,
        }),
      ];

      const reportPluginFailure = (failure: PluginFailure): void =>
        this.dependencies.emitHostEvent({
          kind: "status",
          message:
            failure.id === undefined
              ? `Couldn't read ${failure.path}: ${failure.error}`
              : `Plugin "${failure.id}" couldn't load: ${failure.error}`,
        });

      sdk = await (this.dependencies.createHost ?? createHost)({
        store,
        models,
        model: fallback,
        thinkingLevel: catalog.defaults.thinkingLevel,
        telemetry: this.otel.telemetry,
        cacheWarming: () => this.settings.current().cacheWarming,
        compaction: compactionSettings(this.settings.current()),
        onDiagnostic: retainDiagnostic,
        workspace: configuredWorkspaceBackend,
        plugins: {
          kind: "workspace",
          // Storage opens before trust; project code loads once the user has granted it.
          target: {
            kind: "deferred",
            cwd,
            resolve: async () => {
              const resolved = await this.pluginTarget(target);

              if (resolved.kind === "home" || resolved.kind === "project")
                await ensureShellEnvironment();

              return resolved;
            },
          },
          onFailure: reportPluginFailure,
          extra: extraPlugins,
          codemode,
        },
      });

      const base = {
        sdk,
        workspaceBackend: configuredWorkspaceBackend,
        store,
        sessionAttachments: new Map<SessionId, SessionAttachment>(),
      };

      if (target.kind === "home") {
        const open = { ...base, kind: "home" } satisfies OpenHomeTarget;

        return open;
      }

      const open = {
        ...base,
        kind: "project",
        workspace: target.workspace,
      } satisfies OpenProjectTarget;

      return open;
    } catch (error) {
      await sdk?.close().catch(() => undefined);
      await store.close().catch(() => undefined);
      throw error;
    }
  }

  /** Drop a workspace from the rail. Windows that had it selected return to Home. */
  private async forgetWorkspace(path: string): Promise<void> {
    const target = await realpath(resolve(path)).catch(() => resolve(path));
    await this.workspaces.forget(path);

    for (const [window, open] of this.selections) {
      if (open.kind === "project" && open.workspace.path === target) {
        await this.closeWorkspace(window);
      }
    }

    await this.localSweep?.catch(() => undefined);
    await this.serialize(() => this.retireForgottenTarget(target));
  }

  private async retireForgottenTarget(path: string): Promise<void> {
    const open = this.openTargets.get(path);

    if (this.localSweep !== undefined) {
      const retry = (): Promise<void> => this.serialize(() => this.retireForgottenTarget(path));
      void this.localSweep.then(retry, retry).catch(() => undefined);

      return;
    }

    if (
      open !== undefined &&
      ([...this.selections.values()].includes(open) ||
        open.sessionAttachments.size > 0 ||
        this.watches.size > 0 ||
        this.remoteAccess !== undefined ||
        this.connectShares > 0 ||
        (await this.updateTaskCount(open)) > 0)
    ) {
      return;
    }

    this.closedDirectories.delete(path);
    this.openTargets.delete(path);

    for (const [sessionId, owner] of this.sessionOwners) {
      if (owner === open || (owner.kind === "project" && owner.workspace.path === path)) {
        this.sessionOwners.delete(sessionId);
      }
    }

    this.directory.drop({ environment: "local", workspacePath: path });

    if (open === undefined) return;

    for (const [sessionId, tracked] of this.tracked) {
      if (tracked.open !== open) continue;
      tracked.controller.abort();
      this.tracked.delete(sessionId);
    }

    await open.sdk.close().catch(() => undefined);
    await open.store.close().catch(() => undefined);
  }

  private closeWorkspace(window: HostWindow): Promise<void> {
    return this.serialize(async () => {
      this.selections.set(window, await this.compose({ kind: "home" }));
      await rememberWorkspace(null);
      this.dependencies.emitHostEvent({ kind: "workspace_closed" }, window);
    });
  }

  private async readClosedDirectory(target: WorkspaceTarget): Promise<readonly SessionInfo[]> {
    const path = await storePath(target);

    if (!existsSync(path)) return [];

    const store = new WorkerStore({
      path,
      worker: this.dependencies.storeWorker,
    });

    let sdk: Nyte | undefined;

    try {
      await store.ready();

      if ((await store.list()).length === 0) return [];
      const models = await this.models();
      const { defaultModel } = await this.catalog();

      if (defaultModel === undefined) {
        throw new ExpectedHostError({
          code: "not_found",
          message: "No models are available. Check your connection or sign in to a provider.",
        });
      }

      const id = await environmentId();
      const cwd = target.kind === "home" ? homedir() : target.workspace.path;
      let decided: Promise<WorkspaceTrust> | undefined;
      sdk = await createNyte({
        store,
        models,
        model: defaultModel,
        drain: "all",
        streamFn: (model, context, options) => models.streamSimple(model, context, options),
        telemetry: this.otel.telemetry,
        plugins: [localEnvironmentPlugin({ id })],
        defaultWorkspace: { kind: "local", id, cwd },
        trust: async (workspace): Promise<WorkspaceTrust> => {
          if (workspace.id !== id) return { kind: "trusted" };

          if (workspace.cwd === cwd)
            return (decided ??= this.pluginTarget(target).then((resolved): WorkspaceTrust =>
              resolved.kind === "home" || resolved.kind === "project"
                ? { kind: "trusted" }
                : resolved,
            ));
          const resolution = await this.workspaces.resolve(workspace.cwd).catch(() => undefined);

          if (resolution === undefined) return { kind: "inactive" };

          switch (resolution.kind) {
            case "trusted":
              return { kind: "trusted" };
            case "unknown":
              return {
                kind: "requires",
                requirement: { kind: "workspace_trust", cwd: resolution.cwd },
              };
            default: {
              const _exhaustive: never = resolution;

              return _exhaustive;
            }
          }
        },
      });
      const { items } = await sdk.sessions.list({ includeArchived: true });

      return items;
    } finally {
      await sdk?.close().catch(() => undefined);
      await store.close().catch(() => undefined);
    }
  }

  private async sessionDirectory(): Promise<SessionDirectorySnapshot> {
    if (this.closed)
      throw new ExpectedHostError({ code: "closed", message: "The window is closed" });

    if (this.sweepTimer === undefined) this.startSweeping();
    else this.requestSweep();
    await Promise.race([this.hydrated, setTimeout(DIRECTORY_HYDRATION_BUDGET_MS)]);

    return this.directory.snapshot();
  }

  /** Sweeps run for the host's lifetime, not a window's: a hidden or closed window still hears status. */
  private startSweeping(): void {
    if (this.sweepTimer !== undefined || this.closed) return;
    this.sweepTimer = setInterval(() => this.requestSweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
    this.hydrated = this.requestLocalSweep();
    this.requestServerSweep();
  }

  private requestSweep(): void {
    void this.requestLocalSweep();
    this.requestServerSweep();
  }

  /** One local sweep at a time; a request during one runs once more after it. */
  private requestLocalSweep(): Promise<void> {
    if (this.localSweep !== undefined) {
      this.localSweepAgain = true;

      return this.localSweep;
    }

    const sweep = this.sweepLocal()
      .catch((cause: unknown) => retainDiagnostic({ correlationId: "session-directory", cause }))
      .finally(() => {
        this.localSweep = undefined;

        if (!this.localSweepAgain) return;
        this.localSweepAgain = false;
        void this.requestLocalSweep();
      });

    this.localSweep = sweep;

    return sweep;
  }

  private requestServerSweep(): void {
    if (this.serverSweep !== undefined) {
      this.serverSweepAgain = true;

      return;
    }

    this.serverSweep = this.sweepServer()
      .catch(() => undefined)
      .finally(() => {
        this.serverSweep = undefined;

        if (!this.serverSweepAgain) return;
        this.serverSweepAgain = false;
        this.requestServerSweep();
      });
  }

  /**
   * List every local store into the directory. Open stores are listed each
   * time; closed ones only once they are stale, a few per sweep, since each
   * read composes a store of its own.
   */
  private async sweepLocal(): Promise<void> {
    const targets = await this.serialize(async () => {
      const workspaces = await this.workspaces.list();

      return [
        { kind: "home" },
        ...workspaces.map(
          (workspace) => ({ kind: "project", workspace }) satisfies WorkspaceTarget,
        ),
      ] satisfies WorkspaceTarget[];
    });

    if (this.closed) return;
    const now = Date.now();

    const refreshClosed = new Set(
      targets
        .map((target) => (target.kind === "home" ? null : target.workspace.path))
        .filter((workspacePath) => {
          if (this.openTargets.has(workspacePath)) return false;
          const attemptedAt = this.closedDirectories.get(workspacePath);

          return attemptedAt !== undefined && now - attemptedAt >= CLOSED_DIRECTORY_MAX_AGE_MS;
        })
        .sort(
          (left, right) =>
            (this.closedDirectories.get(left) ?? 0) - (this.closedDirectories.get(right) ?? 0),
        )
        .slice(0, CLOSED_DIRECTORY_REFRESH_BATCH),
    );

    const listings: {
      readonly owner: OpenLocalTarget | WorkspaceTarget;
      readonly workspacePath: string | null;
      readonly items: readonly SessionInfo[];
      readonly startedAt: number | undefined;
    }[] = [];

    for (let index = 0; index < targets.length; index += 4) {
      const reads = await Promise.allSettled(
        targets.slice(index, index + 4).map(async (target) => {
          const workspacePath = target.kind === "home" ? null : target.workspace.path;
          const existing = this.openTargets.get(workspacePath);

          if (existing !== undefined) {
            const items = await this.sweepOpen(existing);

            return { owner: existing, workspacePath, items, startedAt: undefined };
          }

          if (this.closedDirectories.has(workspacePath) && !refreshClosed.has(workspacePath)) {
            return undefined;
          }

          this.closedDirectories.set(workspacePath, Date.now());
          const startedAt = this.directory.clock();
          const items = await this.readClosedDirectory(target);

          return { owner: target, workspacePath, items, startedAt };
        }),
      );

      for (const read of reads) {
        if (read.status === "rejected") {
          retainDiagnostic({ correlationId: "session-directory", cause: read.reason });
        } else if (read.value !== undefined) {
          listings.push(read.value);
        }
      }
    }

    if (this.closed) return;

    // Owners settle over every listing at once, so no claim depends on which read finished first.
    const settled = listings.filter(
      ({ owner, workspacePath }) =>
        this.openTargets.get(workspacePath) === ("sdk" in owner ? owner : undefined),
    );

    for (const { workspacePath, items, startedAt } of settled) {
      if (startedAt === undefined) continue;
      const listed = new Set(items.map((session) => session.sessionId));

      for (const [sessionId, owner] of this.sessionOwners) {
        if (
          !listed.has(sessionId) &&
          !("sdk" in owner) &&
          (owner.kind === "home" ? workspacePath === null : owner.workspace.path === workspacePath)
        ) {
          this.sessionOwners.delete(sessionId);
        }
      }
    }

    for (const { owner, workspacePath, items, startedAt } of settled) {
      for (const session of items) {
        if (!this.sessionOwners.has(session.sessionId)) {
          this.sessionOwners.set(session.sessionId, owner);
        }
      }

      if (startedAt !== undefined) {
        this.directory.replace({ environment: "local", workspacePath }, items, startedAt);
      }
    }
  }

  private async sweepOpen(open: OpenLocalTarget): Promise<readonly SessionInfo[]> {
    const startedAt = this.directory.clock();
    const workspacePath = open.kind === "home" ? null : open.workspace.path;
    const items: SessionInfo[] = [];
    let cursor: string | undefined;

    do {
      const page = await open.sdk.sessions.list({
        includeArchived: true,
        limit: SWEEP_PAGE_SIZE,
        cursor,
      });

      if (this.closed || this.openTargets.get(workspacePath) !== open) return [];
      items.push(...page.items);
      this.directory.fill(sourceOf(open), page.items, startedAt);
      cursor = page.next;
    } while (cursor !== undefined);

    for (const session of items) {
      if (session.archived) {
        await this.releaseSessionIfIdle(open, session.sessionId).catch(() => undefined);
      }
    }

    this.directory.replace(sourceOf(open), items, startedAt);

    for (const session of items) {
      if (!isSettled(session)) this.track(open, session.sessionId);
    }

    return items;
  }

  /** Keep the last known chats visible when a remote read fails, with its failure shown separately. */
  private async sweepServer(): Promise<void> {
    const server = await this.openServer();

    if (server === undefined) return;
    const startedAt = this.directory.clock();

    try {
      const { items } = await server.sdk.sessions.list({ includeArchived: true });

      // The server was replaced or disconnected during the read; its list is nobody's.
      if (this.server !== server) return;

      for (const session of items) this.sessionOwners.set(session.sessionId, server);
      this.directory.replace(CLOUD_SOURCE, items, startedAt);
      this.directory.setAvailability({ kind: "ready" });

      for (const session of items) {
        if (!isSettled(session)) this.track(server, session.sessionId);
      }
    } catch (cause) {
      if (this.server !== server) return;
      retainDiagnostic({ correlationId: `server:${server.baseUrl}`, cause });
      this.directory.setAvailability({
        kind: "unavailable",
        message: serverConnectionProblem(cause).message,
      });
    }
  }

  /** One row read after a mutation, so the directory never waits for a sweep to show it. */
  private async refreshRow(open: OpenTarget, sessionId: SessionId): Promise<void> {
    // The mutation already landed; a failed read leaves the row to the next sweep.
    const session = await open.sdk.sessions.get({ sessionId }).catch(() => null);

    if (this.closed || session === null) return;

    if (session === undefined) {
      this.directory.remove(sessionId);

      return;
    }

    this.directory.upsert(sourceOf(open), session);

    if (!isSettled(session)) this.track(open, sessionId);
  }

  /**
   * Watch a session's status from main without attaching: events mark the
   * row dirty, one `sessions.get` is in flight at a time, and a read that
   * lands dirty reads again. A parent's delegation events list its children,
   * which are tracked in turn while they run. The watch ends once the row
   * settles with nothing attached, or with the session.
   */
  private track(open: OpenTarget, sessionId: SessionId): void {
    if (this.closed || this.tracked.has(sessionId)) return;

    if (
      open.kind === "server" &&
      [...this.tracked.values()].filter((tracked) => tracked.open.kind === "server").length >=
        SERVER_TRACK_LIMIT
    ) {
      return;
    }

    const controller = new AbortController();
    const tracked: TrackedSession = { open, controller };
    this.tracked.set(sessionId, tracked);
    void this.trackSession(open, sessionId, controller)
      .catch(() => undefined)
      .finally(() => {
        if (this.tracked.get(sessionId) === tracked) this.tracked.delete(sessionId);
      });
  }

  private async trackSession(
    open: OpenTarget,
    sessionId: SessionId,
    controller: AbortController,
  ): Promise<void> {
    const source = sourceOf(open);

    const signal =
      open.kind === "server"
        ? AbortSignal.any([controller.signal, open.closing.signal])
        : controller.signal;

    let reading = false;
    let rowDirty = false;
    let childrenDirty = false;

    const attached = (): boolean =>
      open.kind !== "server" && open.sessionAttachments.has(sessionId);

    const readChildren = async (): Promise<void> => {
      let page = await open.sdk.sessions.list({ parent: sessionId, includeArchived: true });

      for (;;) {
        if (signal.aborted) return;

        for (const child of page.items) {
          this.directory.upsert(source, child);

          if (!isSettled(child)) this.track(open, child.sessionId);
        }

        if (page.next === undefined) return;
        page = await open.sdk.sessions.list({
          parent: sessionId,
          includeArchived: true,
          cursor: page.next,
        });
      }
    };

    const read = async (): Promise<void> => {
      if (reading) return;
      reading = true;

      try {
        while ((rowDirty || childrenDirty) && !signal.aborted) {
          const row = rowDirty;
          const children = childrenDirty;
          rowDirty = false;
          childrenDirty = false;

          if (row) {
            const session = await open.sdk.sessions.get({ sessionId });

            if (signal.aborted) return;

            if (session === undefined) {
              this.directory.remove(sessionId);
              controller.abort();

              return;
            }

            this.directory.upsert(source, session);

            if (isSettled(session) && !attached()) {
              controller.abort();

              return;
            }
          }

          if (children) await readChildren();
        }
      } catch {
        // The sweep re-tracks a session whose row still says it runs.
        controller.abort();
      } finally {
        reading = false;
      }
    };

    for await (const event of open.sdk.watch({ sessionId, live: true, signal })) {
      if (signal.aborted) return;

      switch (event.kind) {
        case "synced":
        case "activation_changed":
        case "run":
        case "head_moved":
        case "stack":
        case "fact":
        case "config_queued":
        case "queued":
        case "landed":
        case "queue_cancelled":
        case "deleted":
          rowDirty = true;
          break;
        case "commit":
        case "effect":
          rowDirty = true;
          childrenDirty = true;
          break;
        default:
          continue;
      }

      void read();
    }
  }

  private async openServer(): Promise<OpenServerTarget | undefined> {
    if (this.server !== undefined) return this.server;
    const settings = await this.serverSettings.read();

    if (settings === undefined) return undefined;
    this.server = serverTarget(settings);
    this.directory.setAvailability({ kind: "ready" });

    return this.server;
  }

  private async serverState(): Promise<ServerState> {
    const server = await this.openServer();

    if (server === undefined) return { kind: "none" };

    try {
      const info = await server.sdk.info();
      const provider = await server.sdk.provider.status();

      return { kind: "connected", baseUrl: server.baseUrl, info, provider };
    } catch (cause) {
      retainDiagnostic({ correlationId: `server:${server.baseUrl}`, cause });

      return {
        kind: "unavailable",
        baseUrl: server.baseUrl,
        problem: serverConnectionProblem(cause),
      };
    }
  }

  private async connectServer(settings: ServerSettings): Promise<ServerConnectOutcome> {
    const candidate = serverTarget(settings);

    try {
      const info = await candidate.sdk.info();
      await this.serverSettings.write(settings);
      this.forgetServerSessions();
      this.server = candidate;
      this.directory.setAvailability({ kind: "ready" });
      this.dependencies.emitHostEvent({ kind: "server_changed" });

      if (this.sweepTimer === undefined) this.startSweeping();
      else this.requestServerSweep();

      return { kind: "connected", baseUrl: candidate.baseUrl, version: info.version };
    } catch (cause) {
      retainDiagnostic({ correlationId: `server:${candidate.baseUrl}`, cause });

      return { kind: "failed", message: serverConnectionProblem(cause).message };
    }
  }

  private async disconnectServer(): Promise<void> {
    await this.serverSettings.clear();
    this.forgetServerSessions();
    this.server = undefined;
    this.dependencies.emitHostEvent({ kind: "server_changed" });
  }

  private async remoteAccessState(): Promise<RemoteAccessState> {
    const active = await this.activeRemoteAccess();

    const cloudflare = (await this.dependencies.remoteAccessPlugins?.cloudflare.view()) ?? {
      kind: "unregistered",
    };

    if (active === undefined) {
      return { kind: "off", tailnet: await this.tailnetAvailability(), cloudflare };
    }

    const target =
      active.open.kind === "home"
        ? { kind: "home" as const }
        : { kind: "project" as const, workspace: active.open.workspace };

    const { listener } = active;

    if ("exposure" in listener) {
      return {
        kind: "serving",
        reach: listener.reach,
        address: listener.exposure.address,
        target,
        cloudflare,
      };
    }

    return {
      kind: "serving",
      address: active.serving.address,
      token: listener.token,
      pairingUrl: listener.pairingUrl,
      reach: listener.reach,
      target,
      cloudflare,
    };
  }

  private readonly remoteAccessChanged = (): void => {
    this.dependencies.emitHostEvent({ kind: "remote_access_changed" });
  };

  private remoteSerial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.remoteLock.then(operation, operation);
    this.remoteLock = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private remotePlugin(id: RemoteAccessPluginId): RemoteAccessPlugins[RemoteAccessPluginId] {
    const plugin = this.dependencies.remoteAccessPlugins?.[id];

    if (plugin === undefined) {
      throw new ExpectedHostError({
        code: "not_found",
        message: "This remote access plugin isn't available here.",
      });
    }

    return plugin;
  }

  /** Read fresh each time: the daemon can start or stop while Settings is open. */
  private async tailnetAvailability(): Promise<TailnetAvailability> {
    const lookup = await findTailnetAddress(process.platform);

    if (lookup.kind !== "ready") return lookup;

    return { kind: "ready", ip: lookup.address.ip, name: lookup.address.name };
  }

  /**
   * The address a tailnet reach binds. Resolved at start rather than reused
   * from a cached reading: binding an address whose interface went down fails
   * with a message that explains nothing.
   */
  private async requireTailnetHost(): Promise<string> {
    const lookup = await findTailnetAddress(process.platform);

    if (lookup.kind === "ready") return lookup.address.ip;
    throw new ExpectedHostError({
      code: "not_found",
      message:
        lookup.kind === "missing"
          ? "Tailscale isn't installed on this Mac"
          : "Tailscale isn't running. Start it, then try again.",
    });
  }

  /** The running listener, or nothing once a start has failed. */
  private async activeRemoteAccess(): Promise<ActiveRemoteAccess | undefined> {
    const pending = this.remoteAccess;

    if (pending === undefined) return undefined;

    try {
      return await pending;
    } catch {
      if (this.remoteAccess === pending) this.remoteAccess = undefined;

      return undefined;
    }
  }

  private shareSelection(cursor: ShareCursor): WorkspaceSelection {
    return cursor.open.kind === "home"
      ? { kind: "home" }
      : { kind: "project", workspace: cursor.open.workspace };
  }

  private async retargetShare(
    cursor: ShareCursor,
    input: WorkspaceSelectInput,
  ): Promise<WorkspaceSelectOutcome> {
    // A select queued behind close() must not compose into a torn-down host.
    if (this.closed) return { kind: "failed", message: "The window closed" };

    if (input.kind === "home") {
      if (cursor.open.kind === "home") {
        return { kind: "opened", selection: { kind: "home" } };
      }

      cursor.open = await this.compose({ kind: "home" });
      this.dependencies.emitHostEvent({ kind: "remote_access_changed" });

      return { kind: "opened", selection: { kind: "home" } };
    }

    const cwd = await realpath(resolve(input.path)).catch(() => resolve(input.path));

    if (cursor.open.kind === "project" && cursor.open.workspace.path === cwd) {
      return {
        kind: "opened",
        selection: { kind: "project", workspace: cursor.open.workspace },
      };
    }

    const workspace = (await this.workspaces.list()).find(
      (entry) => entry.path === cwd || entry.path === input.path,
    );

    if (workspace === undefined) {
      return { kind: "failed", message: "Workspace is not in the recents list" };
    }

    if (workspace.available !== true) {
      return { kind: "unavailable", path: workspace.path };
    }

    try {
      await this.requireTrust(workspace.path);
    } catch (cause) {
      if (cause instanceof WorkspaceTrustRequired) {
        return { kind: "untrusted", path: workspace.path };
      }

      throw cause;
    }

    cursor.open = await this.compose({ kind: "project", workspace });
    this.dependencies.emitHostEvent({ kind: "remote_access_changed" });

    return {
      kind: "opened",
      selection: { kind: "project", workspace: cursor.open.workspace },
    };
  }

  /** A client's forget is the Mac's; a cursor on the forgotten folder re-seats on Home. */
  private async forgetShareWorkspace(
    cursor: ShareCursor,
    input: { readonly path: string },
  ): Promise<void> {
    const target = await realpath(resolve(input.path)).catch(() => resolve(input.path));
    await this.forgetWorkspace(input.path);
    await this.serialize(async () => {
      if (this.closed) return;

      if (cursor.open.kind !== "project" || cursor.open.workspace.path !== target) return;
      cursor.open = await this.compose({ kind: "home" });
      this.dependencies.emitHostEvent({ kind: "remote_access_changed" });
    });
  }

  /** Live SDK over the share cursor so `workspace.select` retargets later RPCs. */
  private shareCursor(cursor: ShareCursor): Nyte {
    const owner = (sessionId?: SessionId): OpenLocalTarget =>
      sessionId === undefined ? cursor.open : (cursor.sessionOwners.get(sessionId) ?? cursor.open);

    const sdk = (sessionId?: SessionId) => owner(sessionId).sdk;

    const trustedSdk = async (sessionId?: SessionId): Promise<Nyte> => {
      const open = owner(sessionId);

      if (open.kind === "project") {
        const cwd =
          sessionId === undefined ? open.workspace.path : await open.sdk.sessionCwd({ sessionId });

        if (cwd === undefined) {
          throw new ExpectedHostError({
            code: "not_found",
            message: "The session workspace could not be resolved",
          });
        }

        await this.requireTrust(cwd);
      }

      return open.sdk;
    };

    const trustedVcs = async (sessionId?: SessionId): Promise<Nyte["workspace"]["vcs"]> =>
      (await trustedSdk(sessionId)).workspace.vcs;

    const remember = (sessionId: SessionId, open: OpenLocalTarget): void => {
      cursor.sessionOwners.set(sessionId, open);
      this.sessionOwners.set(sessionId, open);
    };

    return {
      sessions: {
        create: async (input) => {
          const open =
            input?.parent === undefined
              ? cursor.open
              : (cursor.sessionOwners.get(input.parent.sessionId) ?? cursor.open);

          const session = await open.sdk.sessions.create(input);
          remember(session.sessionId, open);
          this.directory.upsert(sourceOf(open), session);

          return session;
        },
        get: (input) => sdk(input.sessionId).sessions.get(input),
        snapshot: (input) => sdk(input.sessionId).sessions.snapshot(input),
        metadata: (input) => sdk(input.sessionId).sessions.metadata(input),
        list: async (input) => {
          const parent = input?.parent ?? undefined;

          const open =
            parent === undefined ? cursor.open : (cursor.sessionOwners.get(parent) ?? cursor.open);

          const page = await open.sdk.sessions.list(input);

          for (const session of page.items) remember(session.sessionId, open);

          return page;
        },
        rename: async (input) => {
          await sdk(input.sessionId).sessions.rename(input);
          await this.refreshRow(owner(input.sessionId), input.sessionId);
        },
        setPinned: async (input) => {
          await sdk(input.sessionId).sessions.setPinned(input);
          await this.refreshRow(owner(input.sessionId), input.sessionId);
        },
        setArchived: async (input) => {
          const open = owner(input.sessionId);
          await open.sdk.sessions.setArchived(input);

          if (input.archived) {
            await this.releaseSessionIfIdle(open, input.sessionId).catch(() => undefined);
          }

          await this.refreshRow(open, input.sessionId);
        },
        delete: async (input) => {
          const open = owner(input.sessionId);
          await open.sdk.sessions.delete(input);
          this.forgetSession(open, input.sessionId);
          cursor.sessionOwners.delete(input.sessionId);
        },
        configure: async (input) => {
          const outcome = await sdk(input.sessionId).sessions.configure(input);
          await this.refreshRow(owner(input.sessionId), input.sessionId);

          return outcome;
        },
      },
      messages: {
        send: (input) => sdk(input.sessionId).messages.send(input),
        cancel: (input) => sdk(input.sessionId).messages.cancel(input),
        redeliver: (input) => sdk(input.sessionId).messages.redeliver(input),
        list: (input) => sdk(input.sessionId).messages.list(input),
        pending: (input) => sdk(input.sessionId).messages.pending(input),
      },
      runs: {
        current: (input) => sdk(input.sessionId).runs.current(input),
        abort: (input) => sdk(input.sessionId).runs.abort(input),
        wait: (input) => sdk(input.sessionId).runs.wait(input),
        reply: (input) => sdk(input.sessionId).runs.reply(input),
        compact: (input) => sdk(input.sessionId).runs.compact(input),
        context: (input) => sdk(input.sessionId).runs.context(input),
        diff: async (input) => (await trustedSdk(input.sessionId)).runs.diff(input),
        revert: async (input) => (await trustedSdk(input.sessionId)).runs.revert(input),
      },
      jobs: {
        list: (input) => sdk(input.sessionId).jobs.list(input),
        start: (input) => sdk(input.sessionId).jobs.start(input),
        background: (input) => sdk(input.sessionId).jobs.background(input),
        cancel: (input) => sdk(input.sessionId).jobs.cancel(input),
      },
      heads: {
        list: (input) => sdk(input.sessionId).heads.list(input),
        create: (input) => sdk(input.sessionId).heads.create(input),
        move: (input) => sdk(input.sessionId).heads.move(input),
        delete: (input) => sdk(input.sessionId).heads.delete(input),
        merge: (input) => sdk(input.sessionId).heads.merge(input),
      },
      workspace: {
        list: () => cursor.open.sdk.workspace.list(),
        current: () => Promise.resolve(this.shareSelection(cursor)),
        select: (input) =>
          this.serialize(() => this.retargetShare(cursor, input)).catch(
            (cause): WorkspaceSelectOutcome => ({
              kind: "failed",
              message: ipcFailure(cause).message,
            }),
          ),
        forget: (input) => this.forgetShareWorkspace(cursor, input),
        files: (input) =>
          sdk(input.target.kind === "session" ? input.target.sessionId : undefined).workspace.files(
            input,
          ),
        read: (input) =>
          sdk(input.target.kind === "session" ? input.target.sessionId : undefined).workspace.read(
            input,
          ),
        save: (input) =>
          sdk(input.target.kind === "session" ? input.target.sessionId : undefined).workspace.save(
            input,
          ),
        format: (input) =>
          sdk(
            input.target.kind === "session" ? input.target.sessionId : undefined,
          ).workspace.format(input),
        search: (input) =>
          sdk(
            input.target.kind === "session" ? input.target.sessionId : undefined,
          ).workspace.search(input),
        blame: (input) =>
          sdk(input.target.kind === "session" ? input.target.sessionId : undefined).workspace.blame(
            input,
          ),
        vcs: {
          snapshot: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).snapshot(input),
          diff: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).diff(input),
          changes: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).changes(input),
          contents: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).contents(input),
          log: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).log(input),
          refs: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).refs(input),
          stage: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).stage(input),
          discard: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).discard(input),
          commit: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).commit(input),
          createBranch: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).createBranch(input),
          push: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).push(input),
        },
      },
      provider: {
        models: {
          list: async () => {
            const [{ catalog }, models] = await Promise.all([
              this.catalog(),
              cursor.open.sdk.provider.models.list(),
            ]);

            const listed = new Set(
              catalog.models.filter((model) => model.listed).map((model) => model.key),
            );

            return models.filter((model) => listed.has(`${model.provider}/${model.id}`));
          },
          default: () => cursor.open.sdk.provider.models.default(),
        },
        status: () => cursor.open.sdk.provider.status(),
      },
      plugins: {
        catalog: () => cursor.open.sdk.plugins.catalog(),
        list: (input) => sdk(input.sessionId).plugins.list(input),
        commands: {
          list: (input) => sdk(input.sessionId).plugins.commands.list(input),
          run: (input) => sdk(input.sessionId).plugins.commands.run(input),
        },
        settings: {
          list: (input) => sdk(input.sessionId).plugins.settings.list(input),
          apply: (input) => sdk(input.sessionId).plugins.settings.apply(input),
        },
        resources: {
          list: (input) => sdk(input.sessionId).plugins.resources.list(input),
        },
        status: {
          list: (input) => sdk(input.sessionId).plugins.status.list(input),
        },
      },
      cacheWarming: {
        status: (input) => sdk(input.sessionId).cacheWarming.status(input),
        modeChanged: () => {
          for (const open of new Set([cursor.open, ...cursor.sessionOwners.values()]))
            open.sdk.cacheWarming.modeChanged();
        },
      },
      watch: (input) => sdk(input.sessionId).watch(input),
      attach: (input) => cursor.open.sdk.attach(input),
      advance: (input) => sdk(input.sessionId).advance(input),
      reactivate: () => cursor.open.sdk.reactivate(),
      sessionCwd: (input) => sdk(input.sessionId).sessionCwd(input),
      sessionRoot: (input) => sdk(input.sessionId).sessionRoot(input),
      relocate: (input) => sdk(input.sessionId).relocate(input),
      close: () => cursor.open.sdk.close(),
    };
  }

  /**
   * This Mac's environment for remote clients: the provider environment and
   * GitHub service the desktop itself uses, GitHub scoped to the folder the
   * share currently serves. A client's sign-in shows its link or code to that
   * client; nothing opens on the Mac.
   */
  private shareEnvironment(cursor: ShareCursor) {
    const owner = new AbortController();
    const github = this.github.owned(owner.signal);

    const workspace = (): string | undefined =>
      cursor.open.kind === "project" ? cursor.open.workspace.path : undefined;

    const operations: Environment = {
      ...this.environment.owned(owner.signal),
      "environment.github.state": () => github.state(workspace()),
      "environment.github.signIn": () => github.signIn(workspace()).then(this.githubChanged),
      "environment.github.signOut": () => github.signOut(workspace()).then(this.githubChanged),
      "environment.github.createPullRequest": async (input) => {
        const path = workspace();

        if (path !== undefined) await this.requireTrust(path);

        return github.createPullRequest(input, path);
      },
    };

    return { operations, close: () => owner.abort() };
  }

  /**
   * Serve the selected local target as it stands now. Mac selection may move
   * later; the cursor stays until a client calls `workspace.select`.
   * A folder is served only once trusted; the server target is never a
   * candidate because selection is always local. Runs under the remote lock.
   */
  private async startRemoteAccess(
    window: HostWindow,
    reach: RemoteReach,
  ): Promise<RemoteAccessState> {
    if (this.closed)
      throw new ExpectedHostError({ code: "closed", message: "The window closed before serving" });

    if (this.remoteAccess === undefined) {
      const pending = (async (): Promise<ActiveRemoteAccess> => {
        const hostname = reach === "tailnet" ? await this.requireTailnetHost() : undefined;

        const via =
          reach === "local" || reach === "tailnet"
            ? { kind: "token" as const, reach }
            : { kind: "plugin" as const, reach, plugin: this.remotePlugin(reach) };

        // Bail before prepare, not after it: teardown waits on this pending,
        // so a prepare queued behind teardown would deadlock the close.
        if (this.closed)
          throw new ExpectedHostError({
            code: "closed",
            message: "The window closed before serving",
          });
        const open = await this.prepare(window);

        if (open.kind === "project") await this.requireTrust(open.workspace.path, window);

        if (this.closed)
          throw new ExpectedHostError({
            code: "closed",
            message: "The window closed before serving",
          });
        const cursor: ShareCursor = { open, sessionOwners: new Map() };
        const environment = this.shareEnvironment(cursor);

        try {
          if (via.kind === "token") {
            const token = randomToken();

            const serving = await this.serveShare(cursor, environment.operations, {
              hostname,
              auth: { kind: "token", token },
            });

            const link = pairingUrl(
              pairingOrigin(serving.address, this.servedAppRoot()),
              serving.address,
              token,
            );

            return Object.assign(cursor, {
              serving,
              listener: { reach: via.reach, token, pairingUrl: link },
              closeEnvironment: environment.close,
            });
          }

          const { serving, exposure } = await this.exposeShare(
            cursor,
            environment.operations,
            via.plugin,
          );

          return Object.assign(cursor, {
            serving,
            listener: { reach: via.reach, exposure },
            closeEnvironment: environment.close,
          });
        } catch (cause) {
          environment.close();
          throw cause;
        }
      })();

      this.remoteAccess = pending;

      try {
        await pending;
      } catch (cause) {
        if (this.remoteAccess === pending) this.remoteAccess = undefined;
        throw cause;
      }
    }

    const state = await this.remoteAccessState();
    this.remoteAccessChanged();

    return state;
  }

  private connect(): ConnectRuntime {
    const { connect } = this.dependencies;

    if (connect === undefined) {
      throw new ExpectedHostError({
        code: "not_found",
        message: "Account remote access isn't available here.",
      });
    }

    return connect;
  }

  /**
   * Serve account remote access if it was left on, once this window has
   * prepared its target. A folder that is not trusted yet stays unserved
   * without a prompt; turning it on again asks.
   */
  async autostartConnect(window: HostWindow): Promise<void> {
    await this.dependencies.connect?.autostart(this.connectShare(window, false));
  }

  /**
   * How account remote access binds: the window's target as it stands now,
   * trusted, on an ephemeral `127.0.0.1` port. The listener and its target
   * outlive the window.
   */
  private connectShare(window: HostWindow, prompt: boolean): ConnectShare {
    return async (listen) => {
      // Bail before prepare: close waits on account remote access first.
      if (this.closed)
        throw new ExpectedHostError({
          code: "closed",
          message: "The window closed before serving",
        });
      const target = await this.prepare(window);

      if (target.kind === "project") {
        if (prompt) await this.requireTrust(target.workspace.path, window);
        else await this.workspaces.require(target.workspace.path);
      }

      if (this.closed)
        throw new ExpectedHostError({
          code: "closed",
          message: "The window closed before serving",
        });
      const cursor: ShareCursor = { open: target, sessionOwners: new Map() };
      const environment = this.shareEnvironment(cursor);
      let serving: Serving;

      try {
        serving = await this.serveShare(cursor, environment.operations, {
          auth: { kind: "custom", authorize: listen.authorize },
          handle: listen.handle,
          hostname: "127.0.0.1",
        });
      } catch (cause) {
        environment.close();
        throw cause;
      }

      this.connectShares += 1;
      let listening = true;

      return {
        port: Number(new URL(serving.address).port),
        disconnectClients: () => serving.disconnectClients(),
        close: async () => {
          if (!listening) return;
          listening = false;
          await serving.close();
          environment.close();
          this.connectShares -= 1;
        },
      };
    };
  }

  /** The built web app, when it is there to serve beside the API. */
  private servedAppRoot(): string | undefined {
    const { appRoot } = this.dependencies;

    return appRoot !== undefined && existsSync(join(appRoot, "index.html")) ? appRoot : undefined;
  }

  private serveShare(
    cursor: ShareCursor,
    environment: Environment,
    listen: Pick<ServeOptions, "hostname" | "port" | "auth" | "browserOrigins" | "handle">,
  ): Promise<Serving> {
    return startServe({
      ...listen,
      sdk: this.shareCursor(cursor),
      environment,
      version: this.dependencies.appVersion ?? "dev",
      describe: () => ({ capabilities: { workspace: true }, persistence: "durable" }),
      appRoot: this.servedAppRoot(),
      attach: (sessionId) => {
        this.attachSession(cursor.sessionOwners.get(sessionId) ?? cursor.open, sessionId);
      },
    });
  }

  /**
   * Bind the plugin's loopback port, then start its connector. If anything
   * after `expose` fails, the exposure ends, so a connector never runs without
   * this listener on its port.
   */
  private async exposeShare(
    cursor: ShareCursor,
    environment: Environment,
    plugin: RemoteAccessPlugins[RemoteAccessPluginId],
  ): Promise<{ readonly serving: Serving; readonly exposure: RemoteExposure }> {
    const exposure = await plugin.expose(this.remoteAccessChanged);

    try {
      const serving = await this.serveShare(cursor, environment, {
        hostname: "127.0.0.1",
        ...exposure.listen,
      }).catch((cause: unknown) => {
        if (cause instanceof Error && "code" in cause && cause.code === "EADDRINUSE") {
          throw new ExpectedHostError({
            code: "forbidden",
            message: `Port ${String(exposure.listen.port)} is in use on this Mac. Free it, or set the tunnel up with another port.`,
          });
        }

        throw cause;
      });

      if (this.closed) {
        await serving.close();
        throw new ExpectedHostError({
          code: "closed",
          message: "The window closed before serving",
        });
      }

      exposure.connect();

      return { serving, exposure };
    } catch (cause) {
      await exposure.disconnect();
      throw cause;
    }
  }

  /**
   * A plugin's connector stops before its port is released, so no other
   * process can bind that port while outside traffic still arrives on it.
   * Runs under the remote lock.
   */
  private async stopRemoteAccess(): Promise<void> {
    const active = await this.activeRemoteAccess();

    if (active === undefined) return;
    this.remoteAccess = undefined;
    const { listener } = active;

    if ("exposure" in listener) await listener.exposure.disconnect();
    await active.serving.close();
    active.closeEnvironment();
    this.remoteAccessChanged();
  }

  /**
   * Forget a device, then drop every open connection on the listener: a
   * stream outlives the credential check that opened it. The port stays bound
   * and the connector keeps running; other devices reconnect and authenticate
   * again. If the plugin cannot record the revoke it refuses every token, and
   * remote access stops. Runs under the remote lock.
   */
  private async revokeRemoteDevice(input: {
    readonly plugin: RemoteAccessPluginId;
    readonly deviceId: string;
  }): Promise<void> {
    const plugin = this.remotePlugin(input.plugin);

    try {
      await plugin.revoke({ deviceId: input.deviceId });
    } catch (cause) {
      await this.stopRemoteAccess();
      throw cause;
    }

    const active = await this.activeRemoteAccess();

    if (active !== undefined && active.listener.reach === input.plugin) {
      active.serving.disconnectClients();
    }

    this.remoteAccessChanged();
  }

  /** Watches on the old server end; the renderer resumes them against the new one or not at all. */
  private forgetServerSessions(): void {
    if (this.server === undefined) return;
    this.server.closing.abort();

    for (const [sessionId, owner] of this.sessionOwners) {
      if (owner === this.server) this.sessionOwners.delete(sessionId);
    }

    for (const [sessionId, tracked] of this.tracked) {
      if (tracked.open === this.server) this.tracked.delete(sessionId);
    }

    this.directory.drop(CLOUD_SOURCE);
  }

  /**
   * Read retained history in Home and registered desktop stores for one window,
   * without changing selection. Stores are read independently: one that fails
   * becomes a failed source on the page rather than an error screen over the
   * folders that answered.
   *
   * Nothing here needs the SDK or the lifecycle lock: the stores are located,
   * then read along with the external transcripts on the scanner, off this
   * thread, so an open chat never waits on a usage read.
   */
  private async usage(window: UsageWindow): Promise<UsageSnapshot> {
    const models = await this.models();

    const located = await this.usageStores().then(
      (stores) => ({ stores, nyteError: null }),
      (error) => ({ stores: [], nyteError: ipcFailure(error).message }),
    );

    const readable = located.stores.filter((store) => store.failure === null);

    const scan = await this.usageScan
      .scan({ stores: readable.map((store) => store.location), catalog: catalogForUsage(models) })
      .catch((cause): UsageScan => {
        const message = ipcFailure(cause).message;

        return {
          stores: readable.map((store) => ({ ...store.location, sessions: [], failure: message })),
          claudeCode: { kind: "failed", message },
          codex: { kind: "failed", message },
        };
      });

    const scanned = new Map(scan.stores.map((store) => [store.workspacePath, store]));

    const reads = located.stores.map((store): StoreRead => {
      const read = scanned.get(store.location.workspacePath);

      if (store.failure !== null || read === undefined) {
        return {
          workspacePath: store.location.workspacePath,
          sessions: [],
          failure: store.failure,
        };
      }

      return {
        workspacePath: store.location.workspacePath,
        sessions: read.sessions,
        failure: read.failure === null ? null : ipcFailure(new Error(read.failure)),
      };
    });

    return {
      ...projectUsageReport(reads, window, Date.now()),
      nyteError: located.nyteError,
      claudeCode: scan.claudeCode,
      codex: scan.codex,
    };
  }

  /**
   * Subscription windows from the providers themselves. Each provider answers
   * for itself, so one that is signed out or slow leaves the other's windows
   * on the page; the timeout keeps a stalled provider from holding the read.
   */
  private accountLimits(): Promise<readonly AccountUsage[]> {
    const signal = AbortSignal.timeout(ACCOUNT_LIMITS_TIMEOUT_MS);

    return this.models().then((models) =>
      Promise.all([
        readAccountUsage({ models, provider: "anthropic", signal }),
        readAccountUsage({ models, provider: "openai-codex", signal }),
      ]),
    );
  }

  /** Every store the page reads. Subagents spend on their parent's behalf, so the scan counts their chats too. */
  private async usageStores(): Promise<readonly LocatedStore[]> {
    const workspaces = await this.workspaces.list();

    const targets: WorkspaceTarget[] = [
      { kind: "home" },
      ...workspaces.map((workspace) => ({ kind: "project", workspace }) satisfies WorkspaceTarget),
    ];

    return Promise.all(
      targets.map(async (target): Promise<LocatedStore> => {
        const workspacePath = target.kind === "home" ? null : target.workspace.path;

        try {
          return { location: { workspacePath, path: await storePath(target) }, failure: null };
        } catch (error) {
          return { location: { workspacePath, path: "" }, failure: ipcFailure(error) };
        }
      }),
    );
  }

  private async teardownOpen(): Promise<void> {
    this.selections.clear();
    // Remote clients' streams end before the SDK they read from closes.
    await this.remoteSerial(() => this.stopRemoteAccess());

    for (const watch of this.watches.values()) watch.controller.abort();
    this.watches.clear();

    for (const tracked of this.tracked.values()) tracked.controller.abort();
    this.tracked.clear();
    this.sessionOwners.clear();
    this.closedDirectories.clear();

    for (const open of this.openTargets.values()) {
      for (const attachment of open.sessionAttachments.values()) attachment.detach();
      open.sessionAttachments.clear();
      await open.sdk.close().catch(() => undefined);
      await open.store.close().catch(() => undefined);
    }

    this.openTargets.clear();
    this.server = undefined;
  }

  /**
   * Start the attempt on the shared environment and follow it to its end.
   * Device codes and messages reach the renderer as they land; a sign-in
   * link opens on this Mac instead of being shown.
   */
  private async login(window: HostWindow, input: CallInput<"host.login">): Promise<LoginOutcome> {
    const { provider, attempt } = input;
    const { operations } = this.environment;

    if (this.closed)
      throw new ExpectedHostError({ code: "closed", message: "The window closed before sign-in" });

    if ((await operations["environment.loginAttempt"]({ attempt })).kind !== "unknown")
      throw new ExpectedHostError({
        code: "invalid_input",
        message: "A sign-in with this attempt ID already exists.",
        issues: [{ path: "/attempt", message: "Attempt IDs must be unique" }],
      });

    const report = (progress: LoginProgress): void =>
      this.dependencies.emitHostEvent(
        { kind: "login_progress", attempt, provider, progress },
        window,
      );

    let opened = false;
    let shown = "";
    const owner = this.windowSignIns.get(window) ?? new AbortController();
    this.windowSignIns.set(window, owner);
    await this.environment.owned(owner.signal)["environment.login"](input);

    for await (const state of this.environment.follow(attempt)) {
      if (state.kind === "settled") return state.outcome;

      if (state.kind !== "running") break;

      if (state.browser !== undefined && !opened) {
        opened = true;

        try {
          this.dependencies.openExternal(safeExternalUrl(state.browser.url));
        } catch {
          report({
            kind: "message",
            message: "The provider sent a sign-in link that isn't a web address.",
          });
        }
      }

      const progress: LoginProgress[] = [];

      if (state.deviceCode !== undefined)
        progress.push({ kind: "device_code", ...state.deviceCode });

      if (state.message !== undefined) progress.push({ kind: "message", message: state.message });
      // A device code resets the message it replaces, so any change replays both.
      const key = JSON.stringify(progress);

      if (key === shown) continue;
      shown = key;

      for (const item of progress) report(item);
    }

    throw new ExpectedHostError({ code: "internal", message: "The sign-in failed." });
  }

  private readonly githubCommand: GitHubCommandRunner = (request) => {
    // Only command verbs may label spans. Never include branch names or other operands.
    const candidate = [request.command, ...request.args.slice(0, 2)].join(".");

    const operation =
      [
        "git.remote",
        "git.symbolic-ref",
        "gh.api",
        "gh.pr.view",
        "gh.pr.create",
        "gh.auth.status",
        "gh.auth.login",
        "gh.auth.logout",
      ].find((allowed) => candidate === allowed || candidate.startsWith(`${allowed}.`)) ??
      `${request.command}.other`;

    return this.otel.telemetry.startSpan(
      { name: "desktop.github.command", attributes: { operation } },
      async (span) => {
        const started = performance.now();
        let result: GitHubCommandResult;

        try {
          result = await (this.dependencies.runGitHubCommand ?? runGitHubCommand)(request);
        } catch {
          // Some adapters record thrown exceptions, which can contain credentials or paths.
          result = { kind: "failed" };
        }

        span.setAttributes({
          outcome: result.kind,
          code: result.kind === "completed" ? result.code : undefined,
          duration_ms: performance.now() - started,
        });
        span.setStatus({
          status: result.kind === "completed" && result.code === 0 ? "ok" : "error",
        });

        return result;
      },
    );
  };

  /**
   * This Mac's GitHub CLI login. Renderer windows and remote clients share
   * it, so a sign-in from either side is the one the other sees; a stopped
   * share still cancels only the sign-in it started.
   */
  private readonly github = createGitHubService({
    beforeCommand: ensureShellEnvironment,
    run: this.githubCommand,
  });

  private githubWorkspace(window: HostWindow): string | undefined {
    const open = this.selections.get(window);

    return open?.kind === "project" ? open.workspace.path : undefined;
  }

  private readonly githubChanged = <T>(state: T): T => {
    this.dependencies.emitHostEvent({ kind: "github_changed" });

    return state;
  };
}
