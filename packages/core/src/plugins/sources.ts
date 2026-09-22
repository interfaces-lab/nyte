/**
 * Finds plugins and turns them into `LoadedPlugin`s. Built-ins come first,
 * then files from each directory in order; a file whose id matches an earlier
 * plugin replaces it in place, a new id is appended. A manifest can disable
 * ids and carry per-id options a host reads; it never has to list anything.
 *
 * A file's version is its mtime and size, so an edit gives the host a new
 * version and `import()` with a changed query string gives Node a new module.
 */
import { watch, type FSWatcher } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { JsonValue } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Disposer, LoadedPlugin, Plugin, PluginSource } from "./types.ts";

type ManifestPluginRef = { id: string; options?: JsonValue };

function isDisabledPluginId(item: string | ManifestPluginRef): item is string {
  return typeof item === "string" && item.startsWith("-");
}

const ModuleWithDefault = Type.Object({ default: Type.Unknown() });

const PluginExport = Type.Object({
  id: Type.String({ minLength: 1 }),
  session: Type.Function([], Type.Unknown()),
});

function isPlugin(value: unknown): value is Plugin {
  return Value.Check(PluginExport, value);
}

export interface PluginManifest {
  /** Strings are ids to disable when prefixed with "-"; objects carry options a host reads. */
  plugins?: readonly (string | ManifestPluginRef)[];
}

export interface PluginDirectory {
  path: string;
  source: Exclude<PluginSource, "builtin" | "inline">;
}

interface LoadFailure {
  path: string;
  error: string;
}

export interface ResolvedPlugins {
  plugins: LoadedPlugin[];
  failures: LoadFailure[];
}

export interface ResolveOptions {
  builtins: readonly Plugin[];
  directories?: readonly PluginDirectory[];
  manifest?: PluginManifest;
  /** Version stamped on built-ins. Defaults to a constant, so built-ins never reload. */
  builtinVersion?: string;
  /** Per-built-in versions for stateful built-ins whose external inputs can change. */
  builtinVersions?: Readonly<Record<string, string>>;
}

const ENTRY_EXTENSIONS = new Set([".ts", ".js", ".mts", ".mjs"]);

const SOURCE_EXTENSIONS = new Set([...ENTRY_EXTENSIONS, ".tsx", ".jsx", ".cts", ".cjs", ".json"]);

export async function resolvePlugins(options: ResolveOptions): Promise<ResolvedPlugins> {
  const byId = new Map<string, LoadedPlugin>();
  const failures: LoadFailure[] = [];

  for (const plugin of options.builtins) {
    byId.set(plugin.id, {
      id: plugin.id,
      version: options.builtinVersions?.[plugin.id] ?? options.builtinVersion ?? "builtin",
      source: "builtin",
      module: plugin,
    });
  }

  for (const directory of options.directories ?? []) {
    for (const entry of await listPluginEntries(directory.path)) {
      const loaded = await loadPluginFile(entry, directory.source);

      if ("error" in loaded) {
        failures.push(loaded);
        continue;
      }

      byId.set(loaded.id, loaded);
    }
  }

  const disabled = new Set<string>();

  for (const item of options.manifest?.plugins ?? []) {
    if (isDisabledPluginId(item)) disabled.add(item.slice(1));
  }

  return { plugins: [...byId.values()].filter((plugin) => !disabled.has(plugin.id)), failures };
}

/** `foo.ts` and `foo/index.ts` are plugin entries; anything else in the directory is ignored. */
async function listPluginEntries(directory: string): Promise<string[]> {
  let names: string[];

  try {
    names = await readdir(directory);
  } catch {
    return [];
  }

  const entries: string[] = [];

  for (const name of names.sort()) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    const path = join(directory, name);
    const info = await stat(path).catch(() => undefined);

    if (info === undefined) continue;

    if (info.isFile() && ENTRY_EXTENSIONS.has(extname(name))) {
      entries.push(path);
      continue;
    }

    if (!info.isDirectory()) continue;

    for (const candidate of ["index.ts", "index.js", "index.mts", "index.mjs"]) {
      const index = join(path, candidate);

      if ((await stat(index).catch(() => undefined))?.isFile()) {
        entries.push(index);
        break;
      }
    }
  }

  return entries;
}

