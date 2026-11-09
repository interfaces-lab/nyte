import { homedir } from "node:os";
import process from "node:process";
import { parentPort } from "node:worker_threads";
import { registerBunOAuthFlows } from "@nyte-ai/ai/bun-oauth";
import { files } from "@nyte-ai/canvas/shell-files";
import { ConnectRuntime, hostShare, machineName } from "@nyte-ai/connect/host";
import { TOKEN } from "@nyte-ai/core/server";
import type { PluginImport } from "@nyte-ai/host";
import { chromiumCanvasPreview } from "@nyte-ai/host/canvas-preview";
import { nodeImages } from "@nyte-ai/host/images";
import type { NodeImagesOptions } from "@nyte-ai/host/images";
import { completeShellEnvironment } from "@nyte-ai/host/shell-env";
import { clientBrowserPlugins } from "@nyte-ai/plugin/core/browser-client";
import { canvasPlugin } from "@nyte-ai/plugin/core/canvas";
import { clientCanvasPreview } from "@nyte-ai/plugin/core/canvas-client";
import { codemodePlugin } from "@nyte-ai/plugin/core/codemode";
import type { CodemodeSandboxOptions } from "@nyte-ai/plugin/core/codemode-runtime";
import { desktopSettingsPlugin } from "@nyte-ai/plugin/core/desktop-settings";
import { dev, sdk } from "@nyte-ai/sdk";
import type { Host } from "@nyte-ai/sdk";
import { readConnectConfig } from "./connect-config.ts";
import { docsPlugin, syncDocs } from "./docs.ts";
import type { DocsFiles } from "./docs.ts";
import { hostMessages } from "./host-thread.ts";
import type { HostCommand, HostReport } from "./host-thread.ts";
import { portConflict, probePort } from "./port.ts";
import { Sharing } from "./sharing.ts";

export interface HostWorkerRuntime {
  readonly source: string;
  readonly codemode: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">;
  readonly images: NodeImagesOptions;
  readonly pluginImport?: PluginImport;
  readonly docs: DocsFiles;
}

interface Opened {
  readonly address: string;
  close(): Promise<void>;
}

export function serveHostThread(runtime: HostWorkerRuntime): void {
  const port = parentPort;

  if (port === null) throw new Error("The host worker must run on a worker thread.");

  registerBunOAuthFlows();

  const report = (message: HostReport): void => port.postMessage(message);

  let opening: Promise<Opened | null> = Promise.resolve(null);

  const revoked = (): void =>
    void opening
      .then((opened) => opened?.close())
      .catch(() => undefined)
      .then(() => report({ kind: "revoked" }));

  port.on("message", (message) => {
    if (!hostMessages.Check(message)) {
      report({
        kind: "failed",
        message: "The host's process sent a message the host thread does not know.",
      });

      return;
    }

    if (message.kind !== "stop") {
      opening = open(message, runtime, revoked).then(
        (opened) => {
          report({ kind: "listening", address: opened.address });

          return opened;
        },
        (cause: unknown) => {
          report({ kind: "failed", message: failureMessage(cause) });

          return null;
        },
      );

      return;
    }

    void opening
      .then((opened) => opened?.close())
      .then(
        () => report({ kind: "closed" }),
        (cause: unknown) => report({ kind: "failed", message: failureMessage(cause) }),
      );
  });
}

async function open(
  command: HostCommand,
  runtime: HostWorkerRuntime,
  revoked: () => void,
): Promise<Opened> {
  if (command.socket !== undefined) void completeShellEnvironment();
  let shell: string | null = null;
  const host = await openLocalHost(command, runtime, revoked, () => shell);

  if (command.socket !== undefined)
    void followTerminalShell(host, (next) => {
      shell = next;
    });

  let sharing: Sharing | null = null;

  const connect = new ConnectRuntime({
    config: readConnectConfig(),
    home: `${homedir()}/.nyte`,
    authorizer: { kind: "transaction", onOpened: () => undefined },
    onChange: () => sharing?.changed(),
    name: machineName(),
  });

  sharing = new Sharing({ connect, share: hostShare(host), home: homedir() });

  try {
    const listener = await host.listen({
      transport: { kind: "http", hostname: "127.0.0.1", port: command.port },
      auth: { kind: "token", token: command.token, authority: new Set(command.authority) },
      before: sharing.routes(command.token),
    });

    if (listener.address === null) throw new Error("The listener bound no address.");

    if (command.socket !== undefined)
      await host.listen({
        transport: { kind: "socket", path: command.socket },
        auth: {
          kind: "custom",
          authorize: () => ({ principal: TOKEN, authority: new Set(command.authority) }),
        },
        execution: { kind: "admit-only" },
        before: sharing.routes(command.token),
      });

    sharing.start();

    return {
      address: listener.address,
      close: async () => {
        await sharing.close();
        await connect.close();
        await host.close();
      },
    };
  } catch (cause) {
    await sharing.close();
    await connect.close();
    await host.close();

    const conflict =
      command.port === 0 ? undefined : portConflict(command.port, await probePort(command.port));

    throw conflict === undefined ? cause : new Error(conflict);
  }
}

async function openLocalHost(
  command: HostCommand,
  runtime: HostWorkerRuntime,
  revoked: () => void,
  shell: () => string | null,
): Promise<Host> {
  if (process.env.NYTE_DEV_LOG !== undefined) dev.forward(process.env.NYTE_DEV_LOG, runtime.source);
  const preview = chromiumCanvasPreview(files);
  const clients = command.socket !== undefined;
  const docs = await syncDocs(runtime.docs);

  return sdk.open({
    plugins: [
      codemodePlugin(runtime.codemode),
      docsPlugin(docs),
      ...(clients ? [desktopSettingsPlugin] : []),
    ],
    clientPlugins: (actions) =>
      clients
        ? [
            ...clientBrowserPlugins(actions, homedir()),
            canvasPlugin(clientCanvasPreview(actions, preview)),
          ]
        : [canvasPlugin(preview)],
    images: nodeImages(runtime.images),
    pluginImport: runtime.pluginImport,
    execution: { kind: "run", coverage: { kind: "all" } },
    label: "nyte",
    onRevoked: revoked,
    shell,
    tailnet: command.tailnet === undefined ? undefined : { binary: command.tailnet },
    workspace:
      command.workspace === undefined ? undefined : { kind: "local", path: command.workspace },
  });
}

async function followTerminalShell(host: Host, apply: (shell: string | null) => void) {
  try {
    for await (const view of host.watch()) {
      const value = view.settings.find((setting) => setting.id === "desktop.terminalShell")?.value;
      apply(typeof value === "string" ? value : null);
    }
  } catch {
    apply(null);
  }
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
