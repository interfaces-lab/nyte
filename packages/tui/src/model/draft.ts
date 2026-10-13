/**
 * The draft's meaning: what kind of thing Enter would send, and the rich
 * parts behind its markers. The textarea owns the characters; this module
 * owns the parts and the codec between markers and `UserContent`.
 *
 * Ported pure from composer.ts: marker naming and de-duplication, paste
 * classification results, `prepare` planning, `extract*`/`shellBlock` codecs.
 */
import type { BlobId, SkillInfo, UserContent } from "@nyte-ai/sdk";
import {
  expandInlineSkills,
  extractSkillInvocations,
  formatSkillInvocation,
  parseComposerSubmission,
  promptDraft,
} from "../lib/slash.ts";
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

/** Keyed by the marker text the textarea shows, e.g. `[File a.ts]`, `[Image 2]`, `[Paste #1 40 lines]`, `[Shell ls]`. */
export type DraftParts = ReadonlyMap<string, DraftPart>;

export type DraftPart =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly directory: boolean;
      /** The body a landed `<file>` block carried; absent until the runner reads the file at submit. */
      readonly body?: string;
    }
  | {
      readonly kind: "image";
      readonly bytes: Uint8Array | null;
      readonly blob: BlobId | null;
      readonly mime: string;
    }
  | { readonly kind: "paste"; readonly text: string }
  | {
      readonly kind: "shell";
      readonly command: string;
      readonly output: string;
      readonly exit: number;
    };

/** What a handback, a saved per-session draft or an edit restores: text plus the parts its markers name. */
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

/** A paste this tall stops being text you are editing and becomes an attachment. */
export const PASTE_COLLAPSE_LINES = 8;

const IMAGE_MARKER = /\[Image \d+\]/gu;

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

/** Markers present in `text`; parts not present stay until the draft is cleared, so undo can bring one back. */
export function liveMarkers(draft: Pick<Draft, "text" | "parts">): readonly MarkerSpan[] {
  const spans: MarkerSpan[] = [];

  for (const marker of draft.parts.keys()) {
    let from = draft.text.indexOf(marker);

    while (from !== -1) {
      spans.push({ marker, from, to: from + marker.length });
      from = draft.text.indexOf(marker, from + marker.length);
    }
  }

  return spans.toSorted((left, right) => left.from - right.from);
}

/** The marker the cursor sits in or right after (past its trailing space too), the one Ctrl+Space acts on. */
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

/** Two snapshots that would send the same thing. */
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

/** The parts a new marker gets: suffix ` 2`, ` 3` on name collisions; images de-duplicated by bytes or blob. */
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
    case "paste":
      return `[Paste #${String(nextNumber(parts, "paste"))} ${String(part.text.split("\n").length)} lines]`;
    case "shell":
      return uniqueMarker(parts, `[Shell ${part.command.trim().replace(/\s+/gu, " ")}]`);
    default: {
      const _exhaustive: never = part;

      return _exhaustive;
    }
  }
}

/** `file:` URL for an absolute POSIX path, the spelling a message carries. */
export function fileUrl(path: string): string {
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

const FILE_ATTACHMENT_PATTERN = /<file src="(file:\/\/[^"\n]+)">\n([\s\S]*?)\n<\/file>/gu;

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

/** A `!command` the way it travels inside a message, so any client folds it back to a tag. */
export function shellBlock(command: string, output: string, exit: number): string {
  const closingBreak = output.endsWith("\n") ? "" : "\n";

  return `<shell command="${shellAttribute(command)}" exit="${String(exit)}">\n${output}${closingBreak}</shell>`;
}

/** An attached file's body inside the message, so the model spends no read call on it. */
export function fileBlock(path: string, body: string): string {
  return `<file src="${fileUrl(path)}">\n${body}\n</file>`;
}

