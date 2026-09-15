/**
 * Composer-owned rich parts. The textarea only carries short markers; this
 * expands file and paste markers and attaches image bytes at the submission
 * boundary. Also the `@` mention index and paste classification.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BoxRenderable,
  CodeRenderable,
  ImageRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  decodePasteBytes,
  imageInfo,
} from "@opentui/core";
import type {
  ClipboardService,
  CliRenderer,
  RendererClipboardBoundary,
  SyntaxStyle,
  TextareaRenderable,
  WidthMethod,
} from "@opentui/core";
import type { CliTheme } from "./theme.ts";
import { completionTrigger } from "@nyte-ai/core";
import { discoverMentionFiles } from "@nyte-ai/core/files";
import type { MentionFile } from "@nyte-ai/core/files";
import type { ImageContent, UserMessage } from "@nyte-ai/schema";
import fuzzysort from "fuzzysort";
import { cellOffset } from "./width.ts";
import { promptDraft } from "./slash.ts";

export { discoverMentionFiles };
export type { MentionFile };

const MAX_MENTION_RESULTS = 10;
const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
type SupportedImageMime = "image/gif" | "image/jpeg" | "image/png" | "image/webp";
type ComposerPart =
  | {
      readonly kind: "file";
      readonly marker: string;
      readonly path: string;
      /** File body, once read. Absent for binaries, oversized files, and unreadable paths. */
      readonly text?: string;
    }
  | { readonly kind: "image"; readonly marker: string; readonly image: ImageContent }
  | { readonly kind: "paste"; readonly marker: string; readonly text: string }
  /** A `!command` the user ran; its output rides along with the next prompt. */
  | { readonly kind: "shell"; readonly marker: string; readonly run: ShellRun };

export interface ShellRun {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number;
}

type ComposerPaste =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "image"; readonly image: ImageContent };

type ClipboardContent = { readonly mime: "image/png" | "text/plain"; readonly data: string };

/** Based on https://github.com/anomalyco/opencode/blob/0643a5638e0cd02234e73f176771527d7600faf7/packages/tui/src/clipboard.ts */
export function createTuiClipboard(renderer: RendererClipboardBoundary) {
  return createClipboardAdapter(
    createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer),
    }),
  );
}

export function createClipboardAdapter(clipboard: ClipboardService) {
  return {
    async read(): Promise<ClipboardContent | undefined> {
      const result = await clipboard.read({
        preferredTypes: ["image/png", "text/plain"],
        selection: "clipboard",
      });
      if (result.status !== "read") {
        if (result.status === "failed") throw result.error;
        if (result.status === "timed-out") throw new Error("Clipboard read timed out");
        if (result.status === "limit-exceeded")
          throw new RangeError("Clipboard content exceeded the read or image conversion limit");
        return undefined;
      }
      if (result.representation.mimeType === "image/png") {
        return {
          data: Buffer.from(result.representation.bytes).toString("base64"),
          mime: result.representation.mimeType,
        };
      }
      if (result.representation.mimeType === "text/plain") {
        if (result.representation.bytes.length === 0) return undefined;
        return {
          data: decodePasteBytes(result.representation.bytes),
          mime: result.representation.mimeType,
        };
      }
      throw new Error(`Unexpected clipboard MIME type: ${result.representation.mimeType}`);
    },
    async write(text: string): Promise<void> {
      // OpenTUI rejects NUL before any destination; host clipboard text cannot contain it.
      const result = await clipboard.writeText(text.replaceAll("\0", ""), {
        destination: "all-available",
        selection: "clipboard",
      });
      if (result.host.status === "written" || result.terminal.status === "attempted") return;
      if (result.host.status === "failed") throw result.host.error;
      throw new Error(
        `Clipboard write failed (host: ${result.host.status}, terminal: ${result.terminal.status})`,
      );
    },
    dispose: () => clipboard.dispose(),
  };
}

interface FileMention {
  readonly source: string;
  readonly path: string;
}

