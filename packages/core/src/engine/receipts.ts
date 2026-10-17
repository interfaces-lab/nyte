import { asId, SdkError } from "@nyte-ai/schema";
import type {
  Disposer,
  HeadName,
  Json,
  MessageId,
  ReceiptId,
  RefUpdate,
  SessionId,
  StopOutcome,
} from "@nyte-ai/schema";
import { CORE_CONTEXT, LOCAL } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { ReceiptRecord } from "../contract/records.ts";
import type { Receipt, SendReceipt } from "../contract/session.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { inboxRef, receiptRef } from "../store/refs.ts";
import {
  attempt,
  inboxWithout,
  put,
  readInbox,
  readReceipt,
  readRefExpectation,
  STALE,
} from "../store/session.ts";
import { stopRun } from "./fence.ts";
import { waitFor } from "./waits.ts";
import type { StoreConnection } from "../contract/store.ts";

type Landing = Awaited<ReturnType<SendReceipt["landed"]>>;

const RECEIPT_EVENTS: ReadonlySet<string> = new Set(["input", "run", "head"]);

type Settlement = {
  readonly [K in ReceiptRecord["kind"]]: {
    readonly kind: K;
    readonly outcome: NonNullable<Extract<ReceiptRecord, { readonly kind: K }>["outcome"]>;
  };
}[ReceiptRecord["kind"]];

export function receiptHandle(kernel: Kernel, session: SessionId, id: ReceiptId): Receipt<unknown> {
  return typedReceipt(kernel, session, id, (record) => record.outcome);
}

export function sendReceipt(kernel: Kernel, session: SessionId, id: ReceiptId): SendReceipt {
  const message = asId<"message">(id);

  return {
    ...typedReceipt(kernel, session, id, (record) => {
      if (record.kind !== "send") throw new SdkError("internal", `Receipt ${id} is not a send.`);

      return record.outcome;
    }),
    message,
    landed: () => landed(kernel, session, id, message),
  };
}

export async function settleReceipt(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  settlement: Settlement,
): Promise<void> {
  const settled = await attempt(`Settling receipt ${id}`, async () => {
    const found = await readReceipt(kernel.store, session, id);

    if (found === null || found.record.outcome !== null) return false;
    if (found.record.kind !== settlement.kind)
      throw new SdkError("internal", `Receipt ${id} is not a ${settlement.kind}.`);
    const target = await put(kernel.store, "receipt", { ...found.record, ...settlement });

    const result = await commit(kernel, [
      { name: receiptRef(session, id), target, expect: found.ref.revision },
    ]);

    return result.kind === "set" ? true : STALE;
  });

  if (settled) kernel.waits.receiptSettled(session, id);
}

export async function reserve(
  kernel: Kernel,
  session: SessionId,
  record: ReceiptRecord,
): Promise<boolean> {
  const outcome = await commit(kernel, [
    {
      name: receiptRef(session, record.id),
      target: await put(kernel.store, "receipt", record),
      expect: "absent",
    },
  ]);

  return outcome.kind === "set";
}

export async function known(
  store: StoreConnection,
  session: SessionId,
  id: ReceiptId,
  kind: ReceiptRecord["kind"],
  digest: string,
): Promise<boolean> {
  const found = await readReceipt(store, session, id);

  if (found === null) return false;

  if (found.record.kind !== kind || found.record.digest !== digest)
    throw new SdkError("invalid", `Receipt ${id} was used for another command.`);

  return true;
}

export function typedReceipt<O extends Json>(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  readOutcome: (record: ReceiptRecord) => O | null,
): Receipt<O> {
  const named = async (): Promise<ReceiptId> =>
    (await readReceipt(kernel.store, session, id))?.record.id ?? id;

  return {
    id,
    async status() {
      const found = await readReceipt(kernel.store, session, await named());

      if (found === null) return { kind: "missing" };
      const outcome = readOutcome(found.record);

      return outcome === null ? { kind: "pending" } : { kind: "settled", outcome };
    },
    async settled(options) {
      const target = await named();

      return waitFor({
        options,
        async check() {
          const found = await readReceipt(kernel.store, session, target);

          if (found === null) throw new SdkError("unknown", `No receipt has the id ${id}.`);
          const outcome = readOutcome(found.record);

          return outcome === null ? null : { value: outcome };
        },
        subscribe: (trigger) =>
          both(
            kernel.waits.onReceipt(session, target, trigger),
            kernel.bus.subscribe(session, (event) => {
              if (RECEIPT_EVENTS.has(event.kind)) trigger();
            }),
          ),
      });
    },
    stop: async () => stopReceipt(kernel, session, await named(), readOutcome),
  };
}

