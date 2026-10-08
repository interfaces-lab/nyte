import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { createNyteModels } from "@nyte-ai/ai";
import { SqliteStore } from "@nyte-ai/core/store";
import { createModelPreferencesStore, readCatalog } from "@nyte-ai/host/catalog";
import { openHostRuntime, openProfile } from "@nyte-ai/host/runtime";
import packageMetadata from "../package.json" with { type: "json" };
import { startHeadless } from "./headless.ts";
import { appDistRoot, findTailnetAddress, pairingOrigin, pairingUrl } from "./index.ts";
import { createStaticHandler } from "./static.ts";

const HELP = `nyte-serve · serve a host profile and, when built, the Nyte web app

  usage:
  nyte-serve [flags]

  flags:
  --profile <name>     host profile under ~/.nyte/hosts; default: default
  --workspace <path>   register a folder on this host; repeatable; default: current directory
  --trust              grant trust to each --workspace folder as it is now
  --host <address>     address to bind, or tailnet; default: 127.0.0.1
  --port <number>      port to bind; default: 5180
  --no-app             serve the API without the web app
  --open               open the pairing link in the default browser
  --help               show this help

  The token printed at start is the bearer for direct access.
  Roots start through environment.start with a registered workspace id.
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
      profile: { type: "string" },
      workspace: { type: "string", multiple: true },
      trust: { type: "boolean" },
      host: { type: "string" },
      port: { type: "string" },
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

  const hostname = values.host === "tailnet" ? await tailnetHost() : values.host;
  const appRoot = values["no-app"] === true ? undefined : appDistRoot();
  const built = appRoot !== undefined && existsSync(join(appRoot, "index.html"));
  const models = createNyteModels();
  await models.refresh();
  const { defaultModel } = await readCatalog(models, await createModelPreferencesStore().read());

  if (defaultModel === undefined) {
    throw new Error(
      "No models are available. Check your connection, then run `nyte update --models`.",
    );
  }

  const profile = await openProfile(values.profile ?? "default");
  let runtime;

  try {
    runtime = await openHostRuntime({
      profile,
      store: new SqliteStore(profile.storePath),
      models,
      model: defaultModel,
      onDiagnostic: (message) => process.stderr.write(`${message}\n`),
    });
  } catch (cause) {
    await profile.release();
    throw cause;
  }

  const folders = (values.workspace ?? [process.cwd()]).map((folder) => resolve(folder));

  for (const folder of folders) {
    const registered = await runtime.workspaces.register(folder);

    if (registered.kind !== "registered" && registered.kind !== "exists") {
      await runtime.close();
      throw new Error(`Cannot register ${folder}: ${registered.kind.replaceAll("_", " ")}.`);
    }

    const { workspace } = registered;

    if (values.trust === true && workspace.trust.kind !== "granted") {
      const granted = await runtime.workspaces.grant(
        workspace.id,
        workspace.path,
        workspace.identity,
      );

      if (granted.kind !== "granted") {
        await runtime.close();
        throw new Error(`Cannot trust ${folder}: ${granted.kind.replaceAll("_", " ")}.`);
      }
    }
  }

  const serving = await startHeadless({
    runtime,
    version: packageMetadata.version,
    hostname,
    port,
    handle: built && appRoot !== undefined ? createStaticHandler(appRoot) : undefined,
  }).catch(async (cause: unknown) => {
    await runtime.close();
    throw cause;
  });

  const stop = (): void => {
    void serving
      .close()
      .then(() => runtime.close())
      .finally(() => process.exit(0));
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const rows = await runtime.workspaces.list();
  process.stdout.write(
    `Host ${profile.hostId} (profile ${profile.name})\nAPI at ${serving.address}\n`,
  );

  for (const row of rows) {
    process.stdout.write(`Workspace ${row.id}  ${row.path}  trust: ${row.trust.kind}\n`);
  }

  process.stdout.write(`Bearer token: ${profile.token}\n`);

  if (appRoot !== undefined && !built) {
    process.stdout.write(
      "The web app is not built. Run `pnpm --dir packages/app build`, then start again.\n",
    );
  }

  if (built && appRoot !== undefined) {
    const link = pairingUrl(
      pairingOrigin(serving.address, appRoot),
      serving.address,
      profile.token,
    );
    process.stdout.write(`Open this link to connect a browser:\n${link}\n`);

    if (values.open === true) openInBrowser(link);
  }
}
