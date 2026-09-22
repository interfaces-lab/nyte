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
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { MutableModels } from "@nyte-ai/ai";
import { createNyte, dispatch, watchPluginDirectories } from "@nyte-ai/core";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type {
  Disposer,
  ResolvedPlugins,
  SessionActivation,
  SessionId,
  SessionInfo,
  Nyte,
  WorkspaceInfo,
  WorkspaceSelectInput,
  WorkspaceSelectOutcome,
  WorkspaceSelection,
} from "@nyte-ai/core";
import { createNyteClient } from "@nyte-ai/client";
import type { NyteClient } from "@nyte-ai/client";
// Hosts name their storage backend through the store entry; the worker keeps
// SQLite off Electron's main thread.
import { WorkerStore } from "@nyte-ai/core/store";
import type { Store } from "@nyte-ai/core/store";
import {
  createGitVcs,
  createHost,
  createWorkspaceStore,
  discoverMentionFiles,
  nyteHome,
  pluginWatchTargets,
  rankMentionFiles,
  readWorkspaceFile,
  resolveHostPlugins,
  saveWorkspaceFile,
  workspaceStorePath,
  WorkspaceTrustRequired,
} from "@nyte-ai/host";
import type { DeferredPluginTarget, PluginTarget } from "@nyte-ai/host";
import { createOtelExport } from "@nyte-ai/host/otel";
import { SDK_OPERATION_PATHS } from "../shared/ipc.ts";
import type {
  CallInput,
  CallOutput,
  CallPath,
  DesktopCatalog,
  LoginOutcome,
  HostEvent,
  HostState,
  GitHubProviderState,
  HostBridge,
  LocalFontCatalog,
  MobileShareReach,
  MobileShareState,
  OpenWorkspaceOutcome,
  PreferenceChange,
  SdkOperationPath,
  ServerConnectOutcome,
  ServerState,
  TailnetAvailability,
  UsageSnapshot,
  UsageWindow,
  WatchEnvelope,
  WatchStartInput,
  WorkspaceSessionDirectory,
} from "../shared/ipc.ts";
import { loadPersistedCatalog, login, readCatalog } from "./catalog.ts";
import type { ResolvedCatalog } from "./catalog.ts";
import { safeExternalUrl } from "./external-url.ts";
import type { BrowserSurfaces } from "./browser.ts";
import { browserToolsPlugin } from "./browser-tools.ts";
import { TerminalSessions } from "./terminals.ts";
import { createGitHubProvider, runProviderCommand } from "./github.ts";
import type { CommandRunner, CommandResult, GitHubProvider } from "./github.ts";
import { CALL_INPUT_SCHEMAS } from "./ipc-inputs.ts";
import { ExpectedHostError, ipcFailure, retainDiagnostic } from "./errors.ts";
import type { IpcFailure } from "../shared/errors.ts";
import { ensureShellEnvironment } from "./shell-environment.ts";
import { catalogForUsage, UsageScanner } from "./usage-scan.ts";
import type { StoreLocation, UsageScan, UsageScanReader } from "./usage-scan.ts";
import { readAccountUsage } from "@nyte-ai/host/usage";
import type { AccountUsage } from "@nyte-ai/host/usage";
import { projectUsageReport } from "./usage.ts";
import type { StoreRead } from "./usage.ts";
import { startMobileShare } from "./mobile-share.ts";
import type { MobileShare } from "./mobile-share.ts";
import { findTailnetAddress } from "./tailnet.ts";
import { ServerSettingsStore } from "./server-settings.ts";
import type { ServerSettings } from "./server-settings.ts";
import { serverCatalog, serverConnectionProblem } from "./server-connection.ts";
import {
  createBrowserAccessStore,
  createModelPreferencesStore,
  readLastWorkspace,
  rememberWorkspace,
} from "./workspaces.ts";

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
  /** Where usage history is scanned. The app uses a worker thread. */
  readonly usageScan?: UsageScanReader;
  readonly createHost?: typeof createHost;
  /** The store's worker thread module, so SQLite work never runs on the main thread. */
  readonly storeWorker: URL;
  readonly runGitHubCommand?: CommandRunner;
  readonly createOtelExport?: typeof createOtelExport;
  /** Push a host event to the focused window; dropped when none is open. */
  emitHostEvent(event: HostEvent): void;
  /** Push one watch envelope to the subscribing window. */
  emitWatchEvent(envelope: WatchEnvelope): void;
  openExternal(url: string): void;
  /** Show a file or folder in the system file manager. */
  revealPath(path: string): void;
  /** Where a discarded untracked file goes; the app uses the OS trash. Absent, the host's own trash. */
  readonly trashPath?: (path: string) => Promise<void>;
  /** Native right-click menu, with the renderer's own signature. */
  showContextMenu: HostBridge["contextMenu"];
  browser: BrowserSurfaces;
  listFonts(): Promise<LocalFontCatalog>;
  /** Native folder picker; resolves undefined on cancel. */
  pickFolder(): Promise<string | undefined>;
}

interface LoginAttempt {
  readonly provider: string;
  readonly controller: AbortController;
  /** Resolves once the flow has stopped, whichever way it ended. */
  readonly settled: Promise<void>;
}

interface WatchLifetime {
  readonly controller: AbortController;
  readonly sessionId: SessionId;
}

interface SessionAttachment {
  readonly detach: Disposer;
  generation: number;
}

interface OpenTargetBase {
  readonly sdk: Nyte;
  readonly store: Store;
  readonly sessionAttachments: Map<SessionId, SessionAttachment>;
  /** Stops watching the plugin sources this target resolves from. */
  readonly stopPluginWatch: Disposer;
}

interface OpenHomeTarget extends OpenTargetBase {
  readonly kind: "home";
}

interface OpenProjectTarget extends OpenTargetBase {
  readonly kind: "project";
  readonly workspace: WorkspaceInfo;
}

type LocalSessionDirectory = Extract<WorkspaceSessionDirectory, { environment: "local" }>;

type CloudAvailability = Extract<
  WorkspaceSessionDirectory,
  { environment: "cloud" }
>["availability"];

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
  sessions: readonly SessionInfo[];
  /** What the last completed list read said; a read still in flight does not change it. */
  availability: CloudAvailability;
}

