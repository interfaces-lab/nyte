/**
 * What a composer chip stands for, and the one text spelling each kind has.
 *
 * A draft is plain text: every chip owns an exact token in it (`@file://…`,
 * `[$skill](path)`, `@current-conversation`, `@clipboard/<n>:…`), so a draft
 * string restores its chips without a second document. A sent message carries
 * file and skill chips as `reference` and `skill` parts, a clipboard chip as
 * its body, and drops the conversation mention; a sent message's parts read
 * back as the same tokens.
 */
import type { FileEntryView, UserContent } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const mentionFileSchema = Type.ReadonlyObject(
  Type.Object({
    path: Type.String(),
    url: Type.String(),
    displayPath: Type.String(),
    label: Type.String(),
  }),
);

export type MentionFile = Static<typeof mentionFileSchema>;

export function mentionFile(
  root: string,
  entry: Pick<FileEntryView, "path" | "kind">,
): MentionFile {
  const folder = entry.kind === "directory" ? "/" : "";
  const path = `${root.replace(/\/$/u, "")}/${entry.path}`;
  const url = new URL("file:///");
  url.pathname = `${path}${folder}`;
  const name = entry.path.split("/").at(-1) ?? entry.path;

  return {
    path: `${path}${folder}`,
    url: url.href,
    displayPath: `${entry.path}${folder}`,
    label: `${name}${folder}`,
  };
}

export const messageReferenceSchema = Type.Union([
  Type.ReadonlyObject(
    Type.Object({
      kind: Type.Literal("file"),
      file: mentionFileSchema,
      lines: Type.Optional(
        Type.ReadonlyObject(Type.Object({ start: Type.Number(), end: Type.Number() })),
      ),
    }),
  ),
  Type.ReadonlyObject(
    Type.Object({ kind: Type.Literal("skill"), name: Type.String(), path: Type.String() }),
  ),
  Type.ReadonlyObject(
    Type.Object({ kind: Type.Literal("mention"), id: Type.Literal("current-conversation") }),
  ),
  Type.ReadonlyObject(Type.Object({ kind: Type.Literal("clipboard"), body: Type.String() })),
]);

export type MessageReference = Static<typeof messageReferenceSchema>;

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

const clipboardBody = Type.String({ minLength: 1 });

/** Length-prefixed JSON so a body with newlines stays one TextNode. */
function encodeClipboardToken(body: string): string {
  const payload = JSON.stringify(body);

  return `${CLIPBOARD_TOKEN_PREFIX}${String(payload.length)}:${payload}`;
}

function parseClipboardBody(payload: string): string | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }

  return Value.Check(clipboardBody, parsed) ? parsed : undefined;
}

