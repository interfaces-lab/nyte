import { Type } from "typebox";
import { enabledModels, matchModels, standard } from "@nyte-ai/schema";
import type { ConfigurationPatch, Infer, ToolResult, WorkspaceId } from "@nyte-ai/schema";
import type { ToolDefinition, ToolInvocation } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/plugin/core";

const LIST_LIMIT = 20;

const startParameters = standard(
  Type.Object({
    prompt: Type.String(),
    title: Type.Optional(Type.String({ description: "Sidebar name." })),
    workspace: Type.Optional(
      Type.String({ description: "Workspace id or folder path from `thread_list`." }),
    ),
    model: Type.Optional(
      Type.String({ description: "provider/id. Only when the user asks for one." }),
    ),
    isolation: Type.Optional(
      Type.Literal("worktree", {
        description: "Own git worktree on a new branch. Only when the user asks for one.",
      }),
    ),
  }),
);

const listParameters = standard(
  Type.Object({
    query: Type.Optional(Type.String({ description: "Match chat names." })),
    everywhere: Type.Optional(Type.Boolean({ description: "Every folder, not only yours." })),
  }),
);

const start: ToolDefinition<Infer<typeof startParameters>> = {
  name: "thread_start",
  description:
    "Start a top-level chat. Not delegation: it doesn't report back. `prompt` is all it knows. Omit `workspace` and `model` to inherit yours. Follow it with `await` or `read_agent`.",
  parameters: startParameters,
  class: (args) => ({
    kind: "custom",
    label: args.title === undefined ? "Starting chat" : `Starting chat: ${args.title}`,
  }),
  effects: "none",
  approval: "never",
  replay: "safe",
  async execute(args, invocation) {
    const started = await invocation.sdk.sessions.start({
      name: args.title,
      workspace:
        args.workspace === undefined
          ? (await invocation.session.info()).workspace
          : await findWorkspace(invocation, args.workspace),
      configuration: await startConfiguration(invocation, args.model),
      isolation: args.isolation,
      content: args.prompt,
    });

    return reply(`Started chat ${started.session.id}.`);
  },
};

const list: ToolDefinition<Infer<typeof listParameters>> = {
  name: "thread_list",
  description: "List other top-level chats, newest first, in this folder unless `everywhere`.",
  parameters: listParameters,
  class: () => ({ kind: "custom", label: "Listing chats" }),
  effects: "none",
  approval: "never",
  replay: "safe",
  async execute(args, invocation) {
    const own = await invocation.session.info();
    const workspaces = await invocation.sdk.workspaces.list();
    const page = await invocation.sdk.sessions.list({ parents: { kind: "roots" }, limit: 200 });
    const query = args.query?.toLowerCase();

    const rows = page.items
      .filter(
        (info) =>
          !info.archived &&
          info.id !== own.id &&
          (args.everywhere === true || info.workspace === own.workspace) &&
          (query === undefined || (info.name ?? "").toLowerCase().includes(query)),
      )
      .slice(0, LIST_LIMIT)
      .map((info) => {
        const workspace = workspaces.find((entry) => entry.id === info.workspace);

        const folder =
          workspace !== undefined && "path" in workspace.target
            ? workspace.target.path
            : info.workspace;

        return `- ${info.id} "${info.name ?? "untitled"}" in ${folder}, ${info.heads.some((head) => head.execution.kind !== "idle") ? "working" : "idle"}, active ${new Date(info.lastActivityAt).toISOString()}`;
      });

    return reply(rows.length === 0 ? "No other chats match." : rows.join("\n"));
  },
};

export default {
  id: "threads",
  async activate(api) {
    if ((await api.session.info()).parent !== null) return;

    for (const definition of [start, list]) api.contribute.tools.add(definition);
  },
} satisfies Plugin;

async function findWorkspace(invocation: ToolInvocation, name: string): Promise<WorkspaceId> {
  const workspaces = await invocation.sdk.workspaces.list();

  const found = workspaces.find(
    (workspace) =>
      workspace.id === name || ("path" in workspace.target && workspace.target.path === name),
  );

  if (found !== undefined) return found.id;

  throw new Error(
    `No workspace on this host is ${name}. Open the folder in Nyte first, or pass one of:\n${workspaces
      .map((workspace) => `- ${"path" in workspace.target ? workspace.target.path : workspace.id}`)
      .join("\n")}`,
  );
}

async function startConfiguration(
  invocation: ToolInvocation,
  model: string | undefined,
): Promise<ConfigurationPatch | undefined> {
  const effective = (await invocation.session.head(invocation.head).view({ tail: 0 })).configuration
    .effective;

  if (model === undefined)
    return effective === null
      ? undefined
      : { model: effective.model, thinking: effective.thinking };

  const matches = matchModels(enabledModels(await invocation.sdk.models.list()), model);
  const [only, ...others] = matches;

  if (only !== undefined && others.length === 0) return { model: only };

  throw new Error(
    only === undefined
      ? `No enabled model is ${model}.`
      : `${model} names more than one model; pass one of ${matches.map((ref) => `${ref.provider}/${ref.id}`).join(", ")}.`,
  );
}

function reply(content: string): ToolResult<unknown> {
  return { content: [{ kind: "text", text: content }] };
}
