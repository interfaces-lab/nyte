import type { Delivery, PendingItem } from "@nyte-ai/core";

export interface DeliveryChoices {
  readonly steer: Delivery;
  readonly queue: Delivery;
}

export const deliveryChoices: DeliveryChoices = { steer: "steer", queue: "next" };

export function nextToSteer(
  items: readonly PendingItem[],
  choices: DeliveryChoices,
): PendingItem | undefined {
  return items.find((item) => item.delivery !== choices.steer);
}
