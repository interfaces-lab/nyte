import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import nodeModule from "node:module";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SdkError } from "@nyte-ai/schema";
import type { ValidationIssue } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { Plugin, PluginDirectory } from "@nyte-ai/core";
import { sha256 } from "../hash.ts";
import { readErrorCode } from "../local/tree.ts";

const EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];

const VERSION = "nyte-plugin";

const LOCAL_SPECIFIER = /^(?:\.\.?(?:\/|$)|\/|file:)/;

/** One plugin entry imported fresh, and what the import gave. `files` maps each local file the import evaluated (the entry first; reached through relative or absolute specifiers, never through `node_modules` or a bare or `#` specifier) to the hex sha256 of the bytes it evaluated, or of bytes read before the import, which it then read unchanged or newer. An importer may keep adding to it while the module lives: Node's adds the local files a plugin imports later, such as in `activate`. */
export interface ImportedPlugin {
  readonly files: ReadonlyMap<string, string>;
  readonly result:
    | { readonly kind: "module"; readonly module: unknown }
    | { readonly kind: "failed"; readonly reason: string };
}

/** Imports the plugin entry at an absolute real `path` so that every local file of its graph evaluates again; `files` hashes them. */
export type PluginImport = (path: string) => Promise<ImportedPlugin>;

/** Loads plugin files (`createPluginLoader`), answering the same plugin object for an entry whose import graph has not changed. */
export interface PluginLoader {
  /** The host's `loadPlugins` (`composeHost({ loadPlugins })`), which `plugins.replace` and `plugins.check` load their files through (§40b, §47m): each path, resolved to its real path, must lie inside one of `dirs()` (else `SdkError("denied")`), and a path with no file is `SdkError("invalid")`; every file that does not import or export a core plugin is reported, together, as one `SdkError("invalid")` with an issue per file naming it. The plugins come back in path order. */
  load(paths: readonly string[]): Promise<readonly Plugin<"core">[]>;
  /** Returns a plugin directory's plugins (`~/.nyte/plugins`, a workspace's `.nyte/plugins`; `pluginFilesIn` finds them) file by file: every file that loads, with its path, and every file that does not, with its path and one `error` issue (its `path` the file, `source.file` the file, the message `load` would have put in its `invalid`), never rejecting for a bad file; a missing directory has neither. What `openHost` loads the plugin directories through, so one bad file is reported on `HostView.plugins` instead of failing the open (§41j). */
  directory(dir: string): Promise<PluginDirectory>;
  /** Removes the Node hooks this loader registered and the file records they keep, if it registered them. */
  close(): void;
}

/** Returns a `PluginLoader` over the plugin directories `dirs()` answers, importing each plugin entry through `import` (`nodePluginImport` when omitted, which `close()` then disposes). Importing a plugin file is one of the two dynamic loads the rewrite allows (§41a), host-only, because a plugin file is code the owner placed there and its path is known only at run time; Node strips `.ts` types natively (erasable syntax only). The loader remembers each entry that loaded a plugin by real path with its `ImportedPlugin.files`: while every recorded file still reads to the bytes its hash was taken of, the entry answers the same plugin object without importing again, so a caller can skip reloading an unchanged plugin; when a recorded file changes or disappears, the entry is imported fresh. A failure is never remembered, and it forgets the plugin the entry loaded before (whose file record the importer may have released): a failing entry is imported again on every load, and reverting it to bytes that loaded before gives a new plugin object, since a fix can lie where its local files cannot show it (a package installed into `node_modules`, a helper created under an extension its import left out). Concurrent loads of one entry share one in-flight import and answer the same outcome. The default export must be a core plugin (an object with a string `id`, and, where present, `contribute` and `hooks` objects, an `activate` function and an `environment` with a string `kind` and `inspect` and `attach` functions). */
export function createPluginLoader(input: {
  readonly dirs: () => Promise<readonly string[]>;
  readonly import?: PluginImport;
}): PluginLoader {
  if (input.import !== undefined) return loaderOver(input.dirs, input.import, () => {});

  const node = nodePluginImport();

  return loaderOver(input.dirs, node.import, () => node.dispose());
}

