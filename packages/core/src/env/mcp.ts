import type { WorkspaceId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { McpApi, McpHub, McpWorkspace } from "../contract/workspace.ts";
import { SdkError } from "../util/error.ts";
import { readWorkspace } from "./environment.ts";
import { projectTrust } from "./trust.ts";

/**
 * Reads what a hub needs to know about a registered workspace: its local
 * folder and whether its project resources are trusted. Throws `unknown` for
 * a workspace the host does not have.
 *
 * @category mcp
 * @since 0.1.0
 */
export async function readMcpWorkspace(kernel: Kernel, id: WorkspaceId): Promise<McpWorkspace> {
  const record = await readWorkspace(kernel, id);

  if (record === null) throw new SdkError("unknown", `Workspace ${id} is not registered.`);
  const { target } = record;

  return {
    id,
    root: target.kind === "local" && "path" in target ? target.path : null,
    trusted: (await projectTrust(kernel, record)) === true,
  };
}

/** The `workspace(id).mcp` of a workspace on this kernel, over its hub. */
export function mcpApi(kernel: Kernel, id: WorkspaceId): McpApi {
  const hub = (): McpHub => {
    if (kernel.mcp === null) throw new SdkError("unavailable", "This host has no MCP servers.");

    return kernel.mcp;
  };

  const act = async <T>(run: (hub: McpHub, workspace: McpWorkspace) => Promise<T>): Promise<T> =>
    run(hub(), await readMcpWorkspace(kernel, id));

  return {
    async *watch() {
      yield* hub().watch(await readMcpWorkspace(kernel, id));
    },
    reconnect: (server) => act((mcp, workspace) => mcp.reconnect(workspace, server)),
    setEnabled: (server, enabled) =>
      act((mcp, workspace) => mcp.setEnabled(workspace, server, enabled)),
    login(server) {
      const login = act(async (mcp, workspace) => mcp.login(workspace, server));

      return {
        async *steps() {
          yield* (await login).steps();
        },
        answer: async (code) => (await login).answer(code),
      };
    },
    logout: (server) => act((mcp, workspace) => mcp.logout(workspace, server)),
    add: (server, config, scope) =>
      act((mcp, workspace) => mcp.add(workspace, server, config, scope)),
    remove: (server, scope) => act((mcp, workspace) => mcp.remove(workspace, server, scope)),
  };
}
