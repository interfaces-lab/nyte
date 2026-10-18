import { watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Models, Provider } from "@nyte-ai/ai";
import { defaultProviderAuthContext } from "@nyte-ai/ai/auth/context";
import { FileModelsStore, nyteProviders } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import { isJson } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import type {
  HostDescription,
  HostView,
  Json,
  PluginReplacementReport,
  ValidationIssue,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { dev, processEnvironment } from "@nyte-ai/core";
import { composeHost } from "@nyte-ai/core/server";
import { readModelSelection } from "@nyte-ai/core/store";
import type { Host, ListenOptions, Listener, OpenOptions, Plugin, Store } from "@nyte-ai/core";
import approvals from "@nyte-ai/plugin/core/approvals";
import { acpAgents } from "@nyte-ai/plugin/core/acp";
import bashDescription from "@nyte-ai/plugin/core/bash-description";
import browserTools from "@nyte-ai/plugin/core/browser-tools";
import canvas from "@nyte-ai/plugin/core/canvas";
import { claudeCodeSdk } from "@nyte-ai/plugin/core/claude-code-sdk";
import codemode from "@nyte-ai/plugin/core/codemode";
import openaiAstraContext from "@nyte-ai/plugin/core/openai-astra-context";
import { openaiCompaction } from "@nyte-ai/plugin/core/openai-compaction";
import question from "@nyte-ai/plugin/core/question";
import rename from "@nyte-ai/plugin/core/rename";
import telemetry from "@nyte-ai/plugin/core/telemetry";
import webSearch from "@nyte-ai/plugin/core/web-search";
import manifest from "../package.json" with { type: "json" };
import { credentialStore } from "./credentials.ts";
import { identitySigner } from "./identity-key.ts";
import { readErrorCode } from "./local/tree.ts";
import { localGitHubAccount } from "./local/github.ts";
import { localProvider } from "./local/provider.ts";
import { importLegacyTrust } from "./local/legacy-trust.ts";
import { migrateLocalWorkspaceIdentities } from "./local/workspace-migration.ts";
import { listen } from "./listen.ts";
import { createMcpHub } from "./mcp/hub.ts";
import { loadPluginDirectory, pluginLoader } from "./plugins/loader.ts";
import { defaultSecrets } from "./secrets.ts";
import type { SecretsSource } from "./secrets.ts";
import { sqliteStore } from "./sqlite.ts";

const RELOAD_DEBOUNCE_MS = 250;

const STORE_POLL_MS = 500;

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
  /** Core plugins loaded after the first-party built-ins and before the plugin files; default none. One with a built-in's id replaces that built-in, as a bundled client's `codemode` runtime does, and a `local` environment provider among them replaces the default one. */
  readonly plugins?: readonly Plugin<"core">[];
  /** The directory whose `.nyte` holds the store, settings, plugins, secrets key and identity key; default `os.homedir()`. */
  readonly home?: string;
  /** The login shell the default local provider's pty jobs run, read at each start; absent or null is `$SHELL`. */
  readonly shell?: () => string | null;
};

