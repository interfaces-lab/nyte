import type {
  HookEntry as SideHookEntry,
  HookHandler as SideHookHandler,
  HookName as SideHookName,
  Plugin as CorePlugin,
  PluginApi as CorePluginApi,
} from "@nyte-ai/core";

export { branchSummary, compaction, definePart, isPart, text, thinking, tool } from "@nyte-ai/core";
export type {
  ActionContext,
  Agent,
  Command,
  Durable,
  HookTable,
  ModelContextPolicy,
  Part,
  PartDefinition,
  PartState,
  PromptSection,
  Setting,
  SettingDefinition,
  Skill,
  ToolDefinition,
  ToolInvocation,
} from "@nyte-ai/core";
export type {
  CompactionPlan,
  Decision,
  ModelContext,
  ModelRequest,
  Submission,
  ToolCall,
  Transcript,
} from "@nyte-ai/schema";

/**
 * A core plugin: per session on the host, with tools, prompt sections,
 * agents, parts, commands, settings and core hooks. Author one as an object
 * literal and check it with `satisfies Plugin`.
 *
 * @category plugins
 * @since 0.1.0
 */
export type Plugin = CorePlugin<"core">;

/**
 * What a core plugin's `activate` and hook handlers receive: the session,
 * its environment, the registries, storage and `request`.
 *
 * @category plugins
 * @since 0.1.0
 */
export type PluginApi = CorePluginApi<"core">;

/**
 * Names a hook a core plugin may handle.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookName = SideHookName<"core">;

/**
 * Returns a core hook handler's signature, for a helper factored out of a
 * plugin's `hooks`.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookHandler<N extends HookName> = SideHookHandler<"core", N>;

/**
 * Returns a core hook entry: a handler, or a handler with an order.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookEntry<N extends HookName> = SideHookEntry<"core", N>;
