import type { EnvOps, ExecutionEnv } from "../kernel/loop/env.ts";
import type { EnvironmentProvider, EnvironmentWrap, Plugin } from "./types.ts";

/** The providers of `plugins`, by kind. Throws if two provide one kind. */
export function environmentProviders(
  plugins: readonly Plugin[],
): ReadonlyMap<string, EnvironmentProvider> {
  const owners = new Map<string, string>();
  const providers = new Map<string, EnvironmentProvider>();

  for (const plugin of plugins) {
    if (plugin.environment === undefined) continue;
    const { kind } = plugin.environment;
    const owner = owners.get(kind);

    if (owner !== undefined)
      throw new Error(
        `Plugins "${owner}" and "${plugin.id}" both provide the "${kind}" environment`,
      );
    owners.set(kind, plugin.id);
    providers.set(kind, plugin.environment);
  }

  return providers;
}

/** Every operation, each forwarded to `target()` when it is called. */
function forward(target: () => EnvOps): EnvOps {
  return {
    resolve: (...paths) => target().resolve(...paths),
    readFile: (path) => target().readFile(path),
    writeFile: (path, content) => target().writeFile(path, content),
    mkdir: (path) => target().mkdir(path),
    stat: (path) => target().stat(path),
    readdir: (path) => target().readdir(path),
    realpath: (path) => target().realpath(path),
    exec: (command, options) => target().exec(command, options),
  };
}

/** `base` through the current wraps, outermost last, under `base`'s identity. */
export function wrappedEnvironment(
  base: ExecutionEnv,
  wraps: () => readonly EnvironmentWrap[],
): ExecutionEnv {
  let composed: { readonly wraps: readonly EnvironmentWrap[]; readonly ops: EnvOps } | undefined;

  const ops = (): EnvOps => {
    const current = wraps();

    if (
      composed === undefined ||
      composed.wraps.length !== current.length ||
      composed.wraps.some((wrap, index) => wrap !== current[index])
    )
      composed = {
        wraps: current,
        // A fresh object, so a wrap that assigns to `inner` changes neither `base` nor another session.
        ops: current.reduce<EnvOps>(
          (inner, wrap) => wrap(inner),
          forward(() => base),
        ),
      };

    return composed.ops;
  };

  return Object.freeze<ExecutionEnv>({ id: base.id, cwd: base.cwd, ...forward(ops) });
}
