import type { Delivery, PendingItem } from "@nyte-ai/protocol";

import type { RunningMessagePreference } from "./running-message-preference.ts";

interface DeliveryChoices {
  readonly steer: Delivery;
  readonly queue: Delivery;
}

export const deliveryChoices: DeliveryChoices = { steer: "steer", queue: "next" };

interface EnterKeyState {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
}

export type SubmitAction = "submit" | "submit-alternate";

type ComposerEnterAction = SubmitAction | "newline" | "none";

export function composerEnterAction(event: EnterKeyState): ComposerEnterAction {
  if (event.key !== "Enter" || event.isComposing) return "none";

  if (event.shiftKey) return "newline";

  if (event.metaKey || event.ctrlKey) return "submit-alternate";

  return "submit";
}

export function submissionDelivery(
  action: SubmitAction,
  choices: DeliveryChoices,
  current?: Delivery,
  preference: RunningMessagePreference = "queue",
): Delivery {
  const primary = current ?? choices[preference];

  if (action === "submit") return primary;

  return primary === choices.steer ? choices.queue : choices.steer;
}

export function modifierKeyLabel(mac: boolean): string {
  return mac ? "⌘" : "Ctrl+";
}

export function nextToSteer(
  items: readonly PendingItem[],
  choices: DeliveryChoices,
): PendingItem | undefined {
  return items.find((item) => item.delivery !== choices.steer);
}
