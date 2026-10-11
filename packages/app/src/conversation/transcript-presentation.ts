import type { Message } from "@nyte-ai/sdk";
import { isPart, text, thinking } from "@nyte-ai/plugin/client";
import { isToolMessage } from "../view-helpers.ts";
import type { PartMessage, ToolMessage } from "../view-helpers.ts";
import { messageParts } from "./message-references.ts";

/** A text part: the model's prose. */
export type TextMessage = PartMessage & { readonly state: { readonly markdown: string } };

/** A thinking part: the model's reasoning, adjacent thoughts already one part. */
export type ThinkingMessage = PartMessage & {
  readonly state: { readonly markdown: string; readonly merged: number };
};

export type StepMessage = ThinkingMessage | ToolMessage;

type TranscriptDisplayPart =
  | { readonly kind: "part"; readonly message: Message }
  | { readonly kind: "step"; readonly messages: readonly StepMessage[] }
  | { readonly kind: "response"; readonly messages: readonly TextMessage[] };

/** Narrows a message to a text part. */
export function isTextMessage(message: Message): message is TextMessage {
  return isPart(message, text);
}

/** Narrows a message to a thinking part. */
export function isThinkingMessage(message: Message): message is ThinkingMessage {
  return isPart(message, thinking);
}

function isStepMessage(message: Message): message is StepMessage {
  if (isToolMessage(message))
    return message.state.class.kind !== "delegate" || message.state.class.role !== "create";

  return isThinkingMessage(message);
}

/**
 * Reasoning and tool calls form one work episode. A subagent's create stands
 * on its own row instead, splitting the episode around it: it is a delegation
 * with its own session and status, not a step inside someone else's work.
 *
 * Assistant text is never part of an episode. Placement follows the part's
 * kind alone, which never changes, so a part drawn as prose stays prose.
 * Text closes the open episode; work that follows opens the next one.
 */
export function displayTranscriptParts(messages: readonly Message[]): TranscriptDisplayPart[] {
  const display: TranscriptDisplayPart[] = [];
  let step: StepMessage[] = [];
  let response: TextMessage[] = [];

  const flushStep = (): void => {
    if (step.length > 0) display.push({ kind: "step", messages: step });
    step = [];
  };

  const flushResponse = (): void => {
    if (response.length > 0) display.push({ kind: "response", messages: response });
    response = [];
  };

  for (const message of messages) {
    if (isTextMessage(message)) {
      if (message.state.markdown.trim() === "") continue;
      flushStep();
      response.push(message);
      continue;
    }

    if (isStepMessage(message)) {
      flushResponse();
      step.push(message);
      continue;
    }

    flushStep();
    flushResponse();
    display.push({ kind: "part", message });
  }

  flushStep();
  flushResponse();

  return display;
}

type UserTextSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reference"; readonly label: string; readonly target: string };

/** Hide persisted skill plumbing while keeping its compact label available to assistive text. */
export function userTextSegments(source: string): readonly UserTextSegment[] {
  const text = source.replaceAll(/\n{3,}/gu, "\n\n");
  const parts = messageParts(text, { form: "message" });
  const segments: UserTextSegment[] = [];

  const appendText = (value: string): void => {
    if (value === "") return;
    const previous = segments.at(-1);

    if (previous?.kind === "text") {
      segments[segments.length - 1] = { kind: "text", text: previous.text + value };

      return;
    }

    segments.push({ kind: "text", text: value });
  };

  for (const [index, part] of parts.entries()) {
    if (part.kind === "text") {
      appendText(part.text);
      continue;
    }

    if (part.reference.kind !== "skill") {
      appendText(part.source);
      continue;
    }

    segments.push({
      kind: "reference",
      label: `/${part.reference.name}`,
      target: part.reference.path,
    });

    if (!part.source.endsWith("\n\n")) continue;
    const next = parts[index + 1];
    const separator = next?.kind === "text" ? "\n" : next?.kind === "reference" ? " " : "";
    appendText(separator);
  }

  return segments.length === 0 ? [{ kind: "text", text }] : segments;
}

export function userDisplayText(source: string): string {
  return userTextSegments(source)
    .map((segment) => (segment.kind === "text" ? segment.text : segment.label))
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
