import type { WorkspaceId } from "@nyte-ai/schema";
import type { Plugin } from "../contract/plugin.ts";
import type { McpHub, McpServerBrief, McpWorkspace } from "../contract/workspace.ts";

const INSTRUCTIONS_CHARS = 4000;

/**
 * Puts the hub's tools for the session's workspace in the session, tells the
 * model each server's instructions and which servers are unavailable, and
 * reloads the session whenever they change.
 */
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

      api.contribute.prompt.add((draft) => {
        const text = describeServers(hub.briefs(workspace));

        if (text !== null) draft.set("mcp", { id: "mcp", order: 95, text });
      });

      const changes = hub.watch(workspace)[Symbol.asyncIterator]();
      api.signal.addEventListener("abort", () => void changes.return?.());

      void (async () => {
        try {
          for (let next = await changes.next(); next.done !== true; next = await changes.next())
            api.reload();
        } catch (error) {
          if (api.signal.aborted) return;
          api.report({
            severity: "warning",
            path: ["mcp"],
            message: `MCP updates stopped: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      })();
    },
  };
}

function describeServers(briefs: readonly McpServerBrief[]): string | null {
  const told = briefs.flatMap((brief) => {
    if (brief.unavailable === "failed")
      return [
        `## ${brief.name}\nNot connected: it failed to start, so it has no tools here. Tell the user when the task needs it.`,
      ];

    if (brief.unavailable === "needs-sign-in")
      return [
        `## ${brief.name}\nNot connected: the user has to sign in to it in the MCP settings before its tools appear.`,
      ];
    const instructions = brief.instructions?.trim() ?? "";

    if (instructions === "") return [];

    return [
      `## ${brief.name}\n${instructions.length > INSTRUCTIONS_CHARS ? `${instructions.slice(0, INSTRUCTIONS_CHARS)}…` : instructions}`,
    ];
  });

  if (told.length === 0) return null;

  return [
    "MCP servers in this workspace. Their tools are named mcp__<server>__<tool>.",
    ...told,
  ].join("\n\n");
}