interface PreparedComposerPrompt {
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

interface FileMentionQuery {
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
export async function explicitMentionFile(
  query: string,
  cwd: string,
): Promise<MentionFile | undefined> {
  if (query === "" || !/^(\.{1,2}[/\\]|~[/\\]|[/\\]|[A-Za-z]:[/\\])/.test(query)) {
    return undefined;
  }
  const expanded = query.startsWith("~") ? join(homedir(), query.slice(2)) : query;
  const path = resolve(cwd, expanded);
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return undefined;
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
  cursor = value.length,
): FileMentionSuggestions | undefined {
  const query = fileMentionQuery(value, cursor);
  if (query === undefined) return undefined;
  let matches: MentionFile[];
  if (query.query === "") {
    matches = files.slice(0, MAX_MENTION_RESULTS);
  } else {
    const prefixed = prefixedMentionFiles(query.query.toLowerCase(), files);
    if (prefixed.length === MAX_MENTION_RESULTS) return { query, files: prefixed };
    const seen = new Set(prefixed.map((file) => file.path));
    matches = [
      ...prefixed,
      ...fuzzysort
        .go(query.query, files, { keys: ["displayPath", "label"], limit: MAX_MENTION_RESULTS })
        .flatMap((result) => (seen.has(result.obj.path) ? [] : [result.obj])),
    ].slice(0, MAX_MENTION_RESULTS);
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

interface FileAttachment {
  readonly source: string;
  readonly path: string;
  readonly text: string;
}

function fileAttachmentBlock(path: string, text: string): string {
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

/**
 * A command the user ran with `!` travels inside the message the way an
 * attached file does, so any client folds it back to a tag.
 */
const SHELL_BLOCK_PATTERN = /<shell command="([^"\n]*)" exit="(\d+)">\n([\s\S]*?)\n<\/shell>/g;

function shellCommandAttribute(command: string): string {
  return command
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}

function commandFromShellAttribute(command: string): string {
  return command
    .replaceAll("&#10;", "\n")
    .replaceAll("&#13;", "\r")
    .replaceAll("&lt;", "<")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

interface ShellBlock extends ShellRun {
  readonly source: string;
}

function shellBlock(run: ShellRun): string {
  const closingBreak = run.output.endsWith("\n") ? "" : "\n";
  return `<shell command="${shellCommandAttribute(run.command)}" exit="${String(run.exitCode)}">\n${run.output}${closingBreak}</shell>`;
}

export function extractShellBlocks(text: string): ShellBlock[] {
  const blocks: ShellBlock[] = [];
  for (const match of text.matchAll(SHELL_BLOCK_PATTERN)) {
    const [source, command, exit, output] = match;
    if (command === undefined || exit === undefined || output === undefined) continue;
    blocks.push({
      source,
      command: commandFromShellAttribute(command),
      exitCode: Number(exit),
      output: output === "" ? "" : `${output}\n`,
    });
  }
  return blocks;
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
  private value: string | undefined;
  private readonly markedInputs = new WeakSet<TextareaRenderable>();
  private nextImage = 1;
  private nextPaste = 1;
  /** Reads start when the tag is inserted and are awaited at submission. */
  private readonly bodies = new Map<string, Promise<string | undefined>>();

  get current(): readonly ComposerPart[] {
    return this.parts.filter(
      (part) => this.value === undefined || this.value.includes(part.marker),
    );
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
    const existing = this.parts.find(
      (part) =>
        part.kind === "image" &&
        part.image.mimeType === image.mimeType &&
        part.image.data === image.data,
    );
    if (existing !== undefined) return existing.marker;
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

  /** Park a finished `!command` behind a marker; `prepare` writes it out as a shell block. */
  addShell(run: ShellRun): string {
    const marker = this.uniqueMarker(`[Shell ${run.command.trim().replace(/\s+/gu, " ")}]`);
    this.parts.push({ kind: "shell", marker, run });
    return marker;
  }

  /** Keep removed bytes until the draft is cleared: undo can bring a marker back. */
  retain(value: string): void {
    this.value = value;
  }

  /** Markers move, select, delete, and undo as one item in OpenTUI's editor. */
  sync(input: TextareaRenderable, styleId: number, widthMethod: WidthMethod, value?: string): void {
    // Reading extmarks installs editor listeners. Plain drafts never need them,
    // but a previously marked editor still needs cleanup after clear or undo.
    if (this.parts.length === 0 && !this.markedInputs.has(input)) return;
    this.markedInputs.add(input);
    const text = value ?? input.plainText;
    const typeId = input.extmarks.registerType("composer-part");
    this.retain(text);
    // OpenTUI restores marks on undo, but not its per-type index. Read the marks
    // themselves so restored virtual ranges are neither lost nor duplicated.
    const marks = input.extmarks.getAll().filter((mark) => mark.typeId === typeId);
    const ranges = new Map<string, (typeof marks)[number]>();
    const removed = new Set(marks);
    for (const mark of marks) {
      if (mark.virtual && mark.styleId === styleId) {
        ranges.set(`${mark.start}:${mark.end}`, mark);
      }
    }
    const tabWidth = input.editBuffer.getTabWidth();
    const occurrences: { index: number; width: number }[] = [];
    for (const part of this.parts) {
      let index = text.indexOf(part.marker);
      if (index === -1) continue;
      const width = cellOffset(part.marker, part.marker.length, widthMethod, tabWidth);
      while (index !== -1) {
        occurrences.push({ index, width });
        index = text.indexOf(part.marker, index + part.marker.length);
      }
    }
    occurrences.sort((left, right) => left.index - right.index);
    let previousIndex = 0;
    let start = 0;
    const missing: { start: number; end: number }[] = [];
    for (const occurrence of occurrences) {
      const between = text.slice(previousIndex, occurrence.index);
      start += cellOffset(between, between.length, widthMethod, tabWidth);
      previousIndex = occurrence.index;
      const end = start + occurrence.width;
      const mark = ranges.get(`${start}:${end}`);
      if (mark !== undefined) removed.delete(mark);
      else missing.push({ start, end });
    }
    for (const mark of removed) input.extmarks.delete(mark.id);
    for (const range of missing) {
      input.extmarks.create({ ...range, virtual: true, styleId, typeId });
    }
  }

  atCursor(input: TextareaRenderable): ComposerPart | undefined {
    const text = input.plainText;
    this.retain(text);
    const index = input.editBuffer.getTextRange(0, input.cursorOffset).length;
    return this.parts.find((part) => {
      const start = text.lastIndexOf(part.marker, index);
      return start !== -1 && index <= start + part.marker.length;
    });
  }

  async preview(part: ComposerPart): Promise<ComposerPart> {
    if (part.kind !== "file" || part.text !== undefined) return part;
    const text = await this.bodies.get(part.path);
    return text === undefined ? part : { ...part, text };
  }

  /** Based on https://github.com/anomalyco/opencode/blob/3bfce3fd2d07588ffd1e3d6fa301626632627cf9/packages/tui/src/component/prompt/index.tsx */
  expandPastedText(
    input: TextareaRenderable,
    extmarkId: number,
    widthMethod: WidthMethod,
  ): boolean {
    const extmark = input.extmarks.get(extmarkId);
    if (extmark === null) return false;
    const marker = input.getTextRange(extmark.start, extmark.end);
    const part = this.parts.find((candidate) => candidate.marker === marker);
    if (part?.kind !== "paste") return false;

    // OpenTUI records delete/insert separately; replace keeps expansion one undo step.
    const text = input.plainText;
    const start = input.editBuffer.getTextRange(0, extmark.start).length;
    const next = text.slice(0, start) + part.text + text.slice(start + marker.length);
    input.replaceText(next);
    input.cursorOffset =
      extmark.start +
      cellOffset(part.text, part.text.length, widthMethod, input.editBuffer.getTabWidth());
    return true;
  }

  clear(): void {
    this.parts = [];
    this.value = undefined;
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
    for (const block of extractShellBlocks(text)) {
      const { source, ...run } = block;
      text = text.replace(source, this.addShell(run));
    }
    for (const mention of extractFileMentions(text)) {
      text = text.replace(mention.source, this.addFile(mention.path));
    }
    return promptDraft(text);
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
    const displayText = promptDraft(
      rawDisplayText.replace(/\[Image \d+\]/g, (marker) => imageMarkers.get(marker) ?? marker),
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
        if (part.kind === "shell")
          expanded = expanded.replaceAll(part.marker, shellBlock(part.run));
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

/** Based on https://github.com/anomalyco/opencode/blob/283258e95b0a534edac3efeb9762e65134b4634c/packages/tui/src/component/dialog-image-preview.tsx */
export class DialogImagePreview {
  readonly container: BoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly theme: CliTheme;
  private marker: string | undefined;

  constructor(renderer: CliRenderer, theme: CliTheme) {
    this.renderer = renderer;
    this.theme = theme;
    this.container = new BoxRenderable(renderer, {
      id: "attachment-preview",
      flexDirection: "column",
      flexShrink: 0,
      width: "100%",
      paddingLeft: 3,
      paddingRight: 2,
      visible: false,
    });
  }

  retain(parts: readonly ComposerPart[]): void {
    if (!parts.some((part) => part.marker === this.marker)) this.close();
  }

  toggle(part: ComposerPart, syntaxStyle: SyntaxStyle): void {
    const closing = this.marker === part.marker;
    this.close();
    if (closing) return;
    this.marker = part.marker;
    this.container.visible = true;
    const title = new TextRenderable(this.renderer, {
      content: `${part.marker} · click to close`,
      fg: this.theme.dim,
      height: 1,
      selectable: false,
    });
    title.onMouseUp = (event) => {
      if (event.button !== 0) return;
      this.close();
      event.preventDefault();
      event.stopPropagation();
    };
    this.container.add(title);
    const height = Math.max(1, Math.min(10, Math.floor(this.renderer.height / 3)));
    if (part.kind === "image") {
      // A scroll box sizes its content to the children, which collapses the
      // image's percentage width; a plain box gives it the full row to fit into.
      this.container.add(
        new ImageRenderable(this.renderer, {
          source: Buffer.from(part.image.data, "base64"),
          width: "100%",
          height,
          fit: "fit",
        }),
      );
      return;
    }
    const viewport = new ScrollBoxRenderable(this.renderer, {
      width: "100%",
      height,
      scrollX: true,
      scrollY: true,
    });
    viewport.add(
      new CodeRenderable(this.renderer, {
        content:
          part.kind === "paste"
            ? part.text
            : part.kind === "shell"
              ? part.run.output
              : (part.text ?? part.path),
        syntaxStyle,
        fg: this.theme.foreground,
        wrapMode: "word",
        selectionBg: this.theme.selectionBackground,
        selectionFg: this.theme.selectionForeground,
      }),
    );
    this.container.add(viewport);
  }

  close(): void {
    this.marker = undefined;
    this.container.visible = false;
    for (const child of this.container.getChildren()) {
      this.container.remove(child);
      child.destroyRecursively();
    }
  }
}
