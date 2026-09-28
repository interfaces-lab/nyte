/**
 * Fresh module instances for a plugin's local import graph under Bun: scan
 * imports with the transpiler, evict every graph file from the module cache,
 * and `require` the entry again. Host packages plugins import by bare
 * specifier resolve to the host's own copies through a Bun plugin, including
 * in a compiled executable. Based on opencode v2 `plugin/src/source.bun.ts`.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { plugin, resolveSync, Transpiler } from "bun";
import type { Prepare, Track } from "@nyte-ai/host/plugins";

function localSource(spec: string, directory: string): URL | undefined {
  if (spec.startsWith("file://")) return new URL(spec);

  if (spec.startsWith("./") || spec.startsWith("../") || isAbsolute(spec))
    return pathToFileURL(resolve(directory, spec));

  return undefined;
}

function loaderFor(file: string): "tsx" | "jsx" | "ts" | "js" {
  if (file.endsWith("tsx")) return "tsx";

  if (file.endsWith("jsx")) return "jsx";

  return /\.[cm]?ts$/.test(file) ? "ts" : "js";
}

function evictGraph(entry: string, track: Track): void {
  const files = new Set<string>();

  const visit = (file: string, search = ""): void => {
    if (file.split(sep).includes("node_modules")) return;

    if (search) delete require.cache[file + search];

    if (files.has(file)) return;
    files.add(file);
    delete require.cache[file];
    track(file);

    if (!/\.[cm]?[jt]sx?$/.test(file)) return;

    const imports = (() => {
      try {
        return new Transpiler({ loader: loaderFor(file), target: "bun" }).scan(
          readFileSync(file, "utf8"),
        ).imports;
      } catch {
        return [];
      }
    })();

    for (const item of imports) {
      const local =
        item.path.startsWith("./") || item.path.startsWith("../")
          ? new URL(item.path, pathToFileURL(file))
          : localSource(item.path, dirname(file));

      if (!local) continue;
      const requested = fileURLToPath(local);

      if (requested.split(sep).includes("node_modules")) continue;

      try {
        visit(
          item.kind === "require-call"
            ? createRequire(file).resolve(requested)
            : resolveSync(requested, dirname(file)),
          local.search,
        );
      } catch {
        track(dirname(requested), true);
      }
    }
  };

  visit(entry);
}

let registered = false;

/**
 * Register the host modules plugins import by name and get the `Prepare` for
 * entries under Bun. The Bun plugin registers once; later calls add modules.
 */
export function bunPluginLoader(modules: Readonly<Record<string, object>>): Prepare<unknown> {
  if (!registered) {
    registered = true;
    plugin({
      name: "nyte-host-modules",
      setup(builder) {
        for (const [specifier, exported] of Object.entries(modules)) {
          builder.module(specifier, () => ({ loader: "object", exports: { ...exported } }));
        }
      },
    });
  }

  return (entry, track) => {
    evictGraph(entry, track);

    return { load: () => Promise.resolve(require(entry)) };
  };
}
