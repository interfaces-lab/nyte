import type { Thinking, UserContent } from "@nyte-ai/sdk";
import type { RemoteFacts } from "../model/state.ts";
import { GLYPHS } from "./constants.ts";
import { displayWidth, truncateDisplay } from "./width.ts";

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;

  if (seconds < 10) return `${seconds.toFixed(1)}s`;

  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m${String(Math.floor(seconds % 60))}s`;

  return `${String(Math.floor(minutes / 60))}h${String(minutes % 60)}m`;
}

export interface Timing {
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export function formatTiming(timing: Timing, now: number): string {
  return formatDuration(Math.max(0, (timing.endedAt ?? now) - timing.startedAt));
}

export function resultSummary(text: string): string | undefined {
  const trimmed = text.replace(/\n+$/, "");

  if (trimmed === "") return undefined;
  const lines = trimmed.split("\n").length;

  return lines === 1 ? undefined : `${String(lines)} lines`;
}

interface Preview {
  readonly text: string;
  readonly omitted: number;
}

export type PreviewCut =
  | { readonly kind: "head"; readonly max: number }
  | { readonly kind: "head-tail"; readonly head: number; readonly tail: number }
  | { readonly kind: "tail"; readonly max: number };

export function previewLines(text: string, cut: PreviewCut): Preview {
  const trimmed = text.replace(/\n+$/, "");

  if (trimmed === "") return { text: "", omitted: 0 };
  const lines = trimmed.split("\n");
  const kept = cut.kind === "head-tail" ? cut.head + cut.tail : cut.max;

  if (lines.length <= kept) return { text: trimmed, omitted: 0 };
  const omitted = lines.length - kept;

  switch (cut.kind) {
    case "head":
      return { text: lines.slice(0, cut.max).join("\n"), omitted };
    case "head-tail":
      return {
        text: [...lines.slice(0, cut.head), omittedLabel(omitted), ...lines.slice(-cut.tail)].join(
          "\n",
        ),
        omitted,
      };
    default:
      return { text: [earlierLinesLabel(omitted), ...lines.slice(-cut.max)].join("\n"), omitted };
  }
}

export function omittedLabel(omitted: number): string {
  return omitted === 1
    ? `${GLYPHS.ellipsis} 1 more line`
    : `${GLYPHS.ellipsis} ${String(omitted)} more lines`;
}

export function earlierLinesLabel(omitted: number): string {
  return omitted === 1
    ? `${GLYPHS.ellipsis} 1 earlier line`
    : `${GLYPHS.ellipsis} ${String(omitted)} earlier lines`;
}

export function unchangedLinesLabel(omitted: number): string {
  return omitted === 1
    ? `${GLYPHS.ellipsis} 1 unchanged line`
    : `${GLYPHS.ellipsis} ${String(omitted)} unchanged lines`;
}

export function userText(content: UserContent): string {
  if (typeof content === "string") return content;

  return content
    .map((part) => {
      switch (part.kind) {
        case "text":
          return part.text;
        case "file":
          return part.mime.startsWith("image/") ? "[image]" : `[${part.name}]`;
        case "reference":
          return `@${part.path}`;
        case "skill":
          return `/${part.name}`;
        default: {
          const _exhaustive: never = part;

          return _exhaustive;
        }
      }
    })
    .join("");
}

export function oneLine(text: string): string {
  return text.replaceAll("\r", "").replaceAll("\n", "⏎").trim();
}

const MAX_RETRY_CAUSE_CHARS = 80;

export function retryCause(reason: string): string {
  const collapsed = reason.replaceAll(/\s+/gu, " ").trim();

  if (collapsed === "") return "Request failed.";

  const bounded =
    collapsed.length <= MAX_RETRY_CAUSE_CHARS
      ? collapsed
      : `${collapsed.slice(0, MAX_RETRY_CAUSE_CHARS - 1).trimEnd()}…`;

  return /[.!?…]$/u.test(bounded) ? bounded : `${bounded}.`;
}

export interface PowerlineState {
  readonly workspace: string;
  readonly branch?: string;
  readonly dirty: boolean;
  readonly provider: string;
  readonly model: string;
  readonly effort?: Thinking;
  readonly statuses: readonly string[];
  readonly queued: number;
  readonly tokens: number;
  readonly window: number;
  readonly pct: number;
  readonly remote: RemoteFacts;
}

type PowerlineTone = "workspace" | "model" | "effort" | "queue" | "usage" | "remote";

type UsageLevel = "ok" | "warning" | "error";

export type PowerlineSegment =
  | { readonly text: string; readonly tone: Exclude<PowerlineTone, "usage" | "remote"> }
  | { readonly text: string; readonly tone: "usage"; readonly level: UsageLevel }
  | { readonly text: string; readonly tone: "remote"; readonly remote: RemoteFacts["kind"] };

function usageLevel(pct: number): UsageLevel {
  if (pct > 90) return "error";

  if (pct > 70) return "warning";

  return "ok";
}
export function clockDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  if (minutes < 60) {
    return restSeconds === 0
      ? `${String(minutes)}m`
      : `${String(minutes)}m${String(restSeconds).padStart(2, "0")}s`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  return restMinutes === 0
    ? `${String(hours)}h`
    : `${String(hours)}h${String(restMinutes).padStart(2, "0")}m`;
}

export function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);

  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;

  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

export function powerlineSegments(state: Partial<PowerlineState>): PowerlineSegment[] {
  const branch =
    state.dirty === undefined || state.branch === undefined
      ? ""
      : ` ${state.branch}${state.dirty ? "*" : ""}`;

  const badges = [...(state.effort === undefined ? [] : [state.effort]), ...(state.statuses ?? [])];

  const segments: PowerlineSegment[] = [
    ...(state.workspace === undefined
      ? []
      : [{ text: `${state.workspace}${branch}`, tone: "workspace" as const }]),
    ...(state.model === undefined ? [] : [{ text: state.model, tone: "model" as const }]),
  ];

  if (badges.length > 0) segments.push({ text: badges.join(" "), tone: "effort" });
  const tokens = state.tokens ?? 0;
  const window = state.window ?? 0;

  if (tokens > 0) {
    const pct = state.pct ?? 0;
    segments.push(
      window > 0
        ? {
            text: `${formatTokens(tokens)}/${formatTokens(window)} · ${String(pct)}% context`,
            tone: "usage",
            level: usageLevel(pct),
          }
        : { text: `${formatTokens(tokens)} tokens`, tone: "usage", level: "ok" },
    );
  }

  if (state.queued !== undefined && state.queued > 0)
    segments.push({ text: `${String(state.queued)} queued`, tone: "queue" });
  const remote = state.remote === undefined ? undefined : remoteText(state.remote);

  if (remote !== undefined && state.remote !== undefined)
    segments.push({ text: remote, tone: "remote", remote: state.remote.kind });

  return segments;
}

function remoteText(remote: RemoteFacts): string | undefined {
  switch (remote.kind) {
    case "off":
      return undefined;
    case "connecting":
      return "sharing…";
    case "shared":
      return remote.devices === 0
        ? "shared"
        : `shared · ${String(remote.devices)} ${remote.devices === 1 ? "device" : "devices"}`;
    case "interrupted":
      return "sharing paused";
    default: {
      const _exhaustive: never = remote;

      return _exhaustive;
    }
  }
}

function joinSegments(segments: readonly PowerlineSegment[]): string {
  return ` ${segments.map((segment) => segment.text).join(` ${GLYPHS.separator} `)}`;
}

export function fitPowerlineSegments(
  segments: readonly PowerlineSegment[],
  maxWidth: number,
): PowerlineSegment[] {
  let kept = [...segments];
  const droppable: readonly PowerlineTone[] = ["usage", "workspace", "queue", "effort", "remote"];

  for (const tone of droppable) {
    if (displayWidth(joinSegments(kept)) <= maxWidth) break;
    kept = kept.filter((segment) => segment.tone !== tone);
  }

  return kept;
}

export const TERMINAL_TITLE_BASE = "nyte";

const TERMINAL_TITLE_MAX_CHARS = 72;

const CONTROL_CHARACTERS = /\p{Cc}/gu;

export function singleLine(text: string): string {
  return text.replaceAll(CONTROL_CHARACTERS, " ").replaceAll(/\s+/gu, " ").trim();
}

export function terminalTitle(name: string | undefined): string {
  const clean = singleLine(name ?? "");

  if (clean === "") return TERMINAL_TITLE_BASE;
  const room = TERMINAL_TITLE_MAX_CHARS - TERMINAL_TITLE_BASE.length - " - ".length;

  return `${TERMINAL_TITLE_BASE} - ${truncateDisplay(clean, room, "…")}`;
}

/** The message of a thrown value, which need not be an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