type OpenLocalTarget = OpenHomeTarget | OpenProjectTarget;
type OpenTarget = OpenLocalTarget | OpenServerTarget;

type WorkspaceTarget =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: WorkspaceInfo };

/** Keep desktop history outside the project, including when the project is deleted. */
function storePath(target: WorkspaceTarget): Promise<string> {
  return target.kind === "home"
    ? Promise.resolve(join(nyteHome(), "sessions.db"))
    : workspaceStorePath(target.workspace.path);
}

function serverTarget(settings: ServerSettings): OpenServerTarget {
  return {
    kind: "server",
    baseUrl: settings.baseUrl,
    closing: new AbortController(),
    sdk: createNyteClient({
      baseUrl: settings.baseUrl,
      token: settings.token,
      fetch: (input, init) => {
        // Watches stay open; finite reads and writes must not leave the desktop waiting forever.
        if (new Headers(init?.headers).get("accept") === "text/event-stream")
          return fetch(input, init);
        const timeout = AbortSignal.timeout(15_000);
        const signal = init?.signal == null ? timeout : AbortSignal.any([init.signal, timeout]);
        return fetch(input, { ...init, signal });
      },
    }),
    sessions: [],
    availability: { kind: "ready" },
  };
}

/**
 * How long a directory read waits for a fresh server list before using its
 * cached list. The read keeps going so the next poll sees the result.
 */
const DIRECTORY_SERVER_BUDGET_MS = 100;
const CLOSED_DIRECTORY_MAX_AGE_MS = 60_000;
const CLOSED_DIRECTORY_REFRESH_BATCH = 4;

/** The share's own cursor; Mac `this.open` may move without it. */
interface ShareCursor {
  open: OpenLocalTarget;
  readonly sessionOwners: Map<SessionId, OpenLocalTarget>;
}

/** The share listener and the local target it currently serves. */
interface ActiveMobileShare extends ShareCursor {
  readonly share: MobileShare;
  readonly reach: MobileShareReach;
}

/** A store the page will read, with what only the SDK can say about it. */
interface NamedStore {
  readonly location: StoreLocation;
  readonly names: ReadonlyMap<SessionId, string | undefined>;
  readonly failure: IpcFailure | null;
}

/** Long enough for a provider round trip, short enough that Usage still paints. */
const ACCOUNT_LIMITS_TIMEOUT_MS = 10_000;

/** The bridge's own SDK subset: `landing` is a protocol operation the desktop never carries. */
const SDK_OPERATIONS: ReadonlySet<string> = new Set(SDK_OPERATION_PATHS);
const TRUSTED_RUN_OPERATIONS: ReadonlySet<string> = new Set(["runs.diff", "runs.revert"]);

function isSdkOperation(path: CallPath): path is SdkOperationPath {
  return SDK_OPERATIONS.has(path);
}

export class DesktopHost {
  private readonly dependencies: DesktopHostDependencies;
  private readonly workspaces = createWorkspaceStore();
  private readonly preferences = createModelPreferencesStore();
  private readonly browserAccess = createBrowserAccessStore();
  private readonly serverSettings = new ServerSettingsStore(join(nyteHome(), "server.json"));
  private readonly usageScan: UsageScanReader;
  private readonly otel: ReturnType<typeof createOtelExport>;
  private modelsPromise: Promise<MutableModels> | undefined;
  private catalogPromise: Promise<ResolvedCatalog> | undefined;
  private target: WorkspaceTarget = { kind: "home" };
  private open: OpenLocalTarget | undefined;
  private readonly openTargets = new Map<string | null, OpenLocalTarget>();
  private server: OpenServerTarget | undefined;
  /** One server list read at a time; overlapping directory reads share it. */
  private serverDirectoryRead: Promise<WorkspaceSessionDirectory | undefined> | undefined;
  /** In flight from start until stopped, so two Start presses share one listener. */
  private mobileShare: Promise<ActiveMobileShare> | undefined;
  private readonly sessionOwners = new Map<SessionId, OpenTarget | WorkspaceTarget>();
  private readonly closedDirectories = new Map<
    string | null,
    { readonly directory: LocalSessionDirectory; readonly refreshedAt: number }
  >();
  private sessionDirectoryRead: Promise<readonly WorkspaceSessionDirectory[]> | undefined;
  private lifecycle: Promise<void> = Promise.resolve();
  private readonly mentionRequests = new Map<string, AbortController>();
  private readonly watches = new Map<string, WatchLifetime>();
  /**
   * Sign-ins by the renderer's attempt ID, kept until the flow has settled so
   * a cancelled attempt's cleanup can never erase a newer entry and an ID
   * cannot be reused while its first flow still winds down.
   */
  private readonly loginAttempts = new Map<string, LoginAttempt>();
  private closed = false;
  private terminalsPromise: Promise<TerminalSessions> | undefined;
  private terminalGeneration = 0;

  constructor(dependencies: DesktopHostDependencies) {
    this.dependencies = dependencies;
    this.usageScan = dependencies.usageScan ?? new UsageScanner(nyteHome());
    this.otel = (dependencies.createOtelExport ?? createOtelExport)({
      serviceName: "nyte-desktop",
    });
  }

