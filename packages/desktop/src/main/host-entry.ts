/**
 * The host process: an Electron utility process that main forks at launch. It runs the Nyte
 * host (store, folds, MCP, tools, terminals, listeners, remote access and Connect) off main's
 * thread, so main keeps only windows, menus, dialogs and the browser panel. Renderers reach the
 * host over its HTTP listener; main forwards their other host operations here (`host-messages.ts`).
 */
import { join } from "node:path";
import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { ConnectRuntime } from "@nyte-ai/connect/host";
import { dev } from "@nyte-ai/core";
import { openSecret, sealSecret } from "@nyte-ai/host/credentials";
import { defaultSecrets } from "@nyte-ai/host/secrets";
import { UsageScanWorker } from "@nyte-ai/host/usage-scan";
import { CloudflareTunnelPlugin } from "./cloudflare-tunnel.ts";
import { readConnectConfig } from "./connect-config.ts";
import { RemoteAccount } from "./host-account.ts";
import type { AccountAnswer, AccountCall } from "./host-account.ts";
import { remoteAgent } from "./host-browser-agent.ts";
import type { AgentAnswer, AgentCall } from "./host-browser-agent.ts";
import type {
  HostMessage,
  HostProcessOptions,
  HostRequest,
  MainAnswer,
  MainMessage,
} from "./host-messages.ts";
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

let asked = 0;

const answers = new Map<
  number,
  (outcome: Extract<MainMessage, { kind: "answer" }>["outcome"]) => void
>();

/** Asks main for `request`; an aborted `signal` tells main to give up on it. */
function ask(request: HostRequest, signal?: AbortSignal): Promise<MainAnswer> {
  const id = ++asked;
  const abort = (): void => post({ kind: "abort", id });

  return new Promise<MainAnswer>((resolve, reject) => {
    answers.set(id, (outcome) => {
      signal?.removeEventListener("abort", abort);

      if (outcome.ok) resolve(outcome.answer);
      else reject(new Error(outcome.message));
    });
    signal?.addEventListener("abort", abort, { once: true });
    post({ kind: "request", id, request });
  });
}

async function askAgent(call: AgentCall): Promise<AgentAnswer> {
  const answered = await ask({ kind: "agent", call });

  if (answered.kind !== "agent") throw new Error("Main answered a browser call about the account.");

  return answered.answer;
}

async function askAccount(call: AccountCall, signal?: AbortSignal): Promise<AccountAnswer> {
  const answered = await ask({ kind: "account", call }, signal);

  if (answered.kind !== "account")
    throw new Error("Main answered an account call about the browser.");

  return answered.answer;
}

function open(options: HostProcessOptions): void {
  const { home } = options;

  const account =
    options.account === null ? undefined : new RemoteAccount(options.account, askAccount);

  const connect = new ConnectRuntime({
    config: readConnectConfig(import.meta.env),
    home: join(home, ".nyte"),
    authorizer: account === undefined ? undefined : { kind: "session", account },
    onChange: () => post({ kind: "event", event: { kind: "remote_access_changed" } }),
  });

  const host = new DesktopHost({
    home,
    models,
    usageScan: new UsageScanWorker(home, new URL("./usage-worker.js", import.meta.url)),
    rendererOrigin: options.rendererOrigin,
    remoteAccessPlugins: { cloudflare: new CloudflareTunnelPlugin({ home: join(home, ".nyte") }) },
    connect,
    keepAwake: (awake) => post({ kind: "awake", awake }),
    settingsChanged: (settings) => post({ kind: "settings", settings }),
    emitHostEvent: (event, window) => post({ kind: "event", event, window }),
    agent: remoteAgent(askAgent),
  });

  const secrets = defaultSecrets(home);

  const route: CallRoute = (window, path, input) =>
    host.call(window, path, input).catch(throwForRenderer);

  void host.autostartConnect().catch(() => undefined);

  port.on("message", ({ data }: { readonly data: MainMessage }) => {
    switch (data.kind) {
      case "call":
        void callIpc(route, data.window, data.request).then((reply) =>
          post({ kind: "reply", id: data.id, reply }),
        );

        return;
      case "activity":
        void host
          .updateActivity()
          .then((activity) => post({ kind: "activity", id: data.id, activity }));

        return;
      case "secret":
        void (data.seal ? sealSecret(secrets, data.text) : openSecret(secrets, data.text)).then(
          (text) => post({ kind: "secret", id: data.id, outcome: { ok: true, text } }),
          (cause: unknown) =>
            post({
              kind: "secret",
              id: data.id,
              outcome: {
                ok: false,
                message: cause instanceof Error ? cause.message : String(cause),
              },
            }),
        );

        return;
      case "release":
        host.releaseWindow(data.window);

        return;
      case "resume":
        connect.resume();

        return;
      case "account":
        account?.changed(data.state);
        connect.accountChanged();

        return;
      case "answer":
        answers.get(data.id)?.(data.outcome);
        answers.delete(data.id);

        return;
      case "close":
        void host.close().finally(() => {
          post({ kind: "closed" });
          process.exit(0);
        });

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

port.once("message", ({ data }: { readonly data: MainMessage }) => {
  if (data.kind === "open") open(data.options);
});
