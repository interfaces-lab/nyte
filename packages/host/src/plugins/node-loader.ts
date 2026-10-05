/**
 * Fresh module instances for a plugin's whole local import graph under Node,
 * which never evicts ESM modules: one process-wide resolve hook copies a
 * load's `nyte_rev` from a parent URL to every local file it imports, so each
 * load gets its own copies while `node_modules` stays shared. Host packages a
 * plugin imports by bare specifier resolve to `nyte-host:` modules that
 * re-export the host's own instance, so `instanceof` checks hold across the
 * boundary. Based on opencode v2 `plugin/src/source.node.ts`.
 */
import Module from "node:module";
import { dirname, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Prepare, Track } from "./sources.ts";

const REV = "nyte_rev";

const HOST_SCHEME = "nyte-host:";

const MODULES = Symbol.for("nyte.host.modules");

interface Installed {
  readonly modules: Map<string, object>;
  readonly trackers: Map<string, Track>;
}

let installed: Installed | undefined;

function isLocal(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("file:") ||
    isAbsolute(specifier)
  );
}

function inNodeModules(path: string): boolean {
  return path.split(sep).includes("node_modules");
}

function install(): Installed {
  if (installed !== undefined) return installed;
  const state: Installed = { modules: new Map(), trackers: new Map() };
  installed = state;
  Object.defineProperty(globalThis, MODULES, { value: state.modules });

  Module.registerHooks({
    resolve(specifier, context, next) {
      if (state.modules.has(specifier)) {
        return { url: `${HOST_SCHEME}${specifier}`, format: "module", shortCircuit: true };
      }

      const parent = context.parentURL === undefined ? undefined : new URL(context.parentURL);
      const rev = parent?.searchParams.get(REV);

      if (parent === undefined || rev === null || rev === undefined)
        return next(specifier, context);
      const tracker = state.trackers.get(rev);

      const resolved = (() => {
        try {
          return next(specifier, context);
        } catch (error) {
          if (isLocal(specifier) && parent.protocol === "file:") {
            const requested = specifier.startsWith("file:")
              ? fileURLToPath(specifier)
              : isAbsolute(specifier)
                ? specifier
                : fileURLToPath(new URL(specifier, parent));
            tracker?.(dirname(requested), true);
          }

          throw error;
        }
      })();

      if (!isLocal(specifier) || !resolved.url.startsWith("file:")) return resolved;
      const file = fileURLToPath(resolved.url);

      if (inNodeModules(file)) return resolved;
      tracker?.(file);
      const url = new URL(resolved.url);
      url.searchParams.set(REV, rev);

      return { ...resolved, url: url.href };
    },
    load(url, context, next) {
      if (!url.startsWith(HOST_SCHEME)) {
        const loaded = next(url, context);
        if (url.startsWith("file:")) {
          const requested = new URL(url);
          const rev = requested.searchParams.get(REV);
          const source = loaded.source;
          if (rev !== null && source !== null && source !== undefined) {
            const content =
              typeof source === "string"
                ? source
                : ArrayBuffer.isView(source)
                  ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
                  : new Uint8Array(source);
            state.trackers.get(rev)?.(fileURLToPath(requested), false, content);
          }
        }
        return loaded;
      }
      const name = url.slice(HOST_SCHEME.length);
      const module = state.modules.get(name);

      if (module === undefined) throw new Error(`Unknown host module: ${name}`);

      const names = Object.keys(module).filter(
        (key) => key !== "default" && /^[A-Za-z_$][\w$]*$/.test(key),
      );

      const source = [
        `const m = globalThis[globalThis.Symbol.for(${JSON.stringify(MODULES.description)})].get(${JSON.stringify(name)});`,
        "export default m.default;",
        ...(names.length === 0 ? [] : [`export const { ${names.join(", ")} } = m;`]),
      ].join("\n");

      return { format: "module", source, shortCircuit: true };
    },
  });

  return state;
}

/**
 * Register the host modules plugins import by name and get the `Prepare` for
 * session entries under Node. Calling it again adds modules; the hook installs once.
 */
export function nodePluginLoader(modules: Readonly<Record<string, object>>): Prepare<unknown> {
  const state = install();

  for (const [name, module] of Object.entries(modules)) state.modules.set(name, module);
  const revByEntry = new Map<string, string>();

  return (entry, track, instance) => {
    const rev = String(instance);
    const previous = revByEntry.get(entry);

    if (previous !== undefined) state.trackers.delete(previous);
    revByEntry.set(entry, rev);
    state.trackers.set(rev, track);
    const url = pathToFileURL(entry);
    url.searchParams.set(REV, rev);

    return { load: () => import(url.href) };
  };
}
