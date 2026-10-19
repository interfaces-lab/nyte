import { SdkError } from "@nyte-ai/schema";
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
import { publishSet } from "./watch.ts";

export type RunScope = { readonly session: SessionId; readonly run: RunId };

export interface CallChange {
  readonly record: CallRecord;
  readonly events?: readonly DurableEvent[];
  readonly updates?: readonly RefUpdate[];
  readonly under?: RunScope;
  readonly index?: { readonly add: readonly string[]; readonly drop: readonly string[] };
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

export async function commit(
  kernel: Kernel,
  updates: readonly RefUpdate[],
  under: RunScope | null = null,
): Promise<SetOutcome> {
  const fenced =
    under === null
      ? updates
      : updates.map((update) => ({
          ...update,
          fences: [...(update.fences ?? []), liveRef(under.session, under.run)],
        }));

  const outcome = await kernel.store.refs.set(fenced);
  dev("store", "refs.set", { names: updates.map(({ name }) => name), outcome });

  if (outcome.kind === "fenced" && under !== null) kernel.runs.abort(under.run);
  await publish(kernel, fenced, outcome, 0);

  return outcome;
}

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

  return kernel.executionState.callQueue.run(name, async () => {
    for (let tries = 0; tries < CALL_TRIES; tries += 1) {
      const found = await readCall(kernel.store, session, call);
      const next = await change(found?.record ?? null);

      if (next === null) return { record: found?.record ?? null, wrote: false, fenced: false };
      const target = await put(kernel.store, "call", next.record);

      const outcome = await commit(
        kernel,
        [
          {
            name,
            target,
            expect: readRefExpectation(found?.ref ?? null),
            events: next.events,
          },
          ...(next.updates ?? []),
          ...(next.index?.add ?? []).map((index) => ({ name: index, target })),
          ...(next.index?.drop ?? []).map((index) => ({ name: index, target: null })),
        ],
        next.under ?? null,
      );

      if (outcome.kind === "set") return { record: next.record, wrote: true, fenced: false };

      if (outcome.kind === "fenced")
        return { record: found?.record ?? null, wrote: false, fenced: true };
    }

    throw new SdkError("stale", `Call ${call} lost to concurrent writes ${CALL_TRIES} times.`);
  });
}
