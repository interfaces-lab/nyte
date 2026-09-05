/**
 * Composer-owned rich parts. The textarea only carries short markers; this
 * expands file and paste markers and attaches image bytes at the submission
 * boundary. Also the `@` mention index and paste classification.
 */
import { statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { imageInfo } from "@opentui/core";
import { completionTrigger, discoverMentionFiles } from "@nyte-ai/core";
import type { MentionFile } from "@nyte-ai/core";
import type { ImageContent, UserMessage } from "@nyte-ai/schema";
import fuzzysort from "fuzzysort";

export { discoverMentionFiles };
export type { MentionFile };

const MAX_MENTION_RESULTS = 10;
const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
type SupportedImageMime = "image/gif" | "image/jpeg" | "image/png" | "image/webp";
export type ComposerPart =
  | {
      readonly kind: "file";
      readonly marker: string;
      readonly path: string;
      /** File body, once read. Absent for binaries, oversized files, and unreadable paths. */
      readonly text?: string;
    }
  | { readonly kind: "image"; readonly marker: string; readonly image: ImageContent }
  | { readonly kind: "paste"; readonly marker: string; readonly text: string };

export type ComposerPaste =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "image"; readonly image: ImageContent };

export interface FileMention {
  readonly source: string;
  readonly path: string;
}

export interface PreparedComposerPrompt {
  readonly displayText: string;
  readonly content: UserMessage["content"];
  readonly parts: readonly ComposerPart[];
}

function imageMimeType(data: Uint8Array): SupportedImageMime | undefined {
  let format: ReturnType<typeof imageInfo>["format"];
  try {
    format = imageInfo(data).format;
  } catch {
    return undefined;
  }
  switch (format) {
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "raw-rgba":
      return undefined;
    default: {
      const _exhaustive: never = format;
      return _exhaustive;
    }
  }
}

/** A paste this tall stops being text you are editing and becomes an attachment. */
export const PASTE_COLLAPSE_LINES = 8;

export function pasteLineCount(text: string): number {
  return text.split("\n").length;
}

/** Turn an OpenTUI binary paste into the same image part used by file-path paste. */
export function resolveComposerImagePaste(
  bytes: Uint8Array,
): Extract<ComposerPaste, { kind: "image" }> | undefined {
  const mimeType = imageMimeType(bytes);
  if (mimeType === undefined) return undefined;
  return {
    kind: "image",
    image: { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType },
  };
}

function pastedPath(value: string, cwd: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.includes("\n")) return undefined;
  const raw = trimmed.replace(/^['"]+|['"]+$/g, "");
  if (raw.startsWith("file://")) {
    try {
      return fileURLToPath(raw);
    } catch {
      return undefined;
    }
  }
  const unescaped = process.platform === "win32" ? raw : raw.replace(/\\(.)/g, "$1");
  return resolve(cwd, unescaped);
}

/** Classify a terminal paste once, before the textarea inserts it. */
export async function resolveComposerPaste(value: string, cwd: string): Promise<ComposerPaste> {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const path = pastedPath(normalized, cwd);
  if (path === undefined) return { kind: "text", text: normalized };
  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isFile()) return { kind: "text", text: normalized };
  if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return { kind: "file", path };
  const bytes = await readFile(path).catch(() => undefined);
  if (bytes === undefined) return { kind: "text", text: normalized };
  const mimeType = imageMimeType(bytes);
  if (mimeType === undefined) return { kind: "file", path };
  return { kind: "image", image: { type: "image", data: bytes.toString("base64"), mimeType } };
}

/** Paths that name directories carry a trailing separator everywhere. */
function isFolderPath(path: string): boolean {
  return path.endsWith(sep) || path.endsWith("/");
}

