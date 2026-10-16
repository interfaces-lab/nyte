import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { SdkError } from "@nyte-ai/schema";
import type { ValidationIssue } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/core";
import type { ComposeOptions } from "@nyte-ai/core/server";
import { codeOf } from "../local/tree.ts";

const EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];

/** Returns the core plugins in a plugin directory (`~/.nyte/plugins`, a workspace's `.nyte/plugins`), by file name: each `.ts`, `.mts`, `.js` or `.mjs` file directly in it and each subdirectory's `index` of those, loaded with a dynamic `import()` of its file URL. That `import()` is one of the two dynamic loads the rewrite allows (§41a), host-only, because a plugin file is code the owner placed there and its path is known only at run time; Node strips `.ts` types natively (erasable syntax only). The URL carries the file's modification time and size as a query, so a replaced file loads fresh instead of from the module cache. The default export must be a core plugin (an object with a string `id`, and, where present, `contribute` and `hooks` objects, an `activate` function and an `environment` with a string `kind` and `inspect` and `attach` functions); every file that does not load or export one is reported, together, as `SdkError("invalid")` with an issue per file naming it. A missing directory has none. */
export async function loadPluginFiles(
  dir: string,
): Promise<readonly { readonly plugin: Plugin<"core">; readonly path: string }[]> {
  return loadAll(await pluginFilesIn(dir));
}

/** Returns a plugin directory's plugins as `loadPluginFiles` finds and imports them, but file by file: every file that loads, with its path, and every file that does not, with its path and one `error` issue (its `path` the file, `source.file` the file, the message `loadPluginFiles` would have put in its `invalid`), never rejecting for a bad file; a missing directory has neither. What `openHost` loads `~/.nyte/plugins` and a local workspace's `.nyte/plugins` through, so one bad file is reported on `HostView.plugins` instead of failing the open (§41j); `loadPluginFiles` becomes this, throwing its one `invalid` when anything failed. */
export async function loadPluginDirectory(dir: string): Promise<{
  readonly loaded: readonly { readonly plugin: Plugin<"core">; readonly path: string }[];
  readonly failed: readonly { readonly path: string; readonly issue: ValidationIssue }[];
}> {
  return importEach(await pluginFilesIn(dir));
}

/** Returns the host's `loadPlugins` (`composeHost({ loadPlugins })`), which `plugins.replace` and `plugins.check` load their files through (§40b, §47m): each path, resolved to its real path, must lie inside one of `dirs` (else `SdkError("denied")`) and is imported as `loadPluginFiles` imports a file; the plugins come back in path order. */
export function pluginLoader(dirs: readonly string[]): NonNullable<ComposeOptions["loadPlugins"]> {
  return async (paths) => {
    const roots = (await Promise.all(dirs.map((dir) => realpath(dir).catch(() => null)))).filter(
      (root) => root !== null,
    );

    const files = await Promise.all(
      paths.map(async (path) => {
        const real = await realpath(path).catch(() => null);

        if (real === null) throw new SdkError("invalid", `No plugin file is at ${path}.`);

        if (!roots.some((root) => inside(root, real)))
          throw new SdkError("denied", `${path} is not in a plugin directory this host loads.`);

        return real;
      }),
    );

    return (await loadAll(files)).map((loaded) => loaded.plugin);
  };
}

async function loadAll(
  files: readonly string[],
): Promise<readonly { readonly plugin: Plugin<"core">; readonly path: string }[]> {
  const { loaded, failed } = await importEach(files);
  const issues = failed.map((entry) => entry.issue);

  if (issues.length > 0)
    throw new SdkError(
      "invalid",
      `${issues.length === 1 ? "A plugin file" : `${issues.length} plugin files`} did not load: ${failed.map((entry) => `${entry.path}: ${entry.issue.message}`).join("; ")}`,
      { issues },
    );

  return loaded;
}

async function importEach(files: readonly string[]): Promise<{
  readonly loaded: readonly { readonly plugin: Plugin<"core">; readonly path: string }[];
  readonly failed: readonly { readonly path: string; readonly issue: ValidationIssue }[];
}> {
  const loaded: { readonly plugin: Plugin<"core">; readonly path: string }[] = [];
  const failed: { readonly path: string; readonly issue: ValidationIssue }[] = [];

  for (const path of files) {
    const outcome = await importPlugin(path);
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
}

async function pluginFilesIn(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") return [];

    throw error;
  });

  return (
    await Promise.all(
      entries
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
        .map(async (entry) => {
          const path = join(dir, entry.name);

          if (entry.isFile())
            return EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : [];

          if (!entry.isDirectory()) return [];

          for (const extension of EXTENSIONS) {
            const index = join(path, `index${extension}`);

            if ((await stat(index).catch(() => null))?.isFile() === true) return [index];
          }

          return [];
        }),
    )
  ).flat();
}

async function importPlugin(
  path: string,
): Promise<{ readonly plugin: Plugin<"core"> } | { readonly reason: string }> {
  try {
    const stats = await stat(path);
    const url = pathToFileURL(path);
    url.searchParams.set("nyte", `${stats.mtimeMs}-${stats.size}`);
    const imported: unknown = await import(url.href);

    const exported =
      typeof imported === "object" && imported !== null && "default" in imported
        ? imported.default
        : undefined;

    return fitsCorePlugin(exported)
      ? { plugin: exported }
      : { reason: "Its default export is not a core plugin (an object with a string id)." };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
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
