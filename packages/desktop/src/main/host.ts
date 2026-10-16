import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { codemodePlugin } from "@nyte-ai/plugin/core/codemode";
import { catalogForUsage, UsageScanner } from "@nyte-ai/host/usage-service";
import type { UsageScanReader } from "@nyte-ai/host/usage-service";
import { SdkError, sdk } from "@nyte-ai/sdk";
import type { Host, Listener, OpenHostOptions, SessionInfo } from "@nyte-ai/sdk";
import type { ConnectRuntime, ConnectShare } from "@nyte-ai/connect/host";
import { hostShare, machineName } from "@nyte-ai/connect/host";
import { APP_ORIGINS } from "@nyte-ai/app/web/origins.ts";
import type {
  HostBridge,
  HostEvent,
  LocalFontCatalog,
  OpenWorkspaceOutcome,
  RemoteAccessPluginId,
  RemoteAccessState,
  RemoteReach,
  SelectedWorkspace,
  ServerConnectionProblem,
  ServerState,
  TailnetAvailability,
} from "@nyte-ai/app/bridge.ts";
import type { CallInput, CallOutput, CallPath } from "../shared/ipc.ts";
import type { BrowserPanels } from "./browser.ts";
import { desktopBrowserPlugin } from "./browser-tools.ts";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";
import {
  DEFAULT_DESKTOP_SETTINGS,
  desktopSettings,
  desktopSettingsPlugin,
} from "./desktop-settings.ts";
import type { DesktopSettings } from "./desktop-settings.ts";
import { ExpectedHostError } from "./errors.ts";
import { safeExternalUrl } from "./external-url.ts";
import type { RemoteAccessPlugins, RemoteExposure } from "./remote-access-plugin.ts";
import { ServerSettingsStore } from "./server-settings.ts";
import type { SavedServer } from "./server-settings.ts";
import { ensureShellEnvironment } from "./shell-env.ts";
import { findTailnetAddress } from "./tailnet.ts";
import { TerminalSessions } from "./terminals.ts";

export type DesktopUpdateActivity =
  | { readonly kind: "idle" }
  | {
      readonly kind: "busy";
      readonly taskCount: number;
      readonly terminalCommandCount: number;
    };

export interface DesktopHostDependencies {
  readonly home: string;
  readonly models?: OpenHostOptions["models"];
  readonly usageScan?: UsageScanReader;
  readonly rendererOrigin: string;
  /**
   * The built-in remote-access plugins `index.ts` registers. Without them, as
   * in tests that never serve through one, their reaches are refused.
   */
  readonly remoteAccessPlugins?: RemoteAccessPlugins;
  readonly connect?: ConnectRuntime;
  readonly updates?: HostBridge["updates"];
  readonly keepAwake?: (awake: boolean) => void;
  readonly settingsChanged?: (settings: DesktopSettings) => void;
  /** Push a host event to one window, or to every window when `window` is omitted. */
  emitHostEvent(event: HostEvent, window?: HostWindow): void;
  openExternal(url: string): void;
  /** Native prompt before a conversation link leaves the app. */
  confirmExternal(url: string, window: HostWindow): ReturnType<HostBridge["confirmExternal"]>;
  /** Show a file or folder in the system file manager. */
  revealPath(path: string): void;
  /** Open a folder in the system file manager. Absent, the host reveals it instead. */
  readonly openPath?: (path: string) => Promise<void>;
  /** Native right-click menu, with the renderer's own signature. */
  showContextMenu(
    input: CallInput<"host.contextMenu">,
    window: HostWindow,
  ): Promise<CallOutput<"host.contextMenu">>;
  browser: BrowserPanels;
  listFonts(): Promise<LocalFontCatalog>;
  /** Native folder picker; resolves undefined on cancel. */
  pickFolder(window: HostWindow): Promise<string | undefined>;
}

export type HostWindow = number;

/** One handler per renderer operation, so a missing or misshapen one is a type error. */
type CallHandlers = {
  readonly [P in CallPath]: (window: HostWindow, input: CallInput<P>) => Promise<CallOutput<P>>;
};