export interface FileMentionQuery {
  /** The `@token` a completed mention replaces. */
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

function fileMentionQuery(value: string, cursor: number): FileMentionQuery | undefined {
  const trigger = completionTrigger(value, cursor);
  if (trigger?.kind !== "@") return undefined;
  return { start: trigger.start, end: trigger.end, query: trigger.query };
}

/** A query spelled as a path is resolved directly and offered first when it names something real. */
function explicitMentionFile(query: string, cwd: string): MentionFile | undefined {
  if (query === "" || !/^(\.{1,2}[/\\]|~[/\\]|[/\\]|[A-Za-z]:[/\\])/.test(query)) {
    return undefined;
  }
  const expanded = query.startsWith("~") ? join(homedir(), query.slice(2)) : query;
  const path = resolve(cwd, expanded);
  let info;
  try {
    info = statSync(path);
  } catch {
    return undefined;
  }
  const rel = relative(cwd, path).split("\\").join("/");
  if (info.isDirectory()) {
    return {
      path: path + sep,
      url: pathToFileURL(path).href,
      displayPath: rel === "" ? "./" : `${rel}/`,
      label: `${basename(path)}/`,
    };
  }
  if (!info.isFile()) return undefined;
  return { path, url: pathToFileURL(path).href, displayPath: rel, label: basename(path) };
}

function prefixedMentionFiles(query: string, files: readonly MentionFile[]): MentionFile[] {
  const matches: MentionFile[] = [];
  for (const file of files) {
    if (matches.length >= MAX_MENTION_RESULTS) break;
    if (
      file.label.toLowerCase().startsWith(query) ||
      file.displayPath.toLowerCase().startsWith(query)
    ) {
      matches.push(file);
    }
  }
  return matches;
}

export interface FileMentionSuggestions {
  readonly query: FileMentionQuery;
  readonly files: readonly MentionFile[];
}

export function fileMentionSuggestions(
  value: string,
  files: readonly MentionFile[],
  cwd: string,
  cursor = value.length,
): FileMentionSuggestions | undefined {
  const query = fileMentionQuery(value, cursor);
  if (query === undefined) return undefined;
  let matches: MentionFile[];
  if (query.query === "") {
    matches = files.slice(0, MAX_MENTION_RESULTS);
  } else {
    const prefixed = prefixedMentionFiles(query.query.toLowerCase(), files);
    const seen = new Set(prefixed.map((file) => file.path));
    matches = [
      ...prefixed,
      ...fuzzysort
        .go(query.query, files, { keys: ["displayPath", "label"], limit: MAX_MENTION_RESULTS })
        .flatMap((result) => (seen.has(result.obj.path) ? [] : [result.obj])),
    ].slice(0, MAX_MENTION_RESULTS);
  }
  const explicit = explicitMentionFile(query.query, cwd);
  if (explicit !== undefined && !matches.some((file) => file.path === explicit.path)) {
    matches.unshift(explicit);
  }
  return { query, files: matches };
}

const FILE_URL_PATTERN = /@file:\/\/[^\s]+/g;

export function extractFileMentions(text: string): FileMention[] {
  const mentions: FileMention[] = [];
  for (const match of text.matchAll(FILE_URL_PATTERN)) {
    const source = match[0];
    try {
      mentions.push({ source, path: fileURLToPath(source.slice(1)) });
    } catch {
      continue;
    }
  }
  return mentions;
}

/**
 * A file the user attached travels inside the message, so the model spends no
 * read call on it. The wrapper lets any client fold the body back into a tag.
 */
const FILE_ATTACHMENT_PATTERN = /<file src="(file:\/\/[^"\n]+)">\n([\s\S]*?)\n<\/file>/g;
const ATTACHMENT_CLOSING_TAG = "</file>";
const MAX_ATTACHMENT_BYTES = 256_000;

export interface FileAttachment {
  readonly source: string;
  readonly path: string;
  readonly text: string;
}

export function fileAttachmentBlock(path: string, text: string): string {
  return `<file src="${pathToFileURL(path).href}">\n${text}\n${ATTACHMENT_CLOSING_TAG}`;
}

