import type { Message } from "@nyte-ai/sdk";
import {
  formatWholeDuration,
  showsText,
  showsThinking,
  showsTool,
} from "@nyte-ai/plugin/client/presentation";
import type {
  TextMessage,
  ThinkingMessage,
  ToolMessage,
} from "@nyte-ai/plugin/client/presentation";
import { messageParts, referenceLabel } from "../references/message-references.ts";

export type StepMessage = ThinkingMessage | ToolMessage;

export type TranscriptDisplayPart =
  | { readonly kind: "part"; readonly message: Message }
  | { readonly kind: "step"; readonly messages: readonly StepMessage[] }
  | { readonly kind: "agents"; readonly messages: readonly ToolMessage[] }
  | { readonly kind: "response"; readonly messages: readonly TextMessage[] };

export type TranscriptSlot =
  | { readonly kind: "await" }
  | { readonly kind: "blank" }
  | { readonly kind: "agents"; readonly message: ToolMessage }
  | { readonly kind: "response"; readonly message: TextMessage }
  | { readonly kind: "step"; readonly message: StepMessage }
  | { readonly kind: "part"; readonly message: Message };

export function transcriptSlot(message: Message): TranscriptSlot {
  if (showsTool(message)) {
    if (message.state.class.kind === "delegate") {
      const { role } = message.state.class;

      if (role === "await") return { kind: "await" };

      if (role === "task" || role === "create") return { kind: "agents", message };
    }

    return { kind: "step", message };
  }

  if (showsText(message))
    return /\S/u.test(message.state.markdown) ? { kind: "response", message } : { kind: "blank" };

  if (showsThinking(message)) return { kind: "step", message };

  return { kind: "part", message };
}

export function displayTranscriptParts(messages: readonly Message[]): TranscriptDisplayPart[] {
  const display: TranscriptDisplayPart[] = [];
  let step: StepMessage[] = [];
  let response: TextMessage[] = [];
  let agents: ToolMessage[] = [];

  const flushAgents = (): void => {
    if (agents.length > 0) display.push({ kind: "agents", messages: agents });
    agents = [];
  };

  const flushStep = (): void => {
    if (step.length > 0) display.push({ kind: "step", messages: step });
    step = [];
  };

  const flushResponse = (): void => {
    if (response.length > 0) display.push({ kind: "response", messages: response });
    response = [];
  };

  for (const message of messages) {
    const slot = transcriptSlot(message);

    switch (slot.kind) {
      case "await":
        break;
      case "blank":
        flushAgents();
        break;
      case "agents":
        flushStep();
        flushResponse();
        agents.push(slot.message);
        break;
      case "response":
        flushAgents();
        flushStep();
        response.push(slot.message);
        break;
      case "step":
        flushAgents();
        flushResponse();
        step.push(slot.message);
        break;
      case "part":
        flushAgents();
        flushStep();
        flushResponse();
        display.push({ kind: "part", message: slot.message });
        break;
      default: {
        const _exhaustive: never = slot;

        return _exhaustive;
      }
    }
  }

  flushAgents();
  flushStep();
  flushResponse();

  return display;
}

export function userDisplayText(source: string): string {
  return messageParts(source.replaceAll(/\n{3,}/gu, "\n\n"), { complete: true })
    .map((part) => (part.kind === "text" ? part.text : referenceLabel(part.reference)))
    .join("");
}

/** A finished turn's wall-clock work, rounded up to the second: "Worked for 2m 47s". */
export function workedFor(ms: number): string {
  return `Worked for ${formatWholeDuration(Math.ceil(ms / 1000) * 1000)}`;
}

/** How long ago a reply was sent: "Just now" under a minute, then "4m ago" through "1y ago". */
export function replyAge(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "Just now";

  if (hours < 1) return `${String(minutes)}m ago`;

  if (days < 1) return `${String(hours)}h ago`;

  if (days < 30) return `${String(days)}d ago`;

  return days < 365
    ? `${String(Math.floor(days / 30))}mo ago`
    : `${String(Math.floor(days / 365))}y ago`;
}
