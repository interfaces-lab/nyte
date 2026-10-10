import type { Plugin } from "@nyte-ai/core";
import type { HandlerOptions } from "@nyte-ai/protocol";

/** Returns the core plugins in a plugin directory (`~/.nyte/plugins`, a workspace's `.nyte/plugins`), by file name: each `.ts`, `.mts`, `.js` or `.mjs` file directly in it and each subdirectory's `index` of those, loaded with a dynamic `import()` of its file URL. That `import()` is the one dynamic import the rewrite allows, host-only, because a plugin file is code the owner placed there and its path is known only at run time; Node strips `.ts` types natively (erasable syntax only). The URL carries the file's modification time and size as a query, so a replaced file loads fresh instead of from the module cache. The default export must be a core plugin (an object with a string `id`), else `SdkError("invalid")` naming the file; a missing directory has none. */
export function loadPluginFiles(
  dir: string,
): Promise<readonly { readonly plugin: Plugin<"core">; readonly path: string }[]> {
  throw new Error("not implemented");
}

/** Returns the loader protocol's handler calls with the paths of `plugins.replace` and `plugins.check` (§40b): each path, resolved to its real path, must lie inside one of `dirs` (else `SdkError("denied")`) and is imported as `loadPluginFiles` imports a file; the plugins come back in path order. */
export function pluginLoader(dirs: readonly string[]): NonNullable<HandlerOptions["plugins"]> {
  throw new Error("not implemented");
}
