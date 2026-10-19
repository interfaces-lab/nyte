import { join } from "node:path";
import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { ConnectRuntime } from "@nyte-ai/connect/host";
import { dev } from "@nyte-ai/core";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewRequest,
} from "@nyte-ai/plugin/core/canvas-preview";
import { openSecret, sealSecret } from "@nyte-ai/host/credentials";
import { defaultSecrets } from "@nyte-ai/host/secrets";
import type { MessagePortMain } from "electron";
import { servePort } from "../shared/host-port.ts";
import type { PortEnd } from "../shared/host-port.ts";
import { UsageScanWorker } from "@nyte-ai/host/usage-scan";
import { CloudflareTunnelPlugin } from "./cloudflare-tunnel.ts";
import { readConnectConfig } from "./connect-config.ts";
import { RemoteAccount } from "./host-account.ts";
import type { AccountAnswer, AccountCall } from "./host-account.ts";
import { remoteAgent } from "./host-browser-agent.ts";
import type { AgentAnswer, AgentCall } from "./host-browser-agent.ts";
import type {
  HostAnswer,
  HostAsk,
  HostMessage,
  HostProcessOptions,
  MainAnswer,
  MainAsk,
  MainMessage,
} from "./host-messages.ts";
import { REVOKED_EXIT } from "./host-messages.ts";
import { Rpc } from "./host-rpc.ts";
import { DesktopHost, throwForRenderer } from "./host.ts";
import type { CallRoute } from "./ipc-call.ts";
import { callIpc } from "./ipc-call.ts";
import { models } from "./models.ts";

const port = process.parentPort;

const post = (message: HostMessage): void => port.postMessage(message);

registerBunOAuthFlows();

if (process.env.NYTE_DEV_LOG !== undefined) dev.forward(process.env.NYTE_DEV_LOG, "desktop");

const marks = new PerformanceObserver((list) => {
  for (const entry of list.getEntries())
    post({ kind: "mark", name: entry.name, at: performance.timeOrigin + entry.startTime });
});

marks.observe({ entryTypes: ["mark"] });

function open(options: HostProcessOptions): void {
  const { home } = options;

  const rpc = new Rpc<HostAsk, MainAnswer, MainAsk, HostAnswer>(post, (ask) => answer(ask));

  const askAgent = async (call: AgentCall): Promise<AgentAnswer> => {
    const answered = await rpc.ask({ kind: "agent", call });

    if (answered.kind !== "agent")
      throw new Error("Main answered a browser call about the account.");

    return answered.answer;
  };

  const preview = async (
    request: CanvasPreviewRequest,
    signal: AbortSignal,
  ): Promise<CanvasPreviewOutcome> => {
    const answered = await rpc.ask({ kind: "canvas-preview", request }, signal);

    if (answered.kind !== "canvas-preview")
      throw new Error("Main answered a canvas preview about something else.");

    return answered.outcome;
  };

  const askAccount = async (call: AccountCall, signal?: AbortSignal): Promise<AccountAnswer> => {
    const answered = await rpc.ask({ kind: "account", call }, signal);

    if (answered.kind !== "account")
      throw new Error("Main answered an account call about the browser.");

    return answered.answer;
  };

  const account =
    options.account === null ? undefined : new RemoteAccount(options.account, askAccount);

  const connect = new ConnectRuntime({
    config: readConnectConfig(import.meta.env),
    home: join(home, ".nyte"),
    authorizer: account === undefined ? undefined : { kind: "session", account },
    onChange: () => host.remoteChanged(),
  });

  const host = new DesktopHost({
    home,
    version: options.version,
    models,
    usageScan: new UsageScanWorker(home, new URL("./usage-worker.js", import.meta.url)),
    openDelayMs: options.openDelayMs,
    token: options.token,
    remoteAccessPlugins: { cloudflare: new CloudflareTunnelPlugin({ home: join(home, ".nyte") }) },
    connect,
    keepAwake: (awake) => post({ kind: "awake", awake }),
    settingsChanged: (settings) => post({ kind: "settings", settings }),
    emitHostEvent: (event, window) => post({ kind: "event", event, window }),
    agent: remoteAgent(askAgent),
    preview,
    revoked: () => void host.close().finally(() => process.exit(REVOKED_EXIT)),
  });

  const secrets = defaultSecrets(home);

  const route: CallRoute = (window, path, input) =>
    host.call(window, path, input).catch(throwForRenderer);

  const answer = async (ask: MainAsk): Promise<HostAnswer> => {
    switch (ask.kind) {
      case "call":
        return { kind: "call", reply: await callIpc(route, ask.window, ask.request) };
      case "activity":
        return { kind: "activity", activity: await host.updateActivity() };
      case "secret":
        return {
          kind: "secret",
          text: await (ask.seal ? sealSecret(secrets, ask.text) : openSecret(secrets, ask.text)),
        };
      default: {
        const _exhaustive: never = ask;

        return _exhaustive;
      }
    }
  };

  host.autostartConnect();

  port.on(
    "message",
    ({ data, ports }: { readonly data: MainMessage; readonly ports: MessagePortMain[] }) => {
    switch (data.kind) {
      case "ask":
      case "abort":
      case "settle":
        rpc.receive(data);

        return;
      case "release":
        host.releaseWindow(data.window);

        return;
      case "resume":
        host.resume();

        return;
      case "account":
        account?.changed(data.state);
        host.accountChanged();

        return;
      case "close":
        void host.close().finally(() => {
          post({ kind: "closed" });
          process.exit(0);
        });

        return;
      case "port":
        for (const received of ports)
          servePort(mainPortEnd(received), (request) => host.fetch(request));

        return;
      case "open":
        return;
      default: {
        const _exhaustive: never = data;

        return _exhaustive;
      }
    }
  });
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

port.once("message", ({ data }: { readonly data: MainMessage }) => {
  if (data.kind === "open") open(data.options);
});
