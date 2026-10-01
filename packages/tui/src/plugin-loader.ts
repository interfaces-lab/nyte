/**
 * Fresh module instances for a plugin's local import graph under Bun: scan
 * imports with the transpiler, evict every graph file from the module cache,
 * and import the entry again. Host packages plugins import by bare
 * specifier resolve to the host's own copies through a Bun plugin, including
 * in a compiled executable. Based on opencode v2 `plugin/src/source.bun.ts`.
 */
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { plugin, resolveSync, Transpiler } from "bun";
import {
  createPluginSources,
  createSourceWatcher,
  notifyPluginSources,
} from "@nyte-ai/host/plugins";
import type { PluginSources, Prepare, Track } from "@nyte-ai/host/plugins";

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

    const content = readFileSync(file);
    track(file, false, content);
    if (!/\.[cm]?[jt]sx?$/.test(file)) return;

    const imports = (() => {
      try {
        return new Transpiler({ loader: loaderFor(file), target: "bun" }).scan(
          content.toString("utf8"),
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

const runtimeModules = new Map<string, object>();
const registered = new Set<string>();

/**
 * Register the host modules plugins import by name and get the `Prepare` for
 * entries under Bun. The Bun plugin registers once; later calls add modules.
 */
export function bunPluginLoader(modules: Readonly<Record<string, object>>): Prepare<unknown> {
  for (const [specifier, module] of Object.entries(modules)) runtimeModules.set(specifier, module);
  const pending = [...runtimeModules.keys()].filter((specifier) => !registered.has(specifier));
  if (pending.length > 0) {
    plugin({
      name: `nyte-host-modules-${registered.size}`,
      setup(builder) {
        for (const specifier of pending) {
          registered.add(specifier);
          builder.module(specifier, () => {
            const exported = runtimeModules.get(specifier);
            if (exported === undefined) throw new Error(`Unknown host module: ${specifier}`);
            return { loader: "object", exports: { ...exported } };
          });
        }
      },
    });
  }

  return (entry, track) => {
    const resolved = realpathSync(entry);
    evictGraph(resolved, track);

    return { load: (): Promise<unknown> => import(pathToFileURL(resolved).href) };
  };
}

export function createBunPluginSources(): PluginSources<unknown> {
  const module: unknown = require("@nyte-ai/plugin");
  if (typeof module !== "object" || module === null) throw new Error("Invalid host plugin module");
  const watcher = createSourceWatcher(notifyPluginSources);
  const sources = createPluginSources(
    bunPluginLoader({ "@nyte-ai/plugin": module, "@nyte-ai/core/plugins": module }),
    watcher.wait,
  );
  return {
    ...sources,
    dispose() {
      sources.dispose();
      watcher.dispose();
    },
  };
}
