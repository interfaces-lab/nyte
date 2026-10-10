import type { HostView, PluginCheckReport, PluginLoadOutcome, SessionId } from "@nyte-ai/schema";
import type { HookDispatch } from "./hooks.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin, PluginApi } from "./plugin.ts";
import type { RegistrySet } from "./registry.ts";

/** Holds one session's core plugins (plugins are per session on core): their apis, the registries they write and the hooks they register. */
export interface PluginRuntime {
  /** The session's registries, shared by every plugin it loaded. */
  readonly registries: RegistrySet;
  /** The session's hook dispatch. */
  readonly hooks: HookDispatch;
  /** Loads plugins after those already loaded and returns one outcome per plugin, in order. Preflight first, as `check`: a duplicate id (in the list or already loaded), a second environment provider of one kind, or a schema whose `jsonSchema` throws rejects that plugin with its issues. Then the session's workspace, environment and resources are resolved once (`kernel.env` and `kernel.resources`; null when unavailable), and per plugin in host registration order: an api over a fresh `AbortController`, the declared `contribute` and `hooks` installed through it, then `await activate(api)`; a throwing `activate` aborts that controller, removing what the plugin installed, and rejects it with the error as an issue. Then one reload pass, the catalog published, `session_activated` observed, and the issues republished to `HostView.plugins`. */
  load(plugins: readonly Plugin<"core">[]): Promise<readonly PluginLoadOutcome[]>;
  /** Replaces the loaded set with `plugins` by id and returns one outcome per plugin in `plugins` order: a loaded plugin absent from the list is deactivated; each listed plugin's previous version is deactivated and the new one loaded as `load` does. A new version rejected in preflight leaves the previous running, and one whose `activate` throws re-activates the previous: either is `kept-previous` with the new version's issues; a plugin with no previous version is `rejected`. */
  replace(plugins: readonly Plugin<"core">[]): Promise<readonly PluginLoadOutcome[]>;
  /** Runs `load`'s preflight over `plugins` as one set: per-plugin outcomes (`activated` with warnings, `rejected` with errors) and the collisions between them (one tool name, command name or setting id from two plugins; a reserved part kind from a non-built-in plugin, §34b). Loads, activates and writes nothing. */
  check(plugins: readonly Plugin<"core">[]): Promise<PluginCheckReport>;
  /** Returns each loaded or rejected plugin with its source (`builtin` for the decision-13 built-ins, `inline` otherwise), a null path, and the issues its load produced plus every one it reported since: this session's share of `HostView.plugins`. */
  issues(): readonly HostView["plugins"][number][];
  /** Returns the api of the active plugin with this id, core's minimal api for `core` (`corePluginApi`), or undefined: what `kernel.pluginApi` resolves through. */
  api(owner: string): PluginApi<"core"> | undefined;
  /** Deactivates every plugin in reverse load order (aborting each one's signal removes its contributions and hooks), runs a last reload pass and republishes the issues; the runtime may load again. */
  close(): Promise<void>;
}

/** Returns a session's plugin runtime with nothing loaded, its registries and hook dispatch empty, and records it among the kernel's runtimes; `kernel.pluginsFor(session)` creates it on first use and activation loads `kernel.hostPlugins` into it. After every reload pass it syncs the `parts` registry into `kernel.partDefinitions` with owners (a non-built-in plugin contributing a reserved kind is reported as a collision, §34b) and publishes the catalog. */
export function createPluginRuntime(kernel: Kernel, session: SessionId): PluginRuntime {
  throw new Error("not implemented");
}

/** Returns every plugin runtime created over the kernel: what a host-wide `plugins.replace`, `HostView.plugins` and host-scope settings read across sessions. */
export function pluginRuntimes(kernel: Kernel): readonly PluginRuntime[] {
  throw new Error("not implemented");
}
