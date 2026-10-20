import { nyte } from "../nyte.ts";
import { commitHostWorkspace, keys, queryClient } from "../queries.ts";
import type { HostState } from "../nyte.ts";
import { handleOpenOutcome } from "./open-workspace.tsx";

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
