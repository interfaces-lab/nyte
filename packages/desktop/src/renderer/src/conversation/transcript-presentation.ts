import { sessionId } from "@nyte-ai/protocol";
import type { ParkedCall, SessionId, ToolTurnPart, TurnPart } from "@nyte-ai/protocol";
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

/**
 * A live wait is run status, not a transcript row. An unsettled call on a
 * child whose card is in the same turn draws nothing; the trailing work
 * header says the run is waiting and counts down to the parked call's wake.
 */
export interface LiveWaits {
  /** Unsettled calls on children created in this turn; drawn nowhere. */
  readonly hidden: ReadonlySet<string>;
  /** Children the hidden calls are blocked on; their cards say so. */
  readonly awaited: ReadonlySet<SessionId>;
  /** Each unsettled call's wake time, when its parked call has one. */
  readonly deadlines: ReadonlyMap<string, number>;
  /** The earliest wake among the hidden calls. */
  readonly until: number | undefined;
}

export const NO_WAITS: LiveWaits = {
  hidden: new Set(),
  awaited: new Set(),
  deadlines: new Map(),
  until: undefined,
};

/** An await's class names its first agent; the parked arguments name them all. */
function parkedAgents(args: ParkedCall["args"]): SessionId[] {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return [];
  const agents = args.agents;
  if (!Array.isArray(agents)) return [];
  return agents.flatMap((agent) =>
    typeof agent === "string" && agent !== "" ? [sessionId(agent)] : [],
  );
}

export function liveWaits(
  parts: readonly TurnPart[],
  parked: readonly ParkedCall[] | undefined,
  running: boolean,
): LiveWaits {
  if (!running) return NO_WAITS;
  const created = new Set<SessionId>();
  const hidden = new Set<string>();
  const awaited = new Set<SessionId>();
  const deadlines = new Map<string, number>();
  let until: number | undefined;
  for (const part of parts) {
    if (part.kind !== "tool" || part.class.kind !== "delegate") continue;
    if (part.class.role === "create") {
      created.add(part.class.session);
      continue;
    }
    if (part.result !== undefined) continue;
    const call = parked?.find((candidate) => candidate.callId === part.callId);
    if (call?.until !== undefined) deadlines.set(part.callId, call.until);
    if (!created.has(part.class.session)) continue;
    hidden.add(part.callId);
    awaited.add(part.class.session);
    if (call === undefined) continue;
    for (const agent of parkedAgents(call.args)) awaited.add(agent);
    if (call.until !== undefined && (until === undefined || call.until < until)) until = call.until;
  }
  return { hidden, awaited, deadlines, until };
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
 * opens the next one. A hidden wait is skipped outright, so it neither opens
 * nor splits an episode and the layout holds when it settles.
 */
export function displayTranscriptParts(
  parts: readonly TurnPart[],
  hidden: ReadonlySet<string> = NO_WAITS.hidden,
): TranscriptDisplayPart[] {
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
    if (part.kind === "tool" && hidden.has(part.callId)) continue;
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
