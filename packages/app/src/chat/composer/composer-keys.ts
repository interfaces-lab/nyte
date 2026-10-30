import type { Delivery } from "@nyte-ai/sdk";

import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import type { RunningMessagePreference } from "../../preferences/index.ts";
import type { RecallDirection } from "./composer-history.ts";

interface DeliveryChoices {
  readonly steer: Delivery;
  readonly queue: Delivery;
}

export const deliveryChoices: DeliveryChoices = { steer: "steer", queue: "queue" };

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

export function recallDirection(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">,
): RecallDirection | undefined {
  if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return undefined;

  if (event.key === "ArrowUp") return "older";

  return event.key === "ArrowDown" ? "newer" : undefined;
}

export type ComposerSituation =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly preference: RunningMessagePreference }
  | { readonly kind: "answering" }
  | { readonly kind: "editing-queued"; readonly delivery: Delivery }
  | { readonly kind: "editing-message" };

interface EnterBehavior {
  /** The alternate chord delivers the other way. */
  readonly delivery: Delivery;
  readonly label: string;
  readonly title: string;
  readonly placeholder?: string;
}

export function enterBehavior(situation: ComposerSituation, mac: boolean): EnterBehavior {
  const modifier = modifierKeyLabel(mac);
  const send = { delivery: deliveryChoices.steer, label: "Send message" };

  switch (situation.kind) {
    case "idle":
      return { ...send, title: "Send Message (Enter)" };
    case "running":
      return situation.preference === "queue"
        ? {
            ...send,
            delivery: deliveryChoices.queue,
            title: `Queue (Enter) · Steer (${modifier}Enter)`,
            placeholder: "Queue for next turn",
          }
        : {
            ...send,
            title: `Steer (Enter) · Queue (${modifier}Enter)`,
            placeholder: "Steer without stopping",
          };
    case "answering":
      return {
        ...send,
        label: "Send answer",
        title: "Send answer (Enter)",
        placeholder: "Answer in your own words",
      };
    case "editing-queued":
      return {
        ...send,
        delivery: situation.delivery,
        title:
          situation.delivery === deliveryChoices.steer
            ? `Update (Enter) · Queue Instead (${modifier}Enter)`
            : `Update (Enter) · Steer Instead (${modifier}Enter)`,
      };
    case "editing-message":
      return { ...send, title: "Send Edited Message (Enter)" };
    default: {
      const _exhaustive: never = situation;

      return _exhaustive;
    }
  }
}

export function submissionDelivery(action: SubmitAction, primary: Delivery): Delivery {
  if (action === "submit") return primary;

  return primary === deliveryChoices.steer ? deliveryChoices.queue : deliveryChoices.steer;
}

export function modifierKeyLabel(mac: boolean): string {
  return mac ? "⌘" : "Ctrl+";
}

export function nextToSteer(items: readonly UserMessage[]): UserMessage | undefined {
  return items.find((item) => item.delivery !== deliveryChoices.steer);
}
