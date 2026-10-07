/**
 * The renderer's one outbox over the bridge, stored per host binding and
 * workspace. A row leaves once the observer draws the durable message under
 * the same key.
 *
 * `send` is the bridge's current client, so a lifetime must not outlive it:
 * the bridge deactivates before it adopts another connection, and an
 * activation taken under the previous connection does nothing.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { createOutbox, type OutboxRow } from "@nyte-ai/client";
import { createIndexedDbOutboxStorage } from "./outbox-storage.ts";
import type { OutboxPartition } from "./outbox-storage.ts";
import { optimisticSessionIds } from "./session-activity.ts";
import { nyte } from "./nyte.ts";

const storage = createIndexedDbOutboxStorage();

export const outbox = createOutbox({ storage, send: (input) => nyte.messages.send(input) });

/** Counts connection changes; an activation names the one it was taken under. */
let connection = 0;

/**
 * The activation for the connection current now. Take it before reading the
 * host state its partition comes from: once the connection is replaced it
 * does nothing, so rows loaded for one host never send through another's
 * client.
 */
export function outboxActivation(): (partition: OutboxPartition) => Promise<void> {
  const taken = connection;

  return async (partition) => {
    if (taken !== connection) return;
    storage.select(partition);
    await outbox.activate();
  };
}

/** The connection is about to change: no row queued for the current host may send again. */
export function deactivateOutbox(): void {
  connection += 1;
  outbox.deactivate();
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
