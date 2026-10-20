import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import { asId } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import { canvasPlugin } from "@nyte-ai/plugin/core/canvas";
import type { CanvasPreviewer } from "@nyte-ai/plugin/core/canvas-preview";
import { codemodePlugin } from "@nyte-ai/plugin/core/codemode";
import { nodeImages } from "@nyte-ai/host/images";
import { completeShellEnvironment } from "@nyte-ai/host/shell-env";
import { catalogForUsage, UsageScanner } from "@nyte-ai/host/usage-service";
import type { UsageScanReader } from "@nyte-ai/host/usage-service";
import { SdkError, sdk } from "@nyte-ai/sdk";
import type { Host, HostView, Listener, OpenHostOptions, SessionInfo } from "@nyte-ai/sdk";
import { Sharing } from "@nyte-ai/service";
import browserTools from "@nyte-ai/plugin/core/browser-tools";
import type { ConnectShare } from "@nyte-ai/connect/host";
import { ConnectError, ConnectRuntime, hostShare } from "@nyte-ai/connect/host";
import { APP_ORIGINS } from "@nyte-ai/app/web/origins.ts";
import type {
  HostEvent,
  OpenWorkspaceOutcome,
  RemoteAccessPluginId,
  RemoteAccessState,
  RemoteReach,
  SelectedWorkspace,
  ServerConnectionProblem,
  ServerState,
  TailnetAvailability,
} from "@nyte-ai/app/bridge.ts";
import type {
  CallHandler,
  CallInput,
  CallOutput,
  CallPath,
  CallTable,
  HostCallPath,
} from "../shared/ipc.ts";
import { HOST_PORT_ORIGIN } from "../shared/host-port.ts";
import type { BrowserAgent } from "./browser-agent.ts";
import type { HostWindow } from "./host-window.ts";
import { desktopBrowserPlugin } from "./browser-tools.ts";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";
import { imageRuntimeOptions } from "./image-runtime.ts";
import { DEFAULT_DESKTOP_SETTINGS } from "./desktop-settings.ts";
import type { DesktopSettings } from "./desktop-settings.ts";
import { desktopSettings, desktopSettingsPlugin } from "./host-settings.ts";
import { ExpectedHostError, retainDiagnostic } from "./errors.ts";
import { callTable } from "./ipc-call.ts";
import type { RemoteAccessPlugins, RemoteExposure } from "./remote-access-plugin.ts";
import { ServerSettingsStore } from "./server-settings.ts";
import type { SavedServer } from "./server-settings.ts";
import { findTailnetAddress } from "./tailnet.ts";

export type DesktopUpdateActivity =
  | { readonly kind: "idle" }
  | {
      readonly kind: "busy";
      readonly taskCount: number;
      readonly terminalCommandCount: number;
    };

export interface DesktopHostDependencies {
  readonly home: string;
  readonly version: string;
  readonly models?: OpenHostOptions["models"];
  readonly usageScan?: UsageScanReader;
  readonly remoteAccessPlugins?: RemoteAccessPlugins;
  readonly connect?: ConnectRuntime;
  readonly keepAwake?: (awake: boolean) => void;
  readonly settingsChanged?: (settings: DesktopSettings) => void;
  emitHostEvent(event: HostEvent, window?: HostWindow): void;
  readonly agent: BrowserAgent;
  readonly openDelayMs?: number | undefined;
  readonly token?: string;
  readonly preview?: CanvasPreviewer;
  readonly revoked?: () => void;
}

type HostCalls = { readonly [P in HostCallPath]: CallHandler<P> };

interface Opened {
  readonly host: Host;
  readonly listener: Listener;
  readonly token: string;
}

type ActiveRemote =
  | {
      readonly kind: "token";
      readonly reach: "local" | "tailnet";
      readonly listener: Listener;
      readonly address: string;
      readonly token: string;
      readonly pairingUrl: string;
    }
  | {
      readonly kind: "plugin";
      readonly reach: RemoteAccessPluginId;
      readonly listener: Listener;
      readonly exposure: RemoteExposure;
    };

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function listenerAddress(listener: Listener): string {
  if (listener.address === null) throw new SdkError("internal", "The listener bound no address.");

  return listener.address;
}

