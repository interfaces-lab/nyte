/**
 * The CLI's stock agents: `general`, a delegate with the parent's own tools,
 * and `explore`, a read-only delegate for finding things. Both use
 * `mode: "subagent"`, so a parent's `task` tool lists them and the user's
 * picker does not. The declarations live in core because runs consume them;
 * a host decides whether to install the plugin.
 *
 * Based on https://github.com/anomalyco/opencode/blob/bd54dc508f940e71aa07cd07a43ce57889c60a97/packages/core/src/plugin/agent.ts
 */
import { definePlugin, type Agent } from "../types.ts";

export const STOCK_AGENTS_PLUGIN_ID = "stock-agents";

const EXPLORE_PROMPT = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Listing directories to map a codebase quickly
- Reading and analyzing file contents
- Answering questions about how code is organized

Guidelines:
- Use ls to find files and map directories; use read when you know the path
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- You cannot create files or run commands; report what you found and stop

Complete the user's search request efficiently and report your findings clearly.`;

/** The tools `explore` may call. A host that lacks one skips it. */
export const EXPLORE_TOOLS = ["read", "ls", "websearch"] as const;

export const GENERAL_AGENT: Agent = {
  id: "general",
  mode: "subagent",
  description:
    "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.",
};

export const EXPLORE_AGENT: Agent = {
  id: "explore",
  mode: "subagent",
  description:
    'Fast agent specialized for exploring codebases. Use this when you need to quickly find files, answer questions about the codebase (eg. "how do API endpoints work?"), or map a directory. It reads and lists; it never edits or runs commands. When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
  system: EXPLORE_PROMPT,
  tools: [...EXPLORE_TOOLS],
};

export function stockAgentsPlugin() {
  return definePlugin({
    id: STOCK_AGENTS_PLUGIN_ID,
    session(api) {
      api.agents.add((draft) => {
        draft.set(GENERAL_AGENT.id, GENERAL_AGENT);
        draft.set(EXPLORE_AGENT.id, EXPLORE_AGENT);
      });
    },
  });
}
