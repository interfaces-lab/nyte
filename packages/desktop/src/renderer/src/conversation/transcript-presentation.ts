import type { Turn, TurnPart } from "@nyte-ai/core";

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
 * Cursor treats the model's intermediate narration, reasoning, and tool calls
 * as one work episode. Only the assistant text after the final activity part
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

/** Hide persisted skill-link plumbing without pretending it is ordinary Markdown. */
export function userTextSegments(source: string): readonly UserTextSegment[] {
  const text = source.replaceAll(/\n{3,}/gu, "\n\n");
  const pattern = /\[\$(?<name>[^\]\r\n]+)\]\((?<target>[^)\r\n]+)\)/gu;
  const segments: UserTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    const name = match.groups?.name;
    const target = match.groups?.target;
    if (index === undefined || name === undefined || target === undefined) continue;
    if (index > cursor) segments.push({ kind: "text", text: text.slice(cursor, index) });
    segments.push({ kind: "reference", label: `/${name}`, target });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
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
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record.message === "string") return record.message;
  return nestedMessage(record.error) ?? nestedMessage(record.cause);
}

function jsonMessage(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return nestedMessage(JSON.parse(text.slice(start, end + 1)) as unknown);
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

function modelLabel(id: string): string {
  return id
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((word) => {
      if (word.toLocaleLowerCase() === "gpt") return "GPT";
      return /^\d/u.test(word) ? word : word.slice(0, 1).toLocaleUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function configChangeText(
  turn: Extract<Turn, { readonly kind: "config" }>,
): string | undefined {
  if (turn.body.model !== undefined) return `Routed to ${modelLabel(turn.body.model.id)}`;
  if (turn.body.agent !== undefined) return `Mode set to ${turn.body.agent}`;
  return undefined;
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
