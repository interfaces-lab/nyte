import { randomBytes } from "node:crypto";
import type { TextContent } from "@nyte-ai/schema";
import { truncateHead, formatSize } from "@nyte-ai/core/plugins";
import type { TruncationResult } from "@nyte-ai/core/plugins";
import type {
  BrowserPageState,
  BrowserConsoleEntry,
  BrowserNode,
  BrowserActionFailure,
  BrowserEvaluateResult,
} from "./browser-agent.ts";

const PAGE_MAX_LINES = 800;
const PAGE_MAX_BYTES = 24 * 1024;
const CONSOLE_MAX_ENTRIES = 200;
const CONSOLE_MAX_BYTES = 16 * 1024;
const EVALUATE_MAX_BYTES = 16 * 1024;

/** Unguessable, so page text can never close the fence it is quoted inside. */
function randomMarker(): string {
  return `END_PAGE_${randomBytes(16).toString("hex")}`;
}

function fenced(text: string, marker: string): string {
  return text
    .split("\n")
    .map((line) => (line === marker ? `\u200B${line}` : line))
    .join("\n");
}

/** Separators and bidi overrides can forge report structure without being C0 controls. */
const UNICODE_FORGERY = /[\u2028\u2029\u202a-\u202e]/g;

/** Page text kept as a block: newlines and tabs survive, cursor control does not. */
function stripControls(text: string): string {
  // Matching control characters is the point: page text must not move a cursor.
  // oxlint-disable-next-line no-control-regex
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0d\x0e-\x1f\x7f-\x9f]/g, "")
    .replace(UNICODE_FORGERY, "");
}

/**
 * Every page-derived string that lands on one report line. Newlines and tabs go
 * too, so a crafted title or role cannot forge a line of its own.
 */
export function sanitizeLine(text: string): string {
  // Matching control characters is the point: page text must not forge a line.
  // oxlint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, "").replace(UNICODE_FORGERY, "");
}

/** Escape quotes so a name cannot forge a tree line. */
function escapeName(name: string): string {
  return sanitizeLine(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function serializeNode(node: BrowserNode): string {
  const parts = [`ref=${sanitizeLine(node.ref)}`];
  if (node.value !== undefined) parts.push(`value="${escapeName(node.value)}"`);
  if (node.href !== undefined) parts.push(`href="${escapeName(node.href)}"`);
  if (node.level !== undefined) parts.push(`level=${String(node.level)}`);
  if (node.disabled === true) parts.push("disabled");
  if (node.checked === true) parts.push("checked");
  if (node.expanded === true) parts.push("expanded");
  if (node.editable === true) parts.push("editable");
  return `- ${escapeName(node.role)} "${escapeName(node.name)}" ${parts.join(" ")}`;
}

function truncationNotice(result: TruncationResult, label: string, nextTool: string): string {
  if (!result.truncated) return "";
  const showed = `${String(result.outputLines)}/${String(result.totalLines)} lines`;
  const bytes = `${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}`;
  return `\n[${label} truncated: showed ${showed} (${bytes}). Use \`${nextTool}\` to see more.]`;
}

export function describeFailure(failure: BrowserActionFailure): string {
  switch (failure.kind) {
    case "stale_document":
      return `Stale ref "${sanitizeLine(failure.ref)}": the page has navigated since the last snapshot. Call browser_snapshot first.`;
    case "unknown_ref":
      return `Unknown ref "${sanitizeLine(failure.ref)}". It does not exist in the current snapshot.`;
    case "detached":
      return `Element "${sanitizeLine(failure.ref)}" is no longer in the DOM.`;
    case "not_visible":
      return `Element "${sanitizeLine(failure.ref)}" is not visible on screen.`;
    case "occluded":
      return `Element "${sanitizeLine(failure.ref)}" is covered by ${escapeName(failure.by.role)} "${escapeName(failure.by.name)}".`;
    case "no_window":
      return "The browser window has never been shown. Mouse input requires the window to be visible at least once.";
    case "closed":
      return "The browser page has been closed.";
    case "crashed":
      return `The browser page crashed: ${sanitizeLine(failure.reason)}.`;
    default:
      return failure satisfies never;
  }
}

/** Page text is quoted between two copies of an unguessable marker, never trusted. */
export function renderPageReport(input: { readonly state: BrowserPageState }): {
  content: TextContent[];
} {
  const { state } = input;
  const marker = randomMarker();
  const header = [
    `url: ${sanitizeLine(state.url)}`,
    `title: ${sanitizeLine(state.title)}`,
    `snapshot: ${String(state.snapshot)}`,
    `viewport: ${String(state.viewport.width)}×${String(state.viewport.height)}`,
    `scroll: ${String(state.scroll.y)}/${String(state.scroll.height)}`,
    state.loading ? "status: loading" : undefined,
    state.blocked > 0 ? `blocked: ${String(state.blocked)} requests` : undefined,
    state.error && `error: ${String(state.error.code)} ${sanitizeLine(state.error.description)}`,
  ].filter((line) => typeof line === "string");

  const withheld =
    state.totalNodes > state.nodes.length
      ? `\n[${String(state.totalNodes - state.nodes.length)} more elements not shown. Narrow with browser_snapshot ref=<ref>.]`
      : "";
  const truncated = truncateHead(state.text, {
    maxLines: PAGE_MAX_LINES,
    maxBytes: PAGE_MAX_BYTES,
  });
  const text = fenced(stripControls(truncated.content), marker);

  const lines = [header.join("\n"), ""];
  if (state.nodes.length > 0) {
    lines.push(
      "Elements:",
      marker,
      fenced(state.nodes.map(serializeNode).join("\n"), marker),
      marker,
      withheld,
    );
  }
  const notice = truncationNotice(truncated, "Page text", "browser_snapshot");
  if (text.length > 0) lines.push("", "Page text:", marker, text, marker, notice);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export function renderConsoleReport(entries: readonly BrowserConsoleEntry[]): {
  content: TextContent[];
} {
  if (entries.length === 0) return { content: [{ type: "text", text: "No console entries." }] };
  const marker = randomMarker();
  const raw = entries
    .slice(0, CONSOLE_MAX_ENTRIES)
    .map((entry) => `[${entry.level}] ${stripControls(entry.message)} (${entry.source})`)
    .join("\n");
  const truncated = truncateHead(raw, {
    maxLines: CONSOLE_MAX_ENTRIES,
    maxBytes: CONSOLE_MAX_BYTES,
  });
  const safe = fenced(stripControls(truncated.content), marker);
  const notice = truncationNotice(truncated, "Console", "browser_console");
  const text = `Console entries (newest first):\n${marker}\n${safe}\n${marker}${notice}`;
  return { content: [{ type: "text", text }] };
}

export function renderEvaluateReport(result: BrowserEvaluateResult): { content: TextContent[] } {
  if (result.kind === "threw") {
    return { content: [{ type: "text", text: `Page threw: ${stripControls(result.message)}` }] };
  }
  const bytes = Buffer.byteLength(result.json, "utf-8");
  if (bytes <= EVALUATE_MAX_BYTES) {
    return { content: [{ type: "text", text: `Result:\n${stripControls(result.json)}` }] };
  }
  const truncated = truncateHead(result.json, { maxBytes: EVALUATE_MAX_BYTES, maxLines: 2000 });
  const text = `Result (truncated, ${formatSize(bytes)} total):\n${stripControls(truncated.content)}`;
  return { content: [{ type: "text", text }] };
}
