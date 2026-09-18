import type { ToolTurnPart, TurnPart } from "@nyte-ai/protocol";
import { messageParts } from "./message-references.ts";
import type { ToolPhase } from "./tool-copy.ts";

type AssistantTurnPart = Extract<TurnPart, { readonly kind: "assistant" }>;
export type WorkTurnPart = Extract<TurnPart, { readonly kind: "thinking" | "tool" }>;

type TranscriptDisplayPart =
  | { readonly kind: "part"; readonly part: TurnPart }
  | { readonly kind: "work"; readonly parts: readonly WorkTurnPart[] }
  | { readonly kind: "response"; readonly parts: readonly AssistantTurnPart[] };

function isWorkPart(part: TurnPart): part is WorkTurnPart {
  // A delegation owns a child session and outlives the call, so it is not a
  // step inside someone else's episode.
  if (part.kind === "tool") return part.class.kind !== "delegate";
  return part.kind === "thinking";
}

/** A call with no result is still running only while its run is; otherwise the run left it behind. */
export function toolPhase(part: ToolTurnPart, running: boolean): ToolPhase {
  if (part.result !== undefined) return part.result.isError ? "failed" : "done";
  return running ? "running" : "interrupted";
}

/**
 * Reasoning and tool calls form one work episode. A subagent call stands on its
 * own row instead, splitting the episode around it: it is a delegation with its
 * own session and status, not a step inside someone else's work.
 *
 * Assistant text is never part of an episode. It is the only content the reader
 * is actually reading, and a turn streams, so any rule that placed it by length,
 * markdown, position, or run state would move it under the reader when the next
 * part arrived. Placement follows `kind` alone, which never changes, so a part
 * drawn as prose stays prose. Text closes the open episode; work that follows
 * opens the next one.
 */
export function displayTranscriptParts(parts: readonly TurnPart[]): TranscriptDisplayPart[] {
  const display: TranscriptDisplayPart[] = [];
  let work: WorkTurnPart[] = [];
  let response: AssistantTurnPart[] = [];

  const flushWork = (): void => {
    if (work.length > 0) display.push({ kind: "work", parts: work });
    work = [];
  };
  const flushResponse = (): void => {
    if (response.length > 0) display.push({ kind: "response", parts: response });
    response = [];
  };

  for (const part of parts) {
    if (part.kind === "assistant") {
      flushWork();
      response.push(part);
      continue;
    }
    if (isWorkPart(part)) {
      flushResponse();
      work.push(part);
      continue;
    }
    flushWork();
    flushResponse();
    display.push({ kind: "part", part });
  }
  flushWork();
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
