import type { JobView, SessionId } from "@nyte-ai/sdk";
import type { HostState } from "../../contract/nyte.ts";
import { keys, queryClient } from "../../data/query-client.ts";
import { findSessionRow } from "../../data/session-rows.ts";
import { readDeferred } from "../../lib/deferred.tsx";
import { openJobTerminal } from "../../workbench/commands.ts";
import { workbenchViewKey } from "../../workbench/paths.ts";

export function openJobOutput(session: SessionId, job: JobView): void {
  const workspace = findSessionRow(session)?.workspace;

  if (workspace === undefined) return;
  const path = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
  const terminal = openJobTerminal(workbenchViewKey(path), workspace, job);

  readDeferred("workbench")?.focusTerminal(terminal);
}
