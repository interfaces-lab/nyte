import { asId } from "@nyte-ai/schema";
import type { Json, ReceiptId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { Receipt, SendReceipt } from "./receipt.ts";
import { isAnyOutcome, isSendOutcome, landed, typedReceipt } from "./receipt-handles.ts";
import { receiptRef } from "./refs.ts";
import { STALE, attempt, commit, put, readReceipt } from "./session-state.ts";
import { notifyReceipt } from "./waits.ts";

/** Returns a handle on any durable command by id: status from its ref, settlement through in-memory waiters or the bus after a restart, stop by its kind. Binds synchronously; no I/O. */
export function receiptHandle(kernel: Kernel, session: SessionId, id: ReceiptId): Receipt<unknown> {
  return typedReceipt(kernel, session, id, isAnyOutcome);
}

/** Returns the receipt for a send: a receipt handle plus `message`, the same id, and `landed()`. Binds synchronously; no I/O. */
export function sendReceipt(kernel: Kernel, session: SessionId, id: ReceiptId): SendReceipt {
  const message = asId<"message">(id);

  return {
    ...typedReceipt(kernel, session, id, isSendOutcome),
    message,
    landed: () => landed(kernel, session, id, message),
  };
}

/** Settles a receipt: writes its record's outcome and resolves every in-memory waiter on it. */
export async function settleReceipt(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  outcome: Json,
): Promise<void> {
  const settled = await attempt(`Settling receipt ${id}`, async () => {
    const found = await readReceipt(kernel, session, id);

    if (found === null || found.record.outcome !== null) return false;
    const target = await put(kernel, "receipt", { ...found.record, outcome });

    const result = await commit(kernel, [
      { name: receiptRef(session, id), target, expect: found.ref.revision },
    ]);

    return result.kind === "set" ? true : STALE;
  });

  if (settled) notifyReceipt(kernel, session, id);
}
