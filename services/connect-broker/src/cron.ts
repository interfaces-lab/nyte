import { RECONCILE_BATCH, lookupOwners, settleSessionRevocation } from "./clerk.ts";
import type { Context } from "./context.ts";
import { errorName } from "./log.ts";
import { publishStanding } from "./webhook.ts";
import { expireLinkTransactions } from "./store/link-transactions.ts";
import { applyOwnerStatus, ownersToReconcile, pendingSessionRevocations } from "./store/owners.ts";
import { purge } from "./store/replays.ts";

const BATCH = 20;

export async function sweep(context: Context): Promise<void> {
  const now = Date.now();

  const steps: readonly (readonly [string, () => Promise<void>])[] = [
    ["transactions", () => expireLinkTransactions(context.db, now)],
    [
      "sessions",
      async () => {
        for (const pending of await pendingSessionRevocations(context.db, { now, limit: BATCH }))
          await settleSessionRevocation(context, pending);
      },
    ],
    ["owners", () => reconcileOwners(context)],
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

async function reconcileOwners(context: Context): Promise<void> {
  let after = "";

  for (;;) {
    const owners = await ownersToReconcile(context.db, { after, limit: RECONCILE_BATCH });
    const last = owners.at(-1);

    if (last === undefined) return;

    const users = await lookupOwners(
      context,
      owners.map((owner) => owner.id),
    );

    if (users === undefined) return;

    for (const owner of owners) {
      const user = users.get(owner.id);

      await publishStanding(
        context,
        await applyOwnerStatus(context.db, {
          userId: owner.id,
          status: user?.status ?? "disabled",
          version: user?.version ?? owner.version,
          source: "lookup",
        }),
      );
    }

    after = last.id;
  }
}
