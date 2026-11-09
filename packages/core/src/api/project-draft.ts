import { SdkError, standard } from "@nyte-ai/schema";
import type {
  Infer,
  McpServerView,
  ProjectDraft,
  ProjectDraftInput,
  WorkspaceId,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Kernel } from "../contract/kernel.ts";
import type { Resources } from "../contract/workspace.ts";
import { readMcpWorkspace } from "../env/mcp.ts";
import { scanWorkspaceResources } from "../extend/resources.ts";
import { workspaceRef } from "../store/refs.ts";

const DRAFT_SYSTEM = `You set up a project in a code folder from the user's goal. A project is one coordinator chat that plans the work and starts agents. Every chat in the project reads its instructions, its preloaded skills, its MCP servers and its shared docs.

From the goal and the folder's lists, choose:
- name: two to four words in sentence case that name the work, such as "Settings polish".
- instructions: a few short imperative lines every chat in the project should follow for this goal, such as what stays out of scope, which checks to run before reporting and how to show the result. Don't restate the goal or the folder's own rules files.
- skills: the skills whose descriptions clearly bear on the goal. Each one fills every chat's context, so leave out weak matches.
- mcp: the MCP servers the goal needs.
- docs: the ids of the shared docs worth reading for this goal.

Use only names and ids from the lists, exactly as written. An empty list is a fine answer.`;

const MAX_NAME = 80;

const answerSchema = standard(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    instructions: Type.String(),
    skills: Type.Array(Type.String()),
    mcp: Type.Array(Type.String()),
    docs: Type.Array(Type.String()),
  }),
);

export async function draftProject(
  kernel: Kernel,
  input: ProjectDraftInput,
): Promise<ProjectDraft> {
  if ((await kernel.store.refs.get(workspaceRef(input.workspace))) === null)
    throw new SdkError("unknown", `Workspace ${input.workspace} is not registered on this host.`);

  const [resources, servers] = await Promise.all([
    scanWorkspaceResources(kernel, input.workspace),
    mcpServers(kernel, input.workspace),
  ]);

  const outcome = await kernel.request(null, {
    model: input.model,
    system: DRAFT_SYSTEM,
    messages: [
      {
        role: "user",
        content: draftPrompt(input.goal, resources, servers),
        timestamp: Date.now(),
      },
    ],
    output: answerSchema,
    maxOutput: 2_000,
  });

  if (outcome.kind === "refused") throw new SdkError("unavailable", outcome.reason);

  if (outcome.kind === "failed") throw new SdkError("unavailable", outcome.failure.message);

  return keepKnown(outcome.value, resources, servers);
}

async function mcpServers(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<readonly McpServerView[]> {
  if (kernel.mcp === null) return [];

  for await (const view of kernel.mcp.watch(await readMcpWorkspace(kernel, workspace)))
    return view.servers;

  return [];
}

function draftPrompt(
  goal: string,
  resources: Resources,
  servers: readonly McpServerView[],
): string {
  const list = (tag: string, lines: readonly string[]): string =>
    `<${tag}>\n${lines.length === 0 ? "(none)" : lines.join("\n")}\n</${tag}>`;

  return [
    `<goal>\n${goal.trim()}\n</goal>`,
    list(
      "skills",
      resources.skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    ),
    list(
      "mcp",
      servers.map((server) => `- ${server.name}: ${server.description ?? ""}`),
    ),
    list(
      "docs",
      resources.docs.map((doc) => `- ${doc.id}: ${doc.name}. ${doc.description}`),
    ),
  ].join("\n\n");
}

function keepKnown(
  answer: Infer<typeof answerSchema>,
  resources: Resources,
  servers: readonly McpServerView[],
): ProjectDraft {
  const skills = new Set(resources.skills.map((skill) => skill.name));

  return {
    name: answer.name.trim().slice(0, MAX_NAME) || "New project",
    instructions: answer.instructions.trim(),
    skills: [...new Set(answer.skills)].filter((name) => skills.has(name)),
    disabledMcp: servers.flatMap((server) =>
      answer.mcp.includes(server.name) ? [] : [server.name],
    ),
    disabledDocs: resources.docs.flatMap((doc) => (answer.docs.includes(doc.id) ? [] : [doc.id])),
  };
}
