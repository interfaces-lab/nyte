import { watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
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
  PluginReplacementReport,
  ValidationIssue,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { composeHost, dev } from "@nyte-ai/core";
import type { Host, ListenOptions, Listener, OpenOptions, Plugin, Store } from "@nyte-ai/core";
import { operations } from "@nyte-ai/protocol";
import manifest from "../package.json" with { type: "json" };
import { credentialStore } from "./credentials.ts";
import { identitySigner } from "./identity-key.ts";
import { codeOf } from "./local/tree.ts";
import { localProvider } from "./local/provider.ts";
import { listen } from "./listen.ts";
import { loadPluginDirectory, pluginLoader } from "./plugins/loader.ts";
import { defaultSecrets } from "./secrets.ts";
import type { SecretsSource } from "./secrets.ts";
import { sqliteStore } from "./sqlite.ts";

const RELOAD_DEBOUNCE_MS = 250;

/**
 * Describes what `openHost` takes: `OpenOptions` with `store`, `workspace`,
 * `models` and `plugins` optional, `secrets` defaulting to this machine's key,
 * and the home directory holding `.nyte`. Every `OpenOptions` is one, so the
 * sdk's Node `open` passes its options straight through.
 */
export type OpenHostOptions = Omit<OpenOptions, "store" | "workspace" | "models" | "plugins"> & {
  /** The host's store; absent, `sqliteStore` at `<home>/.nyte/nyte.db`, which the host then closes with itself (§51c). */
  readonly store?: Store;
  /** Where a root session acts when `create` names none; default the local folder `process.cwd()` (§51c). */
  readonly workspace?: WorkspaceTarget;
  /** The `@nyte-ai/ai` catalog; absent, `nyteModels` over this host's encrypted credential store (§42e). */
  readonly models?: Models;
  /** Core plugins loaded after the built-ins and before the plugin files; default none. A `local` environment provider among them replaces the default one. */
  readonly plugins?: readonly Plugin<"core">[];
  /** The directory whose `.nyte` holds the store, settings, plugins, secrets key and identity key; default `os.homedir()`. */
  readonly home?: string;
};

/**
 * Opens the Node host the sdk's Node `open` calls: `composeHost` with
 * `home` (default `os.homedir()`), `store` (default `<home>/.nyte/nyte.db`),
 * `workspace` (default the local folder `process.cwd()`), `secrets` (default
 * `defaultSecrets(home)`), `models` (default `nyteModels`), `localProvider`
 * unless a plugin provides the `local` environment, then `plugins` and
 * `filePlugins`' files, `settingsSeed`'s seed, protocol's `operations()` and
 * `hostDescription()`; each file that did not load becomes a
 * `kernel.host.report` row. The kernel's `loadPlugins` is `pluginLoader` over
 * the plugin directories (§47l), which `watchPlugins` watches for hot reload
 * (§49a). `listen` defaults `identity` to `identitySigner(host.hostId, home)`
 * and `describe` to the description; nothing here reads the secrets key, even
 * with a credential stored (§50d, §55). `close()` stops the watch, closes the
 * open listeners, the host, then a store it opened.
 */
export async function openHost(options: OpenHostOptions): Promise<Host> {
  const home = options.home ?? homedir();
  const workspace = options.workspace ?? { kind: "local", path: process.cwd() };

  if (options.store !== undefined)
    return composeOpen(options, { home, workspace, store: options.store, owned: null });
  const owned = await defaultStore(home);

  try {
    return await composeOpen(options, { home, workspace, store: owned, owned });
  } catch (cause) {
    await owned.close().catch(() => undefined);
    throw cause;
  }
}

/** Returns the store a host opens when given none: `sqliteStore` at `<home>/.nyte/nyte.db`, the directory made 0700 first (§51c). */
async function defaultStore(home: string): Promise<Store> {
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });

  return sqliteStore({ path: join(home, ".nyte", "nyte.db") });
}

