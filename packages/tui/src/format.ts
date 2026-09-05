/**
 * Pure formatting helpers shared by the TUI and print mode. Nothing here
 * touches a renderer.
 */
import type { ThinkingLevel } from "@nyte-ai/core";
import type { UserMessage } from "@nyte-ai/schema";
import { parsePatch, type StructuredPatch } from "diff";
import { GLYPHS, SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./constants.ts";
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

/** The spinner frame for a run that started `elapsedMs` ago. */
export function spinnerFrame(elapsedMs: number): string {
  const index = Math.floor(elapsedMs / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0];
}

/** What a finished tool produced, for the dim tail of its heading. */
export function resultSummary(text: string): string | undefined {
  const trimmed = text.replace(/\n+$/, "");
  if (trimmed === "") return undefined;
  const lines = trimmed.split("\n").length;
  return lines === 1 ? undefined : `${String(lines)} lines`;
}

export interface Preview {
  readonly text: string;
  readonly omitted: number;
}

/**
 * A capped view of `text`: the first `max` lines, or, when `tail` is given,
 * the first `max` and the last `tail` with the middle dropped.
 */
export function previewLines(text: string, max: number, tail = 0): Preview {
  const trimmed = text.replace(/\n+$/, "");
  if (trimmed === "") return { text: "", omitted: 0 };
  const lines = trimmed.split("\n");
  if (lines.length <= max + tail) return { text: trimmed, omitted: 0 };
  const head = lines.slice(0, max);
  const omitted = lines.length - max - tail;
  if (tail === 0) return { text: head.join("\n"), omitted };
  return {
    text: [...head, omittedLabel(omitted), ...lines.slice(-tail)].join("\n"),
    omitted: 0,
  };
}

export function omittedLabel(omitted: number): string {
  return omitted === 1
    ? `${GLYPHS.ellipsis} 1 more line`
    : `${GLYPHS.ellipsis} ${String(omitted)} more lines`;
}

export function unchangedLinesLabel(omitted: number): string {
  return omitted === 1
    ? `${GLYPHS.ellipsis} 1 unchanged line`
    : `${GLYPHS.ellipsis} ${String(omitted)} unchanged lines`;
}

export interface DiffSection {
  readonly patch: string;
  readonly omittedBefore: number;
  readonly rows: number;
}

interface HunkStart {
  readonly index: number;
  readonly newStart: number;
  readonly newLines: number;
}

function hunkRows(hunk: string): number {
  const [, ...lines] = hunk.replace(/\n$/u, "").split("\n");
  return lines.filter((line) => !line.startsWith("\\")).length;
}

/**
 * Split a patch into independently sized hunks and count the unchanged lines
 * before each one, so the transcript uses one scroller for the whole
 * conversation instead of clipping a tall diff into a nested viewport.
 *
 * Based on OpenCode's patch-hunk presentation:
 * https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/util/diff.ts
 */
export function diffSections(patch: string): DiffSection[] {
  const starts: HunkStart[] = [];
  for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@.*$/gmu)) {
    const newStart = match[1];
    if (newStart === undefined) continue;
    starts.push({
      index: match.index,
      newStart: Number(newStart),
      newLines: Number(match[2] ?? "1"),
    });
  }
  if (starts.length === 0) return [{ patch, omittedBefore: 0, rows: 0 }];

  const prefix = patch.slice(0, starts[0]?.index);
  let previousEnd = 1;
  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? patch.length;
    const hunk = patch.slice(start.index, end);
    const omittedBefore = Math.max(0, start.newStart - previousEnd);
    previousEnd = start.newStart + start.newLines;
    return { patch: prefix + hunk, omittedBefore, rows: hunkRows(hunk) };
  });
}

export interface OutputDiffFile {
  readonly patch: string;
  readonly path?: string;
}

export interface OutputDiff {
  readonly files: readonly OutputDiffFile[];
  readonly before?: string;
  readonly after?: string;
}

function substantivePatch(patch: StructuredPatch): boolean {
  return (
    patch.hunks.length > 0 ||
    patch.isBinary === true ||
    patch.isRename === true ||
    patch.isCopy === true ||
    patch.isCreate === true ||
    patch.isDelete === true ||
    patch.oldMode !== patch.newMode
  );
}

