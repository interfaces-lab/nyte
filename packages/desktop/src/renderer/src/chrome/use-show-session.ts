/**
 * Opening a chat from somewhere other than the sidebar.
 *
 * A chat lives in a folder, so showing one means making that folder current
 * first. Keeping one copy of that step is what stops a usage row from opening
 * a chat differently than the list does.
 */
import { nyte } from "../nyte.ts";
import { commitHostWorkspace, keys, queryClient } from "../queries.ts";
import type { HostState } from "../nyte.ts";
import { handleOpenOutcome } from "./open-workspace.tsx";

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
