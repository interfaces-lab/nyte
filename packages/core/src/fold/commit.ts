import type { CallId, DurableEvent, RefUpdate, SessionId, SetOutcome } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { CallRecord, ReceiptRecord } from "../contract/records.ts";
import { dismiss } from "../store/parts.ts";
import { callRef, receiptRef } from "../store/refs.ts";
import { put, readCall, readRefExpectation } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { SdkError } from "../util/error.ts";
import { publishSet } from "./watch.ts";

export interface CallChange {
  readonly record: CallRecord;
  readonly event?: DurableEvent;
  readonly updates?: readonly RefUpdate[];
}

const CALL_TRIES = 8;

export async function writeReceipt(
  kernel: Kernel,
  session: SessionId,
  record: ReceiptRecord,
): Promise<void> {
  const outcome = await commit(kernel, [
    {
      name: receiptRef(session, record.id),
      target: await put(kernel, "receipt", record),
      expect: "absent",
    },
  ]);

  if (outcome.kind === "stale") throw new SdkError("stale", `Receipt ${record.id} already exists.`);
}

export async function commit(kernel: Kernel, updates: readonly RefUpdate[]): Promise<SetOutcome> {
  const outcome = await kernel.store.refs.set(updates);
  dev("store", "refs.set", { names: updates.map(({ name }) => name), outcome });

  if (outcome.kind === "set")
    for (const { name, event } of updates)
      if (event?.kind === "part" && event.change === "failed") dismiss(kernel.partTable, name);

  try {
    await publishSet(kernel, updates, outcome);
  } catch (error) {
    dev("store", "publish failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return outcome;
}

export function changeCall(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
  change: (current: CallRecord | null) => Promise<CallChange | null>,
): Promise<{ readonly record: CallRecord | null; readonly wrote: boolean }> {
  const name = callRef(session, call);
  const queues = kernel.executionState.callQueues;

  const done = (queues.get(name) ?? Promise.resolve()).then(async () => {
    for (let tries = 0; tries < CALL_TRIES; tries += 1) {
      const found = await readCall(kernel, session, call);
      const next = await change(found?.record ?? null);

      if (next === null) return { record: found?.record ?? null, wrote: false };

      const outcome = await commit(kernel, [
        {
          name,
          target: await put(kernel, "call", next.record),
          expect: readRefExpectation(found?.ref ?? null),
          event: next.event,
        },
        ...(next.updates ?? []),
      ]);

      if (outcome.kind === "set") return { record: next.record, wrote: true };
    }

    throw new SdkError("stale", `Call ${call} lost to concurrent writes ${CALL_TRIES} times.`);
  });

  const settled = done.then(
    () => undefined,
    () => undefined,
  );

  queues.set(name, settled);
  void settled.then(() => {
    if (queues.get(name) === settled) queues.delete(name);
  });

  return done;
}
