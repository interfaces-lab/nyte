import type { FileEntryView, UserContent } from "@nyte-ai/sdk";
import { ExcerptSourceType } from "@nyte-ai/schema";
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
  Type.ReadonlyObject(
    Type.Object({ kind: Type.Literal("excerpt"), source: ExcerptSourceType, text: Type.String() }),
  ),
]);

export type MessageReference = Static<typeof messageReferenceSchema>;

type ClipboardReference = Extract<MessageReference, { readonly kind: "clipboard" }>;

export type ExcerptReference = Extract<MessageReference, { readonly kind: "excerpt" }>;

type MessagePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reference"; readonly reference: MessageReference; readonly source: string };

export const CONVERSATION_MENTION: MessageReference = {
  kind: "mention",
  id: "current-conversation",
};

const CONVERSATION_MENTION_TEXT = "@current-conversation";

const CLIPBOARD_PASTE_MAX_INLINE_CHARS = 10_000;

const LENGTH_TOKEN_HEADER = /@(clipboard|excerpt)\/([0-9]+):/gu;

const SKILL_LINK_PATTERN = /\[\$(?<name>[^\]\r\n]+)\]\((?<path>[^)\r\n]*)\)/gu;

const FILE_URL_PATTERN = /@file:\/\/[^\s<>"]+/gu;

const DRAFT_TOKEN_PATTERN = new RegExp(
  [
    FILE_URL_PATTERN.source,
    SKILL_LINK_PATTERN.source,
    `(?<=^|\\s)${CONVERSATION_MENTION_TEXT}(?=\\s|$)`,
  ].join("|"),
  "gu",
);

const clipboardBody = Type.String({ minLength: 1 });

const excerptPayload = Type.Object({ source: ExcerptSourceType, text: Type.String() });

function encodeLengthToken(
  kind: "clipboard" | "excerpt",
  payload: string | Omit<ExcerptReference, "kind">,
): string {
  const json = JSON.stringify(payload);

  return `@${kind}/${String(json.length)}:${json}`;
}

function parseLengthToken(kind: string, json: string): MessageReference | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }

  if (kind === "clipboard")
    return Value.Check(clipboardBody, parsed) ? { kind: "clipboard", body: parsed } : undefined;

  return Value.Check(excerptPayload, parsed)
    ? { kind: "excerpt", source: parsed.source, text: parsed.text }
    : undefined;
}

function nextLengthToken(
  text: string,
  from: number,
):
  | { readonly start: number; readonly end: number; readonly reference: MessageReference }
  | undefined {
  const header = new RegExp(LENGTH_TOKEN_HEADER.source, "gu");
  header.lastIndex = from;

  for (let match = header.exec(text); match !== null; match = header.exec(text)) {
    const payloadStart = match.index + match[0].length;
    const payloadEnd = payloadStart + Number(match[2]);

    if (payloadEnd > text.length) continue;
    const reference = parseLengthToken(match[1] ?? "", text.slice(payloadStart, payloadEnd));

    if (reference !== undefined) return { start: match.index, end: payloadEnd, reference };
  }

  return undefined;
}

export function clipboardReferenceFromPaste(text: string): ClipboardReference | undefined {
  const normalized = text.replace(/\r\n/gu, "\n").replace(/\n+$/u, "");

  if (normalized.length <= CLIPBOARD_PASTE_MAX_INLINE_CHARS) return undefined;

  return { kind: "clipboard", body: normalized };
}

