/**
 * `@nyte-ai/core/plugins`: `definePlugin`, `SessionApi`, the hook names, the
 * built-in plugins a host installs, and tool authoring. `@nyte-ai/plugin` is
 * the author-facing name for this entry and re-exports it verbatim, so one
 * process never holds two copies of the plugin types.
 *
 * `PluginHost`, the contribution registries, and `PluginScope` are internals:
 * they are exported from nowhere and reached only by relative path inside
 * core (design record, "Plugins").
 */
export * from "./types.ts";
export { systemPromptPlugin } from "./builtin/system-prompt.ts";
export { contextFilesPlugin } from "./builtin/context-files.ts";
export { SKILLS_PLUGIN_ID, skillsPlugin } from "./builtin/skills.ts";
export { toolsFsPlugin } from "./builtin/tools-fs.ts";
export { stockAgentsPlugin } from "./builtin/agents.ts";
/**
 * Durable suspension, the mechanism behind asks and subagent waits: a tool
 * throws `ToolWait` and settles on wake (design record, "Suspension
 * and wake"). The question example shows the whole pattern.
 */
export {
  ToolWait,
  type WaitingCall,
  type ToolWake,
  type ToolWakeContext,
  type ToolWakeOutcome,
} from "../types.ts";
export { ToolError, toolResultContent } from "../utils/tool-result.ts";

/** What a hook handler is handed, and what a `before_tool` policy decides. */
export type {
  HookHandler,
  HookInvocation,
  HookMap,
  HookModelRef,
  HookName,
  ToolCallDecision,
  ToolCallRequest,
} from "./hooks.ts";

/** Tool authoring: what a contributed tool is. */
export type {
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "../types.ts";
export { toJsonValue } from "../kernel/json.ts";

/** Skills are plugin contributions; the built-in `skills` plugin reads them. */
export { formatSkillInvocation } from "../skills.ts";
