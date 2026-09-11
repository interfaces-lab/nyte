/**
 * What a composer chip stands for, and the one text spelling each kind has.
 *
 * A draft is plain text: every chip owns an exact token in it (`@file://…`,
 * `[$skill](path)`, `@current-conversation`), so a draft string restores its
 * chips without a second document. A sent message keeps the provider contract
 * (text and images): skill chips become the instruction sentences at its head,
 * and those sentences read back as chips.
 */
import type { MentionFile } from "@nyte-ai/core/views";

export type MessageReference =
  | { readonly kind: "file"; readonly file: MentionFile }
  | { readonly kind: "skill"; readonly name: string; readonly path: string }
  | { readonly kind: "mention"; readonly id: "current-conversation" };

export type MessagePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reference"; readonly reference: MessageReference; readonly source: string };

export const CONVERSATION_MENTION: MessageReference = {
  kind: "mention",
  id: "current-conversation",
};
const CONVERSATION_MENTION_TEXT = "@current-conversation";

/** `[$name](path)`: the persisted skill link the transcript already hides. */
export const SKILL_LINK_PATTERN = /\[\$(?<name>[^\]\r\n]+)\]\((?<path>[^)\r\n]*)\)/gu;
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
const SKILL_INSTRUCTION_PATTERN = /^Use the (?<name>\S+) skill\.(?=\n\n|$)/u;

export function skillInstruction(name: string): string {
  return `Use the ${name} skill.`;
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
    default: {
      const exhaustive: never = reference;
      return exhaustive;
    }
  }
}

/** The sentence a sent message carries for the reference; files and mentions carry none. */
export function referenceInstruction(reference: MessageReference): string | undefined {
  switch (reference.kind) {
    case "skill":
      return skillInstruction(reference.name);
    case "file":
    case "mention":
      return undefined;
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

export interface DraftParseOptions {
  readonly form: "draft";
  /** Catalog entries by URL; a known file keeps its workspace label and relative path. */
  readonly files?: ReadonlyMap<string, MentionFile>;
  /** A token still being typed at the end of the text keeps its letters until a delimiter arrives. */
  readonly complete?: boolean;
}

export interface MessageParseOptions {
  readonly form: "message";
}

export type MessageParseOptionsUnion = DraftParseOptions | MessageParseOptions;

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
  for (const match of text.matchAll(DRAFT_TOKEN_PATTERN)) {
    const reference = draftReference(match, options);
    if (reference === undefined) continue;
    const end = match.index + match[0].length;
    // A skill link closes itself; the other tokens only end at a delimiter.
    const open = reference.kind !== "skill" && end === text.length;
    const known = reference.kind === "file" && options.files?.has(reference.file.url) === true;
    if (open && options.complete === false && !known) continue;
    if (match.index > cursor) parts.push({ kind: "text", text: text.slice(cursor, match.index) });
    parts.push({ kind: "reference", reference, source: match[0] });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) });
  return parts;
}

/** The instruction sentences a composer put at the head of a message, in order. */
function leadingInstructions(text: string): { parts: MessagePart[]; cursor: number } {
  const parts: MessagePart[] = [];
  let cursor = 0;
  for (;;) {
    const rest = text.slice(cursor);
    const skill = SKILL_INSTRUCTION_PATTERN.exec(rest);
    const name = skill?.groups?.["name"];
    if (skill === null || name === undefined) return { parts, cursor };
    const length = skill[0].length;
    const separator = rest.startsWith("\n\n", length) ? 2 : 0;
    parts.push({
      kind: "reference",
      reference: { kind: "skill", name, path: "" },
      source: rest.slice(0, length + separator),
    });
    cursor += length + separator;
  }
}

/**
 * Split text into plain runs and references. A draft yields its chips back; a
 * sent message yields the skill chips its head sentences stand for, the file
 * mentions in its body, and any persisted skill link.
 */
export function messageParts(
  text: string,
  options: MessageParseOptionsUnion,
): readonly MessagePart[] {
  if (options.form === "draft") return draftParts(text, options);
  const head = leadingInstructions(text);
  const body = text.slice(head.cursor);
  const bodyParts: MessagePart[] = [];
  let cursor = 0;
  const bodyPattern = new RegExp(
    `${FILE_URL_PATTERN.source}|${SKILL_LINK_PATTERN.source}|${SKILL_INVOCATION_PATTERN.source}`,
    "gu",
  );
  for (const match of body.matchAll(bodyPattern)) {
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
    }
    if (reference === undefined) continue;
    if (match.index > cursor)
      bodyParts.push({ kind: "text", text: body.slice(cursor, match.index) });
    bodyParts.push({ kind: "reference", reference, source: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < body.length) bodyParts.push({ kind: "text", text: body.slice(cursor) });
  return [...head.parts, ...bodyParts];
}

/** The draft that edits a sent message: head sentences become their tokens, the body stays. */
export function messageDraftText(text: string): string {
  return messageParts(text, { form: "message" })
    .map((part) => {
      if (part.kind === "text") return part.text;
      // Head sentences end in a paragraph break; their tokens read better with one space.
      return part.source.endsWith("\n\n")
        ? `${referenceText(part.reference)} `
        : referenceText(part.reference);
    })
    .join("");
}