function working(session: SessionInfo): boolean {
  return session.heads.some(
    (head) => head.execution.kind === "live" || head.execution.kind === "retrying",
  );
}

async function listSessions(host: Host): Promise<readonly SessionInfo[]> {
  let page = await host.sessions.list({ parents: { kind: "all" } });
  const rows = [...page.items];

  while (page.next !== null) {
    page = await host.sessions.list({ parents: { kind: "all" }, cursor: page.next });
    rows.push(...page.items);
  }

  return rows;
}

async function busyTerminals(host: Host): Promise<number> {
  const busy = await Promise.all(
    (await host.workspaces.list()).map(async ({ id }) => {
      const workspace = host.workspace(id);

      const running = (await workspace.jobs.list()).filter(
        (job) => job.pty !== null && job.state.kind === "running",
      );

      const idle = await Promise.all(running.map((job) => workspace.job(job.id).idle()));

      return idle.filter((at) => !at).length;
    }),
  );

  return busy.reduce((total, count) => total + count, 0);
}

const WATCH_RETRY_MS = 250;

const WATCH_RETRY_CAP_MS = 30_000;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", wake);
      resolve();
    };

    const timer = setTimeout(wake, ms);
    signal.addEventListener("abort", wake, { once: true });
  });
}

async function follow<T>(
  open: () => AsyncIterable<T>,
  apply: (value: T) => void,
  signal: AbortSignal,
): Promise<void> {
  let wait = WATCH_RETRY_MS;

  while (!signal.aborted) {
    const values = open()[Symbol.asyncIterator]();

    const stop = (): void => {
      void values.return?.();
    };

    signal.addEventListener("abort", stop, { once: true });

    try {
      for (let next = await values.next(); next.done !== true; next = await values.next()) {
        wait = WATCH_RETRY_MS;
        apply(next.value);
      }
    } catch (cause) {
      retainDiagnostic({ correlationId: "desktop-host-watch", cause });
    } finally {
      signal.removeEventListener("abort", stop);
    }

    await pause(wait, signal);
    wait = Math.min(wait * 2, WATCH_RETRY_CAP_MS);
  }
}

const SERVER_PROBLEMS = {
  network: {
    kind: "network",
    message: "Cannot reach the server. Check your connection and try again.",
  },
  authentication: {
    kind: "authentication",
    message: "The server rejected this token. Update the connection token.",
  },
  incompatible: {
    kind: "incompatible",
    message: "A different host answered at this address. Pair with it again.",
  },
  server: { kind: "server", message: "The server could not answer. Try again later." },
} as const satisfies { readonly [K in ServerConnectionProblem["kind"]]: ServerConnectionProblem };

function serverProblem(cause: unknown): ServerConnectionProblem {
  if (!(cause instanceof SdkError) || cause.code === "unavailable") return SERVER_PROBLEMS.network;

  if (cause.code === "unauthenticated" || cause.code === "denied")
    return SERVER_PROBLEMS.authentication;

  if (cause.code === "stale") return SERVER_PROBLEMS.incompatible;

  return SERVER_PROBLEMS.server;
}

function linkedServer(url: string, view: HostView): ServerState {
  const { link } = view;

  if (link.kind === "connected") return { kind: "connected", baseUrl: url, version: view.version };

  const problem =
    link.kind === "reconnecting" || link.reason === "client"
      ? SERVER_PROBLEMS.network
      : link.reason === "revoked"
        ? SERVER_PROBLEMS.authentication
        : SERVER_PROBLEMS.incompatible;

  return { kind: "unavailable", baseUrl: url, problem };
}

export function throwForRenderer(cause: unknown): never {
  if (cause instanceof ConnectError)
    throw new ExpectedHostError({ code: "unavailable", message: cause.message });

  if (cause instanceof SdkError)
    throw new ExpectedHostError({ code: cause.code, message: cause.message });

  throw cause;
}