export function extractFileAttachments(text: string): FileAttachment[] {
  const attachments: FileAttachment[] = [];
  for (const match of text.matchAll(FILE_ATTACHMENT_PATTERN)) {
    const [source, url, body] = match;
    if (url === undefined || body === undefined) continue;
    try {
      attachments.push({ source, path: fileURLToPath(url), text: body });
    } catch {
      continue;
    }
  }
  return attachments;
}

/** Only text bodies inline; folders, binaries, and oversized files fall back to a mention. */
async function readAttachmentText(path: string): Promise<string | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size > MAX_ATTACHMENT_BYTES) return undefined;
  const bytes = await readFile(path).catch(() => undefined);
  if (bytes === undefined || bytes.byteLength > MAX_ATTACHMENT_BYTES || bytes.includes(0)) {
    return undefined;
  }
  const text = bytes.toString("utf8");
  return text.includes(ATTACHMENT_CLOSING_TAG) ? undefined : text;
}

function fileMarker(path: string): string {
  return isFolderPath(path) ? `[Folder ${basename(path)}]` : `[File ${basename(path)}]`;
}

function nextMarkerNumber(parts: readonly ComposerPart[], kind: ComposerPart["kind"]): number {
  return parts
    .filter((part) => part.kind === kind)
    .reduce((max, part) => Math.max(max, Number(/\d+/.exec(part.marker)?.[0] ?? 0) + 1), 1);
}

export interface ComposerDraft {
  readonly text: string;
  readonly parts: readonly ComposerPart[];
}

/** Unsent composer state, scoped to this TUI process and keyed by chat. */
export class SessionDrafts {
  private readonly drafts = new Map<string, ComposerDraft>();

  save(sessionId: string, text: string, parts: readonly ComposerPart[]): void {
    if (text === "" && parts.length === 0) {
      this.drafts.delete(sessionId);
      return;
    }
    this.drafts.set(sessionId, { text, parts: [...parts] });
  }

  read(sessionId: string): ComposerDraft | undefined {
    return this.drafts.get(sessionId);
  }
}

export class ComposerParts {
  private parts: ComposerPart[] = [];
  private nextImage = 1;
  private nextPaste = 1;
  /** Reads start when the tag is inserted and are awaited at submission. */
  private readonly bodies = new Map<string, Promise<string | undefined>>();

  get current(): readonly ComposerPart[] {
    return [...this.parts];
  }

  addFile(path: string): string {
    if (!this.bodies.has(path)) this.bodies.set(path, readAttachmentText(path));
    const existing = this.parts.find((part) => part.kind === "file" && part.path === path);
    if (existing !== undefined) return existing.marker;
    const marker = this.uniqueMarker(fileMarker(path));
    this.parts.push({ kind: "file", marker, path });
    return marker;
  }

  addImage(image: ImageContent): string {
    const marker = `[Image ${String(this.nextImage++)}]`;
    this.parts.push({ kind: "image", marker, image });
    return marker;
  }

  /** Park a tall paste behind a marker. `prepare` puts the lines back. */
  addPaste(text: string): string {
    const marker = `[Paste #${String(this.nextPaste++)} ${String(pasteLineCount(text))} lines]`;
    this.parts.push({ kind: "paste", marker, text });
    return marker;
  }

  /** Drop the parts whose marker the draft no longer contains. */
  retain(value: string): void {
    const retained = this.parts.filter((part) => value.includes(part.marker));
    const retainedFiles = new Set(
      retained.flatMap((part) => (part.kind === "file" ? [part.path] : [])),
    );
    for (const path of this.bodies.keys()) {
      if (!retainedFiles.has(path)) this.bodies.delete(path);
    }
    this.parts = retained;
  }

  clear(): void {
    this.parts = [];
    this.nextImage = 1;
    this.nextPaste = 1;
    this.bodies.clear();
  }

  restore(parts: readonly ComposerPart[]): void {
    this.clear();
    this.parts = [...parts];
    this.nextImage = nextMarkerNumber(this.parts, "image");
    this.nextPaste = nextMarkerNumber(this.parts, "paste");
    for (const part of this.parts) {
      if (part.kind === "file") {
        this.bodies.set(
          part.path,
          part.text === undefined ? readAttachmentText(part.path) : Promise.resolve(part.text),
        );
      }
    }
  }