/**
 * Opens the Node host the sdk's Node `open` calls: `composeHost` with
 * `home` (default `os.homedir()`), `store` (default `<home>/.nyte/nyte.db`,
 * checked every 500 ms for another process's commits, which are then read so
 * a second process on the file sees the first one's runs live),
 * `workspace` (default the local folder `process.cwd()`), `secrets` (default
 * `defaultSecrets(home)`), `models` (default `nyteModels`), `localProvider`
 * unless a plugin provides the `local` environment, every first-party plugin
 * of `@nyte-ai/plugin` that `plugins` does not replace by id, then `plugins`
 * and `filePlugins`' files, `settingsSeed`'s seed and
 * `hostDescription()`; each file that did not load becomes a
 * `server.report` row. The host's `loadPlugins` is `pluginLoader` over
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

async function defaultStore(home: string): Promise<Store> {
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });

  return sqliteStore({ path: join(home, ".nyte", "nyte.db") });
}

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
  const usesLocalProvider = !given.some((plugin) => plugin.environment?.kind === "local");

  const claudeCode = claudeCodeSdk();
  const acp = acpAgents();

  const [models, files, settings] = await Promise.all([
    options.models ??
      nyteModels({ store, secrets, home, providers: [claudeCode.provider, acp.provider] }),
    filePlugins(home),
    settingsSeed(home),
    usesLocalProvider
      ? store.open().then(async (connection) => {
          await migrateLocalWorkspaceIdentities(connection);
          await importLegacyTrust(connection, home);
        })
      : undefined,
  ]);

  const builtins = [
    approvals,
    question,
    rename,
    bashDescription,
    webSearch,
    codemode,
    openaiCompaction(models),
    openaiAstraContext,
    telemetry,
    canvas,
    browserTools,
    claudeCode.plugin,
    acp.plugin,
  ];

  const plugins = [
    ...(usesLocalProvider
      ? [{ id: "local", environment: localProvider({ home, shell: options.shell }) }]
      : []),
    ...builtins.filter((builtin) => !given.some((plugin) => plugin.id === builtin.id)),
    ...given,
  ];

  let projectDirs: () => Promise<readonly string[]> = async () => [];

  const host = await composeHost({
    ...options,
    store,
    workspace,
    loadPlugins: async (paths) => pluginLoader([...files.dirs, ...(await projectDirs())])(paths),
    models,
    mcp: options.mcp ?? createMcpHub({ home }),
    github: options.github ?? (usesLocalProvider ? localGitHubAccount({ home }) : undefined),
    plugins: [...plugins, ...files.plugins],
    pluginSources: files.sources,
    secrets,
    home,
    description,
    ...(settings.seed === null ? {} : { seed: settings.seed }),
    ...(owned === null ? {} : { poll: STORE_POLL_MS }),
  });

  projectDirs = async () =>
    (await host.workspaces.list()).flatMap((entry) =>
      entry.trusted === true && "path" in entry.target
        ? [join(entry.target.path, ".nyte", "plugins")]
        : [],
    );

  for (const row of files.failed) host.server.report(row);

  if (settings.issue !== null)
    host.server.report({
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
    host.server
      .pluginRows()
      .filter((row) => row.path !== null && row.id === row.path)
      .map((row) => [row.id, row]),
  );

  const reload = async (): Promise<void> => {
    const next = await filePlugins(home);

    for (const [plugin, source] of next.sources) files.sources.set(plugin, source);
    const report = await host.plugins.replace([...plugins, ...next.plugins]);
    const failed = [...next.failed, ...refused(next, report)];

    for (const [id, row] of reported)
      if (!failed.some((row) => row.id === id)) host.server.report({ ...row, issues: [] });

    for (const row of failed) host.server.report(row);
    reported.clear();

    for (const row of failed) reported.set(row.id, row);

    for (const plugin of files.sources.keys())
      if (!host.server.loaded(plugin)) files.sources.delete(plugin);
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

async function nyteModels(input: {
  readonly store: Store;
  readonly secrets: SecretsSource;
  readonly home: string;
  /** Providers beside Nyte's catalog, each refreshed offline at open. */
  readonly providers: readonly Provider[];
}): Promise<Models> {
  const credentials = credentialStore(input.store, input.secrets);
  const auth = defaultProviderAuthContext();

  const models = createModels({
    credentials,
    modelsStore: new FileModelsStore(join(input.home, ".nyte", "models-store.json")),
    authContext: {
      ...auth,
      env: async (name) => {
        await processEnvironment();

        return auth.env(name);
      },
    },
    catalog: { url: process.env.NYTE_MODELS_URL },
  });

  for (const provider of [...nyteProviders(), ...input.providers]) models.setProvider(provider);
  const [stored, selected] = await Promise.all([
    credentials.list(),
    input.store.open().then(readModelSelection),
  ]);

  const restored = await models.refresh({
    providers: [
      ...new Set([
        ...stored.map((row) => row.providerId),
        ...input.providers.map((provider) => provider.id),
        ...(selected === null ? [] : [selected.provider]),
      ]),
    ],
    allowNetwork: false,
  });

  dev("open", "models restored", {
    providers: stored.length,
    failed: [...restored.errors.keys()],
  });

  return models;
}

async function filePlugins(home: string): Promise<{
  readonly plugins: readonly Plugin<"core">[];
  readonly sources: Map<
    Plugin<"core">,
    { readonly source: "user" | "project"; readonly path: string }
  >;
  readonly dirs: readonly string[];
  readonly failed: readonly HostView["plugins"][number][];
}> {
  const scopes = [{ source: "user" as const, dir: join(home, ".nyte", "plugins") }];

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

function watchPlugins(dirs: readonly string[], reload: () => Promise<void>): () => Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reloads = serial();

  const run = (): void => {
    timer = null;
    void reloads.run(reload).catch((error: unknown) =>
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
      dev("open", "plugins unwatched", { dir, code: readErrorCode(error) });

      return [];
    }
  });

  return async () => {
    for (const watcher of watchers) watcher.close();

    if (timer !== null) clearTimeout(timer);
    await reloads.settled();
  };
}

async function settingsSeed(home: string): Promise<{
  readonly seed: {
    readonly settings: Readonly<Record<string, Json>>;
    readonly path: string;
  } | null;
  readonly issue: ValidationIssue | null;
}> {
  const path = settingsPath(home);

  const text = await readFile(path, "utf8").catch((error: unknown) =>
    readErrorCode(error) === "ENOENT"
      ? null
      : error instanceof Error
        ? error
        : new Error(String(error)),
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

function hostDescription(): HostDescription {
  return { name: hostname(), platform: process.platform, version: manifest.version };
}

function settingsPath(home: string): string {
  return join(home, ".nyte", "settings.json");
}
