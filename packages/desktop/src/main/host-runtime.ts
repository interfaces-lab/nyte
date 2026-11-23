import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { app, dialog, MessageChannelMain, shell } from "electron";
import type { MessagePortMain } from "electron";
import type { ConnectRuntime } from "@nyte-ai/connect/host";
import { UsageScanWorker } from "@nyte-ai/host/usage-scan";
import { servePort, HOST_PORT_ORIGIN } from "../shared/host-port.ts";
import type { PortEnd, DialSocket } from "../shared/host-port.ts";
import { DesktopHost } from "../host/desktop-host.ts";
import type { DesktopHostDependencies } from "../host/desktop-host.ts";
import { hostAgent } from "./host-agent.ts";
import type { AgentRegistration, HostAgent } from "./host-agent.ts";
import type { SessionId } from "@nyte-ai/sdk";
import { connect, createSendJournal } from "@nyte-ai/sdk/client";
import type { ClientConnection, Live, LinkState } from "@nyte-ai/sdk/client";
import type { CanvasPreviewer } from "@nyte-ai/plugin/core/canvas-preview";
import type { HostProcess } from "@nyte-ai/app/contract/bridge.ts";
import type { BrowserAgent } from "../shared/browser-agent.ts";
import { appSocket, offerAppActions } from "../shared/host-client.ts";
import { socketDial, socketFetch } from "./host-socket.ts";
import { followHostProcess } from "./host-process.ts";
import type { HostProcessFollower } from "./host-process.ts";
import type { PackagedBuild } from "../shared/desktop-builds.ts";

export interface HostRoute {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly dial: DialSocket;
}

export interface HostRuntime {
  readonly agent: HostAgent;
  readonly route: HostRoute;
  readonly link: Live<LinkState>;
  readonly hostProcess: HostProcessFollower;
  readonly desktop: DesktopHost;
  resume(): void;
  close(): Promise<void>;
}

export type HostRuntimeOptions = Pick<
  DesktopHostDependencies,
  "emitHostEvent" | "keepAwake" | "settingsChanged" | "alert" | "badge" | "mediaOrigin"
> & {
  readonly build: PackagedBuild | null;
  readonly home: string;
  readonly nyteHome: string;
  readonly connect: ConnectRuntime;
  readonly usageWorker: URL;
  readonly hostEntry: URL;
  readonly agent: BrowserAgent;
  readonly preview: CanvasPreviewer;
  previewSignal(): AbortSignal;
  openChat(session: SessionId): void;
  readonly linkChanged?: (state: LinkState) => void;
  readonly hostProcessChanged?: (state: HostProcess) => void;
  readonly registrationChanged?: (registration: AgentRegistration) => void;
};

export function startHostRuntime(options: HostRuntimeOptions): HostRuntime {
  const agent = hostAgent({
    build: options.build,
    home: options.home,
    nyteHome: options.nyteHome,
    appPath: app.getAppPath(),
    executable: process.execPath,
    entry: fileURLToPath(options.hostEntry),
    label: options.build === null ? process.env["NYTE_DESKTOP_HOST_LABEL"] : undefined,
  });

  const socket = join(options.nyteHome, "host.sock");
  const route: HostRoute = { fetch: socketFetch(socket), dial: socketDial(socket) };
  const stop = new AbortController();

  const connection = connect({
    url: HOST_PORT_ORIGIN,
    credentials: { kind: "custom", headers: () => ({}) },
    client: { kind: "app", name: "Nyte", version: app.getVersion() },
    journal: createSendJournal(),
    transport: {
      fetch: (url, init) => route.fetch(new Request(url, init)),
      socket: appSocket(socket),
    },
    wait: stop.signal,
  });

  const link = connectedLink(connection);
  link.subscribe(() => options.linkChanged?.(link.snapshot()));

  const hostProcess = followHostProcess({
    agent,
    link,
    activity: () => desktop.updateActivity(),
    changed: (state) => options.hostProcessChanged?.(state),
  });

  void agent.start().then(
    (registration) => {
      options.registrationChanged?.(registration);
      announce(registration);
    },
    (cause: unknown) => dialog.showErrorBox("Nyte couldn't start its host", describe(cause)),
  );

  const offered = connection.then(
    (opened) =>
      offerAppActions(opened, {
        agent: options.agent,
        preview: options.preview,
        signal: () => options.previewSignal(),
        openChat: (session) => options.openChat(session),
      }),
    () => () => undefined,
  );

  const desktop = new DesktopHost({
    home: options.home,
    connection,
    appVersion: app.getVersion(),
    usageScan: new UsageScanWorker(options.home, options.usageWorker),
    connect: options.connect,
    mediaOrigin: options.mediaOrigin,
    emitHostEvent: options.emitHostEvent,
    keepAwake: options.keepAwake,
    settingsChanged: options.settingsChanged,
    alert: options.alert,
    badge: options.badge,
  });

  return {
    agent,
    route,
    link,
    hostProcess,
    desktop,
    resume() {
      void connection.then((opened) => opened.retry());
      desktop.resume();
      options.hostProcessChanged?.(hostProcess.state());
    },
    async close() {
      stop.abort();
      (await offered)();
      await desktop.close();
      await connection.then(
        (opened) => opened.close(),
        () => undefined,
      );
    },
  };
}

function connectedLink(connection: Promise<ClientConnection>): Live<LinkState> {
  const listeners = new Set<() => void>();
  let opened: ClientConnection | null = null;

  void connection.then(
    (ready) => {
      opened = ready;

      for (const listener of listeners) ready.link.subscribe(listener);

      for (const listener of listeners) listener();
    },
    () => undefined,
  );

  return {
    snapshot: () => opened?.link.snapshot() ?? { kind: "connecting" },
    subscribe(listener) {
      listeners.add(listener);
      const stop = opened?.link.subscribe(listener);

      return () => {
        listeners.delete(listener);
        stop?.();
      };
    },
  };
}

export function bridgeHostPort(route: HostRoute): MessagePortMain {
  const channel = new MessageChannelMain();
  servePort(mainPortEnd(channel.port1), route.fetch, route.dial);

  return channel.port2;
}

function mainPortEnd(port: MessagePortMain): PortEnd {
  return {
    open({ message, closed }) {
      port.on("message", (event) => message(event.data));
      port.once("close", closed);
      port.start();
    },
    post: (message) => port.postMessage(message),
    close: () => port.close(),
  };
}

function announce(registration: AgentRegistration): void {
  if (registration === "enabled") return;

  if (registration === "requires-approval") {
    void dialog
      .showMessageBox({
        type: "info",
        message: "Allow Nyte Host to run",
        detail:
          "Nyte runs its host in the background so chats keep going after you quit. Turn on Nyte in System Settings > General > Login Items & Extensions.",
        buttons: ["Open Login Items", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          void shell.openExternal(
            "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
          );
        }
      });

    return;
  }

  dialog.showErrorBox(
    "Nyte couldn't register its host",
    registration === "not-found"
      ? "This copy of Nyte is missing its host. Reinstall Nyte."
      : "macOS didn't register the Nyte host. Quit and reopen Nyte.",
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