/** The first well-formed token at or after `from`: a `@clipboard/<length>:` header, then `length` characters of JSON. */
function nextClipboardToken(
  text: string,
  from: number,
): { readonly start: number; readonly end: number; readonly body: string } | undefined {
  const header = new RegExp(`${CLIPBOARD_TOKEN_PREFIX}([0-9]+):`, "gu");
  header.lastIndex = from;

  for (let match = header.exec(text); match !== null; match = header.exec(text)) {
    const payloadStart = match.index + match[0].length;
    const payloadEnd = payloadStart + Number(match[1]);

    if (payloadEnd > text.length) continue;
    const body = parseClipboardBody(text.slice(payloadStart, payloadEnd));

    if (body !== undefined) return { start: match.index, end: payloadEnd, body };
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

function linesSuffix(lines: { readonly start: number; readonly end: number } | undefined): string {
  if (lines === undefined) return "";

  return lines.end === lines.start
    ? `:${String(lines.start)}`
    : `:${String(lines.start)}-${String(lines.end)}`;
}

export function referenceLabel(reference: MessageReference): string {
  switch (reference.kind) {
    case "file":
      return `${reference.file.label}${linesSuffix(reference.lines)}`;
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

/** The full reference behind a compact label; none when the label already is the whole of it. */
export function referenceTitle(reference: MessageReference): string | undefined {
  switch (reference.kind) {
    case "file":
      return `${reference.file.path}${linesSuffix(reference.lines)}`;
    case "skill":
      return reference.path === "" ? undefined : reference.path;
    case "mention":
      return undefined;
    case "clipboard":
      return "Pasted text";
    default: {
      const exhaustive: never = reference;

      return exhaustive;
    }
  }
}

/** One part of a sent message. */
export type ContentPart = Exclude<UserContent, string>[number];

/** What a chip sends: a file mention, a skill, the text it stands for, or nothing. */
export function referencePart(reference: MessageReference): ContentPart | null {
  switch (reference.kind) {
    case "file":
      return { kind: "reference", path: reference.file.path };
    case "skill":
      return { kind: "skill", name: reference.name, location: reference.path };
    case "clipboard":
      return { kind: "text", text: reference.body };
    case "mention":
      return null;
    default: {
      const exhaustive: never = reference;

      return exhaustive;
    }
  }
}

/** A sent message as draft text: its text, and each mention and skill as its chip's token. */
export function contentDraftText(content: UserContent): string {
  if (typeof content === "string") return content;

  return content
    .map((part) => {
      switch (part.kind) {
        case "text":
          return part.text;
        case "reference": {
          const url = new URL("file:///");

          url.pathname = part.path;

          return `@${url.href}`;
        }
        case "skill":
          return referenceText({ kind: "skill", name: part.name, path: part.location });
        case "file":
          return "";
        default: {
          const exhaustive: never = part;

          return exhaustive;
        }
      }
    })
    .join("");
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

export function mentionsFolder(file: MentionFile): boolean {
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
  /** Catalog entries by URL; a known file keeps its workspace label and relative path. */
  readonly files?: ReadonlyMap<string, MentionFile>;
  /** A token still being typed at the end of the text keeps its letters until a delimiter arrives. */
  readonly complete?: boolean;
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

/** Split draft text into plain runs and the chips its tokens stand for. */
export function messageParts(text: string, options: DraftParseOptions): readonly MessagePart[] {
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

/** Sidebar drafts use the first visible line, including selected skills and file labels. */
export function draftPreviewText(text: string): string {
  const visible = messageParts(text, { files: new Map(), complete: true })
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
 * Inline code that names a real workspace file or folder becomes a link;
 * everything else stays literal. A glob, a shell line, or a path that does not
 * exist is not a file, so the reader never gets a link that goes nowhere.
 * Matching the basename lets prose say `thread.tsx` when only one file answers
 * to it, and a `:12`, `:12-30`, or `#L12-L30` suffix names lines in it.
 */
export function inlineCodeReference(
  text: string,
  files: readonly MentionFile[],
): MessageReference | undefined {
  const trimmed = text.trim().replace(/^\.\//u, "");

  const located =
    /^(?<path>.+?)(?::(?<start>\d+)(?:-(?<end>\d+))?|#L(?<anchorStart>\d+)(?:-L(?<anchorEnd>\d+))?)$/u.exec(
      trimmed,
    )?.groups;

  const candidate = located?.path ?? trimmed;

  if (candidate === "" || /[\s*?{}[\]]/u.test(candidate)) return undefined;
  const index = workspaceFileIndex(files);

  const file =
    index.byPath.get(candidate) ??
    index.byPath.get(`${candidate}/`) ??
    (candidate.includes("/") ? undefined : index.byLabel.get(candidate));

  if (file === undefined) return undefined;
  const start = Number(located?.start ?? located?.anchorStart);

  if (mentionsFolder(file) || !Number.isSafeInteger(start) || start < 1)
    return { kind: "file", file };
  const end = Number(located?.end ?? located?.anchorEnd ?? start);

  return { kind: "file", file, lines: { start, end: Math.max(start, end) } };
}
