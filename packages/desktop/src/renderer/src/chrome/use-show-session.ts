/**
 * Opening a chat from somewhere other than the sidebar.
 *
 * A chat lives in a folder, so showing one means making that folder current
 * first, handing the pane controller the selection, and only then routing.
 * The sidebar and Settings › Usage both need that sequence; keeping one copy
 * is what stops a usage row from opening a chat differently than the list does.
 */
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import type { SessionId } from "@nyte-ai/core";
import { activePane } from "../layout/pane-layout.ts";
import { paneControllerForWorkspace } from "../layout/pane-context.tsx";
import { nyte } from "../nyte.ts";
import { commitHostWorkspace, keys, queryClient } from "../queries.ts";
import type { HostState } from "../nyte.ts";
import { handleOpenOutcome } from "./open-workspace.tsx";
import { shellActions } from "./shell-state.ts";

/**
 * Make a folder current. Returns false when the reader declined or trust failed.
 *
 * The host answers as soon as it has switched; the stage rebinds to the
 * folder's panes on that answer. The `workspace_opened` event the host sends
 * with it refills the folder's caches behind the mounted screen, so a switch
 * never waits on a directory read or a plugin activation.
 */
export async function activateWorkspace(path: string | null): Promise<boolean> {
  const current = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path ?? null;
  if (path === current) return true;
  if (path === null) {
    await nyte.host.closeWorkspace();
    commitHostWorkspace(undefined);
    return true;
  }
  const outcome = await nyte.host.openWorkspace({ path });
  handleOpenOutcome(outcome);
  if (outcome.kind !== "opened") return false;
  commitHostWorkspace(outcome.workspace);
  return true;
}

export function useShowSession(): (
  path: string | null,
  sessionId: SessionId,
  beside?: boolean,
) => Promise<void> {
  const router = useRouter();
  return useCallback(
    async (path: string | null, sessionId: SessionId, beside = false): Promise<void> => {
      if (!(await activateWorkspace(path))) return;
      const controller = paneControllerForWorkspace(path ?? undefined);
      if (beside) {
        controller.drop(sessionId, activePane(controller.getSnapshot().layout).id, "right");
      } else {
        controller.selectSession(sessionId);
      }
      shellActions.showWorkspace();
      await router.navigate({ to: "/session/$sessionId", params: { sessionId } });
    },
    [router],
  );
}