interface ServerWatch {
  readonly saved: SavedServer;
  readonly stop: AbortController;
  readonly first: PromiseWithResolvers<void>;
  state: ServerState | undefined;
}

async function probeServer(url: string, token: string, hostId?: SavedServer["hostId"]) {
  const connection = await sdk.connect({
    url,
    credentials: { kind: "token", token },
    expect: hostId === undefined ? undefined : { hostId },
  });

  try {
    for await (const view of connection.watch())
      return { hostId: connection.hostId, version: view.version };
    throw new SdkError("unavailable", "The server closed before it described itself.");
  } finally {
    await connection.close();
  }
}

async function tailnetAvailability(): Promise<TailnetAvailability> {
  const lookup = await findTailnetAddress(process.platform);

  return lookup.kind === "ready"
    ? { kind: "ready", ip: lookup.address.ip, name: lookup.address.name }
    : lookup;
}

async function requireTailnetHost(): Promise<string> {
  const lookup = await findTailnetAddress(process.platform);

  if (lookup.kind === "ready") return lookup.address.ip;
  throw new ExpectedHostError({
    code: "unavailable",
    message:
      lookup.kind === "missing"
        ? "Tailscale isn't installed on this Mac"
        : "Tailscale isn't running. Start it, then try again.",
  });
}

export class DesktopHost {
  readonly #deps: DesktopHostDependencies;
  readonly #connect: ConnectRuntime;
  readonly #sharing: Sharing;
  #opened: Promise<Opened>;
  readonly #usageScan: UsageScanReader;
  readonly #servers: ServerSettingsStore;
  readonly #selections = new Map<HostWindow, SelectedWorkspace>();
  #settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
  #rows: readonly SessionInfo[] = [];
  readonly #watching = new AbortController();
  #rowsWatch: AbortController | undefined;
  #awake = false;
  #remote: Promise<ActiveRemote> | undefined;
  readonly #remoteOperations = serial();
  #server: Promise<ServerWatch | undefined> | undefined;
  #closing: Promise<void> | undefined;

