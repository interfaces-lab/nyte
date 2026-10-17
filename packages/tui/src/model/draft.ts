import type { BlobId, ExcerptSource, SkillInfo, UserContent } from "@nyte-ai/sdk";
import { excerptLabel } from "../lib/format.ts";
import { parseComposerSubmission, promptDraft, skillTokens } from "../lib/slash.ts";
import type { Draft } from "./state.ts";

export type DraftModel =
  | { readonly kind: "empty" }
  | { readonly kind: "blank" }
  | {
      readonly kind: "message";
      readonly text: string;
      readonly plain: boolean;
      readonly command: string | null;
    }
  | { readonly kind: "shell"; readonly command: string; readonly include: boolean };

export type DraftParts = ReadonlyMap<string, DraftPart>;

export type DraftPart =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly directory: boolean;
      readonly body?: string;
    }
  | {
      readonly kind: "image";
      readonly bytes: Uint8Array | null;
      readonly blob: BlobId | null;
      readonly mime: string;
    }
  | { readonly kind: "paste"; readonly text: string }
  | { readonly kind: "excerpt"; readonly source: ExcerptSource; readonly text: string }
  | {
      readonly kind: "shell";
      readonly command: string;
      readonly output: string;
      readonly exit: number;
    };

export interface DraftSnapshot {
  readonly text: string;
  readonly parts: DraftParts;
}

export type DraftInsert =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "part"; readonly part: DraftPart }
  | { readonly kind: "refused"; readonly reason: string };

export interface MarkerSpan {
  readonly marker: string;
  readonly from: number;
  readonly to: number;
}

export const NO_PARTS: DraftParts = new Map();

/** A paste with more lines than this becomes a part, and a sent message folds past it. */
export const PASTE_COLLAPSE_LINES = 8;

/** A paste longer than this many characters becomes a part even on one line. */
export const PASTE_COLLAPSE_CHARS = 2_000;

export function draftModel(draft: Draft): DraftModel {
  if (draft.text === "") return { kind: "empty" };
  const parsed = parseComposerSubmission(draft.text);

  switch (parsed.kind) {
    case "empty":
      return { kind: "blank" };
    case "shell":
      return { kind: "shell", command: parsed.command, include: parsed.retain };
    case "command":
      return {
        kind: "message",
        text: draft.text.trim(),
        plain: liveMarkers(draft).length === 0,
        command: parsed.command.name,
      };
    case "prompt":
      return {
        kind: "message",
        text: parsed.text,
        plain: liveMarkers(draft).length === 0,
        command: null,
      };
    default: {
      const _exhaustive: never = parsed;

      return _exhaustive;
    }
  }
}

export function liveMarkers(draft: Pick<Draft, "text" | "parts">): readonly MarkerSpan[] {
  const spans: MarkerSpan[] = [];

  for (const marker of draft.parts.keys()) {
    for (const { index } of draft.text.matchAll(new RegExp(RegExp.escape(marker), "g")))
      spans.push({ marker, from: index, to: index + marker.length });
  }

  return spans.toSorted((left, right) => left.from - right.from);
}

export function markerAt(draft: Draft): MarkerSpan | null {
  return (
    liveMarkers(draft).find(
      (span) =>
        span.from <= draft.cursor &&
        draft.cursor <= span.to + (draft.text[span.to] === " " ? 1 : 0),
    ) ?? null
  );
}

export function snapshot(draft: Pick<Draft, "text" | "parts">): DraftSnapshot {
  const live = new Set(liveMarkers(draft).map((span) => span.marker));

  return {
    text: draft.text,
    parts: new Map([...draft.parts].filter(([marker]) => live.has(marker))),
  };
}

export function sameSnapshot(left: DraftSnapshot, right: DraftSnapshot): boolean {
  if (left.text.trim() !== right.text.trim()) return false;
  const leftLive = snapshot(left).parts;
  const rightLive = snapshot(right).parts;

  if (leftLive.size !== rightLive.size) return false;

  return [...leftLive].every(([marker, part]) => {
    const other = rightLive.get(marker);

    return other !== undefined && samePart(part, other);
  });
}