/** The plugin entry files directly in `dir`, by name: each `.ts`, `.mts`, `.js` or `.mjs` file, and each subdirectory's `index` of those; a symlink counts as the file or folder it points to when its real path lies inside `dir`'s, and is skipped when it points outside it or nowhere; a missing directory has none. */
export async function pluginFilesIn(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if (readErrorCode(error) === "ENOENT" || readErrorCode(error) === "ENOTDIR") return [];

    throw error;
  });

  return (
    await Promise.all(
      entries
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
        .map(async (entry) => {
          const path = join(dir, entry.name);

          const kind = entry.isSymbolicLink()
            ? await linkedKind(dir, path)
            : entry.isFile()
              ? "file"
              : entry.isDirectory()
                ? "directory"
                : null;

          if (kind === "file")
            return EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : [];

          if (kind !== "directory") return [];

          for (const extension of EXTENSIONS) {
            const index = join(path, `index${extension}`);

            if ((await stat(index).catch(() => null))?.isFile() === true) return [index];
          }

          return [];
        }),
    )
  ).flat();
}

/** Node's `PluginImport`, the default of `createPluginLoader`. It imports an entry's file URL with a `nyte-plugin` query unique to that import, and registers one `module.registerHooks` pair of hooks: `resolve` copies a parent's `nyte-plugin` value onto what a relative or absolute specifier (`./`, `../`, `/`, `file:`) of it resolves to when that is a `file:` URL outside `node_modules`, so the plugin's local graph evaluates again under the new value while packages, linked ones included, and `#imports` stay the host's cached copies; `load` records, under the import's value, the sha256 of the `source` it hands Node for each such file (the raw file bytes, also for `.ts` before type stripping; the file read in the hook where `source` is null). `files` is that live record, seeded with the entry's bytes read before the import: it keeps growing with the local files the module imports later, until the entry is imported again, its import fails, or `dispose` runs, which each release it. Where `registerHooks` is missing (Bun, unless the host is given its own importer) only the entry is imported fresh and `files` is the entry. `dispose` deregisters the hooks. */
export function nodePluginImport(): { readonly import: PluginImport; dispose(): void } {
  const records = new Map<string, Map<string, string>>();
  const tokens = new Map<string, string>();

  const hooks =
    typeof nodeModule.registerHooks === "function"
      ? nodeModule.registerHooks({
          resolve: (specifier, context, nextResolve) => {
            const resolved = nextResolve(specifier, context);
            const parent = context.parentURL;
            const version = parent === undefined ? null : new URL(parent).searchParams.get(VERSION);

            if (
              version === null ||
              !LOCAL_SPECIFIER.test(specifier) ||
              !resolved.url.startsWith("file:") ||
              resolved.url.includes("/node_modules/")
            )
              return resolved;

            const url = new URL(resolved.url);
            url.searchParams.set(VERSION, version);

            return { ...resolved, url: url.href };
          },
          load: (url, context, nextLoad) => {
            const loaded = nextLoad(url, context);

            if (!url.startsWith("file:")) return loaded;
            const version = new URL(url).searchParams.get(VERSION);
            const files = version === null ? undefined : records.get(version);
            const path = fileURLToPath(url);
            files?.set(path, sha256(evaluatedBytes(loaded.source, path)));

            return loaded;
          },
        })
      : null;

  return {
    import: async (path) => {
      const previous = tokens.get(path);

      if (previous !== undefined) records.delete(previous);
      const token = randomUUID();
      const files = new Map<string, string>();
      records.set(token, files);
      tokens.set(path, token);
      const url = pathToFileURL(path);
      url.searchParams.set(VERSION, token);

      const result = await readFile(path)
        .then((bytes) => {
          files.set(path, sha256(bytes));

          return import(url.href);
        })
        .then(
          (module: unknown) => ({ kind: "module", module }) as const,
          (error: unknown) =>
            ({
              kind: "failed",
              reason: error instanceof Error ? error.message : String(error),
            }) as const,
        );

      if (result.kind === "failed") records.delete(token);

      return { files, result };
    },
    dispose: () => {
      hooks?.deregister();
      records.clear();
      tokens.clear();
    },
  };
}

