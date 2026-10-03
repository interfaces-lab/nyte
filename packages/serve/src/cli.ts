import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { createWorkspaceStore } from "@nyte-ai/host";
import packageMetadata from "../package.json" with { type: "json" };
import { openServedHost } from "./host.ts";
import {
  appDistRoot,
  findTailnetAddress,
  loadOrCreateToken,
  pairingOrigin,
  pairingUrl,
  startServe,
} from "./index.ts";

const HELP = `nyte-serve · serve one folder and the Nyte web app

  usage:
  nyte-serve [flags]

  flags:
  --cwd <path>      folder to serve; default: current directory
  --host <address>  address to bind, or tailnet; default: 127.0.0.1
  --port <number>   port to bind; default: 5180
  --token <token>   bearer token; default: saved in ~/.nyte/serve/token
  --trust           trust the folder before serving it
  --no-app          serve the API without the web app
  --open            open the pairing link in the default browser
  --help            show this help
`;

async function tailnetHost(): Promise<string> {
  const lookup = await findTailnetAddress(process.platform);

  if (lookup.kind === "ready") return lookup.address.ip;

  if (lookup.kind === "missing")
    throw new Error("--host tailnet needs Tailscale, which was not found.");

  throw new Error(`--host tailnet needs Tailscale running; its state is ${lookup.state}.`);
}

function openInBrowser(url: string): void {
  const opener =
    process.platform === "darwin"
      ? { command: "open", args: [url] }
      : process.platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", url] }
        : { command: "xdg-open", args: [url] };

  spawn(opener.command, opener.args, { detached: true, stdio: "ignore" })
    .on("error", () => undefined)
    .unref();
}

export async function main(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    // `pnpm serve -- <flags>` forwards the separator.
    args: argv.filter((arg) => arg !== "--"),
    strict: true,
    options: {
      cwd: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      token: { type: "string" },
      trust: { type: "boolean" },
      "no-app": { type: "boolean" },
      open: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help === true) {
    process.stdout.write(HELP);

    return;
  }

  const port = Number(values.port ?? 5180);

  if (!(Number.isInteger(port) && port >= 0 && port <= 65_535)) {
    throw new Error("--port must be a number from 0 to 65535.");
  }

  if (values.token !== undefined && values.token.length < 16) {
    throw new Error("--token must be at least 16 characters.");
  }

  const host = values.host === "tailnet" ? await tailnetHost() : values.host;
  const cwd = resolve(values.cwd ?? process.cwd());

  if (values.trust === true) await createWorkspaceStore().trust(cwd);
  const appRoot = values["no-app"] === true ? undefined : appDistRoot();
  const built = appRoot !== undefined && existsSync(join(appRoot, "index.html"));

  const token = values.token ?? (await loadOrCreateToken());
  const served = await openServedHost({
    cwd,
    onDiagnostic: (message) => process.stderr.write(`${message}\n`),
  });

  const serving = await startServe({
    sdk: served.sdk,
    environment: served.environment,
    attach: served.attach,
    version: packageMetadata.version,
    describe: () => ({ capabilities: { workspace: true }, persistence: "durable" }),
    host,
    port,
    auth: { kind: "token", token },
    appRoot: built ? appRoot : undefined,
  }).catch(async (cause: unknown) => {
    await served.close();
    throw cause;
  });

  const stop = (): void => {
    void serving
      .close()
      .then(() => served.close())
      .finally(() => process.exit(0));
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stdout.write(`Serving ${served.workspace.cwd}\nAPI at ${serving.address}\n`);

  if (appRoot !== undefined && !built) {
    process.stdout.write(
      "The web app is not built. Run `pnpm --dir packages/app build`, then start again.\n",
    );
  }

  const link = pairingUrl(
    pairingOrigin(serving.address, built ? appRoot : undefined),
    serving.address,
    token,
  );
  process.stdout.write(`Open this link to connect a browser:\n${link}\n`);

  if (values.open === true) openInBrowser(link);
}