function samePart(left: DraftPart, right: DraftPart): boolean {
  switch (left.kind) {
    case "file":
      return right.kind === "file" && right.path === left.path;
    case "image":
      return right.kind === "image" && sameImage(left, right);
    case "paste":
      return right.kind === "paste" && right.text === left.text;
    case "excerpt":
      return (
        right.kind === "excerpt" &&
        right.text === left.text &&
        JSON.stringify(right.source) === JSON.stringify(left.source)
      );
    case "shell":
      return (
        right.kind === "shell" &&
        right.command === left.command &&
        right.output === left.output &&
        right.exit === left.exit
      );
    default: {
      const _exhaustive: never = left;

      return _exhaustive;
    }
  }
}

function sameImage(
  left: Extract<DraftPart, { kind: "image" }>,
  right: Extract<DraftPart, { kind: "image" }>,
): boolean {
  if (left.blob !== null || right.blob !== null) return left.blob === right.blob;

  if (left.bytes === null || right.bytes === null || left.mime !== right.mime) return false;

  return (
    left.bytes.length === right.bytes.length &&
    left.bytes.every((byte, index) => byte === right.bytes?.[index])
  );
}

function baseName(path: string): string {
  return path.replace(/\/+$/u, "").split("/").at(-1) ?? path;
}

function uniqueMarker(parts: DraftParts, base: string): string {
  if (!parts.has(base)) return base;
  let suffix = 2;

  while (parts.has(`${base.slice(0, -1)} ${String(suffix)}]`)) suffix += 1;

  return `${base.slice(0, -1)} ${String(suffix)}]`;
}

function nextNumber(parts: DraftParts, kind: DraftPart["kind"]): number {
  return [...parts].reduce(
    (max, [marker, part]) =>
      part.kind === kind ? Math.max(max, Number(/\d+/u.exec(marker)?.[0] ?? 0) + 1) : max,
    1,
  );
}

export function addPart(parts: DraftParts, part: DraftPart) {
  const existing = [...parts].find(([, candidate]) =>
    part.kind === "file"
      ? candidate.kind === "file" && candidate.path === part.path
      : part.kind === "image" && candidate.kind === "image" && sameImage(candidate, part),
  );

  if (existing !== undefined) return { parts, marker: existing[0] };
  const marker = markerFor(parts, part);

  return { parts: new Map([...parts, [marker, part]]), marker };
}

function markerFor(parts: DraftParts, part: DraftPart): string {
  switch (part.kind) {
    case "file":
      return uniqueMarker(
        parts,
        part.directory ? `[Folder ${baseName(part.path)}]` : `[File ${baseName(part.path)}]`,
      );
    case "image":
      return `[Image ${String(nextNumber(parts, "image"))}]`;
    case "paste": {
      const lines = part.text.split("\n").length;
      const size = lines > 1 ? `${String(lines)} lines` : `${String(part.text.length)} chars`;

      return `[Paste #${String(nextNumber(parts, "paste"))} ${size}]`;
    }
    case "shell":
      return uniqueMarker(parts, `[Shell ${part.command.trim().replace(/\s+/gu, " ")}]`);
    case "excerpt":
      return uniqueMarker(parts, `[${excerptLabel(part.source, part.text)}]`);
    default: {
      const _exhaustive: never = part;

      return _exhaustive;
    }
  }
}

function fileUrl(path: string): string {
  return `file://${encodeURI(path).replaceAll("?", "%3F").replaceAll("#", "%23")}`;
}

function pathOfFileUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "file:" ? decodeURIComponent(parsed.pathname) : null;
  } catch {
    return null;
  }
}

const SHELL_BLOCK_PATTERN = /<shell command="([^"\n]*)" exit="(\d+)">\n([\s\S]*?)\n<\/shell>/gu;

const FILE_MENTION_PATTERN = /@file:\/\/\S+/gu;

function shellAttribute(command: string): string {
  return command
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}

