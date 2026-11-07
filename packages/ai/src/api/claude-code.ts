import type { Tool } from "../types.ts";

export const claudeCodeVersion = "2.1.280";

/**
 * Claude Code 2.x tool names, PascalCase as Claude Code sends them.
 * Source: https://cchistory.mariozechner.at/data/prompts-2.1.11.md
 * To update: https://github.com/badlogic/cchistory
 */
const claudeCodeTools = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "KillShell",
  "NotebookEdit",
  "Skill",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
];

const ccToolLookup = new Map(claudeCodeTools.map((t) => [t.toLowerCase(), t]));

export const toClaudeCodeName = (name: string) => ccToolLookup.get(name.toLowerCase()) ?? name;

export const fromClaudeCodeName = (name: string, tools?: Tool[]) => {
  if (tools && tools.length > 0) {
    const lowerName = name.toLowerCase();
    const matchedTool = tools.find((tool) => tool.name.toLowerCase() === lowerName);

    if (matchedTool) return matchedTool.name;
  }

  return name;
};

export function usesClaudeSubscription(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}
