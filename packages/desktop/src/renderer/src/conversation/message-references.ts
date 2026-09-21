/**
 * What a composer chip stands for, and the one text spelling each kind has.
 *
 * A draft is plain text: every chip owns an exact token in it (`@file://…`,
 * `[$skill](path)`, `@current-conversation`, `@clipboard/<n>:…`), so a draft
 * string restores its chips without a second document. A sent message keeps
 * the provider contract (text and images): skill chips become instruction
 * sentences where they were inserted, clipboard chips unwrap to their body,
 * and those sentences read back as chips.
 */
import type { MentionFile } from "@nyte-ai/client";

export type MessageReference =
  | { readonly kind: "file"; readonly file: MentionFile }
  | { readonly kind: "skill"; readonly name: string; readonly path: string }
  | { readonly kind: "mention"; readonly id: "current-conversation" }
  | { readonly kind: "clipboard"; readonly body: string };

type ClipboardReference = Extract<MessageReference, { readonly kind: "clipboard" }>;

type MessagePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reference"; readonly reference: MessageReference; readonly source: string };

export const CONVERSATION_MENTION: MessageReference = {
  kind: "mention",
  id: "current-conversation",
};
const CONVERSATION_MENTION_TEXT = "@current-conversation";
const CLIPBOARD_PASTE_MAX_INLINE_CHARS = 10_000;
const CLIPBOARD_TOKEN_PREFIX = "@clipboard/";

/** `[$name](path)`: the persisted skill link the transcript already hides. */
const SKILL_LINK_PATTERN = /\[\$(?<name>[^\]\r\n]+)\]\((?<path>[^)\r\n]*)\)/gu;
/** The expanded form persisted by clients that load skill instructions before sending. */
const SKILL_INVOCATION_PATTERN =
  /<skill name="(?<invocationName>[^"\r\n]*)" location="(?<invocationPath>[^"\r\n]*)">\n[\s\S]*?\n<\/skill>(?:\n\n)?/gu;
const FILE_URL_PATTERN = /@file:\/\/[^\s<>"]+/gu;
const DRAFT_TOKEN_PATTERN = new RegExp(
  [
    FILE_URL_PATTERN.source,
    SKILL_LINK_PATTERN.source,
    // The conversation mention is a whole word, like the menu writes it.
    `(?<=^|\\s)${CONVERSATION_MENTION_TEXT}(?=\\s|$)`,
  ].join("|"),
  "gu",
);
const SKILL_INSTRUCTION_PATTERN = /Use the (?<instructionName>\S+) skill\./gu;

export function skillInstruction(name: string): string {
  return `Use the ${name} skill.`;
}

/** Length-prefixed JSON so a body with newlines stays one TextNode. */
function encodeClipboardToken(body: string): string {
  const payload = JSON.stringify(body);
  return `${CLIPBOARD_TOKEN_PREFIX}${String(payload.length)}:${payload}`;
}

function decodeClipboardToken(
  text: string,
  start: number,
): { readonly end: number; readonly body: string } | undefined {
  if (!text.startsWith(CLIPBOARD_TOKEN_PREFIX, start)) return undefined;
  const lengthStart = start + CLIPBOARD_TOKEN_PREFIX.length;
  const colon = text.indexOf(":", lengthStart);
  if (colon <= lengthStart) return undefined;
  const lengthText = text.slice(lengthStart, colon);
  if (!/^[0-9]+$/u.test(lengthText)) return undefined;
  const length = Number(lengthText);
  const payloadStart = colon + 1;
  const payloadEnd = payloadStart + length;
  if (payloadEnd > text.length) return undefined;
  const payload = text.slice(payloadStart, payloadEnd);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "string" || parsed === "") return undefined;
  return { end: payloadEnd, body: parsed };
}

function nextClipboardToken(
  text: string,
  from: number,
): { readonly start: number; readonly end: number; readonly body: string } | undefined {
  let search = from;
  while (search < text.length) {
    const start = text.indexOf(CLIPBOARD_TOKEN_PREFIX, search);
    if (start === -1) return undefined;
    const decoded = decodeClipboardToken(text, start);
    if (decoded !== undefined) return { start, end: decoded.end, body: decoded.body };
    search = start + 1;
  }
  return undefined;
}

export function clipboardReferenceFromPaste(text: string): ClipboardReference | undefined {
  const normalized = text.replace(/\r\n/gu, "\n").replace(/\n+$/u, "");
  if (normalized.length <= CLIPBOARD_PASTE_MAX_INLINE_CHARS) return undefined;
  return { kind: "clipboard", body: normalized };
}

/** The token a reference occupies in a draft. */
export function referenceText(reference: MessageReference): string {
  switch (reference.kind) {
    case "file":
      return `@${reference.file.url}`;
    case "skill":
      return `[$${reference.name}](${reference.path})`;
    case "mention":
      return CONVERSATION_MENTION_TEXT;
    case "clipboard":
      return encodeClipboardToken(reference.body);
    default: {
      const exhaustive: never = reference;
      return exhaustive;
    }
  }
}

export function referenceLabel(reference: MessageReference): string {
  switch (reference.kind) {
    case "file":
      return reference.file.label;
    case "skill":
      return `/${reference.name}`;
    case "mention":
      return "Current conversation";
    case "clipboard": {
      const lines = reference.body.split("\n").length;
      return `Clipboard (${String(lines)} ${lines === 1 ? "line" : "lines"})`;
    }
    default: {
      const exhaustive: never = reference;
      return exhaustive;
    }
  }
}

/** The full reference behind a compact label. */
export function referenceTitle(reference: MessageReference): string {
  switch (reference.kind) {
    case "file":
      return reference.file.path;
    case "skill":
      return reference.path === "" ? skillInstruction(reference.name) : reference.path;
    case "mention":
      return "Use this conversation as context";
    case "clipboard":
      return "Pasted text";
    default: {
      const exhaustive: never = reference;
      return exhaustive;
    }
  }
}

export function referencePromptText(reference: MessageReference): string {
  switch (reference.kind) {
    case "file":
      return referenceText(reference);
    case "skill":
      return skillInstruction(reference.name);
    case "clipboard":
      return reference.body;
    case "mention":
      return "";
    default: {
      const exhaustive: never = reference;
      return exhaustive;
    }
  }
}

export function sameReference(left: MessageReference, right: MessageReference): boolean {
  switch (left.kind) {
    case "file":
      return right.kind === "file" && right.file.url === left.file.url;
    case "skill":
      return right.kind === "skill" && right.name === left.name;
    case "mention":
      return right.kind === "mention" && right.id === left.id;
    case "clipboard":
      return right.kind === "clipboard" && right.body === left.body;
    default: {
      const exhaustive: never = left;
      return exhaustive;
    }
  }
}

export function isFolder(file: MentionFile): boolean {
  return file.label.endsWith("/");
}

/** A canonical `file:` URL describes its file well enough to draw without a workspace catalog. */
export function fileFromUrl(url: string): MentionFile | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "file:") return undefined;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
  const directory = path.endsWith("/");
  const name = path.replace(/\/$/u, "").split("/").at(-1) ?? "";
  return {
    path,
    url,
    displayPath: path,
    label: name === "" ? "/" : `${name}${directory ? "/" : ""}`,
  };
}

