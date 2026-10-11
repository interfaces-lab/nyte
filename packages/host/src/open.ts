import type { Models } from "@nyte-ai/ai";
import type {
  HostDescription,
  HostView,
  Json,
  ValidationIssue,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import type { ComposeOptions, Host, OpenOptions, Plugin, Store } from "@nyte-ai/core";
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
  throw new Error("not implemented");
}

/**
 * Returns the catalog a host gets when `OpenHostOptions.models` is absent:
 * `createModels` (`@nyte-ai/ai/models`) with `credentials:
 * credentialStore(store, secrets)` (§42e), a `FileModelsStore` at
 * `<home>/.nyte/models-store.json`, ai's `defaultProviderAuthContext()` and
 * `catalog.url` from `NYTE_MODELS_URL`.
 *
 * Its providers are those `createNyteModels()` registers, re-registered in its
 * order (ai exports no provider list). Nothing is imported from
 * `~/.nyte/auth.json`: this is a rewrite, not a migration, so users log in
 * again (§43j).
 */
function nyteModels(input: {
  readonly store: Store;
  readonly secrets: SecretsSource;
  readonly home: string;
}): Models {
  throw new Error("not implemented");
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
  throw new Error("not implemented");
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
 * no seed; a file that is not a JSON object is no seed and one `warning`,
 * which `openHost` reports on the `settings` row after the compose.
 */
async function settingsSeed(home: string): Promise<{
  readonly seed: {
    readonly settings: Readonly<Record<string, Json>>;
    readonly path: string;
  } | null;
  readonly issue: ValidationIssue | null;
}> {
  throw new Error("not implemented");
}

/**
 * Returns what this machine says about its host, `{ name: os.hostname(),
 * platform: process.platform, version }` with this package's version:
 * `composeHost`'s `description` and the listener's `describe`.
 */
function hostDescription(): HostDescription {
  throw new Error("not implemented");
}
