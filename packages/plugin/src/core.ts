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
  SearchProvider,
  SearchResult,
  Setting,
  SettingDefinition,
  Skill,
  ToolDefinition,
  ToolInvocation,
} from "@nyte-ai/core";
export type {
  CompactionPlan,
  Decision,
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

export type PluginApi = CorePluginApi<"core">;

export type HookName = SideHookName<"core">;

export type HookHandler<N extends HookName> = SideHookHandler<"core", N>;

export type HookEntry<N extends HookName> = SideHookEntry<"core", N>;
