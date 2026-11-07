import type { ProjectInfo } from "@nyte-ai/schema";
import { queryClient } from "../data/query-client.ts";
import { workspacePath, workspacesQuery } from "../data/workspaces.ts";
import { activateWorkspace } from "../sidebar/use-show-session.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

/** Shows the project's chat, or a new chat in its folder that becomes it on the first message. */
export async function openProject(project: ProjectInfo): Promise<void> {
  if (project.coordinator !== null) {
    windowTabs.openChat(project.coordinator, "permanent");

    return;
  }

  const workspaces = await queryClient.fetchQuery(workspacesQuery);
  const folder = workspaces.find((workspace) => workspace.id === project.workspace);
  const path = folder === undefined ? null : workspacePath(folder);

  if (path === null || !(await activateWorkspace(path))) return;
  windowTabs.newChat(project.id);
}
