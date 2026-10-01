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

export {
  loadProjectContextFiles,
  formatContextFilesForPrompt,
} from "./plugins/builtin/context-files.ts";

/**
 * `LoadedPlugin` is a `NyteOptions` field; `PluginInfo` and `SettingInfo` are
 * what the `plugins` namespace returns. Authoring the things behind them is
 * `/plugins`.
 */
export type { LoadedPlugin, PluginInfo, SettingInfo } from "./plugins/types.ts";

/** The remaining `NyteOptions` fields a host names when it composes a `Nyte`. */
export { isThinkingLevel, type StreamFn, type ThinkingLevel } from "./kernel/loop/types.ts";

export { DEFAULT_COMPACTION_SETTINGS, type CompactionSettings } from "./kernel/compaction.ts";

export {
  CACHE_WARMING_MODES,
  formatCacheWarmingStatus,
  formatCacheWarmingUsage,
  type CacheWarmingAction,
  type CacheWarmingDecision,
  type CacheWarmingMode,
  type CacheWarmingStatus,
} from "./kernel/cache-warmer.ts";
