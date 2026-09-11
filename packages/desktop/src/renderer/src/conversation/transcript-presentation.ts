import type { Turn, TurnPart } from "@nyte-ai/core";
import { messageParts } from "./message-references.ts";

export type AssistantTurnPart = Extract<TurnPart, { readonly kind: "assistant" }>;
export type WorkTurnPart = Extract<TurnPart, { readonly kind: "assistant" | "thinking" | "tool" }>;

export type TranscriptDisplayPart =
  | { readonly kind: "part"; readonly part: TurnPart }
  | { readonly kind: "work"; readonly parts: readonly WorkTurnPart[] }
  | { readonly kind: "response"; readonly parts: readonly AssistantTurnPart[] };

function isWorkPart(part: TurnPart): part is WorkTurnPart {
  return part.kind === "assistant" || part.kind === "thinking" || part.kind === "tool";
}

function isActivityPart(part: TurnPart): boolean {
  return part.kind === "thinking" || part.kind === "tool";
}

/**
 * Intermediate narration, reasoning, and tool calls form one work episode.
 * Only the assistant text after the final activity part
 * remains in the transcript as the response.
 */
export function displayTranscriptParts(parts: readonly TurnPart[]): TranscriptDisplayPart[] {
  let lastActivity = -1;
  for (const [index, part] of parts.entries()) {
    if (isActivityPart(part)) lastActivity = index;
  }

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

  for (const [index, part] of parts.entries()) {
    if (part.kind === "assistant" && index > lastActivity) {
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

export type UserTextSegment =
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

export type TranscriptNoticeTone = "neutral" | "danger";

export interface TranscriptNotice {
  readonly text: string;
  readonly tone: TranscriptNoticeTone;
  /** Original provider output for a tooltip or diagnostic surface. */
  readonly detail?: string;
}

function nestedMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if ("message" in value && typeof value.message === "string") return value.message;
  return (
    ("error" in value ? nestedMessage(value.error) : undefined) ??
    ("cause" in value ? nestedMessage(value.cause) : undefined)
  );
}

function jsonMessage(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return nestedMessage(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return undefined;
  }
}

function compactMessage(text: string): string | undefined {
  const message = (jsonMessage(text) ?? text)
    .replace(/^\s*(?:error\s*:\s*)+/iu, "")
    .replace(/\s*\(?request(?:_|\s)id\s*[:=].*$/iu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (message === "" || message.startsWith("{")) return undefined;
  return message.length <= 180 ? message : `${message.slice(0, 177).trimEnd()}…`;
}

export function isFailureNotice(text: string): boolean {
  return /^\s*error\s*:/iu.test(text);
}

export function presentTranscriptNotice(source: string): TranscriptNotice {
  const raw = source.trim();
  if (!isFailureNotice(raw)) return { text: raw, tone: "neutral" };

  const lower = raw.toLocaleLowerCase();
  if (/abort(?:ed|error)|operation was aborted|run interrupted/u.test(lower)) {
    return { text: "Run stopped.", tone: "neutral", detail: raw };
  }
  if (/rate[_ -]?limit|\b429\b/u.test(lower)) {
    return { text: "Rate limit reached. Try again shortly.", tone: "danger", detail: raw };
  }
  if (/context[_ -]?(?:length|window)|maximum context|too many tokens/u.test(lower)) {
    return { text: "This chat exceeded the model's context window.", tone: "danger", detail: raw };
  }
  if (/insufficient[_ -]?quota|quota exceeded|billing limit/u.test(lower)) {
    return {
      text: "Provider quota reached. Try another model or account.",
      tone: "danger",
      detail: raw,
    };
  }
  if (/unauthori[sz]ed|authentication|invalid api key|\b401\b/u.test(lower)) {
    return {
      text: "Authentication failed. Check the provider account.",
      tone: "danger",
      detail: raw,
    };
  }
  if (/overload|temporarily unavailable|\b529\b/u.test(lower)) {
    return {
      text: "The model is temporarily unavailable. Try again shortly.",
      tone: "danger",
      detail: raw,
    };
  }
  if (/network|fetch failed|connection (?:lost|refused|reset)|\beconn/u.test(lower)) {
    return {
      text: "Connection lost. Check your network and try again.",
      tone: "danger",
      detail: raw,
    };
  }

  return {
    text: compactMessage(raw) ?? "Request failed.",
    tone: "danger",
    detail: raw,
  };
}

export function configChangeText(
  turn: Extract<Turn, { readonly kind: "config" }>,
): string | undefined {
  const changes: string[] = [];
  if (turn.body.model !== undefined) {
    const { provider, id } = turn.body.model;
    changes.push(`Model → ${provider === undefined ? id : `${provider}/${id}`}`);
  }
  if (turn.body.thinkingLevel !== undefined) {
    changes.push(`Thinking → ${turn.body.thinkingLevel}`);
  }
  if (turn.body.agent !== undefined) changes.push(`Agent → ${turn.body.agent}`);
  return changes.length === 0 ? undefined : changes.join(" · ");
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
