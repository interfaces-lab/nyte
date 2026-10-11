import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Models } from "@nyte-ai/ai";
import { defaultProviderAuthContext } from "@nyte-ai/ai/auth/context";
import { FileModelsStore, nyteProviders } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import { isJson } from "@nyte-ai/schema";
import type {
  HostDescription,
  HostView,
  Json,
  ValidationIssue,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { composeHost, dev } from "@nyte-ai/core";
import type {
  ComposeOptions,
  Host,
  ListenOptions,
  Listener,
  OpenOptions,
  Plugin,
  Store,
} from "@nyte-ai/core";
import { operations } from "@nyte-ai/protocol";
import manifest from "../package.json" with { type: "json" };
import { credentialStore } from "./credentials.ts";
import { identitySigner } from "./identity.ts";
import { codeOf } from "./local/tree.ts";
import { listen } from "./listen.ts";
import { loadPluginDirectory, pluginLoader } from "./plugins/loader.ts";
import { defaultSecrets } from "./secrets.ts";
import type { SecretsSource } from "./secrets.ts";

/**
 * Describes what `openHost` takes: `OpenOptions` with `models` and `plugins`
 * optional, `secrets` defaulting to this machine's key, and the home directory
 * holding `.nyte`. Every `OpenOptions` is one, so the sdk's Node `open` passes
 * its options straight through.
 */
export type OpenHostOptions = Omit<OpenOptions, "models" | "plugins"> & {
  /** The `@nyte-ai/ai` catalog; absent, `nyteModels` over this host's encrypted credential store (§42e). */
  readonly models?: Models;
  /** Core plugins loaded after the built-ins and before the plugin files; default none. */
  readonly plugins?: readonly Plugin<"core">[];
  /** The directory whose `.nyte` holds the settings, plugins and secrets key; default `os.homedir()`. */
  readonly home?: string;
};

/**
 * Opens the Node host the sdk's Node `open` calls: `composeHost` with what
 * this machine supplies, and `listen` attached.
 *
 * `home` defaults to `os.homedir()`, `secrets` to `defaultSecrets(home)` and
 * `models` to `nyteModels`. The host plugins are `plugins`, then
 * `filePlugins`' files; there is no preflight here, since `composeHost` drops
 * and reports a rejected plugin that came from a file (§43j). `composeHost`
 * also gets `settingsSeed`'s seed, protocol's `operations()` and
 * `hostDescription()`, and each file that did not load becomes a
 * `kernel.host.report` row. `listen(options)` is h1's `listen` with `identity`
 * defaulting to `identitySigner(host.hostId, secrets)` (derived on the first
 * `listen`), `describe` to the same description and `pluginLoader` over the
 * plugin directories; `close()` closes this host's open listeners, then the
 * host.
 */
export async function openHost(options: OpenHostOptions): Promise<Host> {
  const home = options.home ?? homedir();
  const secrets = options.secrets ?? defaultSecrets(home);
  const description = hostDescription();
  const [files, settings] = await Promise.all([
    filePlugins(home, options.workspace),
    settingsSeed(home),
  ]);

  const host = await composeHost({
    ...options,
    models: options.models ?? nyteModels({ store: options.store, secrets, home }),
    plugins: [...(options.plugins ?? []), ...files.plugins],
    pluginSources: files.sources,
    secrets,
    home,
    operations: operations(),
    description,
    ...(settings.seed === null ? {} : { seed: settings.seed }),
  });

  for (const row of files.failed) host.kernel.host.report(row);

  if (settings.issue !== null)
    host.kernel.host.report({
      id: "settings",
      source: "user",
      path: settingsPath(home),
      issues: [settings.issue],
    });

  dev("open", "host", {
    home,
    seedIds: Object.keys(settings.seed?.settings ?? {}).length,
    pluginFiles: files.plugins.length + files.failed.length,
    failedFiles: files.failed.length,
  });

  const listeners = new Set<Listener>();
  const loader = pluginLoader(files.dirs);
  let identity: ReturnType<typeof identitySigner> | null = null;

  const attach = async (listenOptions: ListenOptions): Promise<Listener> => {
    const listener = await listen(
      host,
      {
        describe: () => description,
        ...listenOptions,
        identity:
          listenOptions.identity ?? (await (identity ??= identitySigner(host.hostId, secrets))),
      },
      loader,
    );

    listeners.add(listener);
    dev("open", "listen", { address: listener.address });

    return listener;
  };

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      for (const listener of listeners) await listener.close();
      await host.close();
    })();

    return closing;
  };

  return { ...host, listen: attach, close, [Symbol.asyncDispose]: close };
}

