/**
 * The scheduled sweep: lapse unconfirmed reservations, retry Clerk session
 * revocation, and drop expired replay and rate rows. Each step runs even if
 * another fails.
 */
import { CLOCK_TOLERANCE_SECONDS } from "@nyte-ai/connect";
import { settleSessionRevocation } from "./clerk.ts";
import type { Context } from "./context.ts";
import { errorName } from "./log.ts";
import { expireReservations, pendingSessionRevocations, purge } from "./store.ts";

const BATCH = 20;

export async function sweep(context: Context): Promise<void> {
  const now = context.now();
  const steps: readonly (readonly [string, () => Promise<void>])[] = [
    ["reservations", () => expireReservations(context.db, now - CLOCK_TOLERANCE_SECONDS * 1000)],
    [
      "sessions",
      async () => {
        for (const pending of await pendingSessionRevocations(context.db, { now, limit: BATCH }))
          await settleSessionRevocation(context, pending);
      },
    ],
    ["purge", () => purge(context.db, now)],
  ];

  for (const [step, run] of steps) {
    try {
      await run();
    } catch (error) {
      context.log.error("sweep.failed", { step, error: errorName(error) });
    }
  }
}
