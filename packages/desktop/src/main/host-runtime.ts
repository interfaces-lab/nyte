import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { app, dialog, MessageChannelMain, shell } from "electron";
import type { MessagePortMain } from "electron";
import type { ConnectRuntime } from "@nyte-ai/connect/host";
import { UsageScanWorker } from "@nyte-ai/host/usage-scan";
import { servePort } from "../shared/host-port.ts";
import type { PortEnd } from "../shared/host-port.ts";
import { DesktopHost } from "../host/desktop-host.ts";
import type { DesktopHostDependencies } from "../host/desktop-host.ts";
import { CloudflareTunnelPlugin } from "../host/connections/cloudflare-tunnel.ts";
import { hostAgent } from "./host-agent.ts";
import type { AgentRegistration, HostAgent } from "./host-agent.ts";
import type { HostConnection } from "@nyte-ai/sdk/client";
import type { CanvasPreviewer } from "@nyte-ai/plugin/core/canvas-preview";
import type { HostProcess } from "@nyte-ai/app/contract/bridge.ts";
import type { BrowserAgent } from "../shared/browser-agent.ts";
import { offerAppActions, openAppClient } from "../shared/host-client.ts";
import { HostLink } from "./host-link.ts";
import type { HostLinkState } from "./host-link.ts";
import { followHostProcess } from "./host-process.ts";
import type { HostProcessFollower } from "./host-process.ts";

export interface HostRuntime {
  readonly agent: HostAgent;
  readonly link: HostLink;
  readonly hostProcess: HostProcessFollower;
  readonly client: HostConnection;
  readonly desktop: DesktopHost;
  close(): Promise<void>;
}

export type HostRuntimeOptions = Pick<
  DesktopHostDependencies,
  "emitHostEvent" | "keepAwake" | "settingsChanged" | "alert" | "badge" | "mediaOrigin"
> & {
  readonly appId: string;
  readonly home: string;
  readonly nyteHome: string;
  readonly connect: ConnectRuntime;
  readonly usageWorker: URL;
  readonly hostEntry: URL;
  readonly agent: BrowserAgent;
  readonly preview: CanvasPreviewer;
  previewSignal(): AbortSignal;
  readonly linkChanged?: (state: HostLinkState) => void;
  readonly hostProcessChanged?: (state: HostProcess) => void;
  readonly registrationChanged?: (registration: AgentRegistration) => void;
};

export function startHostRuntime(options: HostRuntimeOptions): HostRuntime {
  const agent = hostAgent({
    appId: options.appId,
    home: options.home,
    nyteHome: options.nyteHome,
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    executable: process.execPath,
    entry: fileURLToPath(options.hostEntry),
    label: app.isPackaged ? undefined : process.env["NYTE_DESKTOP_HOST_LABEL"],
  });

  const socket = join(options.nyteHome, "host.sock");

  const link = new HostLink(socket, (state) => {
    options.linkChanged?.(state);
    hostProcess.linkChanged();
  });

  const hostProcess = followHostProcess({
    agent,
    appVersion: app.getVersion(),
    link: () => link.state,
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
  link.start();
  const client = openAppClient({ socket, version: app.getVersion() });

  const withdraw = offerAppActions(client, {
    agent: options.agent,
    preview: options.preview,
    signal: () => options.previewSignal(),
  });

  const desktop = new DesktopHost({
    home: options.home,
    open: () => link.connect(),
    client,
    usageScan: new UsageScanWorker(options.home, options.usageWorker),
    remoteAccessPlugins: {
      cloudflare: new CloudflareTunnelPlugin({ home: join(options.home, ".nyte") }),
    },
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
    link,
    hostProcess,
    client,
    desktop,
    async close() {
      withdraw();
      link.close();
      await hostProcess.close();
      await desktop.close();
      client.release();
    },
  };
}

export function bridgeHostPort(link: HostLink): MessagePortMain {
  const channel = new MessageChannelMain();
  servePort(mainPortEnd(channel.port1), link.fetch, link.dial);

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
        if (response === 0)
          void shell.openExternal(
            "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
          );
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
