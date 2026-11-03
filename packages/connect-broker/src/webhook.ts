/**
 * Clerk user events, verified with Clerk's webhook SDK. A ban or lock stops
 * leases and relayed requests at once and ends open relay channels, keeping
 * every link; a newer update that clears it lifts it. A deletion is terminal
 * and revokes every environment the user owned.
 *
 * D1 commits first, then every relay of the owner gets the standing D1 now
 * holds. A relay that can't be reached fails the delivery, and Clerk retries
 * it; the reconcile cron (`cron.ts`) catches what Clerk stops retrying.
 */
import { verifyWebhook } from "@clerk/backend/webhooks";
import type { WebhookEvent } from "@clerk/backend/webhooks";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ClerkId } from "./clerk.ts";
import type { Context } from "./context.ts";
import { Refusal, noContent, requestText } from "./http.ts";
import { ownerEnvironmentIds } from "./store/environments.ts";
import { applyOwnerStatus, deleteOwner } from "./store/owners.ts";
import type { Owner } from "./store/rows.ts";

const WEBHOOK_BODY_LIMIT = 65_536;

const UpdatedUser = Type.Object({
  id: ClerkId,
  banned: Type.Boolean(),
  locked: Type.Boolean(),
  updated_at: Type.Integer({ minimum: 0 }),
});

const DeletedUser = Type.Object({ id: ClerkId });

const Timestamp = Type.Integer({ minimum: 0 });

export async function handleWebhook(context: Context, request: Request): Promise<Response> {
  const body = await requestText(request, WEBHOOK_BODY_LIMIT);
  let event: WebhookEvent;

  try {
    event = await verifyWebhook(
      new Request(request.url, { method: "POST", headers: request.headers, body }),
      { signingSecret: context.config.clerk.webhookSecret },
    );
  } catch {
    throw new Refusal("unauthorized");
  }

  switch (event.type) {
    case "user.updated": {
      if (!Value.Check(UpdatedUser, event.data)) throw new Refusal("invalid");
      const disabled = event.data.banned || event.data.locked;

      await publishStanding(
        context,
        await applyOwnerStatus(context.db, {
          userId: event.data.id,
          status: disabled ? "disabled" : "active",
          version: event.data.updated_at,
          source: "event",
        }),
      );
      context.log.info("owner.updated", { disabled });
      break;
    }

    case "user.deleted": {
      if (!Value.Check(DeletedUser, event.data) || !Value.Check(Timestamp, event.timestamp))
        throw new Refusal("invalid");
      await deleteOwner(context.db, {
        userId: event.data.id,
        version: event.timestamp,
        now: Date.now(),
      });
      await publishStanding(context, {
        user_id: event.data.id,
        status: "deleted",
        version: event.timestamp,
      });
      context.log.info("owner.deleted", {});
      break;
    }

    default:
      break;
  }

  return noContent();
}

/**
 * Give every relay of the owner the standing D1 holds: the active ones, or,
 * for a deleted owner, every one it ever linked. Rejects when a relay can't
 * be reached, so the delivery is retried.
 */
export async function publishStanding(context: Context, owner: Owner): Promise<void> {
  const ids = await ownerEnvironmentIds(context.db, {
    ownerId: owner.user_id,
    state: owner.status === "deleted" ? "any" : "active",
  });

  await Promise.all(
    ids.map((id) =>
      context.environment(id).setOwner({ status: owner.status, version: owner.version }),
    ),
  );
}
