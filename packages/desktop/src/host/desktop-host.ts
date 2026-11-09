import { basename, join } from "node:path";
import { asId } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import { UsageScanner } from "@nyte-ai/host/usage-service";
import type { UsageScanReader } from "@nyte-ai/host/usage-service";
import { SdkError, sdk } from "@nyte-ai/sdk/client";
import type { Connection, HostConnection, HostView, SessionInfo } from "@nyte-ai/sdk/client";
import { ConnectError, ConnectRuntime } from "@nyte-ai/connect/host";
import type {
  HostEvent,
  OpenWorkspaceOutcome,
  RegisterWorkspaceOutcome,
  RemoteAccessPluginId,
  RemoteAccessState,
  SelectedWorkspace,
  ServerConnectionProblem,
  ServerState,
  TailnetNode,
} from "@nyte-ai/app/contract/bridge.ts";
import type {
  CallHandler,
  CallInput,
  CallOutput,
  CallPath,
  CallTable,
  HostCallPath,
} from "../shared/ipc.ts";
import { HOST_PORT_ORIGIN } from "../shared/host-port.ts";
import type { HostWindow } from "../shared/host-window.ts";
import { planAttention } from "../shared/attention.ts";
import type { AttentionDelivery, AttentionReminder, AttentionSeen } from "../shared/attention.ts";
import { DEFAULT_DESKTOP_SETTINGS } from "@nyte-ai/app/contract/desktop-settings.ts";
import type { DesktopSettings } from "@nyte-ai/app/contract/desktop-settings.ts";
import type { DesktopUpdateActivity } from "../shared/update-activity.ts";
import { desktopSettings } from "./host-settings.ts";
import { ExpectedHostError, retainDiagnostic } from "../shared/errors.ts";
import { callTable } from "../shared/ipc-call.ts";
import type { RemoteAccessPlugins } from "./connections/remote-access-plugin.ts";
import { ServerSettingsStore } from "./connections/server-settings.ts";
import type { SavedServer } from "./connections/server-settings.ts";

export interface DesktopHostDependencies {
  readonly home: string;
  open(): Promise<Connection>;
  readonly client: Pick<HostConnection, "call" | "directory">;
  readonly usageScan?: UsageScanReader;
  readonly remoteAccessPlugins?: RemoteAccessPlugins;
  readonly connect?: ConnectRuntime;
  readonly keepAwake?: (awake: boolean) => void;
  readonly settingsChanged?: (settings: DesktopSettings) => void;
  readonly alert?: (delivery: AttentionDelivery) => void;
  readonly badge?: (count: number) => void;
  emitHostEvent(event: HostEvent, window?: HostWindow): void;
}

type HostCalls = { readonly [P in HostCallPath]: CallHandler<P> };

const NOT_SERVED = {
  code: "unavailable",
  message: "Cloudflare Tunnel isn't served by the Nyte host yet. Use Tailscale.",
} as const;

function working(session: SessionInfo): boolean {
  return session.heads.some(
    (head) => head.execution.kind === "live" || head.execution.kind === "retrying",
  );
}

async function listSessions(host: Connection): Promise<readonly SessionInfo[]> {
  let page = await host.sessions.list({ parents: { kind: "all" } });
  const rows = [...page.items];

  while (page.next !== null) {
    page = await host.sessions.list({ parents: { kind: "all" }, cursor: page.next });
    rows.push(...page.items);
  }

  return rows;
}

