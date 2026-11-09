import { asId } from "@nyte-ai/schema";
import type { ProjectInfo } from "@nyte-ai/schema";
import { composerMessageContent, startComposerChat } from "../chat/composer/composer-send.ts";
import { connected } from "../data/connection.ts";
import { queryClient } from "../data/query-client.ts";
import { workspacePath, workspacesQuery } from "../data/workspaces.ts";
import { activateWorkspace } from "../sidebar/use-show-session.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

export async function startProjectChat(project: ProjectInfo, goal: string): Promise<void> {
  const workspaces = await queryClient.fetchQuery(workspacesQuery);
  const folder = workspaces.find((workspace) => workspace.id === project.workspace);
  const path = folder === undefined ? null : workspacePath(folder);

  if (path === null || !(await activateWorkspace(path))) return;
  const first = goal.trim();

  if (first === "") {
    windowTabs.newChat(project.id);

    return;
  }

  const id = asId<"session">(crypto.randomUUID());
  const connection = await connected();

  await startComposerChat(
    connection,
    { id, workspace: project.workspace, project: project.id, name: project.name },
    {
      kind: "message",
      content: composerMessageContent([{ kind: "text", text: first }], []),
      delivery: "queue",
    },
  );
  windowTabs.openChat(id, "permanent");
}
