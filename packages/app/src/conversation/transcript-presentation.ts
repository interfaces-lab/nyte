import type { Message } from "@nyte-ai/sdk";
import { showsText, showsThinking, showsTool } from "@nyte-ai/plugin/client/presentation";
import type {
  TextMessage,
  ThinkingMessage,
  ToolMessage,
} from "@nyte-ai/plugin/client/presentation";
import { messageParts, referenceLabel } from "./message-references.ts";

export type StepMessage = ThinkingMessage | ToolMessage;

type TranscriptDisplayPart =
  | { readonly kind: "part"; readonly message: Message }
  | { readonly kind: "step"; readonly messages: readonly StepMessage[] }
  | { readonly kind: "agents"; readonly messages: readonly ToolMessage[] }
  | { readonly kind: "response"; readonly messages: readonly TextMessage[] };

export function displayTranscriptParts(messages: readonly Message[]): TranscriptDisplayPart[] {
  const display: TranscriptDisplayPart[] = [];
  let step: StepMessage[] = [];
  let response: TextMessage[] = [];
  let agents: ToolMessage[] = [];

  const flushAgents = (): void => {
    const [only] = agents;

    if (only !== undefined && agents.length === 1) display.push({ kind: "part", message: only });
    else if (only !== undefined) display.push({ kind: "agents", messages: agents });
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
    if (showsTool(message) && message.state.class.kind === "delegate") {
      const { role } = message.state.class;

      if (role === "await") continue;

      if (role === "task" || role === "create") {
        flushStep();
        flushResponse();
        agents.push(message);
        continue;
      }
    }

    flushAgents();

    if (showsText(message)) {
      if (message.state.markdown.trim() === "") continue;
      flushStep();
      response.push(message);
      continue;
    }

    if (showsTool(message) || showsThinking(message)) {
      flushResponse();
      step.push(message);
      continue;
    }

    flushStep();
    flushResponse();
    display.push({ kind: "part", message });
  }

  flushAgents();
  flushStep();
  flushResponse();

  return display;
}

/** A sent message's draft text with each chip as its label, for assistive text. */
export function userDisplayText(source: string): string {
  return messageParts(source.replaceAll(/\n{3,}/gu, "\n\n"), { complete: true })
    .map((part) => (part.kind === "text" ? part.text : referenceLabel(part.reference)))
    .join("");
}

export function formatRunDuration(durationMs: number): string | undefined {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));

  if (totalSeconds === 0) return undefined;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return minutes > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(hours)}h`;

  if (minutes > 0)
    return seconds > 0 ? `${String(minutes)}m ${String(seconds)}s` : `${String(minutes)}m`;

  return `${String(seconds)}s`;
}
