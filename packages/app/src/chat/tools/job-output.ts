import type { JobView, SessionId } from "@nyte-ai/sdk";
import type { HostState } from "../../contract/nyte.ts";
import { keys, queryClient } from "../../data/query-client.ts";
import { readDeferred } from "../../lib/deferred.tsx";
import { workbenchController } from "../../workbench/controller.ts";
import { workbenchViewKey } from "../../workbench/model.ts";
import { openJobTerminal } from "../../workbench/terminal/terminal-store.ts";

/**
 * Opens a job's output in a workbench terminal and focuses it: a running job's live output, or
 * what an ended one wrote. `session` is the chat that started the job.
 */
export function openJobOutput(session: SessionId, job: JobView): void {
  const path = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;

  const terminal = openJobTerminal({
    controller: workbenchController,
    view: workbenchViewKey(path),
    sessionId: session,
    job,
  });

  readDeferred("workbench")?.focusTerminal(terminal);
}