async function busyTerminals(host: Connection): Promise<number> {
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

export class DesktopHost {
  readonly #deps: DesktopHostDependencies;
  readonly #connect: ConnectRuntime;
  #opened: Promise<Connection>;
  readonly #usageScan: UsageScanReader;
  readonly #servers: ServerSettingsStore;
  readonly #selections = new Map<HostWindow, SelectedWorkspace>();
  /** The folder Finder opened a window for: it shows when the window has no selection, across reloads. */
  readonly #seeds = new Map<HostWindow, SelectedWorkspace>();
  #settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
  #tailnet: string | undefined;
  #rows: readonly SessionInfo[] = [];
  readonly #watching = new AbortController();
  #rowsFollowed = false;
  #awake = false;
  readonly #since = Date.now();
  #seen: AttentionSeen | undefined;
  #badge = 0;
  readonly #reminders = new Map<
    string,
    { readonly signature: string; readonly timer: ReturnType<typeof setInterval> }
  >();
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

    this.#opened = this.#begin();
  }

  #begin(): Promise<Connection> {
    const opened = this.#deps.open();
    opened.then(
      (connection) => this.#followView(connection),
      () => undefined,
    );

    return opened;
  }

  #ready(): Promise<Connection> {
    return this.#opened.catch((cause: unknown) => {
      if (this.#closing !== undefined) throw cause;
      this.#opened = this.#begin();

      return this.#opened;
    });
  }

  #followView(opened: Connection): void {
    void follow(
      () => opened.watch(),
      (view) => {
        const tailnet = JSON.stringify(view.tailnet ?? null);

        if (this.#tailnet !== undefined && this.#tailnet !== tailnet) this.#remoteChanged();
        this.#tailnet = tailnet;
        this.#settings = desktopSettings(view);
        this.#deps.settingsChanged?.(this.#settings);
        this.#followRows();
        this.#holdAwake();

        if (this.#seen !== undefined) this.#attend();
      },
      this.#watching.signal,
    );
  }

  #followRows(): void {
    if (this.#rowsFollowed || this.#watching.signal.aborted) return;
    this.#rowsFollowed = true;
    const directory = this.#deps.client.directory({ parents: { kind: "all" } });

    const stop = directory.subscribe(() => {
      const snapshot = directory.snapshot();

      if (snapshot === null) return;
      this.#rows = snapshot.ids.flatMap((id) => {
        const row = snapshot.rows.get(id);

        return row === undefined ? [] : [row];
      });
      this.#holdAwake();
      this.#attend();
    });

    this.#watching.signal.addEventListener(
      "abort",
      () => {
        stop();
        directory.close();
      },
      { once: true },
    );
  }

  #attend(): void {
    if (this.#closing !== undefined) return;

    const plan = planAttention({
      previous: this.#seen,
      rows: this.#rows,
      settings: this.#settings,
      since: this.#since,
    });

    this.#seen = plan.seen;

    for (const delivery of plan.deliveries) this.#deps.alert?.(delivery);

    if (plan.badge !== this.#badge) {
      this.#badge = plan.badge;
      this.#deps.badge?.(plan.badge);
    }

    this.#remind(plan.reminders);
  }

  #remind(reminders: readonly AttentionReminder[]): void {
    const every = this.#settings.remindMinutes * 60_000;

    const wanted = new Map(
      reminders.map((reminder) => [reminder.id, JSON.stringify([every, reminder.delivery])]),
    );

    for (const [id, held] of this.#reminders) {
      if (wanted.get(id) === held.signature) continue;
      clearInterval(held.timer);
      this.#reminders.delete(id);
    }

    for (const reminder of reminders) {
      const signature = wanted.get(reminder.id);

      if (signature === undefined || this.#reminders.has(reminder.id)) continue;
      const timer = setInterval(() => this.#deps.alert?.(reminder.delivery), every);
      this.#reminders.set(reminder.id, { signature, timer });
    }
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
      const connection = await this.#ready();

      return {
        url: HOST_PORT_ORIGIN,
        credentials: { kind: "token", token: "" },
        expect: { hostId: connection.hostId },
      };
    },
    "host.state": async (window) => this.#state(window),
    "host.restore": async (window, { session }) => {
      if (this.#state(window).workspace === undefined)
        await this.#selectChatFolder(window, session);

      return this.#state(window);
    },
    "host.openWorkspace": (window, { path }) => this.#openWorkspace(window, path),
    "host.registerWorkspace": (_window, { path }) => this.#registerWorkspace(path),
    "host.trustWorkspace": (window, { path }) => this.#openWorkspace(window, path, true),
    "host.closeWorkspace": async (window) => {
      const shown = this.#state(window).workspace !== undefined;
      this.#selections.delete(window);
      this.#seeds.delete(window);

      if (shown) this.#deps.emitHostEvent({ kind: "workspace_closed" }, window);
    },
    "host.usage": async (_window, usageWindow) => this.#usageScan.scan({ window: usageWindow }),
    "host.server.state": () => this.#serverState(),
    "host.server.connect": (_window, input) => this.#connectServer(input),
    "host.server.disconnect": async () => {
      await this.#servers.clear();
      await this.#watchServer(undefined);
      this.#deps.emitHostEvent({ kind: "server_changed" });
    },
    "host.remote.state": () => this.#remoteState(),
    "host.remote.start": async () => {
      throw new ExpectedHostError(NOT_SERVED);
    },
    "host.remote.stop": async () => undefined,
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
    "host.remote.revoke": async (_window, input) => {
      await this.#remoteOperations.run(() =>
        this.#remotePlugin(input.plugin).revoke({ deviceId: input.deviceId }),
      );
      this.#remoteChanged();
    },
    "host.remote.configureTailnet": async (_window, { enabled }) => {
      const node = await this.#tailnetNode();

      if (node.state === "unavailable")
        throw new ExpectedHostError({
          code: "unavailable",
          message: "This Mac's Nyte host has no Tailscale node. Reinstall Nyte to get it back.",
        });

      await this.#deps.client.call("host.tailnet.configure", {
        enabled,
        hostname: node.dnsName?.split(".")[0] ?? "nyte",
        tags: node.tags,
        access: node.access,
      });
      this.#remoteChanged();
    },
    "host.remote.signOutTailnet": async () => {
      await this.#deps.client.call("host.tailnet.logout", {});
      this.#remoteChanged();
    },
    "host.connect.state": () => this.#connect.view(),
    "host.connect.link": () => this.#connect.link(),
    "host.connect.cancel": () => this.#connect.cancel(),
    "host.connect.setEnabled": (_window, { enabled }) =>
      this.#connect.setEnabled({ enabled, share: null }),
    "host.connect.unlink": () => this.#connect.unlink(),
    "host.connect.revokeDevice": (_window, input) => this.#connect.revokeDevice(input),
    "host.connect.openAccount": () => this.#connect.openAccount(),
    "host.connect.signOut": () => this.#connect.signOut(),
  } satisfies HostCalls;

  /** The window's renderer is gone or reloading; a seed outlives it. */
  releaseWindow(window: HostWindow): void {
    this.#selections.delete(window);
  }

  closeWindow(window: HostWindow): void {
    this.#selections.delete(window);
    this.#seeds.delete(window);
  }

  registerWorkspace(path: string): Promise<RegisterWorkspaceOutcome> {
    return this.#registerWorkspace(path);
  }

  /** Shows `workspace` in a window before its first load, so it emits nothing. */
  seedWorkspace(window: HostWindow, workspace: SelectedWorkspace): void {
    this.#seeds.set(window, workspace);
  }

  selectedWorkspace(window: HostWindow): SelectedWorkspace | undefined {
    return this.#state(window).workspace;
  }

  /** The host's available local folders. */
  async localWorkspaces(): Promise<readonly SelectedWorkspace[]> {
    const host = await this.#ready();

    return (await host.workspaces.list()).flatMap((workspace) =>
      workspace.availability.kind === "available" &&
      workspace.target.kind === "local" &&
      "path" in workspace.target
        ? [{ id: workspace.id, path: workspace.target.path, name: basename(workspace.target.path) }]
        : [],
    );
  }

  remoteChanged(): void {
    this.#remoteChanged();
  }

  suspend(): void {
    if (!this.#settings.pauseOnSleep) return;
    void this.#deps.client.call("host.execution.pause", {}).catch(() => undefined);
  }

  resume(): void {
    this.#connect.resume();
    void this.#deps.client.call("host.execution.resume", {}).catch(() => undefined);
  }

  accountChanged(): void {
    this.#connect.accountChanged();
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      this.#watching.abort();
      this.#holdAwake();
      this.#remind([]);
      await this.#connect.close().catch(() => undefined);
      const opened = await this.#opened.catch(() => undefined);
      await this.#usageScan.close();
      await opened?.close();
    })();

    return this.#closing;
  }

  async updateActivity(): Promise<DesktopUpdateActivity> {
    const opened = await this.#opened.catch(() => undefined);
    const rows = opened === undefined ? [] : await listSessions(opened);
    const terminalCommandCount = opened === undefined ? 0 : await busyTerminals(opened);

    const taskCount = rows.filter((row) =>
      row.heads.some((head) => head.execution.kind !== "idle"),
    ).length;

    return taskCount === 0 && terminalCommandCount === 0
      ? { kind: "idle" }
      : { kind: "busy", taskCount, terminalCommandCount };
  }

  #state(window: HostWindow) {
    return { workspace: this.#selections.get(window) ?? this.#seeds.get(window) };
  }

  async #selectChatFolder(window: HostWindow, session: string): Promise<void> {
    const host = await this.#ready();

    const info = await host
      .session(asId<"session">(session))
      .info()
      .catch(() => null);

    if (info === null) return;

    const workspace = await host
      .workspace(info.workspace)
      .info()
      .catch(() => null);

    if (
      workspace === null ||
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
    const registered = await this.#registerWorkspace(path, trust);

    if (registered.kind === "failed") return registered;
    this.#selections.set(window, registered.workspace);
    this.#deps.emitHostEvent({ kind: "workspace_opened", workspace: registered.workspace }, window);

    return { kind: "opened", workspace: registered.workspace, needsTrust: registered.needsTrust };
  }

  async #registerWorkspace(path: string, trust = false): Promise<RegisterWorkspaceOutcome> {
    const host = await this.#ready();
    const seen = await host.workspaces.inspect({ kind: "local", path });
    const added = await host.workspaces.add(seen.target, { expect: { identity: seen.identity } });

    if (added.kind === "stale")
      return { kind: "failed", message: "The folder changed while it was opened. Open it again." };

    if (added.kind === "unavailable")
      return { kind: "failed", message: "This folder can't be opened here." };

    if (trust) await host.workspace(added.workspace).update({ projectResources: true });
    const workspace = await host.workspace(added.workspace).info();
    const folder = "path" in workspace.target ? workspace.target.path : path;

    return {
      kind: "registered",
      workspace: { id: workspace.id, path: folder, name: basename(folder) },
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
    const [cloudflare, tailnet] = await Promise.all([
      this.#deps.remoteAccessPlugins?.cloudflare.view() ?? { kind: "unregistered" as const },
      this.#tailnetNode(),
    ]);

    return { kind: "off", tailnet, cloudflare };
  }

  #tailnetNode(): Promise<TailnetNode> {
    return this.#deps.client.call("host.tailnet.status", {}).catch((cause: unknown) => {
      if (cause instanceof SdkError && cause.code === "unavailable")
        return { state: "unavailable" as const };

      throw cause;
    });
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
}
