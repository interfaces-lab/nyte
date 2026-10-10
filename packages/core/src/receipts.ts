import type { Json, ReceiptId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { Receipt, SendReceipt } from "./receipt.ts";

/** Returns a handle on any durable command by id: status from its ref, settlement through in-memory waiters or the bus after a restart, stop by its kind. Binds synchronously; no I/O. */
export function receiptHandle(kernel: Kernel, session: SessionId, id: ReceiptId): Receipt<unknown> {
  throw new Error("not implemented");
}

/** Returns the receipt for a send: a receipt handle plus `message`, the same id, and `landed()`. Binds synchronously; no I/O. */
export function sendReceipt(kernel: Kernel, session: SessionId, id: ReceiptId): SendReceipt {
  throw new Error("not implemented");
}

/** Settles a receipt: writes its record's outcome and resolves every in-memory waiter on it. */
export function settleReceipt(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  outcome: Json,
): Promise<void> {
  throw new Error("not implemented");
}