function commandFromAttribute(command: string): string {
  return command
    .replaceAll("&#10;", "\n")
    .replaceAll("&#13;", "\r")
    .replaceAll("&lt;", "<")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

function shellBlock(command: string, output: string, exit: number): string {
  const closingBreak = output.endsWith("\n") ? "" : "\n";

  return `<shell command="${shellAttribute(command)}" exit="${String(exit)}">\n${output}${closingBreak}</shell>`;
}

export function draftFromContent(content: UserContent): DraftSnapshot {
  let parts: DraftParts = NO_PARTS;
  let text = "";

  const add = (part: DraftPart): string => {
    const added = addPart(parts, part);
    parts = added.parts;

    return added.marker;
  };

  if (typeof content === "string") text = content;
  else {
    for (const [index, item] of content.entries()) {
      if (item.kind === "text") text += item.text;
      else if (item.kind === "reference") text += `@${fileUrl(item.path)}`;
      else if (item.kind === "excerpt")
        text += add({ kind: "excerpt", source: item.source, text: item.text });
      else if (item.kind === "skill") {
        const next = content[index + 1];

        text +=
          next?.kind === "text" && /^\s/u.test(next.text) ? `/${item.name}` : `/${item.name} `;
      } else {
        const marker = add({ kind: "image", bytes: null, blob: item.blob, mime: item.mime });

        if (!text.includes(marker)) text += marker;
      }
    }
  }

  for (const match of text.matchAll(SHELL_BLOCK_PATTERN)) {
    const [source, command, exit, output] = match;

    if (command === undefined || exit === undefined || output === undefined) continue;
    text = text.replace(
      source,
      add({
        kind: "shell",
        command: commandFromAttribute(command),
        output: output === "" ? "" : `${output}\n`,
        exit: Number(exit),
      }),
    );
  }

  for (const match of text.matchAll(FILE_MENTION_PATTERN)) {
    const path = pathOfFileUrl(match[0].slice(1));

    if (path === null) continue;
    text = text.replace(match[0], add({ kind: "file", path, directory: path.endsWith("/") }));
  }

  return { text: promptDraft(text), parts };
}

export function pendingUploads(
  draft: DraftSnapshot,
): readonly { readonly marker: string; readonly bytes: Uint8Array; readonly mime: string }[] {
  return [...snapshot(draft).parts].flatMap(([marker, part]) =>
    part.kind === "image" && part.blob === null && part.bytes !== null
      ? [{ marker, bytes: part.bytes, mime: part.mime }]
      : [],
  );
}

interface ContentInputs {
  readonly uploads: ReadonlyMap<string, BlobId>;
  readonly skills: ReadonlyMap<string, SkillInfo>;
}

type ContentPart = Exclude<UserContent, string>[number];

/**
 * What the draft sends: its text, a file or folder chip as a `reference`, a
 * skill (leading or inline) as a `skill` part, an image as its uploaded
 * `file`, an excerpt as itself, and a paste or shell chip as its text.
 */
export function draftContent(draft: DraftSnapshot, inputs: ContentInputs): UserContent {
  const text = draft.text.trim();
  const { parts } = snapshot(draft);
  const parsed = parseComposerSubmission(text);
  const leading = parsed.kind === "command" ? inputs.skills.get(parsed.command.name) : undefined;
  const content: ContentPart[] = [];

  const say = (value: string): void => {
    const last = content.at(-1);

    if (value === "") return;

    if (last?.kind === "text")
      content[content.length - 1] = { kind: "text", text: last.text + value };
    else content.push({ kind: "text", text: value });
  };

  if (leading !== undefined)
    content.push({ kind: "skill", name: leading.name, location: leading.location });
  const rest = leading !== undefined && parsed.kind === "command" ? parsed.command.argument : text;

  const spans = [
    ...liveMarkers({ text: rest, parts }).map((span) => ({
      ...span,
      part: parts.get(span.marker),
      skill: undefined,
    })),
    ...skillTokens(rest, inputs.skills).map((token) => ({
      from: token.start,
      to: token.end,
      marker: "",
      part: undefined,
      skill: token.skill,
    })),
  ].toSorted((left, right) => left.from - right.from);

  let cursor = 0;

  for (const span of spans) {
    if (span.from < cursor) continue;

    say(rest.slice(cursor, span.from));
    cursor = span.to;

    const { part, skill } = span;

    const blob =
      part?.kind === "image" ? (part.blob ?? inputs.uploads.get(span.marker)) : undefined;

    if (skill !== undefined)
      content.push({ kind: "skill", name: skill.name, location: skill.location });
    else if (part?.kind === "file") content.push({ kind: "reference", path: part.path });
    else if (part?.kind === "paste") say(part.text);
    else if (part?.kind === "excerpt")
      content.push({ kind: "excerpt", source: part.source, text: part.text });
    else if (part?.kind === "shell") say(shellBlock(part.command, part.output, part.exit));
    else if (part?.kind === "image" && blob !== undefined)
      content.push({
        kind: "file",
        blob,
        mime: part.mime,
        name: `${span.marker.slice(1, -1).toLowerCase().replace(" ", "-")}.${part.mime.slice("image/".length)}`,
      });
    else say(span.marker);
  }

  say(rest.slice(cursor));
  const [only] = content;

  if (only === undefined) return "";

  return content.length === 1 && only.kind === "text" ? only.text : content;
}
