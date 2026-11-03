import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { ServerHost } from "@nyte-ai/core/server";
import { createMcpEndpoint } from "./endpoint.ts";
import { openMcpGrants } from "./grants.ts";
import type { McpOwner } from "./grants.ts";
import { MCP_PATH, serveOAuth } from "./oauth.ts";

/** Nyte's MCP server for outside agents, apart from the MCP client in `mcp/` that connects a workspace's servers. */
export interface McpServer extends McpOwner {
  /** Answers `/mcp`, the OAuth routes and their metadata, or null for any other path. */
  serve(request: Request): Promise<Response | null>;
}

/** Opens the MCP server of a host whose state lives under `home`: grants in `<home>/.nyte/mcp-grants.json`, the host as its own authorization server. */
export function openMcpServer(options: {
  readonly server: ServerHost;
  readonly home: string;
  readonly version: string;
}): McpServer {
  const grants = openMcpGrants(join(options.home, ".nyte", "mcp-grants.json"));
  const endpoint = createMcpEndpoint({ server: options.server, grants, version: options.version });

  return {
    serve: (request) =>
      new URL(request.url).pathname === MCP_PATH
        ? endpoint.serve(request)
        : serveOAuth(request, grants),
    approve: (input) => grants.approve(input),
    deny: (input) => grants.deny(input),
    list: () => grants.list(),
    revoke: async (input) => {
      await grants.revoke(input);
      options.server.connections.revoke(asId<"principal">(`mcp:${input.id}`));
    },
  };
}
