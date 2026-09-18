/**
 * `@nyte-ai/core`: the kernel SDK, the small set of
 * host composition types needed to construct it, and `dispatch`, the one
 * table binding every protocol operation to the SDK method it names.
 *
 * Plugin authoring stays under `@nyte-ai/core/plugins`; host storage stays
 * under `@nyte-ai/core/store`. Neither route is folded into one barrel.
 */
export { createNyte } from "./kernel/sdk/nyte.ts";
export { dispatch } from "./kernel/sdk/dispatch.ts";
export { bindTool } from "./tools/bind-tool.ts";
export * from "./kernel/sdk/types.ts";

/**
 * Host composition, not internals: a host needs these to build
 * `NyteOptions.plugins` behind workspace trust, so they sit beside `createNyte`.
 * The plugin registries, host, and scope are internals and are exported from
 * nowhere.
 */
export {
  resolvePlugins,
  watchPluginDirectories,
  type PluginDirectory,
  type PluginManifest,
  type ResolvedPlugins,
  type WatchTarget,
} from "./plugins/sources.ts";
/**
 * `LoadedPlugin` is a `NyteOptions` field; `PluginInfo` and `SettingInfo` are
 * what the `plugins` namespace returns. Authoring the things behind them is
 * `/plugins`.
 */
export type { LoadedPlugin, PluginInfo, SettingInfo } from "./plugins/types.ts";

/** The remaining `NyteOptions` fields a host names when it composes a `Nyte`. */
export { isThinkingLevel, type StreamFn, type ThinkingLevel } from "./kernel/loop/types.ts";
export { DEFAULT_COMPACTION_SETTINGS, type CompactionSettings } from "./kernel/compaction.ts";
