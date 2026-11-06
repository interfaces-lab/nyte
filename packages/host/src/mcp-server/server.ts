import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { ServerHost } from "@nyte-ai/core/server";
import { createClientDirectory, fetchClientMetadata } from "./client-metadata.ts";
import type { ClientMetadataFetch } from "./client-metadata.ts";
import { createMcpEndpoint } from "./endpoint.ts";
import { openMcpGrants } from "./grants.ts";
import type { McpOwner } from "./grants.ts";
import { MCP_PATH, serveOAuth } from "./oauth.ts";

export interface McpService extends McpOwner {
  serve(request: Request, origins: readonly string[]): Promise<Response | null>;
}

export function openMcpServer(options: {
  readonly server: ServerHost;
  readonly home: string;
  readonly version: string;
  readonly fetchClientMetadata?: ClientMetadataFetch;
}): McpService {
  const grants = openMcpGrants(join(options.home, ".nyte", "mcp-grants.json"));
  const clients = createClientDirectory(options.fetchClientMetadata ?? fetchClientMetadata);
  const endpoint = createMcpEndpoint({ server: options.server, grants, version: options.version });

  return {
    serve: (request, origins) =>
      new URL(request.url).pathname === MCP_PATH
        ? endpoint.serve(request, origins)
        : serveOAuth(request, grants, clients),
    approve: (input) => grants.approve(input),
    deny: (input) => grants.deny(input),
    list: () => grants.list(),
    revoke: async (input) => {
      await grants.revoke(input);
      options.server.connections.revoke(asId<"principal">(`mcp:${input.id}`));
    },
  };
}
