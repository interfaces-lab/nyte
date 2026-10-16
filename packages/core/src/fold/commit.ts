import type {
  CallId,
  DurableEvent,
  RefUpdate,
  RunId,
  SessionId,
  SetOutcome,
} from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { CallRecord, ReceiptRecord } from "../contract/records.ts";
import { callRef, liveRef, receiptRef } from "../store/refs.ts";
import { put, readCall, readRefExpectation } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { SdkError } from "../util/error.ts";
import { publishSet } from "./watch.ts";

/** The run a write lands under: the write carries the run's live ref as its fence, so once the run's stop fence is set it lands nothing. */
export type RunScope = { readonly session: SessionId; readonly run: RunId };

export interface CallChange {
  readonly record: CallRecord;
  readonly events?: readonly DurableEvent[];
  readonly updates?: readonly RefUpdate[];
  /** The run the change lands under; see {@link RunScope}. */
  readonly under?: RunScope;
}

const CALL_TRIES = 8;

const PUBLISH_RETRIES = 6;

const PUBLISH_BACKOFF_MS = 50;

export async function writeReceipt(
  kernel: Kernel,
  session: SessionId,
  record: ReceiptRecord,
): Promise<void> {
  const outcome = await commit(kernel, [
    {
      name: receiptRef(session, record.id),
      target: await put(kernel.store, "receipt", record),
      expect: "absent",
    },
  ]);

  if (outcome.kind === "stale") throw new SdkError("stale", `Receipt ${record.id} already exists.`);
}

/** Sets refs in one compare-and-set write, then publishes what landed to the session bus. A write `under` a run lands only while the run is live: one its stop fence blocks answers `fenced`, writes nothing, and stops this process's work on the run. */
export async function commit(
  kernel: Kernel,
  updates: readonly RefUpdate[],
  under: RunScope | null = null,
): Promise<SetOutcome> {
  const fenced =
    under === null
      ? updates
      : updates.map((update) => ({ ...update, fence: liveRef(under.session, under.run) }));

  const outcome = await kernel.store.refs.set(fenced);
  dev("store", "refs.set", { names: updates.map(({ name }) => name), outcome });

  if (outcome.kind === "fenced" && under !== null) kernel.runs.abort(under.run);
  await publish(kernel, fenced, outcome, 0);

  return outcome;
}

/** A landed write's events reach watchers through the bus. The write already landed, so a failed publish is not the writer's failure: the same events are published again with backoff, and the publisher drops those already on the bus. */
async function publish(
  kernel: Kernel,
  updates: readonly RefUpdate[],
  outcome: SetOutcome,
  retry: number,
): Promise<void> {
  try {
    await publishSet(kernel, updates, outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dev("store", "publish failed", { retry, error: message });

    if (retry < PUBLISH_RETRIES)
      setTimeout(
        () => void publish(kernel, updates, outcome, retry + 1),
        PUBLISH_BACKOFF_MS * 2 ** retry,
      );
  }
}

export function changeCall(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
  change: (current: CallRecord | null) => Promise<CallChange | null>,
): Promise<{
  readonly record: CallRecord | null;
  readonly wrote: boolean;
  readonly fenced: boolean;
}> {
  const name = callRef(session, call);
  const queues = kernel.executionState.callQueues;

  const done = (queues.get(name) ?? Promise.resolve()).then(async () => {
    for (let tries = 0; tries < CALL_TRIES; tries += 1) {
      const found = await readCall(kernel.store, session, call);
      const next = await change(found?.record ?? null);

      if (next === null) return { record: found?.record ?? null, wrote: false, fenced: false };

      const outcome = await commit(
        kernel,
        [
          {
            name,
            target: await put(kernel.store, "call", next.record),
            expect: readRefExpectation(found?.ref ?? null),
            events: next.events,
          },
          ...(next.updates ?? []),
        ],
        next.under ?? null,
      );

      if (outcome.kind === "set") return { record: next.record, wrote: true, fenced: false };

      if (outcome.kind === "fenced")
        return { record: found?.record ?? null, wrote: false, fenced: true };
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
