import type { JobView, SessionId } from "@nyte-ai/sdk";
import { chatFolderPath } from "../../chats/index.ts";
import { findSessionRow } from "../../data/session-rows.ts";
import { readDeferred } from "../../lib/deferred.tsx";
import { openJobTerminal } from "../../workbench/commands.ts";
import { workbenchViewKey } from "../../workbench/paths.ts";

export function openJobOutput(session: SessionId, job: JobView): void {
  const workspace = findSessionRow(session)?.workspace;

  if (workspace === undefined) return;

  const terminal = openJobTerminal(
    workbenchViewKey(chatFolderPath(session) ?? undefined),
    workspace,
    job,
  );

  readDeferred("workbench")?.focusTerminal(terminal);
}
