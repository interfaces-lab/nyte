import type { Delivery } from "@nyte-ai/sdk";
import type { UserMessage } from "./view-helpers.ts";

export interface DeliveryChoices {
  readonly steer: Delivery;
  readonly queue: Delivery;
}

export const deliveryChoices: DeliveryChoices = { steer: "steer", queue: "queue" };

export function nextToSteer(
  items: readonly UserMessage[],
  choices: DeliveryChoices,
): UserMessage | undefined {
  return items.find((item) => item.status.kind === "pending" && item.delivery !== choices.steer);
}
