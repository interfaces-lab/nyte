import { nyte } from "../contract/nyte.ts";
import { commitHostWorkspace } from "../data/workspaces.ts";
import { keys, queryClient } from "../data/query-client.ts";
import type { HostState } from "../contract/nyte.ts";
import { handleOpenOutcome } from "../panes/open-workspace.tsx";

export async function activateWorkspace(path: string | null): Promise<boolean> {
  const current = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path ?? null;

  if (path === current) return true;

  if (path === null) {
    commitHostWorkspace(undefined);

    return true;
  }

  const outcome = await nyte.host.openWorkspace({ path });
  handleOpenOutcome(outcome);

  return outcome.kind === "opened";
}