export function referenceText(reference: MessageReference): string {
  switch (reference.kind) {
    case "file":
      return `@${reference.file.url}`;
    case "skill":
      return `[$${reference.name}](${reference.path})`;
    case "mention":
      return CONVERSATION_MENTION_TEXT;
    case "clipboard":
      return encodeLengthToken("clipboard", reference.body);
    case "excerpt":
      return encodeLengthToken("excerpt", { source: reference.source, text: reference.text });
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

function lineCount(text: string): string {
  const lines = text.split("\n").length;

  return `${String(lines)} ${lines === 1 ? "line" : "lines"}`;
}

function selectorTail(selector: string): string {
  return selector.split(/\s*>\s*|\s+/u).at(-1) ?? selector;
}

function excerptLabel(reference: ExcerptReference): string {
  const { source } = reference;

  switch (source.kind) {
    case "diff":
      return `${source.path.split("/").at(-1) ?? source.path}${linesSuffix(source)}`;
    case "terminal":
      return source.command ?? `Terminal (${lineCount(reference.text)})`;
    case "browser":
      return selectorTail(source.selector);
    default: {
      const exhaustive: never = source;

      return exhaustive;
    }
  }
}

function excerptTitle(reference: ExcerptReference): string {
  const { source } = reference;

  switch (source.kind) {
    case "diff":
      return `${source.path}${linesSuffix(source)}${source.side === "old" ? " before the change" : ""}`;
    case "terminal":
      return source.command === undefined ? "Terminal output" : `Output of ${source.command}`;
    case "browser":
      return `${source.selector} on ${source.url}`;
    default: {
      const exhaustive: never = source;

      return exhaustive;
    }
  }
}

export function referenceLabel(reference: MessageReference): string {
  switch (reference.kind) {
    case "file":
      return `${reference.file.label}${linesSuffix(reference.lines)}`;
    case "skill":
      return `/${reference.name}`;
    case "mention":
      return "Current conversation";
    case "clipboard":
      return `Clipboard (${lineCount(reference.body)})`;
    case "excerpt":
      return excerptLabel(reference);

    default: {
      const exhaustive: never = reference;

      return exhaustive;
    }
  }
}

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
    case "excerpt":
      return excerptTitle(reference);
    default: {
      const exhaustive: never = reference;

      return exhaustive;
    }
  }
}

export type ContentPart = Exclude<UserContent, string>[number];

export function referencePart(reference: MessageReference): ContentPart | null {
  switch (reference.kind) {
    case "file":
      return { kind: "reference", path: reference.file.path };
    case "skill":
      return { kind: "skill", name: reference.name, location: reference.path };
    case "clipboard":
      return { kind: "text", text: reference.body };
    case "excerpt":
      return { kind: "excerpt", source: reference.source, text: reference.text };
    case "mention":
      return null;
    default: {
      const exhaustive: never = reference;

      return exhaustive;
    }
  }
}

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
        case "excerpt":
          return referenceText({ kind: "excerpt", source: part.source, text: part.text });
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
    case "excerpt":
      return (
        right.kind === "excerpt" &&
        right.text === left.text &&
        JSON.stringify(right.source) === JSON.stringify(left.source)
      );
    default: {
      const exhaustive: never = left;

      return exhaustive;
    }
  }
}

export function mentionsFolder(file: MentionFile): boolean {
  return file.label.endsWith("/");
}

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
  readonly files?: ReadonlyMap<string, MentionFile>;
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

export function messageParts(text: string, options: DraftParseOptions): readonly MessagePart[] {
  const parts: MessagePart[] = [];
  let cursor = 0;
  const tokens = [...text.matchAll(DRAFT_TOKEN_PATTERN)];
  let tokenIndex = 0;

  while (cursor < text.length) {
    const lengthToken = nextLengthToken(text, cursor);

    while (tokenIndex < tokens.length && (tokens[tokenIndex]?.index ?? 0) < cursor) {
      tokenIndex += 1;
    }

    const token = tokens[tokenIndex];
    const lengthStart = lengthToken?.start;
    const tokenStart = token?.index;

    if (
      lengthToken !== undefined &&
      lengthStart !== undefined &&
      (tokenStart === undefined || lengthStart <= tokenStart)
    ) {
      if (lengthToken.start > cursor) {
        parts.push({ kind: "text", text: text.slice(cursor, lengthToken.start) });
      }

      parts.push({
        kind: "reference",
        reference: lengthToken.reference,
        source: text.slice(lengthToken.start, lengthToken.end),
      });
      cursor = lengthToken.end;
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

export function draftPreviewText(text: string): string {
  const visible = messageParts(text, { files: new Map(), complete: true })
    .map((part) => (part.kind === "text" ? part.text : referenceLabel(part.reference)))
    .join("")
    .trim();

  return visible.split(/\r?\n/u)[0] || "Draft";
}

interface WorkspaceFileIndex {
  readonly byPath: ReadonlyMap<string, MentionFile>;
  readonly byLabel: ReadonlyMap<string, MentionFile>;
}

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
