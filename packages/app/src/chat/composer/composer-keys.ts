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
  readonly keyCode: number;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
}

export type SubmitAction = "submit" | "submit-alternate";

export interface KeySituation {
  readonly from: "editor" | "form";
  readonly disabled: boolean;
  readonly submitting: boolean;
  readonly editing: boolean;
  readonly empty: boolean;
  readonly steerQueued: boolean;
  readonly trayOpen: boolean;
  readonly menuOpen: boolean;
  readonly canStop: boolean;
  readonly canRecall: boolean;
}

type KeyState = EnterKeyState & {
  readonly altKey: boolean;
  readonly repeat: boolean;
  readonly defaultPrevented: boolean;
};

export type KeyAction =
  | { readonly kind: "pass" }
  | { readonly kind: "submit"; readonly action: SubmitAction }
  | { readonly kind: "steer-queued" }
  | { readonly kind: "recall"; readonly direction: RecallDirection }
  | { readonly kind: "cancel-edit" }
  | { readonly kind: "swallow" }
  | { readonly kind: "dismiss-tray" }
  | { readonly kind: "stop" };

const PASS: KeyAction = { kind: "pass" };

const IME_KEY_CODE = 229;

export function composerKey(situation: KeySituation, key: KeyState): KeyAction {
  if (situation.from === "form") return formKey(situation, key);
  const recall = recallDirection(key);

  if (recall !== undefined)
    return situation.canRecall ? { kind: "recall", direction: recall } : PASS;
  const enter = composerEnterAction(key);

  if ((enter === "submit" || enter === "submit-alternate") && key.repeat)
    return { kind: "swallow" };

  if (enter === "submit-alternate") return { kind: "submit", action: enter };

  if (enter === "submit") {
    return situation.empty &&
      situation.steerQueued &&
      !situation.disabled &&
      !situation.submitting &&
      !situation.editing
      ? { kind: "steer-queued" }
      : { kind: "submit", action: enter };
  }

  if (key.key !== "Escape" || situation.menuOpen || situation.disabled) return PASS;

  if (situation.editing)
    return situation.submitting ? { kind: "swallow" } : { kind: "cancel-edit" };

  if (situation.trayOpen) return { kind: "dismiss-tray" };

  return situation.canStop ? { kind: "stop" } : PASS;
}

export function draftEmpty(text: string, attachments: number): boolean {
  return text.trim() === "" && attachments === 0;
}

function formKey(situation: KeySituation, key: KeyState): KeyAction {
  if (
    key.key !== "Escape" ||
    key.defaultPrevented ||
    situation.disabled ||
    situation.submitting ||
    situation.menuOpen ||
    !situation.editing
  )
    return PASS;

  return { kind: "cancel-edit" };
}

type ComposerEnterAction = SubmitAction | "newline" | "none";

export function composerEnterAction(event: EnterKeyState): ComposerEnterAction {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === IME_KEY_CODE) return "none";

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