interface Opened {
  readonly host: Host;
  readonly listener: Listener;
  readonly url: string;
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

function serverProblem(cause: unknown): ServerConnectionProblem {
  if (!(cause instanceof SdkError) || cause.code === "unavailable")
    return {
      kind: "network",
      message: "Cannot reach the server. Check your connection and try again.",
    };

  if (cause.code === "unauthenticated" || cause.code === "denied")
    return {
      kind: "authentication",
      message: "The server rejected this token. Update the connection token.",
    };

  if (cause.code === "stale")
    return {
      kind: "incompatible",
      message: "A different host answered at this address. Pair with it again.",
    };

  return { kind: "server", message: "The server could not answer. Try again later." };
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
  readonly #opened: Promise<Opened>;
  readonly #usageScan: UsageScanReader;
  readonly #servers: ServerSettingsStore;
  readonly #terminals = new Map<HostWindow, TerminalSessions>();
  readonly #selections = new Map<HostWindow, SelectedWorkspace>();
  #settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
  #rows: readonly SessionInfo[] = [];
  #awake = false;
  #remote: Promise<ActiveRemote> | undefined;
  #remoteLock: Promise<void> = Promise.resolve();
  #closing: Promise<void> | undefined;

  constructor(dependencies: DesktopHostDependencies) {
    this.#deps = dependencies;
    this.#servers = new ServerSettingsStore(join(dependencies.home, ".nyte", "server.json"));
    this.#usageScan = dependencies.usageScan ?? new UsageScanner(dependencies.home);
    this.#opened = this.#open();
    this.#opened.then(
      (opened) => {
        this.#followView(opened.host).catch(() => undefined);
        this.#followRows(opened.host).catch(() => undefined);
      },
      () => undefined,
    );
  }

  host(): Promise<Host> {
    return this.#opened.then((opened) => opened.host);
  }

  async #open(): Promise<Opened> {
    const { home } = this.#deps;
    await ensureShellEnvironment();
    performance.mark("nyte:shell-environment-ready");

    const host = await sdk.open({
      models: this.#deps.models,
      home,
      workspace: { kind: "local", path: home },
      plugins: [
        desktopSettingsPlugin,
        desktopBrowserPlugin(this.#deps.browser.agent, home),
        codemodePlugin(codemodeRuntimeOptions()),
      ],
    });
    performance.mark("nyte:host-opened");

    const token = newToken();

    const listener = await host.listen({
      transport: { kind: "http" },
      auth: { kind: "token", token },
      origins: [this.#deps.rendererOrigin],
    });
    performance.mark("nyte:endpoint-ready");

    return { host, listener, url: listenerAddress(listener), token };
  }

  async #followView(host: Host): Promise<void> {
    for await (const view of host.watch()) {
      this.#settings = desktopSettings(view);
      this.#deps.settingsChanged?.(this.#settings);
      this.#holdAwake();
    }
  }

