/**
 * `@nyte-ai/core`: the kernel SDK, client projections, the small set of
 * host composition types needed to construct it, and `dispatch`, the one
 * table binding every protocol operation to the SDK method it names.
 *
 * Plugin authoring stays under `@nyte-ai/core/plugins`; host storage stays
 * under `@nyte-ai/core/store`; `@nyte-ai/core/views` is the browser-safe
 * projection-only route. None of those routes is folded into one barrel.
 */
export { createNyte } from "./kernel/sdk/nyte.ts";
export { dispatch } from "./kernel/sdk/dispatch.ts";
export { mergeQueuedLanes } from "./kernel/queue.ts";
export { acceptsSelectionReply, isTerminalPhase, isUserJob } from "@nyte-ai/protocol";
export { bindTool } from "./tools/bind-tool.ts";
export * from "./kernel/sdk/types.ts";
/** Thrown by `watch` when a cursor is older than the event floor: take a snapshot and resume from its seq. */
export { CursorExpired } from "./kernel/model.ts";
export * from "./completion-trigger.ts";
export * from "./mention-files.ts";

/**
 * Client projections over the log. Clients may import nothing but this entry,
 * so the read models they render ship from it (design record, "Views").
 */
export * from "./kernel/views/index.ts";

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
export { isThinkingLevel, type StreamFn, type ThinkingLevel } from "./types.ts";
export { DEFAULT_COMPACTION_SETTINGS, type CompactionSettings } from "./kernel/compaction.ts";
export {
  WorkspaceTrustRequired,
  WorkspaceTrustStore,
  type TrustedWorkspace,
} from "./workspace-trust.ts";
export { WorkspaceRegistry } from "./workspace-registry.ts";