function outputDiffStart(text: string): number | undefined {
  const git = /(^|\n)diff --git [^\n]+/.exec(text);
  const unified = /(^|\n)--- [^\n]+\n\+\+\+ [^\n]+/.exec(text);
  const starts = [git, unified]
    .filter((match) => match !== null)
    .map((match) => match.index + (match[1]?.length ?? 0));
  return starts.length === 0 ? undefined : Math.min(...starts);
}

function diffPath(patch: StructuredPatch): string | undefined {
  const named =
    patch.newFileName !== undefined && patch.newFileName !== "/dev/null"
      ? patch.newFileName
      : patch.oldFileName;
  if (named === undefined || named === "/dev/null") return undefined;
  return patch.isGit === true && /^[ab]\//.test(named) ? named.slice(2) : named;
}

function withPath(patch: string, path: string | undefined): OutputDiffFile {
  return path === undefined ? { patch } : { patch, path };
}

function outputDiffFiles(patch: string, parsed: readonly StructuredPatch[]): OutputDiffFile[] {
  const starts = [...patch.matchAll(/^diff --git [^\n]+/gm)].map((match) => match.index);
  if (starts.length !== parsed.length || starts.length === 0) {
    const only = parsed.length === 1 ? parsed[0] : undefined;
    return [withPath(patch, only === undefined ? undefined : diffPath(only))];
  }
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? patch.length;
    const file = parsed[index];
    return withPath(
      patch.slice(start, end).replace(/\n+$/, ""),
      file === undefined ? undefined : diffPath(file),
    );
  });
}

function trimSection(text: string): string | undefined {
  const trimmed = text.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "");
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Find a complete unified diff inside tool output. Shell calls often append a
 * status or diff-stat command, so try progressively shorter prefixes and keep
 * any text before or after the patch as ordinary output.
 */
export function diffFromOutput(text: string): OutputDiff | undefined {
  const start = outputDiffStart(text);
  if (start === undefined) return undefined;
  const before = trimSection(text.slice(0, start));
  const lines = text.slice(start).split("\n");
  for (let end = lines.length; end > 0; end--) {
    const patch = lines.slice(0, end).join("\n").replace(/\n+$/, "");
    let parsed: StructuredPatch[];
    try {
      parsed = parsePatch(patch);
    } catch {
      continue;
    }
    if (parsed.length === 0 || !parsed.some(substantivePatch)) continue;
    const after = trimSection(lines.slice(end).join("\n"));
    let diff: OutputDiff = { files: outputDiffFiles(patch, parsed) };
    if (before !== undefined) diff = { ...diff, before };
    if (after !== undefined) diff = { ...diff, after };
    return diff;
  }
  return undefined;
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
  /** Tokens reported by the last settled assistant turn. */
  readonly tokens?: number;
  /** Estimated share of the model's context window in use, whole percent. */
  readonly pct?: number;
}

export type PowerlineTone = "workspace" | "model" | "effort" | "queue" | "usage";

export interface PowerlineSegment {
  readonly text: string;
  readonly tone: PowerlineTone;
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

export function powerlineSegments(state: PowerlineState): PowerlineSegment[] {
  const branch = state.branch === undefined ? "" : ` ${state.branch}${state.dirty ? "*" : ""}`;
  const badges = [...(state.effort === undefined ? [] : [state.effort]), ...state.statuses];
  const segments: PowerlineSegment[] = [
    { text: `${state.workspace}${branch}`, tone: "workspace" },
    { text: state.model, tone: "model" },
  ];
  if (badges.length > 0) segments.push({ text: badges.join(" "), tone: "effort" });
  if (state.tokens !== undefined && state.tokens > 0) {
    segments.push({
      text: `${formatTokens(state.tokens)} tokens${state.pct === undefined ? "" : ` · ${String(state.pct)}% context`}`,
      tone: "usage",
    });
  }
  if (state.queued > 0) segments.push({ text: `${String(state.queued)} queued`, tone: "queue" });
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

export interface HintGroup {
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
