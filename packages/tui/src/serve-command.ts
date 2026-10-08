/**
 * `nyte serve`: this binary as a headless host. One profile, its registered
 * folders, one direct address, no terminal UI. With `--account`, the
 * profile's Nyte account link also serves through the Connect relay on a
 * second, loopback listener: its devices are controllers there, owners only
 * when both the device enrolled as one and `--device-admin` says so. The
 * process is the host: it runs while this command runs, and Ctrl-C ends the
 * listeners, then the runtime, then the process.
 */
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { createNyteModels } from "@nyte-ai/ai";
import type { ConnectView } from "@nyte-ai/connect";
import { ConnectRuntime, machineName } from "@nyte-ai/connect/host";
import { WorkerStore } from "@nyte-ai/core/store";
import { openHostRuntime, openProfile } from "@nyte-ai/host/runtime";
import type { HostRuntime } from "@nyte-ai/host/runtime";
import { createOtelExport } from "@nyte-ai/host/otel";
import { accountShare, startHeadless } from "@nyte-ai/serve/headless";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";
import { CONNECT_UNCONFIGURED, readConnectConfig } from "./connect-config.ts";
import type { RunFlags } from "./flags.ts";
import { storeWorkerLocation } from "./host.ts";
import { createBunPluginSources } from "./plugin-loader.ts";
import { hostFallbacks, resolveRuntime, tuiPlugins } from "./run.ts";
import type { Runtime } from "./run.ts";
import { FileSettingsStore } from "./settings.ts";
import { VERSION } from "./version.ts";

export const SERVE_HELP = [
  "Usage: nyte serve [--workspace <path>]... [--trust] [--profile <name>] [--host <address>] [--port <number>] [--account [--device-admin]]",
  "Run this machine as a headless Nyte host: no terminal UI.",
  "--workspace registers a folder on the host (default: the current directory); --trust grants it as it is now.",
  "--profile names the host identity and history under ~/.nyte/hosts (default: default).",
  "--host and --port choose the direct address to bind (default: 127.0.0.1, a free port).",
  "--account also serves the profile's Nyte account link through the Connect relay; link first with `nyte account login`.",
  "--device-admin lets devices that enrolled as admins add folders and manage providers; without it every device only runs sessions.",
  "The token printed at start is the bearer for direct access; roots start through environment.start.",
  "Example: nyte serve --workspace ~/code/app --trust --account",
].join("\n");

interface ServeArgs {
  readonly profile: string;
  readonly workspaces: readonly string[];
  readonly trust: boolean;
  readonly hostname: string | undefined;
  readonly port: number;
  readonly account: boolean;
  readonly deviceAdmin: boolean;
}

export function parseServeArgs(args: readonly string[]): ServeArgs {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    options: {
      profile: { type: "string" },
      workspace: { type: "string", multiple: true },
      trust: { type: "boolean" },
      host: { type: "string" },
      port: { type: "string" },
      account: { type: "boolean" },
      "device-admin": { type: "boolean" },
    },
  });

  const port = Number(values.port ?? 0);

  if (!(Number.isInteger(port) && port >= 0 && port <= 65_535)) {
    throw new Error("--port must be a number from 0 to 65535. Run `nyte serve --help`.");
  }

  if (values["device-admin"] === true && values.account !== true) {
    throw new Error("--device-admin applies to --account. Run `nyte serve --help`.");
  }

  return {
    profile: values.profile ?? "default",
    workspaces: (values.workspace ?? [process.cwd()]).map((folder) => resolve(folder)),
    trust: values.trust ?? false,
    hostname: values.host,
    port,
    account: values.account ?? false,
    deviceAdmin: values["device-admin"] ?? false,
  };
}

/** A catalog-only runtime from the cached model list; an empty cache is a distinct failure from a missing credential. */
async function cachedCatalogRuntime(): Promise<Runtime> {
  const models = createNyteModels();
  await models.refresh({ allowNetwork: false });

  for (const provider of models.getProviders()) {
    const modelCandidates = models.getModels(provider.id);

    if (modelCandidates.length > 0) return { models, provider, modelCandidates };
  }

  throw new Error(
    "No model catalog is cached on this machine. Run `nyte update --models`, then start again.",
  );
}

interface Output {
  readonly write: (text: string) => void;
  readonly error: (text: string) => void;
}

/** Everything acquired so far, released in reverse whatever happens; every failure is reported, none hides another. */
class Acquired {
  private readonly releases: (() => Promise<void> | void)[] = [];

  hold(release: () => Promise<void> | void): void {
    this.releases.push(release);
  }

  async release(): Promise<void> {
    const failures: unknown[] = [];

    for (const release of this.releases.splice(0).toReversed()) {
      try {
        await release();
      } catch (cause) {
        failures.push(cause);
      }
    }

    if (failures.length > 0) throw new AggregateError(failures, "Host cleanup failed");
  }
}

/** The relay's standing, one line per change; devices get in only under a current lease. */
function connectStanding(view: ConnectView): string {
  switch (view.kind) {
    case "unavailable":
      return `Account sharing: unavailable (${view.reason.replaceAll("_", " ")})`;
    case "unlinked":
      return "Account sharing: not linked";
    case "linked": {
      const relay = view.connection.kind === "retrying" ? "retrying" : view.connection.kind;
      const lease =
        view.lease.kind === "lapsed"
          ? `lapsed (${view.lease.reason.replaceAll("_", " ")})`
          : view.lease.kind;

      return `Account sharing: relay ${relay}, lease ${lease}, devices ${String(view.devices.length)}`;
    }
    default: {
      const _exhaustive: never = view;

      return _exhaustive;
    }
  }
}

