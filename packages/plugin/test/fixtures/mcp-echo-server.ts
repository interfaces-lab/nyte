/** A stdio MCP server with one `echo` tool, run as a child process by the MCP tests. */
import { writeFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Given a path, the server records its pid there so a test can watch it exit.
const pidFile = process.argv[2];
if (pidFile !== undefined) writeFileSync(pidFile, String(process.pid));

const server = new McpServer(
  { name: "echo", version: "0" },
  { instructions: "Echo repeats what it is told." },
);
server.registerTool(
  "echo",
  {
    description: "Repeat the text",
    inputSchema: { text: z.string() },
    outputSchema: { text: z.string() },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text}`, _meta: { block: true } }],
    structuredContent: { text: `echo: ${text}` },
    _meta: { private: true },
  }),
);
server.registerTool("fail", { description: "Always fails", inputSchema: {} }, async () => ({
  isError: true,
  content: [{ type: "text", text: "no" }],
  structuredContent: { reason: "no" },
  _meta: { private: true },
}));
// Stray logging must not corrupt the host's terminal; the client pipes it.
process.stderr.write("echo server starting\n");
await server.connect(new StdioServerTransport());
