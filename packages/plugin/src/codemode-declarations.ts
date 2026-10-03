import type { CodemodeTool } from "@earendil-works/pi-codemode";
import {
  renderToolOutputType,
  toCodemodeIdentifier,
} from "@earendil-works/pi-codemode/declarations";
import type { AgentTool } from "@nyte-ai/core/plugins";

export const CODEMODE_TOOL_NAME = "codemode";

export function toCodemodeDeclaration(tool: AgentTool): Omit<CodemodeTool, "execute"> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { ...tool.parameters },
    outputSchema: tool.outputSchema ? { ...tool.outputSchema } : { type: "string" },
  };
}

/**
 * One line of the prompt: what a call of `tool` resolves to in a script. A
 * described property renders on its own line under a `//` comment; the prompt
 * names the shape and leaves the documentation to the tool's declaration.
 */
function renderResolution(tool: AgentTool): string {
  const output = renderToolOutputType(toCodemodeDeclaration(tool).outputSchema)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("//"))
    .join(" ");
  const resolves = output === "string" ? "a string" : `\`${output}\``;

  return `- \`tools.${toCodemodeIdentifier(tool.name)}(args)\` resolves to ${resolves}.`;
}

/**
 * The prompt section: pi's guidance on when to script, then how each tool the
 * model sees declared on its own resolves, so it can batch, chain, and filter them.
 */
export function renderCodemodeInstructions(tools: readonly AgentTool[]): string {
  return [
    "<codemode>",
    "Use codemode to batch independent tool calls (Promise.allSettled), chain them, or filter large output, instead of many separate calls.",
    ...tools
      .filter((tool) => tool.exposure === undefined || tool.exposure === "direct")
      .map(renderResolution),
    "</codemode>",
  ].join("\n");
}

export const CODEMODE_DESCRIPTION = `Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. Calls still running when the script ends are cancelled.
- Optional first line: \`// @options: {"max_output_tokens": 10000, "timeout_ms": 60000}\`

Globals:
- \`text(value)\`, \`image(dataUrlOrImageBlock)\`, \`console.log(...)\`, and top-level \`return\` add output; \`exit()\` ends the script.
- \`store(key, value)\` and \`load(key)\` keep JSON values across codemode calls on this branch. Only successful scripts save writes.
- \`ALL_TOOLS\`, \`searchTools(query, { limit?, namespace? })\`, \`describeTool(name)\`, \`describeNamespace(name)\`: find tools and their declarations, such as MCP tools.`;
