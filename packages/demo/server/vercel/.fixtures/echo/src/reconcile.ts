import { reconcileDispatch } from "@nyte-ai/vercel/outbox";
import { wakeSession } from "./dispatch.ts";
import { openExecution } from "./runtime.ts";

/** Longer than the function's 300 s `maxDuration`, so no admission can still be committing. */
const SETTLE_AFTER_MS = 15 * 60_000;

export async function reconcileSessionDispatch() {
  const sdk = await openExecution();

  try {
    return await reconcileDispatch({
      outbox: sdk.outbox,
      wake: wakeSession,
      settleAfterMs: SETTLE_AFTER_MS,
    });
  } finally {
    await sdk.close();
  }
}