/**
 * Rebuilds markers from landed content, for history recall and for editing a
 * queued message: `<file>`, `<skill>` and `<shell>` blocks become parts again.
 */
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
    for (const item of content) {
      if (item.kind === "text") text += item.text;
      else if (item.kind === "reference") text += `@${fileUrl(item.path)}`;
      else {
        const marker = add({ kind: "image", bytes: null, blob: item.blob, mime: item.mime });

        if (!text.includes(marker)) text += marker;
      }
    }
  }

  for (const match of text.matchAll(FILE_ATTACHMENT_PATTERN)) {
    const [source, url, body] = match;
    const path = url === undefined ? null : pathOfFileUrl(url);

    if (path === null || body === undefined) continue;
    text = text.replace(source, add({ kind: "file", path, directory: false, body }));
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

  for (const invocation of extractSkillInvocations(text)) {
    const withArgument = `${invocation.source}\n\n`;
    text = text.includes(withArgument)
      ? text.replace(withArgument, `/${invocation.name} `)
      : text.replace(invocation.source, `/${invocation.name}`);
  }

  for (const match of text.matchAll(FILE_MENTION_PATTERN)) {
    const path = pathOfFileUrl(match[0].slice(1));

    if (path === null) continue;
    text = text.replace(match[0], add({ kind: "file", path, directory: path.endsWith("/") }));
  }

  return { text: promptDraft(text), parts };
}

/** File markers whose body the runner still has to read (≤256 KB text, else they become `@file://` mentions). */
export function unreadFiles(draft: DraftSnapshot): readonly string[] {
  return [...snapshot(draft).parts.values()].flatMap((part) =>
    part.kind === "file" && !part.directory && part.body === undefined ? [part.path] : [],
  );
}

/** Image markers holding bytes the runner uploads before sending, by marker. */
export function pendingUploads(
  draft: DraftSnapshot,
): readonly { readonly marker: string; readonly bytes: Uint8Array; readonly mime: string }[] {
  return [...snapshot(draft).parts].flatMap(([marker, part]) =>
    part.kind === "image" && part.blob === null && part.bytes !== null
      ? [{ marker, bytes: part.bytes, mime: part.mime }]
      : [],
  );
}

/** What the runner gathered before sending: file bodies by path (null → mention) and uploaded blobs by marker. */
export interface ContentInputs {
  readonly bodies: ReadonlyMap<string, string | null>;
  readonly uploads: ReadonlyMap<string, BlobId>;
  readonly skills: ReadonlyMap<string, SkillInfo>;
}

/**
 * The message a snapshot sends: a leading `/skill args` becomes its
 * invocation block, inline `/skill` tokens expand, file markers become
 * `<file>` blocks or mentions, pastes and shell runs expand, and images
 * become file parts at their marker's place.
 */
export function draftContent(draft: DraftSnapshot, inputs: ContentInputs): UserContent {
  const text = draft.text.trim();
  const { parts } = snapshot(draft);
  const parsed = parseComposerSubmission(text);
  const leading = parsed.kind === "command" ? inputs.skills.get(parsed.command.name) : undefined;

  const expandSkills = (segment: string, first: boolean): string =>
    first && leading !== undefined && parsed.kind === "command"
      ? formatSkillInvocation(
          leading,
          parsed.command.argument === "" ? undefined : parsed.command.argument,
        )
      : expandInlineSkills(segment, inputs.skills);

  const expandMarkers = (segment: string): string => {
    let expanded = segment;

    for (const [marker, part] of parts) {
      if (part.kind === "file") {
        const body = part.body ?? inputs.bodies.get(part.path) ?? null;
        expanded = expanded.replaceAll(
          marker,
          body === null || part.directory ? `@${fileUrl(part.path)}` : fileBlock(part.path, body),
        );
      } else if (part.kind === "paste") expanded = expanded.replaceAll(marker, part.text);
      else if (part.kind === "shell")
        expanded = expanded.replaceAll(marker, shellBlock(part.command, part.output, part.exit));
    }

    return expanded;
  };

  const images = [...parts].filter(([, part]) => part.kind === "image");

  if (images.length === 0) return expandMarkers(expandSkills(text, true));
  const content: Exclude<UserContent, string>[number][] = [];
  let cursor = 0;

  for (const match of text.matchAll(IMAGE_MARKER)) {
    const marker = match[0];
    const part = parts.get(marker);

    if (part?.kind !== "image") continue;
    const blob = part.blob ?? inputs.uploads.get(marker);

    if (blob === undefined) continue;
    const before = expandMarkers(expandSkills(text.slice(cursor, match.index), cursor === 0));

    if (before !== "") content.push({ kind: "text", text: before });
    content.push({
      kind: "file",
      blob,
      mime: part.mime,
      name: `${marker.slice(1, -1).toLowerCase().replace(" ", "-")}.${part.mime.slice("image/".length)}`,
    });
    cursor = match.index + marker.length;
  }

  const tail = expandMarkers(expandSkills(text.slice(cursor), cursor === 0));

  if (tail !== "") content.push({ kind: "text", text: tail });

  return content;
}