async function loadPluginFile(
  path: string,
  source: Exclude<PluginSource, "builtin" | "inline">,
): Promise<LoadedPlugin | LoadFailure> {
  const absolute = resolve(path);
  const id = pluginIdForPath(absolute);

  try {
    const files = await pluginFiles(absolute);

    const stats = await Promise.all(
      files.map(async (file) => {
        const info = await stat(file);

        return `${info.mtimeMs}:${info.size}`;
      }),
    );

    const version = createHash("sha256").update(stats.join(",")).digest("hex").slice(0, 16);

    // A query string gives `import()` a fresh entry module. Helpers keep their
    // plain URL, so Bun's module cache is evicted for the whole tree (it keys
    // by real path); Node's ESM cache has no eviction, so helpers there stay
    // as first loaded.
    if (typeof require !== "undefined") {
      for (const file of files) delete require.cache[await realpath(file).catch(() => file)];
    }

    const url = pathToFileURL(absolute);
    url.searchParams.set("v", version);
    const loaded: unknown = await import(url.href);
    const module = Value.Check(ModuleWithDefault, loaded) ? loaded.default : undefined;

    if (!isPlugin(module)) {
      return { path: absolute, error: "default export is not a plugin (use definePlugin)" };
    }

    if (module.id !== id) {
      return {
        path: absolute,
        error: `plugin id "${module.id}" must match the file name "${id}"`,
      };
    }

    return { id, version, source, module, path: absolute };
  } catch (error) {
    return { path: absolute, error: error instanceof Error ? error.message : String(error) };
  }
}

/** `.../profile.ts` and `.../profile/index.ts` are both "profile". */
function pluginIdForPath(path: string): string {
  const file = basename(path, extname(path));

  if (file === "index") return basename(resolve(path, ".."));

  return file;
}

/**
 * The files whose bytes decide a plugin's version: the entry alone for
 * `foo.ts`, every source file under `foo/` for `foo/index.ts`. A plugin with
 * helpers lives in a directory so an edit to a helper reloads it.
 */
async function pluginFiles(entry: string): Promise<string[]> {
  if (basename(entry, extname(entry)) !== "index") return [entry];
  const root = dirname(entry);
  const names = await readdir(root, { recursive: true, withFileTypes: true });

  const files = names
    .filter((item) => item.isFile() && !item.parentPath.split(sep).includes("node_modules"))
    .map((item) => join(item.parentPath, item.name))
    .filter((file) => file !== entry && SOURCE_EXTENSIONS.has(extname(file)))
    .sort();

  return [entry, ...files];
}

export interface WatchTarget {
  readonly path: string;
  /** Default true. A shallow watch sees the directory's own entries only. */
  readonly recursive?: boolean;
  /** Entry names that count; others under this target are ignored. Default all. */
  readonly names?: readonly string[];
}

export interface WatchOptions {
  directories: readonly WatchTarget[];
  /** Called after a quiet period following any change under the directories. */
  onChange: () => void | Promise<void>;
  debounceMs?: number;
  /** Change handler failures land here instead of being lost. */
  onError?: (error: Error) => void;
  /**
   * Taken on the first raw event of a burst and released once `onChange` has
   * run with nothing further pending, so work gated on it sees the reload.
   */
  hold?: () => Disposer;
}

/**
 * Watch plugin directories and call `onChange` once per burst of edits. A
 * directory that does not exist yet is retried on each burst from the others
 * and on a slow timer, so creating `.nyte/plugins` later is picked up. Returns
 * a stop function.
 */
export function watchPluginDirectories(options: WatchOptions): () => void {
  const watchers = new Map<string, FSWatcher>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  let stopped = false;
  let release: Disposer | undefined;
  const report = options.onError ?? (() => undefined);

  const fire = async (): Promise<void> => {
    if (running) {
      pending = true;

      return;
    }

    running = true;

    try {
      await options.onChange();
    } catch (error) {
      report(error instanceof Error ? error : new Error(String(error)));
    } finally {
      running = false;

      if (pending && !stopped) {
        pending = false;
        schedule();
      } else {
        release?.();
        release = undefined;
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    release ??= options.hold?.();

    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      ensureWatchers();
      void fire();
    }, options.debounceMs ?? 150);
  };

  const ensureWatchers = (): void => {
    for (const directory of options.directories) {
      if (watchers.has(directory.path)) continue;

      try {
        const names = directory.names === undefined ? undefined : new Set(directory.names);

        const watcher = watch(
          directory.path,
          { recursive: directory.recursive ?? true },
          (_event, filename) => {
            // A null filename is platform-dependent and always counts.
            if (names !== undefined && filename !== null && !names.has(filename.toString())) return;
            schedule();
          },
        );

        watcher.on("error", () => {
          watchers.delete(directory.path);
          watcher.close();
          // The native watcher may be unavailable (for example EMFILE). Rescan
          // once now; the existing slow retry will try to restore watching.
          void fire();
        });
        watchers.set(directory.path, watcher);
      } catch {
        // Missing directory; retried on the next burst or tick.
      }
    }
  };

  ensureWatchers();
  const retry = setInterval(ensureWatchers, 5_000);
  retry.unref?.();

  return () => {
    stopped = true;
    clearInterval(retry);

    if (timer !== undefined) clearTimeout(timer);
    release?.();
    release = undefined;

    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}