interface DraftParseOptions {
  readonly form: "draft";
  /** Catalog entries by URL; a known file keeps its workspace label and relative path. */
  readonly files?: ReadonlyMap<string, MentionFile>;
  /** A token still being typed at the end of the text keeps its letters until a delimiter arrives. */
  readonly complete?: boolean;
}

interface MessageParseOptions {
  readonly form: "message";
}

type MessageParseOptionsUnion = DraftParseOptions | MessageParseOptions;

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function draftReference(
  match: RegExpExecArray,
  options: DraftParseOptions,
): MessageReference | undefined {
  const token = match[0];
  const groups = match.groups ?? {};
  if (token.startsWith("@file://")) {
    const url = token.slice(1);
    const file = options.files?.get(url) ?? fileFromUrl(url);
    return file === undefined ? undefined : { kind: "file", file };
  }
  if (groups["name"] !== undefined) {
    return { kind: "skill", name: groups["name"], path: groups["path"] ?? "" };
  }
  if (token === CONVERSATION_MENTION_TEXT) return CONVERSATION_MENTION;
  return undefined;
}

function draftParts(text: string, options: DraftParseOptions): readonly MessagePart[] {
  const parts: MessagePart[] = [];
  let cursor = 0;
  const tokens = [...text.matchAll(DRAFT_TOKEN_PATTERN)];
  let tokenIndex = 0;
  while (cursor < text.length) {
    const clipboard = nextClipboardToken(text, cursor);
    while (tokenIndex < tokens.length && (tokens[tokenIndex]?.index ?? 0) < cursor) {
      tokenIndex += 1;
    }
    const token = tokens[tokenIndex];
    const clipboardStart = clipboard?.start;
    const tokenStart = token?.index;
    if (
      clipboard !== undefined &&
      clipboardStart !== undefined &&
      (tokenStart === undefined || clipboardStart <= tokenStart)
    ) {
      if (clipboard.start > cursor) {
        parts.push({ kind: "text", text: text.slice(cursor, clipboard.start) });
      }
      parts.push({
        kind: "reference",
        reference: { kind: "clipboard", body: clipboard.body },
        source: text.slice(clipboard.start, clipboard.end),
      });
      cursor = clipboard.end;
      continue;
    }
    if (token === undefined || tokenStart === undefined) {
      parts.push({ kind: "text", text: text.slice(cursor) });
      return parts;
    }
    const reference = draftReference(token, options);
    if (reference === undefined) {
      tokenIndex += 1;
      continue;
    }
    const end = token.index + token[0].length;
    // A skill link closes itself; the other tokens only end at a delimiter.
    const open = reference.kind !== "skill" && end === text.length;
    const known = reference.kind === "file" && options.files?.has(reference.file.url) === true;
    if (open && options.complete === false && !known) {
      tokenIndex += 1;
      continue;
    }
    if (token.index > cursor) parts.push({ kind: "text", text: text.slice(cursor, token.index) });
    parts.push({ kind: "reference", reference, source: token[0] });
    cursor = end;
    tokenIndex += 1;
  }
  return parts;
}