  /** The one renderer entry point: an operation path and its single input object. */
  call<P extends CallPath>(path: P, input: CallInput<P>): Promise<CallOutput<P>>;
  async call(path: CallPath, input: CallInput<CallPath>): Promise<CallOutput<CallPath>> {
    if (isSdkOperation(path)) return this.callSdk(path, input);
    switch (path) {
      case "host.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        await this.prepare();
        return this.state();
      case "host.sessionDirectory":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.sessionDirectory();
      case "host.fonts":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.dependencies.listFonts();
      case "host.openWorkspace":
        return this.openWorkspace(CALL_INPUT_SCHEMAS[path].Parse(input).path);
      case "host.pickWorkspace":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.pickWorkspace();
      case "host.trustWorkspace":
        return this.trustWorkspace(CALL_INPUT_SCHEMAS[path].Parse(input).path);
      case "host.closeWorkspace":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.closeWorkspace();
      case "host.catalog": {
        const query = CALL_INPUT_SCHEMAS[path].Parse(input);
        const owner = query === undefined ? undefined : await this.owner(query.sessionId);
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
        return this.login(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.cancelLogin":
        this.cancelLogin(CALL_INPUT_SCHEMAS[path].Parse(input).attempt);
        return undefined;
      case "host.logout":
        return this.logout(CALL_INPUT_SCHEMAS[path].Parse(input).provider);
      case "host.setPreference":
        return this.setPreference(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.github.createPullRequest": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject();
        await this.requireTrust(project.workspace.path);
        return this.github().createPullRequest(decoded);
      }
      case "host.files.list": {
        const { requestId } = CALL_INPUT_SCHEMAS[path].Parse(input);
        const cwd = this.requireProject().workspace.path;
        if (this.mentionRequests.has(requestId) || this.mentionRequests.size >= 4)
          throw new ExpectedHostError({
            code: "invalid_input",
            message: "Mention request is already active or the request limit was reached.",
            issues: [],
          });
        const controller = new AbortController();
        this.mentionRequests.set(requestId, controller);
        try {
          return await discoverMentionFiles(cwd, controller.signal);
        } finally {
          this.mentionRequests.delete(requestId);
        }
      }
      case "host.files.cancelList":
        this.mentionRequests.get(CALL_INPUT_SCHEMAS[path].Parse(input).requestId)?.abort();
        return undefined;
      case "host.files.read": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject();
        return readWorkspaceFile(project.workspace.path, decoded.path);
      }
      case "host.files.save": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const project = this.requireProject();
        await this.requireTrust(project.workspace.path);
        return saveWorkspaceFile(project.workspace.path, decoded);
      }
      case "host.github.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.github().state();
      case "host.github.signIn":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.changeGitHubAuth("signIn");
      case "host.github.signOut":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.changeGitHubAuth("signOut");
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
        const session = await server.sdk.sessions.create({});
        this.sessionOwners.set(session.sessionId, server);
        return session;
      }
      case "host.mobile.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.mobileShareState();
      case "host.mobile.start": {
        const { reach } = CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.startMobileShare(reach);
      }
      case "host.mobile.stop":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        return this.stopMobileShare();
      case "host.openExternal": {
        const { url } = CALL_INPUT_SCHEMAS[path].Parse(input);
        this.dependencies.openExternal(safeExternalUrl(url));
        return undefined;
      }
      case "host.revealPath": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        this.dependencies.revealPath(decoded.path);
        return undefined;
      }
      case "host.contextMenu":
        return this.dependencies.showContextMenu(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.open":
        return this.dependencies.browser.open(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.navigate":
        this.dependencies.browser.navigate(CALL_INPUT_SCHEMAS[path].Parse(input));
        return undefined;
      case "host.browser.menu":
        return this.dependencies.browser.menu(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.perform":
        return this.dependencies.browser.perform(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.close":
        this.dependencies.browser.close(CALL_INPUT_SCHEMAS[path].Parse(input));
        return undefined;
      case "host.browser.captureFrame":
        return this.dependencies.browser.captureFrame(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.create": {
        const generation = this.terminalGeneration;
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const cwd = decoded.workspacePath ?? homedir();
        if (decoded.workspacePath !== null) {
          if (this.requireProject().workspace.path !== decoded.workspacePath) {
            throw new ExpectedHostError({
              code: "forbidden",
              message: "Open this workspace before starting a terminal",
            });
          }
          await this.requireTrust(cwd);
        }
        const [terminals] = await Promise.all([this.terminals(), ensureShellEnvironment()]);
        if (this.closed || generation !== this.terminalGeneration)
          throw new ExpectedHostError({ code: "closed", message: "Terminal window closed" });
        return terminals.create({ id: decoded.id, cwd });
      }
      case "host.terminal.write":
        return (await this.terminals()).write(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.resize":
        return (await this.terminals()).resize(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.acknowledge":
        return (await this.terminals()).acknowledge(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.idle":
        return (await this.terminals()).idle(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.close":
        return (await this.terminals()).close(CALL_INPUT_SCHEMAS[path].Parse(input));
      default:
        path satisfies never;
        throw new Error("Unknown operation");
    }
  }

  /**
   * Route an SDK operation to the workspace that owns its session. The cases are
   * the operations that answer without a workspace open or that record ownership;
   * every other operation reaches its SDK unchanged.
   */
  private async callSdk(
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
        return catalog.models.find(
          (model) =>
            model.id === catalog.defaults.model.id &&
            model.provider === catalog.defaults.model.provider,
        );
      }
      case "sessions.create": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.prepare();
        const session = await open.sdk.sessions.create(decoded);
        this.sessionOwners.set(session.sessionId, open);
        return session;
      }
      case "sessions.list": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.owner(decoded?.parent ?? undefined);
        const page = await open.sdk.sessions.list(decoded);
        for (const session of page.items) this.sessionOwners.set(session.sessionId, open);
        return page;
      }
      case "sessions.setArchived": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.owner(decoded.sessionId);
        await open.sdk.sessions.setArchived(decoded);
        if (decoded.archived) {
          await this.releaseSessionIfIdle(open, decoded.sessionId).catch(() => undefined);
        }
        return;
      }
      case "sessions.delete": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.owner(decoded.sessionId);
        await open.sdk.sessions.delete(decoded);
        this.releaseSessionAttachment(open, decoded.sessionId);
        this.sessionOwners.delete(decoded.sessionId);
        return;
      }
      case "messages.send": {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const open = await this.owner(decoded.sessionId);
        this.attachSession(open, decoded.sessionId);
        return open.sdk.messages.send(decoded);
      }
      case "workspace.vcs.snapshot":
      case "workspace.vcs.diff":
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
        const open = await this.owner(sessionId);
        if (open.kind === "project") {
          const cwd =
            sessionId === undefined
              ? open.workspace.path
              : await open.sdk.sessionCwd({ sessionId });
          if (cwd === undefined) {
            throw new ExpectedHostError({
              code: "not_found",
              message: "The session workspace could not be resolved",
            });
          }
          await this.requireTrust(cwd);
        }
        return dispatch(open.sdk, path, decoded);
      }
      default: {
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        const sessionId =
          decoded !== undefined && "sessionId" in decoded ? decoded.sessionId : undefined;
        const open = await this.owner(sessionId);
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
          await this.requireTrust(cwd);
        }
        return dispatch(open.sdk, path, decoded);
      }
    }
  }

  watchStart(input: WatchStartInput): void {
    if (this.watches.has(input.watchId))
      throw new ExpectedHostError({
        code: "invalid_input",
        message: "Watch already exists. Stop it before starting it again.",
        issues: [],
      });
    const stop = new AbortController();
    const lifetime = { controller: stop, sessionId: input.sessionId } satisfies WatchLifetime;
    this.watches.set(input.watchId, lifetime);
    void (async () => {
      let open: OpenTarget | undefined;
      try {
        open = await this.owner(input.sessionId);
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
          this.dependencies.emitWatchEvent({ watchId: input.watchId, kind: "event", event });
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
          );
        }
      } catch (cause) {
        if (!stop.signal.aborted) {
          this.dependencies.emitWatchEvent({
            watchId: input.watchId,
            kind: "ended",
            error: ipcFailure(cause),
          });
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

  /** A reloaded renderer never sends its stops; its watches would pump into a dead frame. */
  stopWatches(): void {
    for (const watch of this.watches.values()) watch.controller.abort();
    this.watches.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cancelLogins();
    for (const controller of this.mentionRequests.values()) controller.abort();
    try {
      await this.closeTerminals();
      await this.sessionDirectoryRead?.catch(() => undefined);
      await this.serialize(() => this.teardownOpen());
    } finally {
      await Promise.all([this.otel.shutdown(), this.usageScan.close()]);
    }
  }

  async closeTerminals(): Promise<void> {
    this.terminalGeneration += 1;
    const pending = this.terminalsPromise;
    this.terminalsPromise = undefined;
    if (pending !== undefined) (await pending).dispose();
  }

  async updateActivity(): Promise<DesktopUpdateActivity> {
    const terminalCommandCount =
      this.terminalsPromise === undefined ? 0 : (await this.terminalsPromise).busyCount();
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

  private terminals(): Promise<TerminalSessions> {
    this.terminalsPromise ??= Promise.resolve(
      new TerminalSessions((event) => this.dependencies.emitHostEvent(event)),
    );
    return this.terminalsPromise;
  }

  private state(): HostState {
    return {
      workspace: this.open?.kind === "project" ? this.open.workspace : undefined,
      platform: process.platform,
    };
  }

  private requireProject(): OpenProjectTarget {
    const open = this.open;
    if (open?.kind !== "project")
      throw new ExpectedHostError({ code: "not_found", message: "No project is open" });
    return open;
  }

  /**
   * Gate a host mutation on trust. Session work never comes here: the SDK
   * reports its own activation, and the renderer prompts from that.
   */
  private async requireTrust(path: string): Promise<void> {
    try {
      await this.workspaces.require(path);
    } catch (cause) {
      if (cause instanceof WorkspaceTrustRequired) {
        this.dependencies.emitHostEvent({ kind: "workspace_trust_required", path: cause.cwd });
      }
      throw cause;
    }
  }

  /** Prepare local storage while Chromium starts; IPC joins the same initialization. */
  prepare(): Promise<OpenLocalTarget> {
    if (this.open !== undefined) return Promise.resolve(this.open);
    return this.serialize(async () => {
      if (this.open !== undefined) return this.open;
      const path = await readLastWorkspace();
      if (path !== null) {
        const workspace = (await this.workspaces.list()).find((entry) => entry.path === path);
        if (workspace !== undefined) {
          // A broken saved project must not prevent opening the desktop on Home.
          const restored = await this.compose({ kind: "project", workspace }).catch(
            () => undefined,
          );
          if (restored !== undefined) {
            this.target = { kind: "project", workspace };
            this.open = restored;
            return restored;
          }
        }
      }
      const open = await this.compose(this.target);
      this.open = open;
      return open;
    });
  }

  /** Volunteer this process as the session's runner. A server runs its own sessions. */
  private attachSession(open: OpenTarget, sessionId: SessionId): void {
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
  }

  private async releaseSessionIfIdle(open: OpenTarget, sessionId: SessionId): Promise<void> {
    if (open.kind === "server") return;
    const attachment = open.sessionAttachments.get(sessionId);
    if (attachment === undefined) return;
    const generation = attachment.generation;
    const session = await open.sdk.sessions.get({ sessionId });
    const descendants = new Set<SessionId>();
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

  /** The workspace that owns a known session; the selected one for anything else. */
  private owner(sessionId: SessionId | undefined): Promise<OpenTarget> {
    const owner = sessionId === undefined ? undefined : this.sessionOwners.get(sessionId);
    if (owner === undefined) return this.prepare();
    if ("sdk" in owner) return Promise.resolve(owner);
    return this.serialize(async () => {
      if (sessionId === undefined) return this.compose(this.target);
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
      await loadPersistedCatalog(models);
      return models;
    })();
    return this.modelsPromise;
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

  private invalidateCatalog(): void {
    this.catalogPromise = undefined;
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

  private async pickWorkspace(): Promise<OpenWorkspaceOutcome> {
    const path = await this.dependencies.pickFolder();
    if (path === undefined) return { kind: "cancelled" };
    return this.openWorkspace(path);
  }

  private trustWorkspace(path: string): Promise<OpenWorkspaceOutcome> {
    return this.serialize<OpenWorkspaceOutcome>(async () => {
      await this.workspaces.trust(path);
      await Promise.all([...this.openTargets.values()].map((open) => open.sdk.reactivate()));
      return { kind: "cancelled" };
    }).catch((cause): OpenWorkspaceOutcome => ({
      kind: "failed",
      message: ipcFailure(cause).message,
    }));
  }

  private openWorkspace(path: string): Promise<OpenWorkspaceOutcome> {
    return this.serialize(() => this.selectProject(path)).catch((cause): OpenWorkspaceOutcome => ({
      kind: "failed",
      message: ipcFailure(cause).message,
    }));
  }

  /** Selection opens local history. Core resolves the execution path when sending. */
  private async selectProject(path: string): Promise<OpenWorkspaceOutcome> {
    const cwd = await realpath(resolve(path)).catch(() => resolve(path));
    if (this.open?.kind === "project" && this.open.workspace.path === cwd) {
      return { kind: "opened", workspace: this.open.workspace };
    }
    await this.workspaces.touch(cwd);
    const workspace = (await this.workspaces.list()).find((entry) => entry.path === cwd);
    if (workspace === undefined) throw new Error(`Workspace was not recorded: ${cwd}`);
    const target = { kind: "project", workspace } as const;
    // Keep the current session open if local storage cannot be composed.
    const open = await this.compose(target);
    this.target = target;
    this.open = open;
    await rememberWorkspace(cwd);
    this.dependencies.emitHostEvent({ kind: "workspace_opened", workspace: open.workspace });
    return { kind: "opened", workspace: open.workspace };
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
    return open;
  }

  private async createTarget(target: WorkspaceTarget): Promise<OpenLocalTarget> {
    const models = await this.models();
    const { catalog, defaultModel: fallback } = await this.catalog();
    const projectCwd = target.kind === "project" ? target.workspace.path : undefined;
    const store = new WorkerStore({
      path: await storePath(target),
      worker: this.dependencies.storeWorker,
    });
    const trashPath = this.dependencies.trashPath;
    const vcs =
      projectCwd === undefined
        ? undefined
        : createGitVcs(projectCwd, {
            beforeCommand: ensureShellEnvironment,
            ...(trashPath === undefined ? {} : { discard: trashPath }),
          });
    let sdk: Nyte | undefined;
    let stopPluginWatch: Disposer | undefined;
    try {
      await store.ready();
      const extraPlugins = [
        browserToolsPlugin({
          agent: this.dependencies.browser.agent,
          access: this.browserAccess,
        }),
      ];
      const reportPluginFailure = (failure: ResolvedPlugins["failures"][number]): void =>
        this.dependencies.emitHostEvent({
          kind: "status",
          // The producer retained only this failure record, not its original Error.
          message: ipcFailure(failure).message,
        });
      // Plugin sources are only read once the workspace is trusted, so the watch starts with the
      // first resolution that reads them and re-resolves on every later change to the same sources.
      const watchPluginSources = (resolved: PluginTarget): void => {
        const host = sdk;
        if (host === undefined || stopPluginWatch !== undefined) return;
        stopPluginWatch = watchPluginDirectories({
          directories: pluginWatchTargets(resolved),
          // Runners wait on the hold, so a plugin the model just wrote is in its next request.
          hold: () => host.holdPlugins(),
          onChange: async () => {
            const reloaded = await resolveHostPlugins(resolved, {
              models,
              model: fallback,
              extra: extraPlugins,
            });
            for (const failure of reloaded.failures) reportPluginFailure(failure);
            await host.setPlugins(reloaded.plugins);
          },
          onError: (error) =>
            this.dependencies.emitHostEvent({ kind: "status", message: error.message }),
        });
      };
      sdk = await (this.dependencies.createHost ?? createHost)({
        store,
        models,
        model: fallback,
        thinkingLevel: catalog.defaults.thinkingLevel,
        telemetry: this.otel.telemetry,
        onDiagnostic: retainDiagnostic,
        workspace: {
          list: () => this.workspaces.list(),
          touch: (path, now) => this.workspaces.touch(path, now),
          forget: (path) => this.workspaces.forget(path),
          files: async ({ cwd, query, signal }) =>
            rankMentionFiles(await discoverMentionFiles(cwd, signal), query ?? ""),
          vcs,
        },
        plugins: {
          kind: "workspace",
          // Storage opens before trust; project code loads once the user has granted it.
          target: {
            kind: "deferred",
            resolve: async () => {
              const resolved = await this.pluginTarget(target);
              if (resolved.kind === "home" || resolved.kind === "project") {
                await ensureShellEnvironment();
                watchPluginSources(resolved);
              }
              return resolved;
            },
          },
          onFailure: reportPluginFailure,
          extra: extraPlugins,
        },
      });
      const base = {
        sdk,
        store,
        sessionAttachments: new Map<SessionId, SessionAttachment>(),
        stopPluginWatch: () => stopPluginWatch?.(),
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
      stopPluginWatch?.();
      await sdk?.close().catch(() => undefined);
      await store.close().catch(() => undefined);
      throw error;
    }
  }

  /** Drop a workspace from the rail. Forgetting the selected one returns the view to Home. */
  private async forgetWorkspace(path: string): Promise<void> {
    const target = await realpath(resolve(path)).catch(() => resolve(path));
    await this.workspaces.forget(path);
    if (this.open?.kind === "project" && this.open.workspace.path === target) {
      await this.closeWorkspace();
    }
    await this.sessionDirectoryRead?.catch(() => undefined);
    await this.serialize(() => this.retireForgottenTarget(target));
  }

  private async retireForgottenTarget(path: string): Promise<void> {
    const open = this.openTargets.get(path);
    if (this.sessionDirectoryRead !== undefined) {
      const retry = (): Promise<void> => this.serialize(() => this.retireForgottenTarget(path));
      void this.sessionDirectoryRead.then(retry, retry).catch(() => undefined);
      return;
    }
    if (
      open !== undefined &&
      (open === this.open ||
        open.sessionAttachments.size > 0 ||
        this.watches.size > 0 ||
        this.mobileShare !== undefined ||
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
    if (open === undefined) return;
    open.stopPluginWatch();
    await open.sdk.close().catch(() => undefined);
    await open.store.close().catch(() => undefined);
  }

  private closeWorkspace(): Promise<void> {
    return this.serialize(async () => {
      this.open = await this.compose({ kind: "home" });
      this.target = { kind: "home" };
      await rememberWorkspace(null);
      this.dependencies.emitHostEvent({ kind: "workspace_closed" });
    });
  }

  private async readClosedDirectory(target: WorkspaceTarget): Promise<readonly SessionInfo[]> {
    const models = await this.models();
    const { defaultModel } = await this.catalog();
    const store = new WorkerStore({
      path: await storePath(target),
      worker: this.dependencies.storeWorker,
    });
    let sdk: Nyte | undefined;
    try {
      await store.ready();
      sdk = await createNyte({
        store,
        models,
        model: defaultModel,
        drain: "all",
        streamFn: (model, context, options) => models.streamSimple(model, context, options),
        telemetry: this.otel.telemetry,
        resolveActivation: async (): Promise<SessionActivation> => {
          const resolved = await this.pluginTarget(target);
          switch (resolved.kind) {
            case "home":
              return { kind: "active", plugins: [], env: { cwd: homedir() } };
            case "project":
              return { kind: "active", plugins: [], env: { cwd: resolved.workspace.cwd } };
            case "inactive":
            case "requires":
              return resolved;
            default: {
              const _exhaustive: never = resolved;
              return _exhaustive;
            }
          }
        },
      });
      const { items } = await sdk.sessions.list({ parent: null, includeArchived: true });
      return items;
    } finally {
      await sdk?.close().catch(() => undefined);
      await store.close().catch(() => undefined);
    }
  }

  private sessionDirectory(): Promise<readonly WorkspaceSessionDirectory[]> {
    if (this.closed)
      return Promise.reject(
        new ExpectedHostError({ code: "closed", message: "The window is closed" }),
      );
    return (this.sessionDirectoryRead ??= this.readSessionDirectory().finally(() => {
      this.sessionDirectoryRead = undefined;
    }));
  }

  private async readSessionDirectory(): Promise<readonly WorkspaceSessionDirectory[]> {
    const server = this.serverDirectory();
    const local = (async () => {
      const targets = await this.serialize(async () => {
        const workspaces = await this.workspaces.list();
        return [
          { kind: "home" },
          ...workspaces.map(
            (workspace) => ({ kind: "project", workspace }) satisfies WorkspaceTarget,
          ),
        ] satisfies WorkspaceTarget[];
      });
      const directories: LocalSessionDirectory[] = [];
      const now = Date.now();
      const refreshClosed = new Set(
        targets
          .map((target) => (target.kind === "home" ? null : target.workspace.path))
          .filter((workspacePath) => {
            if (this.openTargets.has(workspacePath)) return false;
            const cached = this.closedDirectories.get(workspacePath);
            return cached !== undefined && now - cached.refreshedAt >= CLOSED_DIRECTORY_MAX_AGE_MS;
          })
          .sort(
            (left, right) =>
              (this.closedDirectories.get(left)?.refreshedAt ?? 0) -
              (this.closedDirectories.get(right)?.refreshedAt ?? 0),
          )
          .slice(0, CLOSED_DIRECTORY_REFRESH_BATCH),
      );
      for (let index = 0; index < targets.length; index += 4) {
        const reads = await Promise.allSettled(
          targets.slice(index, index + 4).map(async (target): Promise<LocalSessionDirectory> => {
            const workspacePath = target.kind === "home" ? null : target.workspace.path;
            const existing = this.openTargets.get(workspacePath);
            const cached = this.closedDirectories.get(workspacePath);
            if (
              existing === undefined &&
              cached !== undefined &&
              !refreshClosed.has(workspacePath)
            ) {
              return cached.directory;
            }
            const items =
              existing === undefined
                ? await this.readClosedDirectory(target)
                : (
                    await existing.sdk.sessions.list({
                      parent: null,
                      includeArchived: true,
                    })
                  ).items;
            for (const session of items) {
              if (!this.sessionOwners.has(session.sessionId)) {
                this.sessionOwners.set(session.sessionId, existing ?? target);
              }
              if (existing !== undefined && session.archived) {
                await this.releaseSessionIfIdle(existing, session.sessionId).catch(() => undefined);
              }
            }
            const directory = {
              environment: "local",
              workspacePath,
              sessions: items,
            } satisfies LocalSessionDirectory;
            if (existing === undefined) {
              this.closedDirectories.set(workspacePath, {
                directory,
                refreshedAt: Date.now(),
              });
            }
            return directory;
          }),
        );
        for (const read of reads) {
          if (read.status === "rejected") throw read.reason;
          directories.push(read.value);
        }
      }
      return directories;
    })();
    const [directories, remote] = await Promise.allSettled([local, server]);
    if (directories.status === "rejected") throw directories.reason;
    if (remote.status === "rejected") throw remote.reason;
    return remote.value === undefined ? directories.value : [...directories.value, remote.value];
  }

  /** Use a fresh server list when it is fast, otherwise answer from the cache. */
  private async serverDirectory(): Promise<WorkspaceSessionDirectory | undefined> {
    const server = await this.openServer();
    if (server === undefined) return undefined;
    const read = (this.serverDirectoryRead ??= this.readServerDirectory(server).finally(() => {
      this.serverDirectoryRead = undefined;
    }));
    let budget: ReturnType<typeof setTimeout> | undefined;
    const cached = new Promise<WorkspaceSessionDirectory>((resolve) => {
      budget = setTimeout(
        () =>
          resolve({
            environment: "cloud",
            sessions: server.sessions,
            availability: server.availability,
          }),
        DIRECTORY_SERVER_BUDGET_MS,
      );
    });
    try {
      return await Promise.race([read, cached]);
    } finally {
      clearTimeout(budget);
    }
  }

  /** Keep the last known chats visible when a remote read fails, with its failure shown separately. */
  private async readServerDirectory(
    server: OpenServerTarget,
  ): Promise<WorkspaceSessionDirectory | undefined> {
    try {
      const { items } = await server.sdk.sessions.list({ parent: null, includeArchived: true });
      // The server was replaced or disconnected during the read; its list is nobody's.
      if (this.server !== server) return undefined;
      for (const session of items) this.sessionOwners.set(session.sessionId, server);
      server.sessions = items;
      server.availability = { kind: "ready" };
    } catch (cause) {
      if (this.server !== server) return undefined;
      retainDiagnostic({ correlationId: `server:${server.baseUrl}`, cause });
      server.availability = {
        kind: "unavailable",
        message: serverConnectionProblem(cause).message,
      };
    }
    return { environment: "cloud", sessions: server.sessions, availability: server.availability };
  }

  private async openServer(): Promise<OpenServerTarget | undefined> {
    if (this.server !== undefined) return this.server;
    const settings = await this.serverSettings.read();
    if (settings === undefined) return undefined;
    this.server = serverTarget(settings);
    return this.server;
  }

  private async serverState(): Promise<ServerState> {
    const server = await this.openServer();
    if (server === undefined) return { kind: "none" };
    try {
      const info = await server.sdk.info();
      return { kind: "connected", baseUrl: server.baseUrl, info };
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
      this.dependencies.emitHostEvent({ kind: "server_changed" });
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

  private async mobileShareState(): Promise<MobileShareState> {
    const active = await this.activeMobileShare();
    if (active === undefined) return { kind: "off", tailnet: await this.tailnetAvailability() };
    return {
      kind: "sharing",
      address: active.share.address,
      token: active.share.token,
      reach: active.reach,
      target:
        active.open.kind === "home"
          ? { kind: "home" }
          : { kind: "project", workspace: active.open.workspace },
    };
  }

  /** Read fresh each time: the daemon can start or stop while Settings is open. */
  private async tailnetAvailability(): Promise<TailnetAvailability> {
    const lookup = await findTailnetAddress(process.platform);
    if (lookup.kind !== "ready") return lookup;
    return { kind: "ready", ip: lookup.address.ip, name: lookup.address.name };
  }

  /**
   * The address a tailnet share binds. Resolved at start rather than reused
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
          : "Tailscale isn't running. Start it, then share again.",
    });
  }

  /** The running share, or nothing once a start has failed. */
  private async activeMobileShare(): Promise<ActiveMobileShare | undefined> {
    const pending = this.mobileShare;
    if (pending === undefined) return undefined;
    try {
      return await pending;
    } catch {
      if (this.mobileShare === pending) this.mobileShare = undefined;
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
      this.dependencies.emitHostEvent({ kind: "mobile_share_changed" });
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
    this.dependencies.emitHostEvent({ kind: "mobile_share_changed" });
    return {
      kind: "opened",
      selection: { kind: "project", workspace: cursor.open.workspace },
    };
  }

  /** The phone's forget is the Mac's; a cursor on the forgotten folder re-seats on Home. */
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
      this.dependencies.emitHostEvent({ kind: "mobile_share_changed" });
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
        rename: (input) => sdk(input.sessionId).sessions.rename(input),
        setPinned: (input) => sdk(input.sessionId).sessions.setPinned(input),
        setArchived: async (input) => {
          const open = owner(input.sessionId);
          await open.sdk.sessions.setArchived(input);
          if (input.archived) {
            await this.releaseSessionIfIdle(open, input.sessionId).catch(() => undefined);
          }
        },
        delete: async (input) => {
          const open = owner(input.sessionId);
          await open.sdk.sessions.delete(input);
          this.releaseSessionAttachment(open, input.sessionId);
          cursor.sessionOwners.delete(input.sessionId);
          this.sessionOwners.delete(input.sessionId);
        },
        configure: (input) => sdk(input.sessionId).sessions.configure(input),
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
        vcs: {
          snapshot: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).snapshot(input),
          diff: async (input) =>
            (
              await trustedVcs(input.target.kind === "session" ? input.target.sessionId : undefined)
            ).diff(input),
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
      watch: (input) => sdk(input.sessionId).watch(input),
      attach: (input) => cursor.open.sdk.attach(input),
      advance: (input) => sdk(input.sessionId).advance(input),
      reactivate: () => cursor.open.sdk.reactivate(),
      sessionCwd: (input) => sdk(input.sessionId).sessionCwd(input),
      relocate: (input) => sdk(input.sessionId).relocate(input),
      setPlugins: (plugins, input) => sdk(input?.sessionId).setPlugins(plugins, input),
      holdPlugins: () => cursor.open.sdk.holdPlugins(),
      close: () => cursor.open.sdk.close(),
    };
  }

  /**
   * Serve the selected local target as it stands now. Mac selection may move
   * later; the share cursor stays until the phone calls `workspace.select`.
   * A folder is served only once trusted; the server target is never a
   * candidate because selection is always local.
   */
  private async startMobileShare(reach: MobileShareReach): Promise<MobileShareState> {
    if (this.closed)
      throw new ExpectedHostError({ code: "closed", message: "The window closed before sharing" });
    if (this.mobileShare === undefined) {
      const pending = (async (): Promise<ActiveMobileShare> => {
        const host = reach === "tailnet" ? await this.requireTailnetHost() : undefined;
        // Bail before prepare, not after it: teardown waits on this pending,
        // so a prepare queued behind teardown would deadlock the close.
        if (this.closed)
          throw new ExpectedHostError({
            code: "closed",
            message: "The window closed before sharing",
          });
        const open = await this.prepare();
        if (open.kind === "project") await this.requireTrust(open.workspace.path);
        if (this.closed)
          throw new ExpectedHostError({
            code: "closed",
            message: "The window closed before sharing",
          });
        const cursor: ShareCursor = { open, sessionOwners: new Map() };
        const share = await startMobileShare({
          host,
          sdk: this.shareCursor(cursor),
          version: this.dependencies.appVersion ?? "dev",
          attach: (sessionId) => {
            this.attachSession(cursor.sessionOwners.get(sessionId) ?? cursor.open, sessionId);
          },
        });
        return Object.assign(cursor, { share, reach });
      })();
      this.mobileShare = pending;
      try {
        await pending;
      } catch (cause) {
        if (this.mobileShare === pending) this.mobileShare = undefined;
        throw cause;
      }
    }
    const state = await this.mobileShareState();
    this.dependencies.emitHostEvent({ kind: "mobile_share_changed" });
    return state;
  }

  private async stopMobileShare(): Promise<void> {
    const active = await this.activeMobileShare();
    if (active === undefined) return;
    this.mobileShare = undefined;
    await active.share.stop();
    this.dependencies.emitHostEvent({ kind: "mobile_share_changed" });
  }

  /** Watches on the old server end; the renderer resumes them against the new one or not at all. */
  private forgetServerSessions(): void {
    if (this.server === undefined) return;
    this.server.closing.abort();
    for (const [sessionId, owner] of this.sessionOwners) {
      if (owner === this.server) this.sessionOwners.delete(sessionId);
    }
  }

  /**
   * Read retained history in Home and registered desktop stores for one window,
   * without changing selection. Stores are read independently: one that fails
   * becomes a failed source on the page rather than an error screen over the
   * folders that answered.
   *
   * The lifecycle lock covers only what needs the SDK: session names and where
   * each store lives. The read of the stores and of the external transcripts
   * runs on the scanner, off this thread, so nothing waits on it.
   */
  private async usage(window: UsageWindow): Promise<UsageSnapshot> {
    const models = await this.models();
    const named = await this.serialize(() => this.usageStores()).then(
      (stores) => ({ stores, nyteError: null }),
      (error) => ({ stores: [], nyteError: ipcFailure(error).message }),
    );
    const readable = named.stores.filter((store) => store.failure === null);
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
    const reads = named.stores.map((store): StoreRead => {
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
        sessions: read.sessions.map((session) => ({
          ...session,
          name: store.names.get(session.sessionId),
        })),
        failure: read.failure === null ? null : ipcFailure(new Error(read.failure)),
      };
    });
    return {
      ...projectUsageReport(reads, window, Date.now()),
      nyteError: named.nyteError,
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

  /** Every store the page reads, with the names the SDK holds for its sessions. */
  private async usageStores(): Promise<readonly NamedStore[]> {
    const workspaces = await this.workspaces.list();
    const targets: WorkspaceTarget[] = [
      { kind: "home" },
      ...workspaces.map((workspace) => ({ kind: "project", workspace }) satisfies WorkspaceTarget),
    ];
    return Promise.all(
      targets.map(async (target): Promise<NamedStore> => {
        const workspacePath = target.kind === "home" ? null : target.workspace.path;
        const names = new Map<SessionId, string | undefined>();
        try {
          const location = { workspacePath, path: await storePath(target) };
          const open = await this.compose(target);
          // Subagents spend on their parent's behalf, so their chats count too.
          const { items } = await open.sdk.sessions.list({ includeArchived: true });
          for (const info of items) names.set(info.sessionId, info.name);
          return { location, names, failure: null };
        } catch (error) {
          return { location: { workspacePath, path: "" }, names, failure: ipcFailure(error) };
        }
      }),
    );
  }

  private async teardownOpen(): Promise<void> {
    this.open = undefined;
    // The phone's streams end before the SDK they read from closes.
    await this.stopMobileShare();
    for (const watch of this.watches.values()) watch.controller.abort();
    this.watches.clear();
    this.sessionOwners.clear();
    this.closedDirectories.clear();
    for (const open of this.openTargets.values()) {
      open.stopPluginWatch();
      for (const attachment of open.sessionAttachments.values()) attachment.detach();
      open.sessionAttachments.clear();
      await open.sdk.close().catch(() => undefined);
      await open.store.close().catch(() => undefined);
    }
    this.openTargets.clear();
    this.server = undefined;
  }

  private async login(input: {
    provider: string;
    method: { kind: "browser" } | { kind: "api_key"; key: string };
    attempt: string;
  }): Promise<LoginOutcome> {
    const { provider, method, attempt } = input;
    if (this.closed)
      throw new ExpectedHostError({ code: "closed", message: "The window closed before sign-in" });
    if (this.loginAttempts.has(attempt))
      throw new ExpectedHostError({
        code: "invalid_input",
        message: "A sign-in with this attempt ID is already running.",
        issues: [{ path: "/attempt", message: "Attempt IDs must be unique" }],
      });
    // A new sign-in for the same provider supersedes one the renderer lost
    // track of. Its flow must settle first: a credential it was already
    // committing would otherwise land beside the new attempt's.
    const superseded = [...this.loginAttempts.values()].filter(
      (running) => running.provider === provider,
    );
    for (const running of superseded) running.controller.abort();
    const controller = new AbortController();
    const running = (async (): Promise<LoginOutcome> => {
      await Promise.all(superseded.map((previous) => previous.settled));
      // Superseded in turn, or the window closed, while waiting its turn.
      if (controller.signal.aborted) return { kind: "cancelled" };
      return login(await this.models(), provider, method, {
        signal: controller.signal,
        openExternal: (url) => this.dependencies.openExternal(url),
        report: (progress) =>
          this.dependencies.emitHostEvent({ kind: "login_progress", attempt, provider, progress }),
      });
    })();
    const entry: LoginAttempt = {
      provider,
      controller,
      settled: running.then(
        () => undefined,
        () => undefined,
      ),
    };
    this.loginAttempts.set(attempt, entry);
    void entry.settled.then(() => {
      if (this.loginAttempts.get(attempt) === entry) this.loginAttempts.delete(attempt);
    });
    const outcome = await running;
    if (outcome.kind === "connected") {
      this.invalidateCatalog();
      this.dependencies.emitHostEvent({ kind: "catalog_changed" });
    }
    return outcome;
  }

  /** Abort the attempt; its entry stays until the flow has actually stopped. */
  private cancelLogin(attempt: string): void {
    this.loginAttempts.get(attempt)?.controller.abort();
  }

  /** The window that could show a device code is gone; stop polling for it. */
  cancelLogins(): void {
    for (const attempt of this.loginAttempts.keys()) this.cancelLogin(attempt);
  }

  /**
   * Abort every attempt for the provider and wait until each has settled. A
   * commit that already started finishes before the caller touches the store.
   */
  private async settleLogins(provider: string): Promise<void> {
    const pending = [...this.loginAttempts.values()].filter(
      (running) => running.provider === provider,
    );
    for (const running of pending) running.controller.abort();
    await Promise.all(pending.map((running) => running.settled));
  }

  private async logout(provider: string): Promise<void> {
    // A sign-in mid-approval must not save a credential after this delete.
    await this.settleLogins(provider);
    await (await this.models()).logout(provider);
    this.invalidateCatalog();
    this.dependencies.emitHostEvent({ kind: "catalog_changed" });
  }

  private async setPreference(change: PreferenceChange): Promise<DesktopCatalog> {
    await this.preferences.update(change);
    this.invalidateCatalog();
    this.dependencies.emitHostEvent({ kind: "catalog_changed" });
    return (await this.catalog()).catalog;
  }

  private github(): GitHubProvider {
    const run: CommandRunner = (request) => {
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
          let result: CommandResult;
          try {
            result = await (this.dependencies.runGitHubCommand ?? runProviderCommand)(request);
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
    return createGitHubProvider(
      this.open?.kind === "project" ? this.open.workspace.path : undefined,
      run,
    );
  }

  private async changeGitHubAuth(operation: "signIn" | "signOut"): Promise<GitHubProviderState> {
    const state = await this.github()[operation]();
    this.dependencies.emitHostEvent({ kind: "github_changed" });
    return state;
  }
}