  /** Put a sent message back into the composer, files and images as markers. */
  load(content: UserMessage["content"]): string {
    this.clear();
    let text = "";
    if (!Array.isArray(content)) {
      text = content;
    } else {
      for (const part of content) {
        if (part.type === "text") {
          text += part.text;
          continue;
        }
        const marker = this.addImage(part);
        if (!text.includes(marker)) text += marker;
      }
    }
    for (const attachment of extractFileAttachments(text)) {
      this.bodies.set(attachment.path, Promise.resolve(attachment.text));
      text = text.replace(attachment.source, this.addFile(attachment.path));
    }
    for (const mention of extractFileMentions(text)) {
      text = text.replace(mention.source, this.addFile(mention.path));
    }
    return text;
  }

  /**
   * Async, but the draft is snapshotted before the first await, so the caller
   * may clear the composer the moment this is called without losing parts.
   * `expandText` rewrites typed text on its way to the model (skill
   * invocations) before markers expand.
   */
  async prepare(
    value: string,
    expandText: (text: string) => string = (text) => text,
  ): Promise<PreparedComposerPrompt> {
    const rawDisplayText = value.trim();
    const snapshot = this.parts
      .filter((part) => rawDisplayText.includes(part.marker))
      .toSorted(
        (left, right) => rawDisplayText.indexOf(left.marker) - rawDisplayText.indexOf(right.marker),
      );
    const bodies = await Promise.all(
      snapshot.map(async (part) =>
        part.kind === "file" ? await this.bodies.get(part.path) : undefined,
      ),
    );
    const parts: ComposerPart[] = snapshot.map((part, index) => {
      const text = bodies[index];
      return part.kind === "file" && text !== undefined ? { ...part, text } : part;
    });
    const images = parts.filter((part) => part.kind === "image");
    const imageMarkers = new Map(
      images.map((part, index) => [part.marker, `[Image ${String(index + 1)}]`]),
    );
    const displayText = rawDisplayText.replace(
      /\[Image \d+\]/g,
      (marker) => imageMarkers.get(marker) ?? marker,
    );
    const expandFiles = (text: string): string => {
      let expanded = expandText(text);
      for (const part of parts) {
        if (part.kind === "file") {
          expanded = expanded.replaceAll(
            part.marker,
            part.text === undefined
              ? `@${pathToFileURL(part.path).href}`
              : fileAttachmentBlock(part.path, part.text),
          );
        }
        if (part.kind === "paste") expanded = expanded.replaceAll(part.marker, part.text);
      }
      return expanded;
    };
    if (images.length === 0) {
      return { displayText, content: expandFiles(rawDisplayText), parts };
    }
    const richContent: Exclude<UserMessage["content"], string> = [];
    const byMarker = new Map(images.map((part) => [part.marker, part.image]));
    let cursor = 0;
    for (const match of rawDisplayText.matchAll(/\[Image \d+\]/g)) {
      const marker = match[0];
      const image = byMarker.get(marker);
      if (image === undefined) continue;
      const text = expandFiles(rawDisplayText.slice(cursor, match.index));
      if (text !== "") richContent.push({ type: "text", text });
      richContent.push(image);
      cursor = match.index + marker.length;
    }
    const tail = expandFiles(rawDisplayText.slice(cursor));
    if (tail !== "") richContent.push({ type: "text", text: tail });
    return { displayText, content: richContent, parts };
  }

  private uniqueMarker(base: string): string {
    if (!this.parts.some((part) => part.marker === base)) return base;
    let suffix = 2;
    while (this.parts.some((part) => part.marker === `${base.slice(0, -1)} ${String(suffix)}]`)) {
      suffix += 1;
    }
    return `${base.slice(0, -1)} ${String(suffix)}]`;
  }
}
