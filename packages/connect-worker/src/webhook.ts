/**
 * Clerk user events, verified with Clerk's webhook SDK. A ban or lock stops
 * leases and relayed requests at once and ends open relay channels, keeping
 * every link; a newer update that clears it lifts it. A deletion is terminal
 * and revokes every environment the user owned.
 */
import { verifyWebhook } from "@clerk/backend/webhooks";
import type { WebhookEvent } from "@clerk/backend/webhooks";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ClerkId } from "./clerk.ts";
import type { Context } from "./context.ts";
import { Refusal, noContent, requestText } from "./http.ts";
import { resetRelay, revokeRelay } from "./relay-stub.ts";
import { applyOwnerStatus, deleteOwner, ownerEnvironmentIds } from "./store.ts";

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

  const now = context.now();

  switch (event.type) {
    case "user.updated": {
      if (!Value.Check(UpdatedUser, event.data)) throw new Refusal("invalid");
      const disabled = event.data.banned || event.data.locked;

      await applyOwnerStatus(context.db, {
        userId: event.data.id,
        status: disabled ? "disabled" : "active",
        version: event.data.updated_at,
      });

      if (disabled)
        for (const environmentId of await ownerEnvironmentIds(context.db, event.data.id))
          resetRelay(context, { environmentId });
      context.log.info("owner.updated", { disabled });
      break;
    }
    case "user.deleted": {
      if (!Value.Check(DeletedUser, event.data) || !Value.Check(Timestamp, event.timestamp))
        throw new Refusal("invalid");
      const environmentIds = await ownerEnvironmentIds(context.db, event.data.id);

      await deleteOwner(context.db, { userId: event.data.id, version: event.timestamp, now });

      for (const environmentId of environmentIds) revokeRelay(context, environmentId);
      context.log.info("owner.deleted", {});
      break;
    }
    default:
      break;
  }

  return noContent();
}
