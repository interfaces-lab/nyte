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

function localImports(file: string, bytes: Uint8Array): readonly string[] {
  const loader = LOADERS.get(extname(file));

  if (loader === undefined) return [];

  return scanImports(loader, bytes)
    .filter((specifier) => LOCAL_SPECIFIER.test(specifier))
    .map((specifier) => resolveLocal(specifier, dirname(file)))
    .filter((resolved) => resolved !== null);
}

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
