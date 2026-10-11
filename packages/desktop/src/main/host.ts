/**
 * The desktop host: one sdk host for every folder on this Mac, served to the
 * renderer over a loopback listener, and what lives beside the sdk —
 * terminals, browser panels, remote access, account remote access and the
 * remembered remote host. Sessions, models, settings and workspaces are the
 * connection's; this class never reads or folds them except the directory
 * rows that decide Keep awake.
 *
 * Electron specifics (windows, dialogs, shell) are injected, so this class
 * tests headless under Vitest.
 */
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import browserToolsPlugin from "@nyte-ai/plugin/browser-tools";
import canvasPlugin from "@nyte-ai/plugin/canvas";
import { codemodePlugin } from "@nyte-ai/plugin/codemode";
import { asId } from "@nyte-ai/schema";
import { SdkError, sdk } from "@nyte-ai/sdk";
import type { Authority, Host, Listener, OpenHostOptions, SessionInfo } from "@nyte-ai/sdk";
import type { ConnectRuntime, ConnectShare } from "@nyte-ai/connect/host";
import { machineName } from "@nyte-ai/connect/host";
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
import type { BrowserSurfaces } from "./browser.ts";
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
import { CALL_INPUT_SCHEMAS } from "./ipc-inputs.ts";
import type { RemoteAccessPlugins, RemoteExposure } from "./remote-access-plugin.ts";
import { ServerSettingsStore } from "./server-settings.ts";
import type { SavedServer } from "./server-settings.ts";
import { ensureShellEnvironment } from "./shell-environment.ts";
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
  /** The directory whose `.nyte` holds the store, settings, plugins and snapshots, and the Home workspace. */
  readonly home: string;
  /** The provider catalog; absent, the host's own over its credential store. Tests inject an offline one. */
  readonly models?: OpenHostOptions["models"];
  /** The key core seals secrets with; the app passes one sealed by the OS keychain. Absent, the 0600 key file. */
  readonly secrets?: OpenHostOptions["secrets"];
  /** The renderer's origin, the one the loopback listener lets through CORS. */
  readonly rendererOrigin: string;
  /**
   * The built-in remote-access plugins `index.ts` registers. Without them, as
   * in tests that never serve through one, their reaches are refused.
   */
  readonly remoteAccessPlugins?: RemoteAccessPlugins;
  /** Account remote access. Absent, as in tests that never link, it reads as unavailable. */
  readonly connect?: ConnectRuntime;
  readonly updates?: HostBridge["updates"];
  /** Called on each change: true while Keep awake is on and a chat on this machine is working. */
  readonly keepAwake?: (awake: boolean) => void;
  /** Called with the desktop's settings each time the host view carries them. */
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
  browser: BrowserSurfaces;
  listFonts(): Promise<LocalFontCatalog>;
  /** Native folder picker; resolves undefined on cancel. */
  pickFolder(window: HostWindow): Promise<string | undefined>;
}

/** The renderer a request came from. */
export type HostWindow = number;

/** The opened host and the loopback listener the renderer connects to. */
interface Opened {
  readonly host: Host;
  readonly listener: Listener;
  readonly url: string;
  readonly token: string;
}

/** What remote access is serving: a token listener on loopback or the tailnet, or a plugin's exposure. */
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

const PARTICIPANT: ReadonlySet<Authority> = new Set(["participant"]);

const OWNER: ReadonlySet<Authority> = new Set(["participant", "owner"]);

/** Returns a fresh bearer token for a listener. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Returns the listener's address; an http listener always has one. */
function addressOf(listener: Listener): string {
  if (listener.address === null) throw new SdkError("internal", "The listener bound no address.");

  return listener.address;
}

/** Returns whether a directory row has a head at work: responding, executing or waiting on a provider retry. */
function working(session: SessionInfo): boolean {
  return session.heads.some(
    (head) => head.execution.kind === "live" || head.execution.kind === "retrying",
  );
}

/** Returns why a remembered server did not answer, as the copy Settings shows. */
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

/** Connects to a server once, pinned to `hostId` when given, and returns the host that answered and its version. */
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

/** Read fresh each time: the daemon can start or stop while Settings is open. */
async function tailnetAvailability(): Promise<TailnetAvailability> {
  const lookup = await findTailnetAddress(process.platform);

  return lookup.kind === "ready"
    ? { kind: "ready", ip: lookup.address.ip, name: lookup.address.name }
    : lookup;
}

