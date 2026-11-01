import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, sep } from "node:path";
import type { PluginImport } from "@nyte-ai/host";

const LOADERS = new Map<string, Bun.JavaScriptLoader>([
  [".ts", "ts"],
  [".mts", "ts"],
  [".cts", "ts"],
  [".tsx", "tsx"],
  [".js", "js"],
  [".mjs", "js"],
  [".cjs", "js"],
  [".jsx", "jsx"],
]);

const LOCAL_SPECIFIER = /^(?:\.\.?(?:\/|$)|\/|file:)/;

/** Bun's `PluginImport`, for the host the terminal opens (Bun's `node:module` has no `registerHooks`, so the host's default importer would reload only the entry). It walks the entry's local import graph: it reads each file, records the sha256 of those bytes, and follows the file's relative or absolute imports (`./`, `../`, `/`, `file:`, from `Bun.Transpiler` `scanImports`, which sees literal dynamic imports too) that `Bun.resolveSync` resolves to an absolute path outside `node_modules`; bare and `#` specifiers are never followed, so packages, linked ones included, keep the host's cached copies. It deletes every file of the graph from Bun's module cache (`import.meta.require.cache`, which holds ES modules too), which makes Bun evaluate those modules again, and imports the entry. `files` is the graph, entry first, with the hashes of the bytes read before the import: the import reads those bytes or newer ones, so a later check against them sees any newer save. A file that does not read is left out, and an import that does not resolve is not followed. */
export function bunPluginImport(): PluginImport {
  return async (path) => {
    const files = await localGraph(path);

    for (const file of files.keys()) delete import.meta.require.cache[file];

    const result = await import(path).then(
      (module: unknown) => ({ kind: "module", module }) as const,
      (error: unknown) =>
        ({
          kind: "failed",
          reason: error instanceof Error ? error.message : String(error),
        }) as const,
    );

    return { files, result };
  };
}

async function localGraph(entry: string): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();

  const visit = async (file: string): Promise<void> => {
    if (files.has(file)) return;
    const bytes = await readFile(file).catch(() => null);

    if (bytes === null) return;
    files.set(file, createHash("sha256").update(bytes).digest("hex"));

    for (const imported of localImports(file, bytes)) await visit(imported);
  };

  await visit(entry);

  return files;
}

/** The local files `file`, read as `bytes`, imports; none when it has no script extension or does not parse. */
function localImports(file: string, bytes: Uint8Array): readonly string[] {
  const loader = LOADERS.get(extname(file));

  if (loader === undefined) return [];

  return scanImports(loader, bytes)
    .filter((specifier) => LOCAL_SPECIFIER.test(specifier))
    .map((specifier) => resolveLocal(specifier, dirname(file)))
    .filter((resolved) => resolved !== null);
}

/** The file `specifier` resolves to from `dir`, or null when it does not resolve or resolves to a builtin or a `node_modules` file. */
function resolveLocal(specifier: string, dir: string): string | null {
  const resolved = resolveOrNull(specifier, dir);

  return resolved !== null && isAbsolute(resolved) && !resolved.split(sep).includes("node_modules")
    ? resolved
    : null;
}

function scanImports(loader: Bun.JavaScriptLoader, code: Uint8Array): readonly string[] {
  try {
    return new Bun.Transpiler({ loader }).scanImports(code).map((entry) => entry.path);
  } catch {
    return [];
  }
}

function resolveOrNull(specifier: string, dir: string): string | null {
  try {
    return Bun.resolveSync(specifier, dir);
  } catch {
    return null;
  }
}