  constructor(dependencies: DesktopHostDependencies) {
    this.#deps = dependencies;
    this.#servers = new ServerSettingsStore(join(dependencies.home, ".nyte", "server.json"));
    this.#usageScan = dependencies.usageScan ?? new UsageScanner(dependencies.home);

    this.#connect =
      dependencies.connect ??
      new ConnectRuntime({
        config: undefined,
        home: join(dependencies.home, ".nyte"),
        authorizer: undefined,
        onChange: () => this.remoteChanged(),
      });

    this.#sharing = new Sharing({
      connect: this.#connect,
      share: this.#connectShare,
      home: dependencies.home,
    });
    this.#opened = this.#begin();
  }

  #begin(): Promise<Opened> {
    const opened = this.#openOwned();
    opened.then(
      (opened) => this.#followView(opened.host),
      () => undefined,
    );

    return opened;
  }

  #ready(): Promise<Opened> {
    return this.#opened.catch((cause: unknown) => {
      if (this.#closing !== undefined) throw cause;
      this.#opened = this.#begin();

      return this.#opened;
    });
  }

  host(): Promise<Host> {
    return this.#ready().then((opened) => opened.host);
  }

  async #openOwned(): Promise<Opened> {
    performance.mark("nyte:host-start");
    void completeShellEnvironment().then(() => performance.mark("nyte:shell-environment-ready"));
    const delay = this.#deps.openDelayMs;

    if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));
    const { home } = this.#deps;

    const host = await sdk.open({
      models: this.#deps.models,
      home,
      label: "Nyte.app",
      onRevoked: this.#deps.revoked,
      workspace: { kind: "local", path: home },
      shell: () => this.#settings.terminalShell,
      images: nodeImages(imageRuntimeOptions()),
      plugins: [
        desktopSettingsPlugin,
        browserTools,
        desktopBrowserPlugin(this.#deps.agent, home),
        codemodePlugin(codemodeRuntimeOptions()),
        canvasPlugin(this.#deps.preview),
      ],
    });

    performance.mark("nyte:host-opened");

    const token = this.#deps.token ?? newToken();

    const listener = await host.listen({
      transport: { kind: "fetch" },
      auth: { kind: "token", token },
    });

    performance.mark("nyte:endpoint-ready");

    return { host, listener, token };
  }

  async fetch(request: Request): Promise<Response> {
    return (await this.#ready()).listener.fetch(request);
  }

  #followView(host: Host): void {
    void follow(
      () => host.watch(),
      (view) => {
        this.#settings = desktopSettings(view);
        this.#deps.settingsChanged?.(this.#settings);
        this.#followRows(host);
        this.#holdAwake();
      },
      this.#watching.signal,
    );
  }

  #followRows(host: Host): void {
    const wanted = this.#settings.keepAwake;

    if (wanted === (this.#rowsWatch !== undefined)) return;
    this.#rowsWatch?.abort();
    this.#rowsWatch = undefined;
    this.#rows = [];

    if (!wanted) return;
    const rowsWatch = new AbortController();
    this.#rowsWatch = rowsWatch;
    void follow(
      () => host.sessions.watch({ parents: { kind: "all" } }),
      (rows) => {
        this.#rows = rows;
        this.#holdAwake();
      },
      AbortSignal.any([rowsWatch.signal, this.#watching.signal]),
    );
  }

  #holdAwake(): void {
    const awake =
      this.#closing === undefined && this.#settings.keepAwake && this.#rows.some(working);

    if (awake === this.#awake) return;
    this.#awake = awake;
    this.#deps.keepAwake?.(awake);
  }

  call<P extends CallPath>(
    window: HostWindow,
    path: P,
    input: CallInput<P>,
  ): Promise<CallOutput<P>> {
    return callTable(this.#handlers, window, path, input);
  }

  readonly #handlers: CallTable = {
    "host.endpoint": async () => {
      const { host, token } = await this.#ready();

      return {
        url: HOST_PORT_ORIGIN,
        credentials: { kind: "token", token },
        expect: { hostId: host.hostId },
      };
    },
    "host.state": async (window) => this.#state(window),
    "host.restore": async (window, { session }) => {
      if (!this.#selections.has(window)) await this.#selectChatFolder(window, session);

      return this.#state(window);
    },
    "host.openWorkspace": (window, { path }) => this.#openWorkspace(window, path),
    "host.trustWorkspace": (window, { path }) => this.#openWorkspace(window, path, true),
    "host.closeWorkspace": async (window) => {
      if (this.#selections.delete(window))
        this.#deps.emitHostEvent({ kind: "workspace_closed" }, window);
    },
    "host.usage": async (_window, usageWindow) => {
      await this.#opened;

      return this.#usageScan.scan({
        window: usageWindow,
        catalog: this.#deps.models === undefined ? undefined : catalogForUsage(this.#deps.models),
      });
    },
    "host.server.state": () => this.#serverState(),
    "host.server.connect": (_window, input) => this.#connectServer(input),
    "host.server.disconnect": async () => {
      await this.#servers.clear();
      await this.#watchServer(undefined);
      this.#deps.emitHostEvent({ kind: "server_changed" });
    },
    "host.remote.state": () => this.#remoteState(),
    "host.remote.start": (_window, { reach }) =>
      this.#remoteOperations.run(() => this.#startRemote(reach)),
    "host.remote.stop": () => this.#remoteOperations.run(() => this.#stopRemote()),
    "host.remote.configure": async (_window, { plugin, ...settings }) => {
      await this.#remoteOperations.run(() => this.#remotePlugin(plugin).configure(settings));
      this.#remoteChanged();
    },
    "host.remote.clear": async (_window, { plugin }) => {
      await this.#remoteOperations.run(() => this.#remotePlugin(plugin).clear());
      this.#remoteChanged();
    },
    "host.remote.pair": async (_window, { plugin, name }) => {
      const pairing = await this.#remoteOperations.run(() =>
        this.#remotePlugin(plugin).pair({ name }),
      );

      this.#remoteChanged();

      return pairing;
    },
    "host.remote.revoke": (_window, input) =>
      this.#remoteOperations.run(() => this.#revokeRemoteDevice(input)),
    "host.connect.state": () => this.#connect.view(),
    "host.connect.link": () => this.#connect.link(),
    "host.connect.cancel": () => this.#connect.cancel(),
    "host.connect.setEnabled": (_window, { enabled }) =>
      this.#connect.setEnabled({
        enabled,
        share: enabled && this.#sharing.claim() ? this.#connectShare : null,
      }),
    "host.connect.unlink": () => this.#connect.unlink(),
    "host.connect.revokeDevice": (_window, input) => this.#connect.revokeDevice(input),
    "host.connect.openAccount": () => this.#connect.openAccount(),
    "host.connect.signOut": () => this.#connect.signOut(),
  } satisfies HostCalls;

  releaseWindow(window: HostWindow): void {
    this.#selections.delete(window);
  }

  remoteChanged(): void {
    this.#remoteChanged();
  }

  resume(): void {
    this.#connect.resume();
  }

  accountChanged(): void {
    this.#connect.accountChanged();
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      this.#watching.abort();
      this.#holdAwake();
      await this.#connect.close().catch(() => undefined);
      await this.#remoteOperations.run(() => this.#stopRemote()).catch(() => undefined);
      await this.#sharing.close();
      const opened = await this.#opened.catch(() => undefined);
      await this.#usageScan.close();
      await opened?.host.close();
    })();

    return this.#closing;
  }

  async updateActivity(): Promise<DesktopUpdateActivity> {
    const opened = await this.#opened.catch(() => undefined);
    const rows = opened === undefined ? [] : await listSessions(opened.host);
    const terminalCommandCount = opened === undefined ? 0 : await busyTerminals(opened.host);

    const taskCount = rows.filter((row) =>
      row.heads.some((head) => head.execution.kind !== "idle"),
    ).length;

    return taskCount === 0 && terminalCommandCount === 0
      ? { kind: "idle" }
      : { kind: "busy", taskCount, terminalCommandCount };
  }

  autostartConnect(): void {
    this.#sharing.start();
  }

  #state(window: HostWindow) {
    return { workspace: this.#selections.get(window) };
  }

  async #selectChatFolder(window: HostWindow, session: string): Promise<void> {
    const { host } = await this.#opened;

    const info = await host
      .session(asId<"session">(session))
      .info()
      .catch(() => null);

    if (info === null) return;
    const workspace = (await host.workspaces.list()).find((entry) => entry.id === info.workspace);

    if (
      workspace === undefined ||
      workspace.availability.kind === "unavailable" ||
      workspace.target.kind !== "local" ||
      !("path" in workspace.target) ||
      (workspace.trusted === null && workspace.projectSources.length > 0)
    )
      return;
    const { path } = workspace.target;
    this.#selections.set(window, { id: workspace.id, path, name: basename(path) });
  }

  async #openWorkspace(
    window: HostWindow,
    path: string,
    trust = false,
  ): Promise<OpenWorkspaceOutcome> {
    const { host } = await this.#opened;
    const seen = await host.workspaces.inspect({ kind: "local", path });
    const added = await host.workspaces.add(seen.target, { expect: { identity: seen.identity } });

    if (added.kind === "stale")
      return { kind: "failed", message: "The folder changed while it was opened. Open it again." };

    if (added.kind === "unavailable")
      return { kind: "failed", message: "This folder can't be opened here." };

    if (trust) await host.workspace(added.workspace).update({ projectResources: true });
    const workspace = (await host.workspaces.list()).find((entry) => entry.id === added.workspace);

    if (workspace === undefined)
      return { kind: "failed", message: "The folder was forgotten while it was opened." };
    const folder = "path" in workspace.target ? workspace.target.path : path;
    const selected = { id: workspace.id, path: folder, name: basename(folder) };
    this.#selections.set(window, selected);
    this.#deps.emitHostEvent({ kind: "workspace_opened", workspace: selected }, window);

    return {
      kind: "opened",
      workspace: selected,
      needsTrust: workspace.trusted === null && seen.projectSources.length > 0,
    };
  }

  async #serverState(): Promise<ServerState> {
    this.#server ??= this.#servers.read().then((saved) => this.#startServer(saved));
    const watch = await this.#server;

    if (watch === undefined) return { kind: "none" };
    await watch.first.promise;

    return watch.state ?? { kind: "none" };
  }

  async #connectServer(input: { readonly baseUrl: string; readonly token: string }) {
    const answered = await probeServer(input.baseUrl, input.token).catch((cause: unknown) =>
      serverProblem(cause),
    );

    if ("kind" in answered) return { kind: "failed" as const, message: answered.message };
    const saved = { url: input.baseUrl, hostId: answered.hostId, token: input.token };
    await this.#servers.write(saved);
    await this.#watchServer(saved);
    this.#deps.emitHostEvent({ kind: "server_changed" });

    return { kind: "connected" as const, baseUrl: input.baseUrl, version: answered.version };
  }

  async #watchServer(saved: SavedServer | undefined): Promise<void> {
    const previous = await this.#server;
    previous?.stop.abort();
    this.#server = Promise.resolve(this.#startServer(saved));
  }

  #startServer(saved: SavedServer | undefined): ServerWatch | undefined {
    if (saved === undefined || this.#closing !== undefined) return undefined;

    const watch: ServerWatch = {
      saved,
      stop: new AbortController(),
      first: Promise.withResolvers(),
      state: undefined,
    };

    void this.#followServer(watch);

    return watch;
  }

  async #followServer(watch: ServerWatch): Promise<void> {
    const { saved } = watch;
    const signal = AbortSignal.any([watch.stop.signal, this.#watching.signal]);
    let wait = WATCH_RETRY_MS;

    while (!signal.aborted) {
      try {
        const connection = await sdk.connect({
          url: saved.url,
          credentials: { kind: "token", token: saved.token },
          expect: { hostId: saved.hostId },
        });

        const stop = (): void => {
          void connection.close();
        };

        signal.addEventListener("abort", stop, { once: true });

        try {
          for await (const view of connection.watch()) {
            wait = WATCH_RETRY_MS;
            this.#serverAnswered(watch, linkedServer(saved.url, view));
          }
        } finally {
          signal.removeEventListener("abort", stop);
          await connection.close().catch(() => undefined);
        }

        throw new SdkError("unavailable", "The server closed the connection.");
      } catch (cause) {
        if (signal.aborted) return;
        this.#serverAnswered(watch, {
          kind: "unavailable",
          baseUrl: saved.url,
          problem: serverProblem(cause),
        });
      }

      await pause(wait, signal);
      wait = Math.min(wait * 2, WATCH_RETRY_CAP_MS);
    }
  }

  #serverAnswered(watch: ServerWatch, state: ServerState): void {
    const changed =
      watch.state !== undefined && JSON.stringify(watch.state) !== JSON.stringify(state);

    watch.state = state;
    watch.first.resolve();

    if (changed) this.#deps.emitHostEvent({ kind: "server_changed" });
  }

  async #remoteState(): Promise<RemoteAccessState> {
    const [active, cloudflare, tailnet] = await Promise.all([
      this.#activeRemote(),
      this.#deps.remoteAccessPlugins?.cloudflare.view() ?? { kind: "unregistered" as const },
      tailnetAvailability(),
    ]);

    if (active === undefined) return { kind: "off", tailnet, cloudflare };

    if (active.kind === "plugin")
      return {
        kind: "serving",
        reach: active.reach,
        address: active.exposure.address,
        target: { kind: "home" },
        cloudflare,
      };

    return {
      kind: "serving",
      reach: active.reach,
      address: active.address,
      token: active.token,
      pairingUrl: active.pairingUrl,
      target: { kind: "home" },
      cloudflare,
    };
  }

  readonly #remoteChanged = (): void => {
    this.#deps.emitHostEvent({ kind: "remote_access_changed" });
  };

  #remotePlugin(id: RemoteAccessPluginId): RemoteAccessPlugins[RemoteAccessPluginId] {
    const plugin = this.#deps.remoteAccessPlugins?.[id];

    if (plugin === undefined)
      throw new ExpectedHostError({
        code: "unknown",
        message: "This remote access plugin isn't available here.",
      });

    return plugin;
  }

  async #activeRemote(): Promise<ActiveRemote | undefined> {
    const pending = this.#remote;

    if (pending === undefined) return undefined;

    try {
      return await pending;
    } catch {
      if (this.#remote === pending) this.#remote = undefined;

      return undefined;
    }
  }

  async #startRemote(reach: RemoteReach): Promise<RemoteAccessState> {
    if (this.#closing !== undefined)
      throw new ExpectedHostError({
        code: "unavailable",
        message: "The window closed before serving",
      });

    if (this.#remote === undefined) {
      const pending = this.#serve(reach);
      this.#remote = pending;

      try {
        await pending;
      } catch (cause) {
        if (this.#remote === pending) this.#remote = undefined;
        throw cause;
      }
    }

    const state = await this.#remoteState();
    this.#remoteChanged();

    return state;
  }

  async #serve(reach: RemoteReach): Promise<ActiveRemote> {
    const { host } = await this.#opened;

    if (reach === "local" || reach === "tailnet") {
      const hostname = reach === "tailnet" ? await requireTailnetHost() : "127.0.0.1";
      const token = newToken();

      const listener = await host.listen({
        transport: { kind: "http", hostname },
        auth: { kind: "token", token },
        origins: APP_ORIGINS,
      });

      const address = listenerAddress(listener);
      const pairingUrl = `${APP_ORIGINS[0]}/pair#host=${encodeURIComponent(address)}&token=${encodeURIComponent(token)}`;

      return { kind: "token", reach, listener, address, token, pairingUrl };
    }

    const exposure = await this.#remotePlugin(reach).expose(this.#remoteChanged);

    try {
      const listener = await host
        .listen({
          transport: { kind: "http", hostname: "127.0.0.1", port: exposure.listen.port },
          auth: exposure.listen.auth,
          origins: exposure.listen.browserOrigins,
          before: exposure.listen.handle,
        })
        .catch((cause: unknown) => {
          if (cause instanceof SdkError && cause.code === "unavailable")
            throw new ExpectedHostError({
              code: "unavailable",
              message: `Port ${String(exposure.listen.port)} can't be used on this Mac. Free it, or set the tunnel up with another port.`,
            });
          throw cause;
        });

      exposure.connect();

      return { kind: "plugin", reach, listener, exposure };
    } catch (cause) {
      await exposure.disconnect();
      throw cause;
    }
  }

  async #stopRemote(): Promise<void> {
    const active = await this.#activeRemote();

    if (active === undefined) return;
    this.#remote = undefined;

    if (active.kind === "plugin") await active.exposure.disconnect();
    await active.listener.close();
    this.#remoteChanged();
  }

  async #revokeRemoteDevice(input: {
    readonly plugin: RemoteAccessPluginId;
    readonly deviceId: string;
  }): Promise<void> {
    try {
      await this.#remotePlugin(input.plugin).revoke({ deviceId: input.deviceId });
    } catch (cause) {
      await this.#stopRemote();
      throw cause;
    }

    const active = await this.#activeRemote();

    if (active?.reach === input.plugin) active.listener.disconnectClients();
    this.#remoteChanged();
  }

  readonly #connectShare: ConnectShare = async (listen) => {
    if (this.#closing !== undefined)
      throw new ExpectedHostError({
        code: "unavailable",
        message: "The window closed before serving",
      });
    const { host } = await this.#opened;

    return hostShare(host)(listen);
  };
}
