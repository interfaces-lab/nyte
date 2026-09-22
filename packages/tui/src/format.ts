/**
 * Pure formatting helpers shared by the TUI and print mode. Nothing here
 * touches a renderer.
 */
import type { ThinkingLevel } from "@nyte-ai/core";
import type { UserMessage } from "@nyte-ai/schema";
import { GLYPHS } from "./constants.ts";
import { displayWidth, truncateDisplay } from "./width.ts";

/** One heading per tool call: the tool's own title after its name, else the name alone. */
export function toolHeading(toolName: string, title: string | undefined): string {
  return title === undefined ? toolName : `${toolName} ${title}`;
}

/** How long an operation took, read as a duration rather than a clock. */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000;

  if (seconds < 10) return `${seconds.toFixed(1)}s`;

  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m${String(Math.floor(seconds % 60))}s`;

  return `${String(Math.floor(minutes / 60))}h${String(minutes % 60)}m`;
}

/** What a finished tool produced, for the dim tail of its heading. */
export function resultSummary(text: string): string | undefined {
  const trimmed = text.replace(/\n+$/, "");

  if (trimmed === "") return undefined;
  const lines = trimmed.split("\n").length;

  return lines === 1 ? undefined : `${String(lines)} lines`;
}

interface Preview {
  readonly text: string;
  /** Lines the cut dropped. Head cuts leave labelling to the caller; the others embed theirs. */
  readonly omitted: number;
}

export type PreviewCut =
  | { readonly kind: "head"; readonly max: number }
  | { readonly kind: "head-tail"; readonly head: number; readonly tail: number }
  | { readonly kind: "tail"; readonly max: number };

/**
 * A capped view of `text`: its first lines, its first and last lines with the
 * middle dropped and labelled, or its last lines with the label above them.
 */
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

/** Flatten user content parts to display text; images become a marker. */
export function userText(content: UserMessage["content"]): string {
  if (!Array.isArray(content)) return content;

  return content
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "image":
          return "[image]";
        default: {
          const _exhaustive: never = part;

          return _exhaustive;
        }
      }
    })
    .join("");
}

/** One display line from possibly multi-line text, for compact rows. */
export function oneLine(text: string): string {
  return text.replaceAll("\r", "").replaceAll("\n", "⏎").trim();
}

const MAX_RETRY_CAUSE_CHARS = 80;

/** A provider error trimmed to one transcript line and punctuated. */
export function retryCause(errorMessage: string): string {
  const collapsed = errorMessage.replaceAll(/\s+/gu, " ").trim();

  if (collapsed === "") return "Request failed.";

  const bounded =
    collapsed.length <= MAX_RETRY_CAUSE_CHARS
      ? collapsed
      : `${collapsed.slice(0, MAX_RETRY_CAUSE_CHARS - 1).trimEnd()}…`;

  return /[.!?…]$/u.test(bounded) ? bounded : `${bounded}.`;
}

/** Composer metadata. */
export interface PowerlineState {
  readonly workspace: string;
  readonly branch?: string;
  readonly dirty: boolean;
  readonly provider: string;
  readonly model: string;
  readonly effort?: ThinkingLevel;
  /** Status badges from plugin settings (e.g. "fast"), beside the thinking level. */
  /** Badges from plugin settings and the plugin status items, in that order. */
  readonly statuses: readonly string[];
  readonly queued: number;
  /** Tokens reported by the last settled assistant turn; 0 until one settles. */
  readonly tokens: number;
  /** The model's context window; 0 until the model is known. */
  readonly window: number;
  /**
   * Core's whole-percent estimate of the window in use. It counts the
   * measured tokens plus the estimated tail after them, so it is not derivable
   * from `tokens / window` here. Meaningful only when `window > 0`.
   */
  readonly pct: number;
}

type PowerlineTone = "workspace" | "model" | "effort" | "queue" | "usage";

type UsageLevel = "ok" | "warning" | "error";

export type PowerlineSegment =
  | { readonly text: string; readonly tone: Exclude<PowerlineTone, "usage"> }
  | { readonly text: string; readonly tone: "usage"; readonly level: UsageLevel };

/** Strict thresholds: past 70 % warns, past 90 % alarms. */
function usageLevel(pct: number): UsageLevel {
  if (pct > 90) return "error";

  if (pct > 70) return "warning";

  return "ok";
}

/** `42_000` → `42s`, `258_000` → `4m18s`, `3_720_000` → `1h02m`. */
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

/** `12340` → `12.3k`; whole counts below a thousand stay bare. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);

  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;

  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

export function powerlineSegments(state: Partial<PowerlineState>): PowerlineSegment[] {
  const branch =
    state.dirty === undefined
      ? " · git loading"
      : state.branch === undefined
        ? ""
        : ` ${state.branch}${state.dirty ? "*" : ""}`;

  const badges = [...(state.effort === undefined ? [] : [state.effort]), ...(state.statuses ?? [])];

  const segments: PowerlineSegment[] = [
    { text: `${state.workspace ?? "workspace loading"}${branch}`, tone: "workspace" },
    { text: state.model ?? "model loading", tone: "model" },
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

  return segments;
}

function joinSegments(segments: readonly PowerlineSegment[]): string {
  return ` ${segments.map((segment) => segment.text).join(` ${GLYPHS.separator} `)}`;
}

/** Drop low-priority metadata as the terminal narrows. Model survives. */
export function fitPowerlineSegments(
  segments: readonly PowerlineSegment[],
  maxWidth: number,
): PowerlineSegment[] {
  let kept = [...segments];
  const droppable: readonly PowerlineTone[] = ["usage", "workspace", "queue", "effort"];

  for (const tone of droppable) {
    if (displayWidth(joinSegments(kept)) <= maxWidth) break;
    kept = kept.filter((segment) => segment.tone !== tone);
  }

  return kept;
}

interface HintGroup {
  readonly key: string;
  readonly label: string;
}

const HINT_SEPARATOR = " · ";

/**
 * Split a hint row into keycaps and what they do. Every hint string is written
 * `<keycap> <what it does>`, so the first token is the cap and the rest is the
 * description.
 */
export function hintGroups(text: string): HintGroup[] {
  const groups: HintGroup[] = [];

  for (const chunk of text.split(HINT_SEPARATOR)) {
    const trimmed = chunk.trim();

    if (trimmed === "") continue;
    const space = trimmed.indexOf(" ");

    if (space < 0) groups.push({ key: trimmed, label: "" });
    else groups.push({ key: trimmed.slice(0, space), label: trimmed.slice(space + 1) });
  }

  return groups;
}

export const TERMINAL_TITLE_BASE = "nyte";

const TERMINAL_TITLE_MAX_CHARS = 72;

/** C0 and C1, which is where the OSC terminator and the bell live. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/** `nyte` until the chat has a name, then `nyte - <name>`, with control characters stripped. */
export function terminalTitle(name: string | undefined): string {
  const clean = (name ?? "").replaceAll(CONTROL_CHARACTERS, " ").replaceAll(/\s+/gu, " ").trim();

  if (clean === "") return TERMINAL_TITLE_BASE;
  const room = TERMINAL_TITLE_MAX_CHARS - TERMINAL_TITLE_BASE.length - " - ".length;

  return `${TERMINAL_TITLE_BASE} - ${truncateDisplay(clean, room, "…")}`;
}
