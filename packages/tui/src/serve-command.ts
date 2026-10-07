/**
 * `nyte serve`: this binary as a headless host. One profile, its registered
 * folders, one address, no terminal UI and no Nyte account. The process is
 * the host: it runs while this command runs, and Ctrl-C ends the listener,
 * then the runtime, then the process.
 */
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { createNyteModels } from "@nyte-ai/ai";
import { WorkerStore } from "@nyte-ai/core/store";
import { openHostRuntime, openProfile } from "@nyte-ai/host/runtime";
import type { HostRuntime } from "@nyte-ai/host/runtime";
import { createOtelExport } from "@nyte-ai/host/otel";
import { startHeadless } from "@nyte-ai/serve/headless";
import { codemodeRuntimeOptions } from "./codemode-runtime.ts";
import type { RunFlags } from "./flags.ts";
import { storeWorkerLocation } from "./host.ts";
import { createBunPluginSources } from "./plugin-loader.ts";
import { hostFallbacks, resolveRuntime, tuiPlugins } from "./run.ts";
import type { Runtime } from "./run.ts";
import { FileSettingsStore } from "./settings.ts";
import { VERSION } from "./version.ts";

export const SERVE_HELP = [
  "Usage: nyte serve [--workspace <path>]... [--trust] [--profile <name>] [--host <address>] [--port <number>]",
  "Run this machine as a headless Nyte host: no terminal UI, no Nyte account.",
  "--workspace registers a folder on the host (default: the current directory); --trust grants it as it is now.",
  "--profile names the host identity and history under ~/.nyte/hosts (default: default).",
  "--host and --port choose the address to bind (default: 127.0.0.1, a free port).",
  "The bearer for direct access is in the profile's token file; roots start through environment.start.",
  "Example: nyte serve --workspace ~/code/app --trust --port 5180",
].join("\n");

interface ServeArgs {
  readonly profile: string;
  readonly workspaces: readonly string[];
  readonly trust: boolean;
  readonly hostname: string | undefined;
  readonly port: number;
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
    },
  });

  const port = Number(values.port ?? 0);

  if (!(Number.isInteger(port) && port >= 0 && port <= 65_535)) {
    throw new Error("--port must be a number from 0 to 65535. Run `nyte serve --help`.");
  }

  return {
    profile: values.profile ?? "default",
    workspaces: (values.workspace ?? [process.cwd()]).map((folder) => resolve(folder)),
    trust: values.trust ?? false,
    hostname: values.host,
    port,
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

async function registerFolders(
  runtime: HostRuntime,
  parsed: ServeArgs,
): Promise<void> {
  for (const folder of parsed.workspaces) {
    const registered = await runtime.workspaces.register(folder);

    if (registered.kind !== "registered" && registered.kind !== "exists") {
      throw new Error(`Cannot register ${folder}: ${registered.kind.replaceAll("_", " ")}.`);
    }

    const { workspace } = registered;

    if (parsed.trust && workspace.trust.kind !== "granted") {
      const granted = await runtime.workspaces.grant(workspace.id, workspace.path, workspace.identity);

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
  const flags: RunFlags = { resume: { kind: "new" }, print: false, json: false, quiet: false, rest: [] };
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

    output.write(`Bearer token: ${profile.tokenPath}\n`);
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
