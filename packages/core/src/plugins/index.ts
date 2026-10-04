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

/** Skill discovery: what a host scans to compose `skillsPlugin`. */
export { loadSkills } from "./builtin/skills-index.ts";

export type { LoadedSkills, SkillDiagnostic, SkillDiagnosticCode } from "./builtin/skills-index.ts";

export { toolsFsPlugin } from "./builtin/tools-fs.ts";

/**
 * Durable suspension, the mechanism behind asks and subagent waits: a tool
 * throws `ToolWait` and settles on wake (design record, "Wait and wake").
 * A wait that needs a participant carries a `Selection`, which every client
 * renders without knowing the tool. The question example shows the whole pattern.
 */
export {
  ToolWait,
  type WaitingCall,
  type ToolWake,
  type ToolWakeContext,
  type ToolWakeOutcome,
} from "../kernel/loop/types.ts";

export { acceptsSelectionReply } from "@nyte-ai/protocol";

export type { Choice, Selection, SelectionReply } from "@nyte-ai/protocol";

export { ToolError, stopReason, toolResultContent } from "../kernel/loop/tool-result.ts";

export { bindTool } from "../tools/bind-tool.ts";

/**
 * Where a call acts. The kernel hands one to every tool call as `call.env`;
 * a tool that reaches files or processes takes it from there, never from
 * anything captured when the tool was built.
 */
export type { ExecutionEnv, ExecOptions, FileInfo, FileKind } from "../kernel/loop/env.ts";

export { requireEnv } from "../tools/env.ts";

/** Shared truncation helpers so tool output notices read identically to `read` and `bash`. */
export { truncateHead, formatSize, type TruncationResult } from "../tools/support/truncate.ts";

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
  ToolCall,
  ToolCallOutcome,
  ToolDefinition,
  ToolRun,
} from "../kernel/loop/types.ts";

export { toJsonValue } from "@nyte-ai/client";

/** Skills are plugin contributions; the built-in `skills` plugin reads them. */
export { formatSkillInvocation } from "./builtin/skills-index.ts";