async function landed(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  message: MessageId,
): Promise<Landing> {
  const hold = kernel.folds.acquire(session, LOCAL);

  try {
    await hold.ready();

    return await waitFor<Landing>({
      async check() {
        const current = hold.state().messages.get(message);

        if (current?.kind === "user" && current.status.kind === "landed")
          return { value: current.status };
        const found = await readReceipt(kernel.store, session, id);

        if (found === null) throw new SdkError("unknown", `No receipt has the id ${id}.`);
        if (found.record.kind !== "send")
          throw new SdkError("internal", `Receipt ${id} is not a send.`);
        const outcome = found.record.outcome;

        if (outcome === null) return null;

        switch (outcome.kind) {
          case "completed":
          case "stopped":
          case "failed":
            return null;
          case "withdrawn":
          case "stale":
          case "busy":
          case "pending-input":
          case "missing-target":
          case "summary-failed":
            return { value: outcome };
          default: {
            const _exhaustive: never = outcome;

            return _exhaustive;
          }
        }
      },
      subscribe: (trigger) =>
        both(
          hold.subscribe(() => trigger()),
          kernel.waits.onReceipt(session, id, trigger),
        ),
    });
  } finally {
    hold.release();
  }
}

export async function withdraw(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  ids: readonly MessageId[],
): Promise<readonly MessageId[]> {
  const withdrawn = await attempt("Withdrawing inputs", async () => {
    const inbox = await readInbox(kernel.store, session, head);

    const due = await withFold(kernel, session, (state) =>
      inbox.messages.filter(
        (message) =>
          ids.includes(message) && state.inputs.get(message)?.schedule.kind !== "deciding",
      ),
    );

    if (due.length === 0) return [];

    const target = await put(kernel.store, "inbox", inboxWithout(inbox, due));

    const receipts = await Promise.all(
      due.map(async (message): Promise<readonly RefUpdate[]> => {
        const found = await readReceipt(kernel.store, session, message);

        if (found === null || found.record.outcome !== null) return [];

        return [
          {
            name: found.ref.name,
            target: await put(kernel.store, "receipt", {
              ...found.record,
              outcome: { kind: "withdrawn" },
            }),
            expect: found.ref.revision,
          },
        ];
      }),
    );

    const outcome = await commit(kernel, [
      {
        name: inboxRef(session, head),
        target,
        expect: readRefExpectation(inbox.ref),
        events: due.map(
          (message) => ({ head, kind: "input", message, change: "withdrawn" }) as const,
        ),
      },
      ...receipts.flat(),
    ]);

    return outcome.kind === "set" ? due : STALE;
  });

  for (const message of withdrawn) kernel.waits.receiptSettled(session, asId<"receipt">(message));

  return withdrawn;
}

async function stopReceipt<O extends Json>(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  readOutcome: (record: ReceiptRecord) => O | null,
): Promise<StopOutcome<O>> {
  const found = await readReceipt(kernel.store, session, id);

  if (found === null) return { kind: "missing" };

  const outcome = readOutcome(found.record);

  if (outcome !== null) return { kind: "settled", outcome };

  if (found.record.kind === "batch") stopBatch(kernel, id);

  if (found.record.kind !== "send") return { kind: "requested" };
  const message = asId<"message">(id);
  const input = await withFold(kernel, session, (state) => state.inputs.get(message));

  if (input === undefined) return { kind: "missing" };

  if (input.schedule.kind === "deciding") {
    await kernel.handles.session(CORE_CONTEXT, session).stop();

    return { kind: "requested" };
  }

  if (input.landed === null && (await withdraw(kernel, session, input.head, [message])).length > 0)
    return { kind: "requested" };

  const run =
    input.landed?.run ??
    (await withFold(kernel, session, (state) => state.inputs.get(message)?.landed?.run)) ??
    null;

  if (run === null) return { kind: "missing" };
  const stopped = await stopRun(kernel, session, run);

  if (stopped.kind !== "settled") return stopped;
  const settled = readOutcome({ ...found.record, outcome: stopped.outcome });

  if (settled === null) throw new SdkError("internal", `Receipt ${id} has no settled outcome.`);

  return { kind: "settled", outcome: settled };
}

function both(left: Disposer, right: Disposer): Disposer {
  return () => {
    left();
    right();
  };
}

function stopBatch(kernel: Kernel, id: ReceiptId): boolean {
  const controller = kernel.workspaceState.batches.get(id);
  controller?.abort();

  return controller !== undefined;
}
