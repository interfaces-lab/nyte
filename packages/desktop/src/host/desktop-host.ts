import { basename, join } from "node:path";
import type { UsageScanReader } from "@nyte-ai/host/usage-service";
import { asId } from "@nyte-ai/schema";
import type { HostActivity } from "@nyte-ai/schema";
import { connect, createSendJournal, SdkError } from "@nyte-ai/sdk/client";
import type { ClientConnection, LinkState, SessionInfo } from "@nyte-ai/sdk/client";
import { ConnectError, ConnectRuntime } from "@nyte-ai/connect/host";
import type {
  HostEvent,
  OpenWorkspaceOutcome,
  RegisterWorkspaceOutcome,
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
import { planAttention, reconcileReminders } from "../shared/attention.ts";
import type { AttentionDelivery, AttentionReminder, AttentionSeen } from "../shared/attention.ts";
import { DEFAULT_DESKTOP_SETTINGS } from "@nyte-ai/app/contract/desktop-settings.ts";
import type { DesktopSettings } from "@nyte-ai/app/contract/desktop-settings.ts";
import { restorableFolder } from "../shared/window-workspace.ts";
import { registerFolder } from "@nyte-ai/app/contract/register-folder.ts";
import { desktopSettings } from "./host-settings.ts";
import { ExpectedHostError } from "../shared/errors.ts";
import { callTable } from "../shared/ipc-call.ts";
import { ServerSettingsStore } from "./connections/server-settings.ts";
import type { SavedServer } from "./connections/server-settings.ts";

export interface DesktopHostDependencies {
  readonly home: string;
  /** Resolves once the host first answers; the SDK redials it after that. */
  readonly connection: Promise<ClientConnection>;
  readonly appVersion: string;
  readonly usageScan: UsageScanReader;
  readonly connect?: ConnectRuntime;
  readonly keepAwake?: (awake: boolean) => void;
  readonly settingsChanged?: (settings: DesktopSettings) => void;
  readonly alert?: (delivery: AttentionDelivery) => void;
  readonly badge?: (count: number) => void;
  readonly mediaOrigin?: string;
  emitHostEvent(event: HostEvent): void;
}

type HostCalls = { readonly [P in HostCallPath]: CallHandler<P> };

function working(session: SessionInfo): boolean {
  return session.heads.some(
    (head) => head.execution.kind === "live" || head.execution.kind === "retrying",
  );
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
} as const satisfies Readonly<Record<ServerConnectionProblem["kind"], ServerConnectionProblem>>;

function serverProblem(cause: unknown): ServerConnectionProblem {
  if (!(cause instanceof SdkError) || cause.code === "unavailable") return SERVER_PROBLEMS.network;

  if (cause.code === "unauthenticated" || cause.code === "denied") {
    return SERVER_PROBLEMS.authentication;
  }

  if (cause.code === "stale") return SERVER_PROBLEMS.incompatible;

  return SERVER_PROBLEMS.server;
}

function linkedServer(url: string, state: LinkState): ServerState | null {
  switch (state.kind) {
    case "connecting":
      return null;
    case "open":
      return { kind: "connected", baseUrl: url, version: state.version };
    case "away":
    case "closed":
      return { kind: "unavailable", baseUrl: url, problem: SERVER_PROBLEMS.network };
    case "refused":
      return {
        kind: "unavailable",
        baseUrl: url,
        problem:
          state.reason === "auth" ? SERVER_PROBLEMS.authentication : SERVER_PROBLEMS.incompatible,
      };
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

export function throwForRenderer(cause: unknown): never {
  if (cause instanceof ConnectError) {
    throw new ExpectedHostError({ code: "unavailable", message: cause.message });
  }

  if (cause instanceof SdkError) {
    throw new ExpectedHostError({ code: cause.code, message: cause.message });
  }

  throw cause;
}

interface ServerWatch {
  saved: SavedServer;
  readonly stop: AbortController;
  readonly first: PromiseWithResolvers<void>;
  state: ServerState | undefined;
}

function serverClient(version: string) {
  return { kind: "app", name: "Nyte", version } as const;
}

async function probeServer(url: string, token: string, version: string) {
  const connection = await connect({
    url,
    credentials: { kind: "token", token },
    client: serverClient(version),
    journal: createSendJournal(),
  });

  try {
    for await (const view of connection.watch()) {
      return {
        hostId: connection.hostId,
        publicKey: connection.publicKey ?? null,
        version: view.version,
      };
    }
    throw new SdkError("unavailable", "The server closed before it described itself.");
  } finally {
    await connection.close();
  }
}

export class DesktopHost {
  private readonly deps: DesktopHostDependencies;
  private readonly connect: ConnectRuntime;
  private readonly usageScan: UsageScanReader;
  private readonly servers: ServerSettingsStore;
  private settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
  private tailnet: string | undefined;
  private rows: readonly SessionInfo[] = [];
  private readonly watching = new AbortController();
  private awake = false;
  private readonly since = Date.now();
  private seen: AttentionSeen | undefined;
  private badge = 0;
  private readonly reminders = new Map<
    string,
    { readonly signature: string; readonly timer: ReturnType<typeof setInterval> }
  >();
  private server: Promise<ServerWatch | undefined> | undefined;
  private closing: Promise<void> | undefined;

  constructor(dependencies: DesktopHostDependencies) {
    this.deps = dependencies;
    this.servers = new ServerSettingsStore(join(dependencies.home, ".nyte", "server.json"));
    this.usageScan = dependencies.usageScan;

    this.connect =
      dependencies.connect ??
      new ConnectRuntime({
        config: undefined,
        home: join(dependencies.home, ".nyte"),
        authorizer: undefined,
        onChange: () => this.remoteChanged(),
      });

    this.followView();
  }

  private followView(): void {
    void this.deps.connection.then(
      async (connection) => {
        this.followRows(connection);

        for await (const view of connection.watch()) {
          if (this.watching.signal.aborted) return;
          const tailnet = JSON.stringify(view.tailnet ?? null);

          if (this.tailnet !== undefined && this.tailnet !== tailnet) this.remoteChanged();
          this.tailnet = tailnet;
          this.settings = desktopSettings(view);
          this.deps.settingsChanged?.(this.settings);
          this.holdAwake();

          if (this.seen !== undefined) this.attend();
        }
      },
      () => undefined,
    );
  }

  private followRows(connection: ClientConnection): void {
    const directory = connection.sessions.open({ parents: { kind: "all" } });

    const stop = directory.subscribe(() => {
      const snapshot = directory.snapshot();

      if (snapshot === null) return;
      this.rows = snapshot.ids.flatMap((id) => {
        const row = snapshot.rows.get(id);

        return row === undefined ? [] : [row];
      });
      this.holdAwake();
      this.attend();
    });

    this.watching.signal.addEventListener(
      "abort",
      () => {
        stop();
        directory.close();
      },
      { once: true },
    );
  }

  private readonly callHost: ClientConnection["call"] = async (name, input) =>
    (await this.deps.connection).call(name, input);

  private attend(): void {
    if (this.closing !== undefined) return;

    const plan = planAttention({
      previous: this.seen,
      rows: this.rows,
      settings: this.settings,
      since: this.since,
    });

    this.seen = plan.seen;

    for (const delivery of plan.deliveries) this.deps.alert?.(delivery);

    if (plan.badge !== this.badge) {
      this.badge = plan.badge;
      this.deps.badge?.(plan.badge);
    }

    this.remind(plan.reminders);
  }

  private remind(reminders: readonly AttentionReminder[]): void {
    const every = this.settings.remindMinutes * 60_000;
    const changes = reconcileReminders(this.reminders, reminders, every);

    for (const id of changes.stop) {
      clearInterval(this.reminders.get(id)?.timer);
      this.reminders.delete(id);
    }

    for (const reminder of changes.start) {
      const timer = setInterval(() => this.deps.alert?.(reminder.delivery), every);
      this.reminders.set(reminder.id, { signature: reminder.signature, timer });
    }
  }

  private holdAwake(): void {
    const awake = this.closing === undefined && this.settings.keepAwake && this.rows.some(working);

    if (awake === this.awake) return;
    this.awake = awake;
    this.deps.keepAwake?.(awake);
  }

  call<P extends CallPath>(
    window: HostWindow,
    path: P,
    input: CallInput<P>,
  ): Promise<CallOutput<P>> {
    return callTable(this.handlers, window, path, input);
  }

  private readonly handlers: CallTable = {
    "host.endpoint": async () => {
      const connection = await this.deps.connection;

      return {
        url: HOST_PORT_ORIGIN,
        credentials: { kind: "token", token: "" },
        expect:
          connection.publicKey === undefined
            ? undefined
            : { hostId: connection.hostId, publicKey: connection.publicKey },
        ...(this.deps.mediaOrigin === undefined ? {} : { mediaOrigin: this.deps.mediaOrigin }),
      };
    },
    "host.restore": (_window, { session }) => this.chatFolder(session),
    "host.openWorkspace": (_window, { path }) => this.openWorkspace(path, false),
    "host.registerWorkspace": (_window, { path }) => this.registerWorkspace(path),
    "host.trustWorkspace": (_window, { path }) => this.openWorkspace(path, true),
    "host.usage": async (_window, usageWindow) => this.usageScan.scan({ window: usageWindow }),
    "host.server.state": () => this.serverState(),
    "host.server.connect": (_window, input) => this.connectServer(input),
    "host.server.disconnect": async () => {
      await this.servers.clear();
      await this.watchServer(undefined);
      this.deps.emitHostEvent({ kind: "server_changed" });
    },
    "host.remote.state": () => this.remoteState(),
    "host.remote.configureTailnet": async (_window, { enabled }) => {
      const node = await this.tailnetNode();

      if (node.state === "unavailable") {
        throw new ExpectedHostError({
          code: "unavailable",
          message: "This Mac's Nyte host has no Tailscale node. Reinstall Nyte to get it back.",
        });
      }

      await this.callHost("host.tailnet.configure", {
        enabled,
        hostname: node.dnsName?.split(".")[0] ?? "nyte",
        tags: node.tags,
        access: node.access,
      });
      this.remoteChanged();
    },
    "host.remote.signOutTailnet": async () => {
      await this.callHost("host.tailnet.logout", {});
      this.remoteChanged();
    },
    "host.connect.state": () => this.connect.view(),
    "host.connect.link": () => this.connect.link(),
    "host.connect.cancel": () => this.connect.cancel(),
    "host.connect.setEnabled": (_window, { enabled }) =>
      this.connect.setEnabled({ enabled, share: null }),
    "host.connect.unlink": () => this.connect.unlink(),
    "host.connect.revokeDevice": (_window, input) => this.connect.revokeDevice(input),
    "host.connect.openAccount": () => this.connect.openAccount(),
    "host.connect.signOut": () => this.connect.signOut(),
  } satisfies HostCalls;

  registerWorkspace(path: string): Promise<RegisterWorkspaceOutcome> {
    return registerFolder(() => this.deps.connection, path, false, "local");
  }

  async localWorkspaces(): Promise<readonly SelectedWorkspace[]> {
    const host = await this.deps.connection;

    return (await host.workspaces.list()).flatMap((workspace) =>
      workspace.availability.kind === "available" &&
      workspace.target.kind === "local" &&
      "path" in workspace.target
        ? [{ id: workspace.id, path: workspace.target.path, name: basename(workspace.target.path) }]
        : [],
    );
  }

  remoteChanged(): void {
    this.deps.emitHostEvent({ kind: "remote_access_changed" });
  }

  suspend(): void {
    if (!this.settings.pauseOnSleep) return;
    void this.callHost("host.execution.pause", {}).catch(() => undefined);
  }

  resume(): void {
    this.connect.resume();
    void this.callHost("host.execution.resume", {}).catch(() => undefined);
  }

  accountChanged(): void {
    this.connect.accountChanged();
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.watching.abort();
      this.holdAwake();
      this.remind([]);
      await this.connect.close().catch(() => undefined);
      await this.usageScan.close();
    })();

    return this.closing;
  }

  async updateActivity(): Promise<HostActivity> {
    return (await this.deps.connection).host.activity();
  }

  private async chatFolder(session: string): Promise<SelectedWorkspace | undefined> {
    const host = await this.deps.connection;

    const info = await host
      .session(asId<"session">(session))
      .info()
      .catch(() => null);

    if (info === null) return undefined;

    return restorableFolder(
      await host
        .workspace(info.workspace)
        .info()
        .catch(() => null),
    );
  }

  private async openWorkspace(path: string, trust: boolean): Promise<OpenWorkspaceOutcome> {
    const registered = await registerFolder(() => this.deps.connection, path, trust, "local");

    return registered.kind === "failed"
      ? registered
      : { kind: "opened", workspace: registered.workspace, needsTrust: registered.needsTrust };
  }

  private async serverState(): Promise<ServerState> {
    this.server ??= this.servers.read().then((saved) => this.startServer(saved));
    const watch = await this.server;

    if (watch === undefined) return { kind: "none" };
    await watch.first.promise;

    return watch.state ?? { kind: "none" };
  }

  private async connectServer(input: { readonly baseUrl: string; readonly token: string }) {
    const answered = await probeServer(input.baseUrl, input.token, this.deps.appVersion).catch(
      (cause: unknown) => serverProblem(cause),
    );

    if ("kind" in answered) return { kind: "failed" as const, message: answered.message };

    const saved = {
      url: input.baseUrl,
      hostId: answered.hostId,
      publicKey: answered.publicKey,
      token: input.token,
    };

    await this.servers.write(saved);
    await this.watchServer(saved);
    this.deps.emitHostEvent({ kind: "server_changed" });

    return { kind: "connected" as const, baseUrl: input.baseUrl, version: answered.version };
  }

  private async watchServer(saved: SavedServer | undefined): Promise<void> {
    const previous = await this.server;
    previous?.stop.abort();
    this.server = Promise.resolve(this.startServer(saved));
  }

  private startServer(saved: SavedServer | undefined): ServerWatch | undefined {
    if (saved === undefined || this.closing !== undefined) return undefined;

    const watch: ServerWatch = {
      saved,
      stop: new AbortController(),
      first: Promise.withResolvers(),
      state: undefined,
    };

    void this.followServer(watch);

    return watch;
  }

  private async connectSaved(watch: ServerWatch): Promise<ClientConnection> {
    const saved = watch.saved;

    const connection = await connect({
      url: saved.url,
      credentials: { kind: "token", token: saved.token },
      client: serverClient(this.deps.appVersion),
      journal: createSendJournal(),
      expect:
        saved.publicKey === null ? undefined : { hostId: saved.hostId, publicKey: saved.publicKey },
    });

    if (saved.publicKey !== null) return connection;

    if (connection.hostId !== saved.hostId) {
      await connection.close().catch(() => undefined);

      throw new SdkError(
        "stale",
        `Host ${connection.hostId} answered instead of ${saved.hostId}.`,
        {
          hostId: connection.hostId,
        },
      );
    }

    if (connection.publicKey === undefined || watch.stop.signal.aborted) return connection;
    watch.saved = { ...saved, publicKey: connection.publicKey };
    void this.servers.write(watch.saved).catch(() => undefined);

    return connection;
  }

  private async followServer(watch: ServerWatch): Promise<void> {
    const { saved } = watch;
    const signal = AbortSignal.any([watch.stop.signal, this.watching.signal]);
    let wait = WATCH_RETRY_MS;

    while (!signal.aborted) {
      const connection = await this.connectSaved(watch).catch((cause: unknown) => {
        if (!signal.aborted) {
          this.serverAnswered(watch, {
            kind: "unavailable",
            baseUrl: saved.url,
            problem: serverProblem(cause),
          });
        }

        return null;
      });

      if (connection !== null) {
        const show = (): void => {
          const state = linkedServer(saved.url, connection.link.snapshot());

          if (state !== null) this.serverAnswered(watch, state);
        };

        const unfollow = connection.link.subscribe(show);
        show();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        unfollow();
        await connection.close().catch(() => undefined);

        return;
      }

      await pause(wait, signal);
      wait = Math.min(wait * 2, WATCH_RETRY_CAP_MS);
    }
  }

  private serverAnswered(watch: ServerWatch, state: ServerState): void {
    const changed =
      watch.state !== undefined && JSON.stringify(watch.state) !== JSON.stringify(state);

    watch.state = state;
    watch.first.resolve();

    if (changed) this.deps.emitHostEvent({ kind: "server_changed" });
  }

  private async remoteState(): Promise<RemoteAccessState> {
    return { tailnet: await this.tailnetNode() };
  }

  private tailnetNode(): Promise<TailnetNode> {
    return this.callHost("host.tailnet.status", {}).catch((cause: unknown) => {
      if (cause instanceof SdkError && cause.code === "unavailable") {
        return { state: "unavailable" as const };
      }

      throw cause;
    });
  }
}
