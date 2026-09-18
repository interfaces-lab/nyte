/**
 * The renderer's one outbox over the bridge. A receipt is followed by one
 * coherent snapshot read, so the durable pending row is on screen before the
 * local row leaves and the gutter never blinks.
 */
import { useSyncExternalStore } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import {
  createOutbox,
  HOME_WORKSPACE_PARTITION,
  type OutboxRow,
  workspacePartition,
} from "./outbox.ts";
import { createIndexedDbOutboxStorage } from "./outbox-storage.ts";
import { loadThread } from "./live.ts";
import { requestTrust } from "./chrome/open-workspace.tsx";
import { nyte } from "./nyte.ts";

export const outbox = createOutbox({
  storage: createIndexedDbOutboxStorage(),
  send: (input) => nyte.messages.send(input),
  settled: async (sessionId) => {
    // The message is durable; if the folder is untrusted it waits there, so ask now.
    const snapshot = await loadThread(sessionId);
    requestTrust(snapshot.session.activation);
  },
});

export function activateOutbox(workspacePath: string | undefined): Promise<void> {
  return outbox.activate(
    workspacePath === undefined ? HOME_WORKSPACE_PARTITION : workspacePartition(workspacePath),
  );
}

export function useOutboxRows(sessionId: SessionId): readonly OutboxRow[] {
  const rows = useSyncExternalStore(outbox.subscribe, outbox.rows);
  return rows.filter((row) => row.sessionId === sessionId);
}
