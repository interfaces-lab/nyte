/** A stdio MCP server with one `echo` tool, run as a child process by the MCP tests. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "echo", version: "0" },
  { instructions: "Echo repeats what it is told." },
);
server.registerTool(
  "echo",
  {
    description: "Repeat the text",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
);
server.registerTool("fail", { description: "Always fails", inputSchema: {} }, async () => ({
  isError: true,
  content: [{ type: "text", text: "no" }],
}));
// Stray logging must not corrupt the host's terminal; the client pipes it.
process.stderr.write("echo server starting\n");
await server.connect(new StdioServerTransport());