  async #followRows(host: Host): Promise<void> {
    for await (const rows of host.sessions.watch({ parents: { kind: "all" } })) {
      this.#rows = rows;
      this.#holdAwake();
    }
  }

  #holdAwake(): void {
    const awake =
      this.#closing === undefined && this.#settings.keepAwake && this.#rows.some(working);

    if (awake === this.#awake) return;
    this.#awake = awake;
    this.#deps.keepAwake?.(awake);
  }

  /** The one renderer entry point: an operation path and its input, already decoded at the IPC boundary. */
  call<P extends CallPath>(
    window: HostWindow,
    path: P,
    input: CallInput<P>,
  ): Promise<CallOutput<P>> {
    return this.#handlers[path](window, input);
  }

  readonly #handlers: CallHandlers = {
    "host.endpoint": async () => {
      const { host, url, token } = await this.#opened;

      return { url, credentials: { kind: "token", token }, expect: { hostId: host.hostId } };
    },
    "host.state": async (window) => ({
      workspace: this.#selections.get(window),
      platform: process.platform,
      machineName: machineName(),
    }),
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
    "host.fonts": () => this.#deps.listFonts(),
    "host.pickWorkspace": async (window) => {
      const picked = await this.#deps.pickFolder(window);

      return picked === undefined ? { kind: "cancelled" } : this.#openWorkspace(window, picked);
    },
    "host.updates.state": async () => this.#deps.updates?.state() ?? { kind: "idle" },
    "host.updates.check": async () => this.#deps.updates?.check(),
    "host.server.state": () => this.#serverState(),
    "host.server.connect": (_window, input) => this.#connectServer(input),
    "host.server.disconnect": async () => {
      await this.#servers.clear();
      this.#deps.emitHostEvent({ kind: "server_changed" });
    },
    "host.remote.state": () => this.#remoteState(),
    "host.remote.start": (_window, { reach }) => this.#remoteSerial(() => this.#startRemote(reach)),
    "host.remote.stop": () => this.#remoteSerial(() => this.#stopRemote()),
    "host.remote.configure": async (_window, { plugin, ...settings }) => {
      await this.#remoteSerial(() => this.#remotePlugin(plugin).configure(settings));
      this.#remoteChanged();
    },
    "host.remote.clear": async (_window, { plugin }) => {
      await this.#remoteSerial(() => this.#remotePlugin(plugin).clear());
      this.#remoteChanged();
    },
    "host.remote.pair": async (_window, { plugin, name }) => {
      const pairing = await this.#remoteSerial(() => this.#remotePlugin(plugin).pair({ name }));
      this.#remoteChanged();

      return pairing;
    },
    "host.remote.revoke": (_window, input) =>
      this.#remoteSerial(() => this.#revokeRemoteDevice(input)),
    "host.connect.state": async () =>
      this.#deps.connect?.view() ?? { kind: "unavailable", reason: "not_configured" },
    "host.connect.link": () => this.#connect().link(),
    "host.connect.cancel": () => this.#connect().cancel(),
    "host.connect.setEnabled": (_window, { enabled }) =>
      this.#connect().setEnabled({ enabled, share: this.#connectShare }),
    "host.connect.unlink": () => this.#connect().unlink(),
    "host.connect.revokeDevice": (_window, input) => this.#connect().revokeDevice(input),
    "host.connect.openAccount": () => this.#connect().openAccount(),
    "host.connect.signOut": () => this.#connect().signOut(),
    "host.openExternal": async (_window, { url }) => this.#deps.openExternal(safeExternalUrl(url)),
    "host.confirmExternal": (window, { url }) =>
      this.#deps.confirmExternal(safeExternalUrl(url), window),
    "host.revealPath": async (_window, { path }) => this.#deps.revealPath(path),
    "host.openPluginsFolder": async () => {
      const folder = join(this.#deps.home, ".nyte", "plugins");
      await mkdir(folder, { recursive: true });

      if (this.#deps.openPath === undefined) this.#deps.revealPath(folder);
      else await this.#deps.openPath(folder);
    },
    "host.contextMenu": (window, input) => this.#deps.showContextMenu(input, window),
    "host.browser.open": async (window, input) => this.#deps.browser.open(input, window),
    "host.browser.navigate": async (_window, input) => this.#deps.browser.navigate(input),
    "host.browser.menu": (window, input) => this.#deps.browser.menu(input, window),
    "host.browser.perform": (window, input) => this.#deps.browser.perform(input, window),
    "host.browser.close": async (_window, input) => this.#deps.browser.close(input),
    "host.browser.captureFrame": (_window, input) => this.#deps.browser.captureFrame(input),
    "host.browser.find": (_window, input) => this.#deps.browser.find(input),
    "host.browser.cancelDownload": async (_window, input) =>
      this.#deps.browser.cancelDownload(input),
    "host.browser.login": async (_window, input) => this.#deps.browser.login(input),
    "host.browser.history": (_window, input) => this.#deps.browser.history(input),
    "host.browser.forgetHistory": (_window, input) => this.#deps.browser.forgetHistory(input),
    "host.browser.focusPage": async (_window, input) => this.#deps.browser.focusPage(input),
    "host.terminal.create": async (window, { id, workspacePath }) => {
      const terminals = this.#windowTerminals(window);
      await ensureShellEnvironment();

      if (this.#closing !== undefined || this.#terminals.get(window) !== terminals)
        throw new ExpectedHostError({ code: "unavailable", message: "Terminal window closed" });

      return terminals.create({ id, cwd: workspacePath ?? this.#deps.home });
    },
    "host.terminal.write": async (window, input) => this.#windowTerminals(window).write(input),
    "host.terminal.resize": async (window, input) => this.#windowTerminals(window).resize(input),
    "host.terminal.acknowledge": async (window, input) =>
      this.#windowTerminals(window).acknowledge(input),
    "host.terminal.idle": async (window, input) => this.#windowTerminals(window).idle(input),
    "host.terminal.close": async (window, input) => this.#windowTerminals(window).close(input),
  };

  releaseWindow(window: HostWindow): void {
    this.#selections.delete(window);
    const terminals = this.#terminals.get(window);
    this.#terminals.delete(window);
    terminals?.dispose();
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      for (const terminals of this.#terminals.values()) terminals.dispose();
      this.#terminals.clear();
      this.#holdAwake();
      await this.#deps.connect?.close().catch(() => undefined);
      await this.#remoteSerial(() => this.#stopRemote()).catch(() => undefined);
      const opened = await this.#opened.catch(() => undefined);
      await this.#usageScan.close();
      await opened?.host.close();
    })();

    return this.#closing;
  }

  updateActivity(): DesktopUpdateActivity {
    const terminalCommandCount = [...this.#terminals.values()].reduce(
      (total, terminals) => total + terminals.busyCount(),
      0,
    );

    const taskCount = this.#rows.filter((row) =>
      row.heads.some((head) => head.execution.kind !== "idle"),
    ).length;

    return taskCount === 0 && terminalCommandCount === 0
      ? { kind: "idle" }
      : { kind: "busy", taskCount, terminalCommandCount };
  }

  async autostartConnect(): Promise<void> {
    await this.#deps.connect?.autostart(this.#connectShare);
  }

  #windowTerminals(window: HostWindow): TerminalSessions {
    const existing = this.#terminals.get(window);

    if (existing !== undefined) return existing;

    const terminals = new TerminalSessions(
      (event) => this.#deps.emitHostEvent(event, window),
      () => this.#settings.terminalShell,
    );

    this.#terminals.set(window, terminals);

    return terminals;
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
    const saved = await this.#servers.read();

    if (saved === undefined) return { kind: "none" };

    return probeServer(saved.url, saved.token, saved.hostId).then(
      (answered): ServerState => ({
        kind: "connected",
        baseUrl: saved.url,
        version: answered.version,
      }),
      (cause: unknown): ServerState => ({
        kind: "unavailable",
        baseUrl: saved.url,
        problem: serverProblem(cause),
      }),
    );
  }

  async #connectServer(input: { readonly baseUrl: string; readonly token: string }) {
    const answered = await probeServer(input.baseUrl, input.token).catch((cause: unknown) =>
      serverProblem(cause),
    );

    if ("kind" in answered) return { kind: "failed" as const, message: answered.message };
    await this.#servers.write({ url: input.baseUrl, hostId: answered.hostId, token: input.token });
    this.#deps.emitHostEvent({ kind: "server_changed" });

    return { kind: "connected" as const, baseUrl: input.baseUrl, version: answered.version };
  }

  async #remoteState(): Promise<RemoteAccessState> {
    const active = await this.#activeRemote();

    const cloudflare = (await this.#deps.remoteAccessPlugins?.cloudflare.view()) ?? {
      kind: "unregistered",
    };

    if (active === undefined)
      return { kind: "off", tailnet: await tailnetAvailability(), cloudflare };

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

  #remoteSerial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#remoteLock.then(operation, operation);
    this.#remoteLock = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

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

  #connect(): ConnectRuntime {
    const { connect } = this.#deps;

    if (connect === undefined)
      throw new ExpectedHostError({
        code: "unknown",
        message: "Account remote access isn't available here.",
      });

    return connect;
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