/** Composes the host over a resolved home, workspace and store, and returns it with `listen` and `close` bound; `owned` is the store `close` closes last, null when the caller owns it. */
async function composeOpen(
  options: OpenHostOptions,
  input: {
    readonly home: string;
    readonly workspace: WorkspaceTarget;
    readonly store: Store;
    readonly owned: Store | null;
  },
): Promise<Host> {
  const { home, workspace, store, owned } = input;
  const secrets = options.secrets ?? defaultSecrets(home);
  const description = hostDescription();
  const given = options.plugins ?? [];

  const plugins = given.some((plugin) => plugin.environment?.kind === "local")
    ? given
    : [{ id: "local", environment: localProvider({ home }) }, ...given];

  const [files, settings] = await Promise.all([filePlugins(home, workspace), settingsSeed(home)]);

  const host = await composeHost({
    ...options,
    store,
    workspace,
    loadPlugins: pluginLoader(files.dirs),
    models: options.models ?? (await nyteModels({ store, secrets, home })),
    plugins: [...plugins, ...files.plugins],
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

  const reported = new Map(
    host.kernel.host
      .current()
      .plugins.filter((row) => row.path !== null && row.id === row.path)
      .map((row) => [row.id, row]),
  );

  const reload = async (): Promise<void> => {
    const next = await filePlugins(home, workspace);

    for (const [plugin, source] of next.sources) files.sources.set(plugin, source);
    const report = await host.plugins.replace([...plugins, ...next.plugins]);
    const failed = [...next.failed, ...refused(next, report)];

    for (const [id, row] of reported)
      if (!failed.some((row) => row.id === id)) host.kernel.host.report({ ...row, issues: [] });

    for (const row of failed) host.kernel.host.report(row);
    reported.clear();

    for (const row of failed) reported.set(row.id, row);

    for (const plugin of files.sources.keys())
      if (!host.kernel.hostPlugins.includes(plugin)) files.sources.delete(plugin);
    dev("open", "plugins reloaded", {
      generation: report.generation,
      pluginFiles: next.plugins.length,
      failedFiles: failed.length,
    });
  };

  const unwatch = watchPlugins(files.dirs, reload);
  const listeners = new Set<Listener>();
  let identity: ReturnType<typeof identitySigner> | null = null;

  const attach = async (listenOptions: ListenOptions): Promise<Listener> => {
    const listener = await listen(host, {
      describe: () => description,
      ...listenOptions,
      identity: listenOptions.identity ?? (await (identity ??= identitySigner(host.hostId, home))),
    });

    listeners.add(listener);
    dev("open", "listen", { address: listener.address });

    return listener;
  };

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      await unwatch();

      for (const listener of listeners) await listener.close();
      await host.close();
      await owned?.close();
    })();

    return closing;
  };

  return { ...host, listen: attach, close, [Symbol.asyncDispose]: close };
}

/**
 * Returns the catalog a host gets when `OpenHostOptions.models` is absent:
 * `createModels` over `credentialStore(store, secrets)` (§42e), a
 * `FileModelsStore` at `<home>/.nyte/models-store.json` and ai's
 * `nyteProviders()`, with `catalog.url` from `NYTE_MODELS_URL`. Each provider
 * the credential listing names gets its saved catalog restored, with no network
 * and no secrets key; a credential is decrypted only by a provider request (§55).
 */
async function nyteModels(input: {
  readonly store: Store;
  readonly secrets: SecretsSource;
  readonly home: string;
}): Promise<Models> {
  const credentials = credentialStore(input.store, input.secrets);

  const models = createModels({
    credentials,
    modelsStore: new FileModelsStore(join(input.home, ".nyte", "models-store.json")),
    authContext: defaultProviderAuthContext(),
    catalog: { url: process.env.NYTE_MODELS_URL },
  });

  for (const provider of nyteProviders()) models.setProvider(provider);
  const stored = await credentials.list();

  const restored = await models.refresh({
    providers: stored.map((row) => row.providerId),
    allowNetwork: false,
  });

  dev("open", "models restored", {
    providers: stored.length,
    failed: [...restored.errors.keys()],
  });

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
  readonly sources: Map<
    Plugin<"core">,
    { readonly source: "user" | "project"; readonly path: string }
  >;
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
 * Returns the report rows for the plugin files a replace did not activate:
 * `{ id: <its path>, source, path, issues }` per `rejected` or
 * `kept-previous` outcome whose plugin `files` loaded from a file, as
 * `composeHost` reports a file it drops at open.
 */
function refused(
  files: Awaited<ReturnType<typeof filePlugins>>,
  report: PluginReplacementReport,
): readonly HostView["plugins"][number][] {
  return report.plugins.flatMap((outcome) => {
    const plugin = files.plugins.find((candidate) => candidate.id === outcome.id);
    const file = plugin === undefined ? undefined : files.sources.get(plugin);

    return outcome.kind === "activated" || file === undefined
      ? []
      : [{ id: file.path, source: file.source, path: file.path, issues: outcome.issues }];
  });
}

/**
 * Calls `reload` 250 ms after the last change under any of `dirs` (§49a), one
 * reload at a time, through a recursive, non-persistent `fs.watch` per
 * directory; a directory that does not exist at open is not watched. A failed
 * reload is logged and the next change tries again. The returned stop closes
 * the watchers, drops a pending reload and waits for a running one.
 */
function watchPlugins(dirs: readonly string[], reload: () => Promise<void>): () => Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = Promise.resolve();

  const run = (): void => {
    timer = null;
    running = running.then(reload).catch((error: unknown) =>
      dev("open", "plugin reload failed", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  const changed = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, RELOAD_DEBOUNCE_MS);
    timer.unref();
  };

  const watchers = dirs.flatMap((dir) => {
    try {
      const watcher = watch(dir, { recursive: true, persistent: false }, changed);

      watcher.on("error", (error) => {
        dev("open", "plugin watch failed", { dir, message: error.message });
        watcher.close();
      });
      dev("open", "plugins watched", { dir });

      return [watcher];
    } catch (error) {
      dev("open", "plugins unwatched", { dir, code: codeOf(error) });

      return [];
    }
  });

  return async () => {
    for (const watcher of watchers) watcher.close();

    if (timer !== null) clearTimeout(timer);
    await running;
  };
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