function loaderOver(
  dirs: () => Promise<readonly string[]>,
  importer: PluginImport,
  close: () => void,
): PluginLoader {
  const remembered = new Map<
    string,
    { readonly files: ReadonlyMap<string, string>; readonly plugin: Plugin<"core"> }
  >();

  const loading = new Map<string, Promise<Outcome>>();

  const importEntry = async (path: string): Promise<Outcome> => {
    const cached = remembered.get(path);

    if (cached !== undefined && (await unchanged(cached.files))) return { plugin: cached.plugin };

    const imported = await importer(path);

    const outcome =
      imported.result.kind === "failed"
        ? { reason: imported.result.reason }
        : exportedPlugin(imported.result.module);

    if ("plugin" in outcome)
      remembered.set(path, { files: imported.files, plugin: outcome.plugin });
    else remembered.delete(path);

    return outcome;
  };

  const loadEntry = (path: string): Promise<Outcome> => {
    const pending = loading.get(path);

    if (pending !== undefined) return pending;
    const started = importEntry(path).finally(() => loading.delete(path));
    loading.set(path, started);

    return started;
  };

  const importEach = async (files: readonly string[]): Promise<PluginDirectory> => {
    const loaded: { readonly plugin: Plugin<"core">; readonly path: string }[] = [];
    const failed: { readonly path: string; readonly issue: ValidationIssue }[] = [];

    for (const path of files) {
      const outcome = await loadEntry(await realpath(path).catch(() => path));
      dev("plugins", "file", { path, outcome: "plugin" in outcome ? "loaded" : "failed" });

      if ("plugin" in outcome) loaded.push({ plugin: outcome.plugin, path });
      else
        failed.push({
          path,
          issue: {
            severity: "error",
            path: [path],
            message: outcome.reason,
            source: { plugin: path, file: path },
          },
        });
    }

    return { loaded, failed };
  };

  return {
    load: async (paths) => {
      const roots = (
        await Promise.all((await dirs()).map((dir) => realpath(dir).catch(() => null)))
      ).filter((root) => root !== null);

      const files = await Promise.all(
        paths.map(async (path) => {
          const real = await realpath(path).catch(() => null);

          if (real === null) throw new SdkError("invalid", `No plugin file is at ${path}.`);

          if (!roots.some((root) => inside(root, real)))
            throw new SdkError("denied", `${path} is not in a plugin directory this host loads.`);

          return real;
        }),
      );

      const found = await importEach(files);
      const issues = found.failed.map((entry) => entry.issue);

      if (issues.length > 0)
        throw new SdkError(
          "invalid",
          `${issues.length === 1 ? "A plugin file" : `${issues.length} plugin files`} did not load: ${found.failed.map((entry) => `${entry.path}: ${entry.issue.message}`).join("; ")}`,
          { issues },
        );

      return found.loaded.map((entry) => entry.plugin);
    },
    directory: async (dir) => importEach(await pluginFilesIn(dir)),
    close,
  };
}

type Outcome = { readonly plugin: Plugin<"core"> } | { readonly reason: string };

function exportedPlugin(imported: unknown): Outcome {
  const exported =
    typeof imported === "object" && imported !== null && "default" in imported
      ? imported.default
      : undefined;

  return fitsCorePlugin(exported)
    ? { plugin: exported }
    : { reason: "Its default export is not a core plugin (an object with a string id)." };
}

async function unchanged(files: ReadonlyMap<string, string>): Promise<boolean> {
  const recorded = [...files];

  const current = await Promise.all(
    recorded.map((entry) => readFile(entry[0]).then(sha256, () => null)),
  );

  return recorded.every((entry, index) => current[index] === entry[1]);
}

function evaluatedBytes(
  source: nodeModule.LoadFnOutput["source"] | null,
  path: string,
): string | Uint8Array {
  if (source === undefined || source === null) return readFileSync(path);

  if (ArrayBuffer.isView(source))
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);

  return source instanceof ArrayBuffer ? new Uint8Array(source) : source;
}

async function linkedKind(dir: string, path: string): Promise<"file" | "directory" | null> {
  const root = await realpath(dir).catch(() => null);
  const real = await realpath(path).catch(() => null);

  if (root === null || real === null || !inside(root, real)) return null;
  const stats = await stat(real).catch(() => null);

  if (stats?.isFile() === true) return "file";

  return stats?.isDirectory() === true ? "directory" : null;
}

function fitsCorePlugin(value: unknown): value is Plugin<"core"> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string"
  )
    return false;

  const object = (field: unknown): boolean =>
    field === undefined || (typeof field === "object" && field !== null);

  if ("contribute" in value && !object(value.contribute)) return false;

  if ("hooks" in value && !object(value.hooks)) return false;

  if ("activate" in value && value.activate !== undefined && typeof value.activate !== "function")
    return false;

  if (!("environment" in value) || value.environment === undefined) return true;
  const environment = value.environment;

  return (
    typeof environment === "object" &&
    environment !== null &&
    "kind" in environment &&
    typeof environment.kind === "string" &&
    "inspect" in environment &&
    typeof environment.inspect === "function" &&
    "attach" in environment &&
    typeof environment.attach === "function"
  );
}

function inside(root: string, path: string): boolean {
  const within = relative(root, path);

  return within !== "" && !within.startsWith("..") && !isAbsolute(within);
}