/**
 * The address a tailnet reach binds, resolved at start: binding an address
 * whose interface went down fails with a message that explains nothing.
 */
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
  readonly #servers: ServerSettingsStore;
  readonly #terminals = new Map<HostWindow, TerminalSessions>();
  /** The folder each window selected; absent is Home. */
  readonly #selections = new Map<HostWindow, SelectedWorkspace>();
  #settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
  #rows: readonly SessionInfo[] = [];
  /** What `keepAwake` was last told. */
  #awake = false;
  /** In flight from start until stopped, so two Start presses share one listener. */
  #remote: Promise<ActiveRemote> | undefined;
  /** Runs remote access starts, stops and plugin changes one at a time. */
  #remoteLock: Promise<void> = Promise.resolve();
  #closing: Promise<void> | undefined;

  constructor(dependencies: DesktopHostDependencies) {
    this.#deps = dependencies;
    this.#servers = new ServerSettingsStore(join(dependencies.home, ".nyte", "server.json"));
    this.#opened = this.#open();
    this.#opened.then(
      (opened) => {
        this.#followView(opened.host).catch(() => undefined);
        this.#followRows(opened.host).catch(() => undefined);
      },
      () => undefined,
    );
  }

  /** The opened host, for the composition root's own reads and for tests. */
  host(): Promise<Host> {
    return this.#opened.then((opened) => opened.host);
  }

  /**
   * Opens the one host over its default store, `<home>/.nyte/nyte.db`, and
   * local provider, with Home as its workspace, the desktop's settings, its
   * viewport browser and the browser and codemode tools, then binds the
   * loopback listener the renderer connects to.
   */
  async #open(): Promise<Opened> {
    const { home } = this.#deps;

    const host = await sdk.open({
      models: this.#deps.models,
      secrets: this.#deps.secrets,
      home,
      workspace: { kind: "local", path: home },
      plugins: [
        desktopSettingsPlugin,
        desktopBrowserPlugin(this.#deps.browser.agent, home),
        browserToolsPlugin,
        codemodePlugin(codemodeRuntimeOptions()),
        canvasPlugin,
      ],
    });

    const token = newToken();

    const listener = await host.listen({
      transport: { kind: "http" },
      auth: { kind: "token", token },
      origins: [this.#deps.rendererOrigin],
    });

    return { host, listener, url: addressOf(listener), token };
  }

  /** Reads the desktop's settings from every host view until the host closes. */
  async #followView(host: Host): Promise<void> {
    for await (const view of host.watch()) {
      this.#settings = desktopSettings(view);
      this.#deps.settingsChanged?.(this.#settings);
      this.#holdAwake();
    }
  }

  /** Keeps the directory rows, children included, that Keep awake and update activity read. */
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
    switch (path) {
      case "host.endpoint": {
        CALL_INPUT_SCHEMAS[path].Parse(input);
        const { host, url, token } = await this.#opened;

        return { url, credentials: { kind: "token", token }, expect: { hostId: host.hostId } };
      }

      case "host.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return {
          workspace: this.#selections.get(window),
          platform: process.platform,
          machineName: machineName(),
        };
      case "host.openWorkspace":
        return this.#openWorkspace(window, CALL_INPUT_SCHEMAS[path].Parse(input).path);
      case "host.closeWorkspace":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        this.#selections.delete(window);

        return undefined;
      case "host.fonts":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#deps.listFonts();
      case "host.pickWorkspace": {
        CALL_INPUT_SCHEMAS[path].Parse(input);
        const picked = await this.#deps.pickFolder(window);

        return picked === undefined ? { kind: "cancelled" } : this.#openWorkspace(window, picked);
      }

      case "host.updates.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#deps.updates?.state() ?? { kind: "idle" };
      case "host.updates.check":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#deps.updates?.check();
      case "host.server.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#serverState();
      case "host.server.connect":
        return this.#connectServer(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.server.disconnect":
        CALL_INPUT_SCHEMAS[path].Parse(input);
        await this.#servers.clear();
        this.#deps.emitHostEvent({ kind: "server_changed" });

        return undefined;
      case "host.remote.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#remoteState();
      case "host.remote.start": {
        const { reach } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#remoteSerial(() => this.#startRemote(reach));
      }

      case "host.remote.stop":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#remoteSerial(() => this.#stopRemote());
      case "host.remote.configure": {
        const { plugin, ...settings } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#remoteSerial(() => this.#remotePlugin(plugin).configure(settings)).then(
          this.#remoteChanged,
        );
      }

      case "host.remote.clear": {
        const { plugin } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#remoteSerial(() => this.#remotePlugin(plugin).clear()).then(
          this.#remoteChanged,
        );
      }

      case "host.remote.pair": {
        const { plugin, name } = CALL_INPUT_SCHEMAS[path].Parse(input);
        const pairing = await this.#remoteSerial(() => this.#remotePlugin(plugin).pair({ name }));
        this.#remoteChanged();

        return pairing;
      }

      case "host.remote.revoke":
        return this.#remoteSerial(() =>
          this.#revokeRemoteDevice(CALL_INPUT_SCHEMAS[path].Parse(input)),
        );
      case "host.connect.state":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#deps.connect?.view() ?? { kind: "unavailable", reason: "not_configured" };
      case "host.connect.link":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#connect().link();
      case "host.connect.cancel":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#connect().cancel();
      case "host.connect.setEnabled": {
        const { enabled } = CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#connect().setEnabled({ enabled, share: this.#connectShare });
      }

      case "host.connect.unlink":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#connect().unlink();
      case "host.connect.revokeDevice":
        return this.#connect().revokeDevice(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.connect.openAccount":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#connect().openAccount();
      case "host.connect.signOut":
        CALL_INPUT_SCHEMAS[path].Parse(input);

        return this.#connect().signOut();
      case "host.openExternal":
        this.#deps.openExternal(safeExternalUrl(CALL_INPUT_SCHEMAS[path].Parse(input).url));

        return undefined;
      case "host.confirmExternal":
        return this.#deps.confirmExternal(
          safeExternalUrl(CALL_INPUT_SCHEMAS[path].Parse(input).url),
          window,
        );
      case "host.revealPath":
        this.#deps.revealPath(CALL_INPUT_SCHEMAS[path].Parse(input).path);

        return undefined;
      case "host.openPluginsFolder": {
        CALL_INPUT_SCHEMAS[path].Parse(input);
        const folder = join(this.#deps.home, ".nyte", "plugins");
        await mkdir(folder, { recursive: true });

        if (this.#deps.openPath === undefined) this.#deps.revealPath(folder);
        else await this.#deps.openPath(folder);

        return undefined;
      }

      case "host.contextMenu":
        return this.#deps.showContextMenu(CALL_INPUT_SCHEMAS[path].Parse(input), window);
      case "host.browser.open":
        return this.#deps.browser.open(CALL_INPUT_SCHEMAS[path].Parse(input), window);
      case "host.browser.navigate":
        this.#deps.browser.navigate(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.browser.menu":
        return this.#deps.browser.menu(CALL_INPUT_SCHEMAS[path].Parse(input), window);
      case "host.browser.perform":
        return this.#deps.browser.perform(CALL_INPUT_SCHEMAS[path].Parse(input), window);
      case "host.browser.close":
        this.#deps.browser.close(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.browser.captureFrame":
        return this.#deps.browser.captureFrame(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.find":
        return this.#deps.browser.find(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.cancelDownload":
        this.#deps.browser.cancelDownload(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.browser.login":
        this.#deps.browser.login(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.browser.history":
        return this.#deps.browser.history(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.forgetHistory":
        return this.#deps.browser.forgetHistory(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.browser.focusPage":
        this.#deps.browser.focusPage(CALL_INPUT_SCHEMAS[path].Parse(input));

        return undefined;
      case "host.terminal.create": {
        const terminals = this.#terminalsOf(window);
        const decoded = CALL_INPUT_SCHEMAS[path].Parse(input);
        await ensureShellEnvironment();

        if (this.#closing !== undefined || this.#terminals.get(window) !== terminals)
          throw new ExpectedHostError({ code: "unavailable", message: "Terminal window closed" });

        return terminals.create({ id: decoded.id, cwd: decoded.workspacePath ?? this.#deps.home });
      }

      case "host.terminal.write":
        return this.#terminalsOf(window).write(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.resize":
        return this.#terminalsOf(window).resize(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.acknowledge":
        return this.#terminalsOf(window).acknowledge(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.idle":
        return this.#terminalsOf(window).idle(CALL_INPUT_SCHEMAS[path].Parse(input));
      case "host.terminal.close":
        return this.#terminalsOf(window).close(CALL_INPUT_SCHEMAS[path].Parse(input));
      default:
        path satisfies never;
        throw new Error("Unknown operation");
    }
  }

  /** A reloaded or closed renderer owns no terminals and no selection anymore. */
  releaseWindow(window: HostWindow): void {
    this.#selections.delete(window);
    const terminals = this.#terminals.get(window);
    this.#terminals.delete(window);
    terminals?.dispose();
  }

  /**
   * Closes terminals, account remote access and remote access, then the host
   * (its listeners and store with it). Accepted work stays on record for the
   * next open.
   */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      for (const terminals of this.#terminals.values()) terminals.dispose();
      this.#terminals.clear();
      this.#holdAwake();
      await this.#deps.connect?.close().catch(() => undefined);
      await this.#remoteSerial(() => this.#stopRemote()).catch(() => undefined);
      const opened = await this.#opened.catch(() => undefined);
      await opened?.host.close();
    })();

    return this.#closing;
  }

  /** What an update would interrupt: chats at work on this host and terminals running a command. */
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

  /** Serve account remote access if it was left on. */
  async autostartConnect(): Promise<void> {
    await this.#deps.connect?.autostart(this.#connectShare);
  }

  #terminalsOf(window: HostWindow): TerminalSessions {
    const existing = this.#terminals.get(window);

    if (existing !== undefined) return existing;

    const terminals = new TerminalSessions(
      (event) => this.#deps.emitHostEvent(event, window),
      () => this.#settings.terminalShell,
    );

    this.#terminals.set(window, terminals);

    return terminals;
  }

  /**
   * Registers the folder with its inspected identity pinned and selects it
   * for this window. A folder swapped under the path while it was inspected,
   * or one the local provider cannot reach, fails with why.
   */
  async #openWorkspace(window: HostWindow, path: string): Promise<OpenWorkspaceOutcome> {
    const { host } = await this.#opened;
    const seen = await host.workspaces.inspect({ kind: "local", path });
    const added = await host.workspaces.add(seen.target, { expect: { identity: seen.identity } });

    if (added.kind === "stale")
      return { kind: "failed", message: "The folder changed while it was opened. Open it again." };

    if (added.kind === "unavailable")
      return { kind: "failed", message: "This folder can't be opened here." };
    const workspace = (await host.workspaces.list()).find((entry) => entry.id === added.workspace);

    if (workspace === undefined)
      return { kind: "failed", message: "The folder was forgotten while it was opened." };
    const folder = "path" in workspace.target ? workspace.target.path : path;
    const selected = { id: workspace.id, path: folder, name: basename(folder) };
    this.#selections.set(window, selected);

    return { kind: "opened", workspace: selected, needsTrust: false };
  }

  /** The remembered server as it answers now: its version, or why it did not answer. */
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

  /** Connects once with the token to learn which host answers, then remembers the three together. */
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

  /** The running listener, or nothing once a start has failed. */
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

  /** Serves the whole host at the reach asked for; runs under the remote lock. */
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

  /**
   * A token reach binds loopback or the tailnet address with a fresh token
   * and a pairing link to the hosted web app; a plugin reach binds the port
   * its exposure names under its auth, then starts the connector.
   */
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

      const address = addressOf(listener);
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

  /** A plugin's connector stops before its port is released; runs under the remote lock. */
  async #stopRemote(): Promise<void> {
    const active = await this.#activeRemote();

    if (active === undefined) return;
    this.#remote = undefined;

    if (active.kind === "plugin") await active.exposure.disconnect();
    await active.listener.close();
    this.#remoteChanged();
  }

  /**
   * Forget a device, then drop every open connection on the plugin's
   * listener: a stream outlives the credential check that opened it. If the
   * plugin cannot record the revoke, remote access stops. Runs under the
   * remote lock.
   */
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

  /**
   * How account remote access binds: the whole host on an ephemeral
   * `127.0.0.1` port, each relayed request authorized by Connect, an owner
   * device with owner authority and a controller as a participant.
   */
  readonly #connectShare: ConnectShare = async (listen) => {
    if (this.#closing !== undefined)
      throw new ExpectedHostError({
        code: "unavailable",
        message: "The window closed before serving",
      });
    const { host } = await this.#opened;

    const listener = await host.listen({
      transport: { kind: "http", hostname: "127.0.0.1" },
      auth: {
        kind: "custom",
        authorize: async (request) => {
          const decision = await listen.authorize(request);

          return decision.kind === "allow"
            ? {
                principal: asId(decision.principal),
                authority: decision.device.role === "owner" ? OWNER : PARTICIPANT,
              }
            : { deny: decision.reason };
        },
      },
      before: listen.handle,
    });

    return {
      port: Number(new URL(addressOf(listener)).port),
      disconnectClients: () => listener.disconnectClients(),
      close: () => listener.close(),
    };
  };
}