/**
 * Returns the catalog a host gets when `OpenHostOptions.models` is absent:
 * `createModels` (`@nyte-ai/ai/models`) with `credentials:
 * credentialStore(store, secrets)` (§42e), a `FileModelsStore` at
 * `<home>/.nyte/models-store.json`, ai's `defaultProviderAuthContext()` and
 * `catalog.url` from `NYTE_MODELS_URL`.
 *
 * Its providers are ai's `nyteProviders()`, the list `createNyteModels()`
 * registers, in its order, with no second `Models` built (§43k). Nothing is imported from
 * `~/.nyte/auth.json`: this is a rewrite, not a migration, so users log in
 * again (§43j).
 */
function nyteModels(input: {
  readonly store: Store;
  readonly secrets: SecretsSource;
  readonly home: string;
}): Models {
  const models = createModels({
    credentials: credentialStore(input.store, input.secrets),
    modelsStore: new FileModelsStore(join(input.home, ".nyte", "models-store.json")),
    authContext: defaultProviderAuthContext(),
    catalog: { url: process.env.NYTE_MODELS_URL },
  });

  for (const provider of nyteProviders()) models.setProvider(provider);

  return models;
}

/**
 * Loads the plugin files a host serves, file by file through
 * `loadPluginDirectory` (§41j): `<home>/.nyte/plugins` as `user`, then, for a
 * `{ kind: "local", path }` workspace, `<path>/.nyte/plugins` as `project`.
 *
 * It answers the plugins in that order with the `pluginSources` map naming
 * each one's scope and path (§41e), the directories it read (what
 * `pluginLoader` accepts), and one report row per file that did not load,
 * `{ id: <its path>, source, path, issues }` (§43g).
 */
async function filePlugins(
  home: string,
  workspace: WorkspaceTarget,
): Promise<{
  readonly plugins: readonly Plugin<"core">[];
  readonly sources: NonNullable<ComposeOptions["pluginSources"]>;
  readonly dirs: readonly string[];
  readonly failed: readonly HostView["plugins"][number][];
}> {
  const scopes = [
    { source: "user" as const, dir: join(home, ".nyte", "plugins") },
    ...(workspace.kind === "local" && "path" in workspace
      ? [{ source: "project" as const, dir: join(workspace.path, ".nyte", "plugins") }]
      : []),
  ];

  const plugins: Plugin<"core">[] = [];
  const sources = new Map<Plugin<"core">, { source: "user" | "project"; path: string }>();
  const failed: HostView["plugins"][number][] = [];

  for (const { source, dir } of scopes) {
    const found = await loadPluginDirectory(dir);

    for (const { plugin, path } of found.loaded) {
      plugins.push(plugin);
      sources.set(plugin, { source, path });
    }

    for (const { path, issue } of found.failed)
      failed.push({ id: path, source, path, issues: [issue] });
  }

  return { plugins, sources, dirs: scopes.map((scope) => scope.dir), failed };
}

/**
 * Reads `<home>/.nyte/settings.json` once per open, never watching or writing
 * it, into the seed `composeHost` applies (decision 12, §43c): the file's
 * settings, `{ [settingId]: Json }`, and its path, which the `settings` report
 * row carries (§43j).
 *
 * `composeHost` applies a file value only when no value is stored for that id,
 * so a value changed over the wire survives restarts (§43j), and reports
 * unknown or invalid ids as warnings under owner `settings`. A missing file is
 * no seed; a file that cannot be read or is not a JSON object is no seed and
 * one `warning`, which `openHost` reports on the `settings` row after the
 * compose.
 */
async function settingsSeed(home: string): Promise<{
  readonly seed: {
    readonly settings: Readonly<Record<string, Json>>;
    readonly path: string;
  } | null;
  readonly issue: ValidationIssue | null;
}> {
  const path = settingsPath(home);
  const text = await readFile(path, "utf8").catch((error: unknown) =>
    codeOf(error) === "ENOENT" ? null : error instanceof Error ? error : new Error(String(error)),
  );

  if (text === null) return { seed: null, issue: null };

  if (text instanceof Error)
    return {
      seed: null,
      issue: { severity: "warning", path: [], message: `${path} cannot be read: ${text.message}` },
    };
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return {
      seed: null,
      issue: { severity: "warning", path: [], message: `${path} is not a JSON object.` },
    };

  const settings: Record<string, Json> = {};

  for (const [id, value] of Object.entries(parsed)) if (isJson(value)) settings[id] = value;

  return { seed: { settings, path }, issue: null };
}

/**
 * Returns what this machine says about its host, `{ name: os.hostname(),
 * platform: process.platform, version }` with this package's version:
 * `composeHost`'s `description` and the listener's `describe`.
 */
function hostDescription(): HostDescription {
  return { name: hostname(), platform: process.platform, version: manifest.version };
}

function settingsPath(home: string): string {
  return join(home, ".nyte", "settings.json");
}
