import type { ProjectId, ProjectInfo, WorkspaceId } from "@nyte-ai/schema";
import type { Plugin } from "../contract/plugin.ts";
import type { McpHub, McpServerBrief, McpWorkspace } from "../contract/workspace.ts";

const SUMMARY_CHARS = 250;

const SECTION_CHARS = 4096;

export function mcpPlugin(
  hub: McpHub,
  readWorkspace: (id: WorkspaceId) => Promise<McpWorkspace>,
  readProject: (id: ProjectId) => Promise<Pick<ProjectInfo, "disabledMcp">>,
): Plugin<"core"> {
  return {
    id: "mcp",
    async activate(api) {
      const info = await api.session.info();
      const workspace = await readWorkspace(info.workspace);

      const disabled = new Set(
        info.project === undefined ? [] : (await readProject(info.project)).disabledMcp,
      );

      if (api.signal.aborted) return;

      api.contribute.tools.add((draft) => {
        for (const tool of hub.tools(workspace))
          if (!disabled.has(tool.name.split("__")[1] ?? "")) draft.set(tool.name, tool);
      });

      api.contribute.prompt.add((draft) => {
        const text = describeServers(
          hub.briefs(workspace).filter((brief) => !disabled.has(brief.name)),
        );

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

type ServerLine = {
  readonly head: string;
  readonly reach: "direct" | "codemode" | "tool_search" | null;
  readonly summary: string;
};

function describeServers(briefs: readonly McpServerBrief[]): string | null {
  const servers = briefs.flatMap((brief): readonly ServerLine[] => {
    if (brief.unavailable === "failed")
      return [
        {
          head: `- ${brief.name}: not connected; it failed to start, so it has no tools here. Tell the user when the task needs it.`,
          reach: null,
          summary: "",
        },
      ];

    if (brief.unavailable === "needs-sign-in")
      return [
        {
          head: `- ${brief.name}: not connected; the user has to sign in to it in the MCP settings before its tools appear.`,
          reach: null,
          summary: "",
        },
      ];
    const reach = brief.exposures.includes("code")
      ? "codemode"
      : brief.exposures.includes("deferred")
        ? "tool_search"
        : brief.exposures.includes("model")
          ? "direct"
          : null;

    if (reach === null) return [];
    const [summary = ""] = (brief.description?.trim() || brief.instructions?.trim() || "").split(
      "\n",
    );

    return [{ head: `- ${brief.name} (${reach})`, reach, summary: summary.trim() }];
  });

  if (servers.length === 0) return null;
  const reaches = new Set(servers.map((server) => server.reach));

  const intro = [
    "MCP servers in this workspace. Their tools are named mcp__<server>__<tool>.",
    ...(reaches.has("direct") ? ["The tools of `direct` servers are declared to you."] : []),
    ...(reaches.has("codemode")
      ? ["Call the tools of `codemode` servers from codemode scripts; `searchTools()` finds them."]
      : []),
    ...(reaches.has("tool_search")
      ? ["Load the tools of `tool_search` servers with `tool_search`."]
      : []),
    ...(servers.some((server) => server.reach !== null)
      ? ['`describeNamespace("<server>")` in a codemode script returns a server\'s instructions.']
      : []),
  ].join(" ");

  const omitted = (count: number): readonly string[] =>
    count > 0 ? [`- … ${count} more server${count === 1 ? "" : "s"}`] : [];

  const size = (kept: number): number =>
    [
      intro,
      ...servers.slice(0, kept).map((server) => server.head),
      ...omitted(servers.length - kept),
    ].join("\n").length;

  let kept = servers.length;

  while (kept > 0 && size(kept) > SECTION_CHARS) kept -= 1;
  const room =
    kept === 0 ? 0 : Math.min(SUMMARY_CHARS, Math.floor((SECTION_CHARS - size(kept)) / kept) - 2);

  return [
    intro,
    ...servers.slice(0, kept).map((server) => {
      const summary =
        server.summary.length <= room
          ? server.summary
          : room <= 1
            ? ""
            : `${server.summary.slice(0, room - 1).trimEnd()}…`;

      return summary === "" ? server.head : `${server.head}: ${summary}`;
    }),
    ...omitted(servers.length - kept),
  ].join("\n");
}