/**
 * Serve the account link beside the direct address: a loopback listener the
 * relay forwards to, admitting the link's devices as the principals the
 * owner's consent allows.
 */
async function serveAccount(
  host: HostRuntime,
  parsed: ServeArgs,
  acquired: Acquired,
  output: Output,
): Promise<void> {
  const config = readConnectConfig();

  if (config === undefined) throw new Error(CONNECT_UNCONFIGURED);
  let standing = "";

  const report = (): void => {
    void connect.view().then((view) => {
      const line = connectStanding(view);

      if (line === standing) return;
      standing = line;
      output.write(`${line}\n`);
    });
  };

  const connect = new ConnectRuntime({
    config,
    home: host.profile.directory,
    storePath: host.profile.connectPath,
    authorizer: undefined,
    onChange: report,
    name: machineName(),
  });
  acquired.hold(() => connect.close());
  const before = await connect.view();

  if (before.kind === "unavailable") {
    throw new Error(
      before.reason === "origin_changed"
        ? "This host is linked through another Nyte Connect origin. Unlink it first."
        : `Can't use ${host.profile.connectPath}. Remove it to start over.`,
    );
  }

  if (before.kind === "unlinked") {
    throw new Error("This host isn't linked to a Nyte account. Run `nyte account login` first.");
  }

  const share = accountShare({
    runtime: host,
    version: VERSION,
    deviceAdmin: parsed.deviceAdmin,
    onError: (failure) => output.error(`${failure.route} failed: ${String(failure.cause)}`),
  });

  await connect.setEnabled({ enabled: true, share });
  output.write(
    `Account: ${before.owner.label} as "${before.environment.name}" at ${before.environment.address}\n`,
  );

  if (parsed.deviceAdmin) {
    output.write("Devices enrolled as admins can add folders and manage providers on this host.\n");
  }

  report();
}

async function registerFolders(runtime: HostRuntime, parsed: ServeArgs): Promise<void> {
  for (const folder of parsed.workspaces) {
    const registered = await runtime.workspaces.register(folder);

    if (registered.kind !== "registered" && registered.kind !== "exists") {
      throw new Error(`Cannot register ${folder}: ${registered.kind.replaceAll("_", " ")}.`);
    }

    const { workspace } = registered;

    if (parsed.trust && workspace.trust.kind !== "granted") {
      const granted = await runtime.workspaces.grant(
        workspace.id,
        workspace.path,
        workspace.identity,
      );

      if (granted.kind !== "granted") {
        throw new Error(`Cannot trust ${folder}: ${granted.kind.replaceAll("_", " ")}.`);
      }
    }
  }
}

/** Resolves when the host has stopped. */
export async function serveCommand(args: readonly string[], output: Output): Promise<void> {
  const parsed = parseServeArgs(args);
  // Global settings only: a folder named on the command line is registered, not yet trusted,
  // and its own settings must not shape a host that serves other folders too.
  const settings = await new FileSettingsStore().readGlobal();
  const flags: RunFlags = {
    resume: { kind: "new" },
    print: false,
    json: false,
    quiet: false,
    rest: [],
  };
  const signedIn = await resolveRuntime(flags, settings);
  // No stored provider credential blocks runs, not the host: folders, trust and
  // sign-in through an authorized client still need the host up. Starting a
  // host reaches no network: the cached catalog decides, or nothing does.
  const runtime = signedIn ?? (await cachedCatalogRuntime());
  const { model, thinkingLevel } = hostFallbacks(runtime, settings, {});
  const acquired = new Acquired();

  try {
    const profile = await openProfile(parsed.profile);
    acquired.hold(() => profile.release());
    const otel = createOtelExport({ serviceName: "nyte-serve" });
    acquired.hold(() => otel.shutdown());
    const store = new WorkerStore({ path: profile.storePath, worker: storeWorkerLocation() });
    acquired.hold(() => store.close());
    const pluginSources = createBunPluginSources();
    acquired.hold(() => pluginSources.dispose());
    await store.ready();

    const host = await openHostRuntime({
      profile,
      store,
      models: runtime.models,
      model,
      thinkingLevel,
      telemetry: otel.telemetry,
      compaction: settings.compaction,
      streamOptions: { transport: settings.transport },
      plugins: { extra: tuiPlugins(), sources: pluginSources, codemode: codemodeRuntimeOptions() },
      onDiagnostic: output.error,
    });
    // The runtime closes the store and releases the profile itself; the earlier holds become no-ops.
    acquired.hold(() => host.close());
    await registerFolders(host, parsed);

    const serving = await startHeadless({
      runtime: host,
      version: VERSION,
      hostname: parsed.hostname,
      port: parsed.port,
      onError: (failure) => output.error(`${failure.route} failed: ${String(failure.cause)}`),
    });
    acquired.hold(() => serving.close());

    output.write(`Host ${profile.hostId} (profile ${profile.name})\nAPI at ${serving.address}\n`);

    for (const row of await host.workspaces.list()) {
      output.write(`Workspace ${row.id}  ${row.path}  trust: ${row.trust.kind}\n`);
    }

    if (signedIn === undefined) {
      output.write(
        "No model provider is signed in on this host. Runs fail until `nyte login` here or an owner signs in through a client.\n",
      );
    }

    output.write(`Bearer token: ${profile.token}\n`);

    if (parsed.account) await serveAccount(host, parsed, acquired, output);
  } catch (cause) {
    await acquired.release().catch((failure: unknown) => output.error(String(failure)));
    throw cause;
  }

  const stopped = Promise.withResolvers<void>();

  const stop = (): void => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    acquired.release().then(stopped.resolve, stopped.reject);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  return stopped.promise;
}
