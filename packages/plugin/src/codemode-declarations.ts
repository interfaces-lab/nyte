import type { CodemodeTool } from "@earendil-works/pi-codemode";
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

export const CODEMODE_DESCRIPTION = `Run JavaScript that calls other tools. The \`code\` parameter contains JavaScript without a code fence, run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. Calls still running when the script ends are cancelled.
- Optional first line: \`// @options: {"max_output_tokens": 10000, "timeout_ms": 60000}\`

Globals:
- \`text(value)\`, \`image(dataUrlOrImageBlock)\`, \`console.log(...)\`, and top-level \`return\` add output; \`exit()\` ends the script.
- \`store(key, value)\` and \`load(key)\` keep JSON values across codemode calls on this branch. Only successful scripts save writes.
- \`ALL_TOOLS\`, \`searchTools(query, { limit?, namespace? })\`, \`describeTool(name)\`, \`describeNamespace(name)\`: find tools and their declarations, such as MCP tools.`;