/**
 * Split text into plain runs and references. A draft yields its chips back; a
 * sent message yields the skill chips its instruction sentences stand for,
 * the file mentions in its body, and any persisted skill link.
 */
export function messageParts(
  text: string,
  options: MessageParseOptionsUnion,
): readonly MessagePart[] {
  if (options.form === "draft") return draftParts(text, options);
  const parts: MessagePart[] = [];
  let cursor = 0;
  const pattern = new RegExp(
    [
      FILE_URL_PATTERN.source,
      SKILL_LINK_PATTERN.source,
      SKILL_INVOCATION_PATTERN.source,
      SKILL_INSTRUCTION_PATTERN.source,
    ].join("|"),
    "gu",
  );
  for (const match of text.matchAll(pattern)) {
    const groups = match.groups ?? {};
    let reference: MessageReference | undefined;
    if (match[0].startsWith("@file://")) {
      const file = fileFromUrl(match[0].slice(1));
      reference = file === undefined ? undefined : { kind: "file", file };
    } else if (groups["invocationName"] !== undefined) {
      reference = {
        kind: "skill",
        name: unescapeXml(groups["invocationName"]),
        path: unescapeXml(groups["invocationPath"] ?? ""),
      };
    } else if (groups["name"] !== undefined) {
      reference = { kind: "skill", name: groups["name"], path: groups["path"] ?? "" };
    } else if (groups["instructionName"] !== undefined) {
      reference = { kind: "skill", name: groups["instructionName"], path: "" };
    }
    if (reference === undefined) continue;
    if (match.index > cursor) parts.push({ kind: "text", text: text.slice(cursor, match.index) });
    parts.push({ kind: "reference", reference, source: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) });
  return parts;
}

/** The draft that edits a sent message. */
export function messageDraftText(text: string): string {
  return messageParts(text, { form: "message" })
    .map((part) => (part.kind === "text" ? part.text : referenceText(part.reference)))
    .join("");
}

/** Sidebar drafts use the first visible line, including selected skills and file labels. */
export function draftPreviewText(text: string): string {
  const visible = messageParts(text, { form: "draft", files: new Map(), complete: true })
    .map((part) => (part.kind === "text" ? part.text : referenceLabel(part.reference)))
    .join("")
    .trim();
  return visible.split(/\r?\n/u)[0] || "Draft";
}

interface WorkspaceFileIndex {
  readonly byPath: ReadonlyMap<string, MentionFile>;
  /** Basenames naming exactly one file; an ambiguous one would link to the wrong file. */
  readonly byLabel: ReadonlyMap<string, MentionFile>;
}

/**
 * One index per file list. Every code span in a transcript resolves against
 * the same one instead of scanning thousands of paths per span, and the list
 * arrives from a query whose identity changes only when the files do.
 */
let indexed:
  | { readonly files: readonly MentionFile[]; readonly index: WorkspaceFileIndex }
  | undefined;

function workspaceFileIndex(files: readonly MentionFile[]): WorkspaceFileIndex {
  if (indexed?.files === files) return indexed.index;
  const byPath = new Map<string, MentionFile>();
  const byLabel = new Map<string, MentionFile>();
  const ambiguous = new Set<string>();
  for (const file of files) {
    byPath.set(file.displayPath, file);
    if (byLabel.has(file.label)) ambiguous.add(file.label);
    byLabel.set(file.label, file);
  }
  for (const label of ambiguous) byLabel.delete(label);
  const index = { byPath, byLabel };
  indexed = { files, index };
  return index;
}

/**
 * Inline code that names a real workspace file becomes a link; everything else
 * stays literal. A glob, a shell line, or a path that does not exist is not a
 * file, so the reader never gets a link that goes nowhere. Matching the
 * basename lets prose say `thread.tsx` when only one file answers to it.
 */
export function inlineCodeReference(
  text: string,
  files: readonly MentionFile[],
): MessageReference | undefined {
  const candidate = text.trim().replace(/^\.\//u, "");
  if (candidate === "" || /[\s*?{}[\]]/u.test(candidate)) return undefined;
  const index = workspaceFileIndex(files);
  const file =
    index.byPath.get(candidate) ??
    (candidate.includes("/") ? undefined : index.byLabel.get(candidate));
  return file === undefined ? undefined : { kind: "file", file };
}
