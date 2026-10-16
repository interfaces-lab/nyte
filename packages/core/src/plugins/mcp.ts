import type { WorkspaceId } from "@nyte-ai/schema";
import type { McpHub, McpWorkspace } from "../mcp.ts";
import type { Plugin } from "../plugin.ts";

/** Puts the hub's tools for the session's workspace in the session and reloads the session whenever they change. */
export function mcpPlugin(
  hub: McpHub,
  readWorkspace: (id: WorkspaceId) => Promise<McpWorkspace>,
): Plugin<"core"> {
  return {
    id: "mcp",
    async activate(api) {
      const workspace = await readWorkspace((await api.session.info()).workspace);

      if (api.signal.aborted) return;

      api.contribute.tools.add((draft) => {
        for (const tool of hub.tools(workspace)) draft.set(tool.name, tool);
      });

      const changes = hub.watch(workspace)[Symbol.asyncIterator]();
      api.signal.addEventListener("abort", () => void changes.return?.());

      void (async () => {
        for (let next = await changes.next(); next.done !== true; next = await changes.next())
          api.reload();
      })().catch((error: unknown) => {
        if (api.signal.aborted) return;
        api.report({
          severity: "warning",
          path: ["mcp"],
          message: `MCP updates stopped: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
    },
  };
}
