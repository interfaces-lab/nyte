/**
 * The renderer's one outbox over the bridge, stored per workspace. A row leaves
 * once the observer draws the durable message under the same key.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { createOutbox, type OutboxRow } from "@nyte-ai/client";
import { createIndexedDbOutboxStorage } from "./outbox-storage.ts";
import { optimisticSessionIds } from "./session-activity.ts";
import { nyte } from "./nyte.ts";

const storage = createIndexedDbOutboxStorage();

export const outbox = createOutbox({ storage, send: (input) => nyte.messages.send(input) });

export function activateOutbox(workspacePath: string | undefined): Promise<void> {
  storage.select(workspacePath ?? null);
  return outbox.activate();
}

function useOutboxSnapshot(): readonly OutboxRow[] {
  return useSyncExternalStore(outbox.subscribe, outbox.rows);
}

export function useOutboxRows(sessionId: SessionId): readonly OutboxRow[] {
  return useOutboxSnapshot().filter((row) => row.input.sessionId === sessionId);
}

export function useOptimisticSessionIds(): ReadonlySet<SessionId> {
  const rows = useOutboxSnapshot();
  return useMemo(() => optimisticSessionIds(rows), [rows]);
}
