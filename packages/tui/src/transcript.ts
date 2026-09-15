/**
 * The transcript as OpenTUI blocks, reconciled from `SessionState`: one block
 * per turn keyed by the turn's id, one part block per settled part keyed by
 * `turnPartId`, and live blocks for the streaming overlay keyed by
 * `livePartKey`. A restore and a live stream both land here, so a resumed
 * session looks like the one that was just typed.
 */
import {
  BoxRenderable,
  CodeRenderable,
  CliRenderEvents,
  createMarkdownCodeBlockRenderer,
  DiffRenderable,
  fg,
  ImageRenderable,
  LineNumberRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  pathToFiletype,
  RenderableEvents,
  StyledText,
  SyntaxStyle,
  TextRenderable,
  TextBufferRenderable,
  TextBuffer,
  TextBufferView,
  TextTableRenderable,
  RGBA,
  LayoutEvents,
} from "@opentui/core";
import type {
  BoxOptions,
  CliRenderer,
  MarkdownCodeBlockRenderer,
  MarkdownOptions,
  Renderable,
  ScrollUnit,
  Selection,
  SimpleHighlight,
  TextChunk,
  OptimizedBuffer,
} from "@opentui/core";
import { Edge } from "@opentui/core/yoga";
import {
  presentNote,
  presentTool,
  projectToolView,
  runActivityLabel,
  turnPartId,
  isTerminalPhase,
} from "@nyte-ai/core";
import type {
  RunInfo,
  ToolLive,
  ToolPresentation,
  ToolTurnPart,
  Turn,
  TurnOutcome,
  TurnPart,
} from "@nyte-ai/core";
import type { ImageContent, UserMessage } from "@nyte-ai/schema";
import { diffChars, diffWordsWithSpace } from "diff";
import { SpinnerRenderable } from "opentui-spinner";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractFileAttachments,
  extractFileMentions,
  extractShellBlocks,
  PASTE_COLLAPSE_LINES,
  pasteLineCount,
} from "./composer.ts";
import type { ShellRun } from "./composer.ts";
import type { ShellExecution } from "./local-shell.ts";
import {
  ACTIVITY_FAILED_LABEL,
  ACTIVITY_RETRY_LABEL,
  ACTIVITY_STOPPED_LABEL,
  ACTIVITY_THINKING_LABEL,
  ACTIVITY_THOUGHT_LABEL,
  ACTIVITY_WAITING_LABEL,
  ACTIVITY_WORKED_LABEL,
  ACTIVITY_WORKING_LABEL,
  GLYPHS,
  keycap,
  MIN_REPORTED_DURATION_MS,
  RESULT_PREVIEW_LINES,
  RESULT_TAIL_LINES,
  RESULT_TAIL_ONLY_LINES,
  SPACING,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
  DELEGATION_ROWS,
  TOOL_INLINE_PREVIEW_LENGTH,
} from "./constants.ts";
import {
  earlierLinesLabel,
  formatDuration,
  omittedLabel,
  type PreviewCut,
  previewLines,
  resultSummary,
  toolHeading,
  unchangedLinesLabel,
} from "./format.ts";
import { diffFromOutput, type ChangedLinePair, type OutputDiff } from "./output-diff.ts";
import { isJsonObject, isJsonString } from "./json.ts";
import type { LabelSyntax } from "./label-syntax.ts";
import { renderMermaidASCII } from "beautiful-mermaid";
import { waitingCall } from "@nyte-ai/core/client";
import type { SessionState } from "@nyte-ai/core/client";
import { livePartKey, type LivePart } from "@nyte-ai/core/views";
import { extractSkillInvocations } from "./slash.ts";
import { runStatus, statusMark, taskSteps } from "./tasks.ts";
import type { CliTheme } from "./theme.ts";
import { cellOffset, displayWidth } from "./width.ts";

// Native text buffers retain their construction-time width rules after capability replies.
const bufferWidths = new WeakMap<TextBufferRenderable, CliRenderer["widthMethod"]>();

class TranscriptTextRenderable extends TextRenderable {
  constructor(renderer: CliRenderer, options: ConstructorParameters<typeof TextRenderable>[1]) {
    super(renderer, options);
    bufferWidths.set(this, renderer.widthMethod);
  }
}

class TranscriptCodeRenderable extends CodeRenderable {
  constructor(renderer: CliRenderer, options: ConstructorParameters<typeof CodeRenderable>[1]) {
    super(renderer, options);
    bufferWidths.set(this, renderer.widthMethod);
  }
}

const repaints = new WeakMap<Renderable, () => void>();

export function repaintTree(root: Renderable): void {
  repaints.get(root)?.();
  for (const child of root.getChildren()) repaintTree(child);
}

/**
 * OpenTUI only seeds inline styled text for streaming markdown. Settled blocks
 * otherwise reserve raw-text geometry but draw nothing until highlighting ends.
 * Draw that pending text too; concealment and asynchronous highlighting stay on.
 */
class TranscriptMarkdownRenderable extends MarkdownRenderable {
  constructor(renderer: CliRenderer, options: MarkdownOptions) {
    super(renderer, options);
    this.showPendingText(this);
  }

  override get content(): string {
    return super.content;
  }

  override set content(value: string) {
    super.content = value;
    this.showPendingText(this);
  }

  override get streaming(): boolean {
    return super.streaming;
  }

  override set streaming(value: boolean) {
    super.streaming = value;
    if (!value) this.showPendingText(this);
  }

  /** Native style refresh rebuilds custom blocks and lists. Repaint their buffers instead. */
  retheme(theme: CliTheme, style: SyntaxStyle, subtle: boolean): void {
    const previous = this.syntaxStyle;
    const colors = new Map<string, RGBA>();
    for (const [name, old] of previous.getAllStyles()) {
      const next = style.getStyle(name)?.fg;
      if (old.fg !== undefined && next !== undefined) colors.set(old.fg.toString(), next);
    }
    const tint = (chunk: TextChunk): TextChunk => ({
      ...chunk,
      fg: chunk.fg === undefined ? undefined : (colors.get(chunk.fg.toString()) ?? chunk.fg),
    });
    this.syntaxStyle = style;
    this.fg = subtle ? theme.dim : theme.foreground;
    const paint = (node: Renderable): void => {
      if (node instanceof CodeRenderable) {
        node.syntaxStyle = style;
        node.fg = subtle ? theme.dim : theme.foreground;
        node.selectionBg = theme.selectionBackground;
        node.selectionFg = theme.selectionForeground;
      } else if (node instanceof TextRenderable) {
        node.content = new StyledText(node.chunks.map(tint));
        node.fg = subtle ? theme.dim : theme.foreground;
        node.selectionBg = theme.selectionBackground;
        node.selectionFg = theme.selectionForeground;
      } else if (node instanceof TextTableRenderable) {
        const selected = node.hasSelection();
        node.content = node.content.map((row) => row.map((cell) => cell?.map(tint)));
        // TextTable's public content setter replaces cell buffers, not its owner.
        if (selected) node.onSelectionChanged(this.ctx.getSelection());
        node.borderColor = theme.dim;
      } else if (node instanceof BoxRenderable && node.border !== false)
        node.borderColor = theme.dim;
      for (const child of node.getChildren()) paint(child);
    };
    for (const child of this.getChildren()) paint(child);
    this.requestRender();
  }

  // Markdown's renderSelf only refreshes styles. Its content already lives in children.
  protected override renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {}

  private showPendingText(parent: Renderable): void {
    for (const child of parent.getChildren()) {
      if (child instanceof TextBufferRenderable && !bufferWidths.has(child))
        bufferWidths.set(child, this.ctx.widthMethod);
      if (child instanceof CodeRenderable) {
        if (!child.drawUnstyledText) child.drawUnstyledText = true;
        const previous = child.onChunks;
        if (previous !== highlightSources.get(child)?.callback) {
          const callback: NonNullable<CodeRenderable["onChunks"]> = async (chunks, context) => {
            const result = (await previous?.(chunks, context)) ?? chunks;
            highlightSources.set(child, {
              callback,
              source: context.content,
              text: result.map((chunk) => chunk.text).join(""),
              highlights: context.highlights,
            });
            return result;
          };
          highlightSources.set(child, { callback, source: "", text: "", highlights: [] });
          child.onChunks = callback;
        }
      }
      this.showPendingText(child);
    }
  }
}

/** Based on https://github.com/anomalyco/opencode/blob/f3f1204802eaf9f3f26352330449d3ce4454f4af/packages/merman/src/markdown.ts */
function prepareDiagram(source: string) {
  if (source.length > 8_000 || source.split("\n").length > 120)
    throw new RangeError("Diagram is too large");
  const text = renderMermaidASCII(source, { colorMode: "none", paddingX: 3, paddingY: 2 });
  const lines = text.split("\n");
  if (lines.length > 300 || text.length > 100_000) throw new RangeError("Diagram is too large");
  return { source, text, height: lines.length, width: Math.max(1, ...lines.map(displayWidth)) };
}

class StaticDiagramRenderable extends BoxRenderable {
  constructor(
    renderer: CliRenderer,
    theme: CliTheme,
    prepared: ReturnType<typeof prepareDiagram>,
    source: Renderable,
    disclosure: () => string,
    disclosures?: Map<string, boolean>,
  ) {
    super(renderer, { flexDirection: "column", width: "100%" });
    const toggle = new TranscriptTextRenderable(renderer, {
      content: "mermaid · click for source",
      fg: theme.dim,
      selectable: false,
      height: 1,
    });
    const viewport = new ScrollBoxRenderable(renderer, {
      width: "100%",
      height: Math.min(prepared.height + 1, 24),
      scrollX: true,
      scrollY: true,
    });
    viewport.add(
      new TranscriptTextRenderable(renderer, {
        content: prepared.text,
        fg: theme.foreground,
        wrapMode: "none",
        width: prepared.width,
        selectionBg: theme.selectionBackground,
        selectionFg: theme.selectionForeground,
      }),
    );
    source.visible = disclosures?.get(disclosure()) ?? false;
    viewport.visible = !source.visible;
    if (source.visible) toggle.content = "mermaid · click for diagram";
    toggle.onMouseUp = (event) => {
      if (event.button !== 0 || renderer.getSelection()?.getSelectedText()) return;
      source.visible = !source.visible;
      disclosures?.set(disclosure(), source.visible);
      viewport.visible = !source.visible;
      toggle.content = source.visible
        ? "mermaid · click for diagram"
        : "mermaid · click for source";
      event.preventDefault();
      event.stopPropagation();
    };
    repaints.set(this, () => {
      toggle.fg = theme.dim;
      for (const child of viewport.getChildren()) {
        if (!(child instanceof TextRenderable)) continue;
        child.fg = theme.foreground;
        child.selectionBg = theme.selectionBackground;
        child.selectionFg = theme.selectionForeground;
      }
    });
    this.add(toggle);
    this.add(viewport);
    this.add(source);
  }
}

function createMermaidCodeBlockRenderer(
  renderer: CliRenderer,
  theme: CliTheme,
  disclosures: Map<string, boolean> | undefined,
  partKey: { key: string },
): MarkdownCodeBlockRenderer {
  // One renderer serves one markdown renderable, so block ids stay bounded and
  // the map dies with it.
  const lastGood = new Map<string, ReturnType<typeof prepareDiagram>>();
  return (token, context) => {
    const source = context.defaultRender();
    if (source === null) return undefined;
    const disclosure = (): string =>
      `${partKey.key}:${source.id.slice(source.id.lastIndexOf("-block-"))}`;
    try {
      const prepared = prepareDiagram(token.text);
      lastGood.set(source.id, prepared);
      return new StaticDiagramRenderable(
        renderer,
        theme,
        prepared,
        source,
        disclosure,
        disclosures,
      );
    } catch {
      const previous = lastGood.get(source.id);
      if (previous === undefined) return undefined;
      return new StaticDiagramRenderable(
        renderer,
        theme,
        previous,
        source,
        disclosure,
        disclosures,
      );
    }
  };
}

function createMermaidMarkdownRenderer(
  renderer: CliRenderer,
  theme: CliTheme,
  disclosures: Map<string, boolean> | undefined,
  partKey: { key: string },
): MarkdownOptions["renderNode"] {
  return createMarkdownCodeBlockRenderer({
    mermaid: createMermaidCodeBlockRenderer(renderer, theme, disclosures, partKey),
  });
}

function rekeyDisclosures(
  key: { key: string },
  next: string,
  disclosures: Transcript["disclosures"],
): void {
  if (key.key === next) return;
  // Rekey a snapshot: inserting into the live Map also extends its iterator.
  for (const [name, value] of Array.from(disclosures ?? [])) {
    if (!name.startsWith(`${key.key}:`)) continue;
    disclosures?.set(`${next}${name.slice(key.key.length)}`, value);
    disclosures?.delete(name);
  }
  key.key = next;
}

/**
 * Keep code columns fixed when separate hunks have different line-number widths.
 * Based on OpenCode's patch diff component:
 * https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/component/patch-diff.tsx
 */
function syncDiffGutters(diffs: readonly DiffRenderable[]): void {
  const gutters = diffs.flatMap((diff) =>
    diff.getChildren().filter((child) => child instanceof LineNumberRenderable),
  );
  const numbers = gutters.map((gutter) => new Map(gutter.getLineNumbers()));
  const digits = numbers.map((lines) => Math.max(0, ...lines.values()).toString().length);
  const after = gutters.map((gutter) =>
    Math.max(
      0,
      ...[...gutter.getLineSigns().values()].map((sign) => displayWidth(sign.after ?? "")),
    ),
  );
  const maxDigits = Math.max(0, ...digits);
  const maxAfter = Math.max(0, ...after);
  for (const [index, gutter] of gutters.entries()) {
    const lineNumbers = numbers[index];
    const lineDigits = digits[index];
    if (lineNumbers === undefined || lineDigits === undefined) continue;
    const signs = new Map(gutter.getLineSigns());
    signs.set(-1, { after: " ".repeat(maxAfter + maxDigits - lineDigits) });
    gutter.setLineNumbers(lineNumbers);
    gutter.setLineSigns(signs);
  }
}

/** Beyond this a word diff costs more than the highlight is worth. */
const WORD_SPAN_LIMIT = 4_000;

/**
 * Changed words of a one-line replacement as highlight spans over the unified view's
 * content, which is the hunk's rows minus their sign joined by newlines. Offsets count
 * UTF-16 code units: OpenTUI applies a span with `content.slice(start, end)`.
 * Whitespace alone never earns a span.
 */
export function wordSpans(content: string, pair: ChangedLinePair): SimpleHighlight[] {
  if (pair.removed.length + pair.added.length > WORD_SPAN_LIMIT) return [];
  const rows = content.split("\n");
  if (rows[pair.row] !== pair.removed || rows[pair.row + 1] !== pair.added) return [];
  const removedStart = rows.slice(0, pair.row).reduce((sum, row) => sum + row.length + 1, 0);
  const addedStart = removedStart + pair.removed.length + 1;
  const spans: SimpleHighlight[] = [];
  let removedOffset = removedStart;
  let addedOffset = addedStart;
  for (const change of diffWordsWithSpace(pair.removed, pair.added)) {
    const offset = change.added ? addedOffset : removedOffset;
    if (change.added || change.removed) {
      const leading = change.value.length - change.value.trimStart().length;
      const trailing = change.value.length - change.value.trimEnd().length;
      if (leading + trailing < change.value.length)
        spans.push([
          offset + leading,
          offset + change.value.length - trailing,
          change.added ? "diff.plus" : "diff.minus",
        ]);
    }
    if (!change.added) removedOffset += change.value.length;
    if (!change.removed) addedOffset += change.value.length;
  }
  return spans;
}

/** Highlight the changed words after the hunk's syntax colours, so the inverse wins. */
function markChangedWords(diff: DiffRenderable, pair: ChangedLinePair): void {
  const code = diff
    .getChildren()
    .filter((child) => child instanceof LineNumberRenderable)
    .flatMap((gutter) => gutter.getChildren())
    .find((child) => child instanceof CodeRenderable);
  if (code === undefined) return;
  code.onHighlight = (highlights, context) => [...highlights, ...wordSpans(context.content, pair)];
}

/** Tools whose title is source rather than prose, named by the grammar it speaks. */
const HEADING_FILETYPES = new Map([["bash", "bash"]]);

/** Tools whose newest output matters most: a collapsed card keeps the tail and drops the head. */
const TAIL_PREVIEW_TOOLS = new Set(["bash"]);

function previewCut(toolName: string | undefined): PreviewCut {
  return toolName !== undefined && TAIL_PREVIEW_TOOLS.has(toolName)
    ? { kind: "tail", max: RESULT_TAIL_ONLY_LINES }
    : { kind: "head-tail", head: RESULT_PREVIEW_LINES, tail: RESULT_TAIL_LINES };
}

function inlineToolPreview(text: string): string | undefined {
  const value = text.trim();
  if (value === "" || value.includes("\n") || displayWidth(value) > TOOL_INLINE_PREVIEW_LENGTH) {
    return undefined;
  }
  return value;
}

/** The collapsed body of a tool card or thought; the cut's label names the key that expands it. */
function toolOutputPreview(text: string, expanded: boolean, cut: PreviewCut): string {
  const trimmed = text.replace(/\n+$/u, "");
  if (expanded || trimmed === "") return trimmed;
  const preview = previewLines(trimmed, cut);
  if (preview.omitted === 0) return preview.text;
  const omission =
    cut.kind === "tail" ? earlierLinesLabel(preview.omitted) : omittedLabel(preview.omitted);
  return preview.text.replace(omission, `${omission} · ${keycap("chat.tools.toggle")} expand`);
}

/** Highlight groups, named as the shipped grammars emit them. */
function syntaxStyle(theme: CliTheme, subtle: boolean): SyntaxStyle {
  const color = (value: string): string => (subtle ? theme.dim : value);
  return SyntaxStyle.fromStyles({
    default: { fg: color(theme.foreground) },
    markup: { fg: color(theme.foreground) },
    keyword: { fg: color(theme.code) },
    string: { fg: color(theme.string) },
    number: { fg: color(theme.number) },
    comment: { fg: color(theme.dim), italic: true },
    function: { fg: color(theme.user) },
    type: { fg: color(theme.type) },
    variable: { fg: color(theme.foreground) },
    operator: { fg: color(theme.operator) },
    punctuation: { fg: color(theme.dim) },
    // Base scopes the non-bundled grammars lean on; a dotted group falls back
    // to the name before its first dot.
    constant: { fg: color(theme.number) },
    boolean: { fg: color(theme.number) },
    character: { fg: color(theme.string) },
    constructor: { fg: color(theme.type) },
    module: { fg: color(theme.type) },
    property: { fg: color(theme.foreground) },
    attribute: { fg: color(theme.type) },
    label: { fg: color(theme.code) },
    tag: { fg: color(theme.code) },
    "markup.heading": { fg: color(theme.foreground), bold: true },
    "markup.strong": { fg: color(theme.foreground), bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": { fg: color(theme.dim) },
    "markup.raw": { fg: color(theme.code) },
    "markup.link": { fg: color(theme.link), underline: true },
    "markup.list": { fg: color(theme.dim) },
    "markup.quote": { fg: color(theme.dim), italic: true },
    conceal: { fg: color(theme.dim) },
    "diff.plus": { bg: theme.ok, fg: theme.background },
    "diff.minus": { bg: theme.error, fg: theme.background },
  });
}

export function createSyntaxStyle(theme: CliTheme): SyntaxStyle {
  return syntaxStyle(theme, false);
}

/** Keep reasoning markdown structure while lowering every syntax foreground. */
export function createSubtleSyntaxStyle(theme: CliTheme): SyntaxStyle {
  return syntaxStyle(theme, true);
}

interface ExpandableToolOutput {
  setExpanded(expanded: boolean): void;
}

/**
 * One expansion state for the transcript and every tool card in it.
 *
 * Based on pi's global tool-output toggle:
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts
 */
export class ToolOutputExpansion {
  private readonly cards = new Set<ExpandableToolOutput>();
  private current = false;

  get expanded(): boolean {
    return this.current;
  }

  register(card: ExpandableToolOutput): () => void {
    this.cards.add(card);
    card.setExpanded(this.current);
    return () => this.cards.delete(card);
  }

  toggle(): boolean {
    this.current = !this.current;
    for (const card of this.cards) card.setExpanded(this.current);
    return this.current;
  }
}

/** Disclosure changes invalidate measurements at every previously visited width. */
class TranscriptDisclosures extends Map<string, boolean> {
  revision = 0;

  override set(key: string, value: boolean): this {
    if (this.get(key) === value) return this;
    super.set(key, value);
    this.revision += 1;
    return this;
  }
}

/** What every block draws with. */
export interface Transcript {
  readonly renderer: CliRenderer;
  readonly container: ScrollBoxRenderable;
  syntaxStyle: SyntaxStyle;
  subtleSyntaxStyle: SyntaxStyle;
  readonly theme: CliTheme;
  /** Highlights for one-line labels, such as the command on a shell call. */
  readonly labelSyntax: LabelSyntax;
  readonly toolOutput: ToolOutputExpansion;
  readonly nextId: (prefix?: string) => string;
  readonly openPath: (path: string) => void;
  /**
   * Child sessions of the one shown, for delegation cards. The task browser
   * follows them and installs this once it exists; until then there are none.
   */
  children: () => readonly SessionState[];
  readonly disclosures?: TranscriptDisclosures;
  /** Width for user cards, which sit inside the scroll padding. */
  readonly userBlocks: Set<BoxRenderable>;
  readonly userBlockWidth: () => number;
  /** Told whether output growth owns the viewport, for the latest control. */
  readonly onFollowModeChange: (followingLatest: boolean) => void;
}

type SectionOptions = Pick<
  BoxOptions,
  | "backgroundColor"
  | "marginTop"
  | "marginLeft"
  | "marginRight"
  | "paddingTop"
  | "paddingBottom"
  | "paddingLeft"
  | "paddingRight"
  | "width"
>;

function section(
  transcript: Transcript,
  prefix: string,
  options: SectionOptions = {},
  parent: Renderable = transcript.container,
  before?: Renderable,
): BoxRenderable {
  const box = new BoxRenderable(transcript.renderer, {
    id: transcript.nextId(prefix),
    flexDirection: "column",
    backgroundColor: options.backgroundColor ?? transcript.theme.transparent,
    paddingTop: options.paddingTop ?? 0,
    paddingBottom: options.paddingBottom ?? 0,
    paddingLeft: options.paddingLeft ?? SPACING.inset,
    paddingRight: options.paddingRight ?? SPACING.insetRight,
    marginTop: options.marginTop ?? SPACING.block,
    marginLeft: options.marginLeft ?? 0,
    marginRight: options.marginRight ?? 0,
    width: options.width ?? "100%",
  });
  if (before === undefined) parent.add(box);
  else parent.insertBefore(box, before);
  return box;
}

function label(transcript: Transcript, text: string, color: string): TextRenderable {
  const line = new TranscriptTextRenderable(transcript.renderer, {
    id: transcript.nextId("label"),
    content: text,
    fg: color,
  });
  repaints.set(line, () => {
    line.fg = transcript.theme.dim;
  });
  return line;
}

/** Hold a streamed heading marker until its text arrives. */
function hasIncompleteHeadingPrefix(text: string): boolean {
  const line = text.slice(text.lastIndexOf("\n") + 1);
  return /^\s{0,3}#{1,6}\s*$/.test(line);
}

// ---------------------------------------------------------------------------
// User turns
// ---------------------------------------------------------------------------

interface PresentedFile {
  readonly path: string;
  readonly text?: string;
}

interface PresentedSkill {
  readonly name: string;
  readonly path: string;
}

interface UserPresentation {
  readonly text: string;
  readonly files: readonly PresentedFile[];
  readonly skills: readonly PresentedSkill[];
  readonly shells: readonly ShellRun[];
  readonly images: readonly ImageContent[];
}

function userPresentation(content: UserMessage["content"]): UserPresentation {
  let text = Array.isArray(content)
    ? content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    : content;
  // Instructions the prompt pulled in are the skill, not the prompt; an
  // attached body is the file, not the prompt. Both fold back to their tag.
  const skills: PresentedSkill[] = [];
  for (const invocation of extractSkillInvocations(text)) {
    skills.push({ name: invocation.name, path: invocation.path });
    text = text.replace(invocation.source, "");
  }
  const files: PresentedFile[] = [];
  for (const attachment of extractFileAttachments(text)) {
    files.push({ path: attachment.path, text: attachment.text });
    text = text.replace(attachment.source, "");
  }
  for (const mention of extractFileMentions(text)) {
    files.push({ path: mention.path });
    text = text.replace(mention.source, "");
  }
  const shells: ShellRun[] = [];
  for (const block of extractShellBlocks(text)) {
    shells.push({ command: block.command, output: block.output, exitCode: block.exitCode });
    text = text.replace(block.source, "");
  }
  const images = Array.isArray(content)
    ? content.flatMap((part) => (part.type === "image" ? [part] : []))
    : [];
  if (images.length > 0) text = text.replace(/\[Image \d+\]/g, "");
  return {
    text: text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .trim(),
    files,
    skills,
    shells,
    images,
  };
}

const PASTE_PREVIEW_LINES = 3;

/** A clickable tag that folds or opens what a user turn carried. */
function collapsedTag(
  transcript: Transcript,
  parent: BoxRenderable,
  options: {
    readonly label: () => string;
    readonly url?: string;
    readonly marginTop?: number;
    readonly onToggle: () => void;
  },
): TextRenderable {
  const { renderer, theme } = transcript;
  let hovered = false;
  const tag = new TranscriptTextRenderable(renderer, {
    id: transcript.nextId("tag"),
    content: "",
    fg: theme.pasteForeground,
    bg: theme.pasteBackground,
    wrapMode: "none",
    marginTop: options.marginTop ?? 0,
  });
  const paint = (): void => {
    tag.content = new StyledText([fg(theme.pasteForeground)(options.label())]);
    tag.bg = hovered ? theme.hover : theme.pasteBackground;
  };
  tag.onMouseOver = () => {
    hovered = true;
    paint();
  };
  tag.onMouseOut = () => {
    hovered = false;
    paint();
  };
  tag.onMouseUp = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = renderer.getSelection()?.getSelectedText() ?? "";
    if (selected !== "") return;
    options.onToggle();
    paint();
  };
  repaints.set(tag, () => {
    tag.fg = theme.pasteForeground;
    paint();
  });
  paint();
  parent.add(tag);
  return tag;
}

function addUserText(transcript: Transcript, block: BoxRenderable, text: string): void {
  const lines = text.split("\n");
  const folded = lines.length > PASTE_COLLAPSE_LINES;
  const preview = lines.slice(0, PASTE_PREVIEW_LINES).join("\n");
  let expanded = transcript.disclosures?.get(`user:${text}`) ?? false;
  const body = new TranscriptTextRenderable(transcript.renderer, {
    id: transcript.nextId("user-text"),
    content: folded && !expanded ? preview : text,
    fg: transcript.theme.foreground,
    wrapMode: "word",
    selectionBg: transcript.theme.selectionBackground,
    selectionFg: transcript.theme.selectionForeground,
  });
  repaints.set(body, () => {
    body.fg = transcript.theme.foreground;
    body.selectionBg = transcript.theme.selectionBackground;
    body.selectionFg = transcript.theme.selectionForeground;
  });
  block.add(body);
  if (!folded) return;
  const hidden = lines.length - PASTE_PREVIEW_LINES;
  collapsedTag(transcript, block, {
    marginTop: 1,
    label: () => (expanded ? " fewer lines " : ` +${String(hidden)} lines `),
    onToggle: () => {
      expanded = !expanded;
      transcript.disclosures?.set(`user:${text}`, expanded);
      body.content = expanded ? text : preview;
    },
  });
}

function addFileTag(
  transcript: Transcript,
  block: BoxRenderable,
  tags: BoxRenderable,
  file: PresentedFile,
): void {
  const { path, text } = file;
  if (text === undefined) {
    collapsedTag(transcript, tags, {
      url: pathToFileURL(path).href,
      label: () => ` File ${basename(path)} `,
      onToggle: () => transcript.openPath(path),
    });
    return;
  }
  let open = transcript.disclosures?.get(`file:${path}`) ?? false;
  const body = new TranscriptCodeRenderable(transcript.renderer, {
    id: transcript.nextId("file-body"),
    content: text,
    filetype: pathToFiletype(path) ?? undefined,
    syntaxStyle: transcript.syntaxStyle,
    fg: transcript.theme.foreground,
    visible: open,
    marginTop: 1,
    selectionBg: transcript.theme.selectionBackground,
    selectionFg: transcript.theme.selectionForeground,
  });
  repaints.set(body, () => {
    body.syntaxStyle = transcript.syntaxStyle;
    body.fg = transcript.theme.foreground;
    body.selectionBg = transcript.theme.selectionBackground;
    body.selectionFg = transcript.theme.selectionForeground;
  });
  collapsedTag(transcript, tags, {
    url: pathToFileURL(path).href,
    label: () => ` File ${basename(path)}${open ? "" : ` +${String(pasteLineCount(text))} lines`} `,
    onToggle: () => {
      open = !open;
      transcript.disclosures?.set(`file:${path}`, open);
      body.visible = open;
    },
  });
  block.add(body);
}

/** A `!command` the prompt carried: its output folds behind the command, like an attached file. */
function addShellTag(
  transcript: Transcript,
  block: BoxRenderable,
  tags: BoxRenderable,
  run: ShellRun,
): void {
  const key = `shell:${run.command}:${run.output}`;
  let open = transcript.disclosures?.get(key) ?? false;
  const body = new TranscriptCodeRenderable(transcript.renderer, {
    id: transcript.nextId("shell-body"),
    content: run.output,
    syntaxStyle: transcript.syntaxStyle,
    fg: transcript.theme.foreground,
    visible: open,
    marginTop: 1,
    selectionBg: transcript.theme.selectionBackground,
    selectionFg: transcript.theme.selectionForeground,
  });
  repaints.set(body, () => {
    body.syntaxStyle = transcript.syntaxStyle;
    body.fg = transcript.theme.foreground;
    body.selectionBg = transcript.theme.selectionBackground;
    body.selectionFg = transcript.theme.selectionForeground;
  });
  collapsedTag(transcript, tags, {
    label: () =>
      ` Shell ${run.command}${run.exitCode === 0 ? "" : ` exit ${String(run.exitCode)}`}${open ? "" : ` +${String(pasteLineCount(run.output))} lines`} `,
    onToggle: () => {
      open = !open;
      transcript.disclosures?.set(key, open);
      body.visible = open;
    },
  });
  block.add(body);
}

/** The request block of a turn; a pending message draws the same block ahead of its turn. */
export function appendUser(
  transcript: Transcript,
  content: UserMessage["content"],
  parent: Renderable,
  before?: Renderable,
): BoxRenderable {
  const presentation = userPresentation(content);
  const block = section(
    transcript,
    "user",
    {
      backgroundColor: transcript.theme.userBackground,
      marginTop: 0,
      marginLeft: 1,
      marginRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 3,
      width: transcript.userBlockWidth(),
    },
    parent,
    before,
  );
  repaints.set(block, () => {
    block.backgroundColor = transcript.theme.userBackground;
  });
  transcript.userBlocks.add(block);
  block.once(RenderableEvents.DESTROYED, () => transcript.userBlocks.delete(block));
  if (presentation.text !== "") addUserText(transcript, block, presentation.text);

  const tags = new BoxRenderable(transcript.renderer, {
    id: transcript.nextId("user-attachments"),
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 1,
    visible:
      presentation.files.length +
        presentation.skills.length +
        presentation.shells.length +
        presentation.images.length >
      0,
    marginTop: presentation.text === "" ? 0 : 1,
  });
  block.add(tags);
  for (const skill of presentation.skills) {
    collapsedTag(transcript, tags, {
      url: pathToFileURL(skill.path).href,
      label: () => ` Skill ${skill.name} `,
      onToggle: () => transcript.openPath(skill.path),
    });
  }
  for (const file of presentation.files) addFileTag(transcript, block, tags, file);
  for (const run of presentation.shells) addShellTag(transcript, block, tags, run);
  for (const [index, image] of presentation.images.entries()) {
    const preview = new ImageRenderable(transcript.renderer, {
      id: transcript.nextId("user-image"),
      source: Buffer.from(image.data, "base64"),
      width: "100%",
      height: 12,
      fit: "fit",
      visible: transcript.disclosures?.get(`image:${String(index)}`) ?? false,
    });
    collapsedTag(transcript, tags, {
      label: () => ` Image ${String(index + 1)} (${image.mimeType}) `,
      onToggle: () => {
        preview.visible = !preview.visible;
        transcript.disclosures?.set(`image:${String(index)}`, preview.visible);
      },
    });
    block.add(preview);
  }
  return block;
}

// ---------------------------------------------------------------------------
// Markers between turns
// ---------------------------------------------------------------------------

function appendNote(
  transcript: Transcript,
  text: string,
  color: string | undefined,
  parent: Renderable,
  before?: Renderable,
): BoxRenderable {
  const box = section(transcript, "note", {}, parent, before);
  box.add(
    new TranscriptTextRenderable(transcript.renderer, {
      id: transcript.nextId("note-text"),
      content: text,
      fg: color ?? transcript.theme.dim,
      wrapMode: "word",
    }),
  );
  repaints.set(box, () => {
    for (const child of box.getChildren()) {
      if (child instanceof TextRenderable)
        child.fg = color === undefined ? transcript.theme.dim : transcript.theme.error;
    }
  });
  return box;
}

function appendCard(transcript: Transcript, heading: string, summary: string): BoxRenderable {
  const { theme } = transcript;
  const preview = previewLines(summary, { kind: "head", max: 40 });
  const visibleSummary =
    preview.omitted === 0 ? preview.text : `${preview.text}\n${omittedLabel(preview.omitted)}`;
  const card = new BoxRenderable(transcript.renderer, {
    id: transcript.nextId("card"),
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.promptBorder,
    paddingLeft: 2,
    paddingRight: 2,
    marginTop: SPACING.block,
    width: "100%",
  });
  card.add(
    new TranscriptTextRenderable(transcript.renderer, {
      id: transcript.nextId("card-heading"),
      content: new StyledText([fg(theme.dim)(heading)]),
      wrapMode: "word",
    }),
  );
  if (visibleSummary !== "") {
    card.add(
      new TranscriptMarkdownRenderable(transcript.renderer, {
        renderNode: createMermaidMarkdownRenderer(
          transcript.renderer,
          theme,
          transcript.disclosures,
          { key: "card" },
        ),
        tableOptions: { selectable: true, cellPaddingX: 1 },
        id: transcript.nextId("card-summary"),
        content: visibleSummary,
        syntaxStyle: transcript.subtleSyntaxStyle,
        fg: theme.dim,
      }),
    );
  }
  repaints.set(card, () => {
    card.borderColor = theme.promptBorder;
    for (const child of card.getChildren()) {
      if (child instanceof TextRenderable) child.content = new StyledText([fg(theme.dim)(heading)]);
      if (child instanceof TranscriptMarkdownRenderable)
        child.retheme(theme, transcript.subtleSyntaxStyle, true);
    }
  });
  transcript.container.add(card);
  return card;
}

/** One non-turn item: a checkpoint card, a branch summary, a config line, a note. */
function appendMarker(transcript: Transcript, item: Exclude<Turn, { kind: "turn" }>): Renderable {
  switch (item.kind) {
    case "checkpoint":
      return appendCard(
        transcript,
        `context compacted · ${String(item.body.tokensBefore)} tokens before`,
        item.body.summary,
      );
    case "summary":
      return appendCard(transcript, "branch summary", item.body.text);
    case "config": {
      const parts: string[] = [];
      if (item.body.model !== undefined) {
        const { provider, id } = item.body.model;
        parts.push(`Model → ${provider === undefined ? id : `${provider}/${id}`}`);
      }
      if (item.body.thinkingLevel !== undefined)
        parts.push(`Thinking → ${item.body.thinkingLevel}`);
      if (item.body.agent !== undefined) parts.push(`Agent → ${item.body.agent}`);
      return appendNote(transcript, parts.join(" · "), undefined, transcript.container);
    }
    case "note":
      return appendNote(
        transcript,
        presentNote({ commit: item.commit, at: item.at, body: item.body }).text,
        undefined,
        transcript.container,
      );
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Turn blocks
// ---------------------------------------------------------------------------

/** Top-level layout owner for a conversation turn. */
class TurnSection extends BoxRenderable {
  constructor(transcript: Transcript, id: string) {
    super(transcript.renderer, {
      id: `turn:${id}`,
      flexDirection: "column",
      paddingLeft: 0,
      paddingRight: 0,
      marginTop: SPACING.block,
      width: "100%",
      live: false,
    });
  }
}

/**
 * Streamed assistant markdown owned by one conversation turn. The content only
 * ever grows at its tail, so OpenTUI re-parses the last blocks and nothing
 * above them, the way opencode v2 feeds its markdown part.
 *
 * Based on https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/routes/session/index.tsx (text part)
 */
class AssistantPartBlock {
  readonly box: BoxRenderable;
  private readonly markdown: TranscriptMarkdownRenderable;
  private readonly disclosureKey: { key: string };
  private readonly disclosures: Transcript["disclosures"];
  private buffer = "";

  constructor(
    transcript: Transcript,
    parent: Renderable,
    before: Renderable | undefined,
    partKey: string,
    settledText?: string,
  ) {
    this.disclosureKey = { key: partKey };
    this.disclosures = transcript.disclosures;
    this.box = section(transcript, "assistant", {}, parent, before);
    this.markdown = new TranscriptMarkdownRenderable(transcript.renderer, {
      renderNode: createMermaidMarkdownRenderer(
        transcript.renderer,
        transcript.theme,
        transcript.disclosures,
        this.disclosureKey,
      ),
      tableOptions: { selectable: true, cellPaddingX: 1 },
      id: transcript.nextId("assistant-md"),
      content: settledText ?? "",
      syntaxStyle: transcript.syntaxStyle,
      streaming: settledText === undefined,
      internalBlockMode: "top-level",
      // A fenced block whose language has no grammar (`text`, `mermaid`, none)
      // is drawn as plain text in this color. OpenTUI's own default is white,
      // which vanishes on the light theme.
      fg: transcript.theme.foreground,
    });
    repaints.set(this.box, () => {
      this.markdown.retheme(transcript.theme, transcript.syntaxStyle, false);
    });
    this.box.add(this.markdown);
    this.buffer = settledText ?? "";
    this.box.visible = this.buffer.trim() !== "";
  }

  /** The whole text so far; the overlay carries the accumulated stream. */
  set(text: string): void {
    if (text === this.buffer) return;
    this.buffer = text;
    this.box.visible = text.trim() !== "";
    if (!hasIncompleteHeadingPrefix(text)) this.markdown.content = text;
  }

  finish(text: string, partKey = this.disclosureKey.key): void {
    rekeyDisclosures(this.disclosureKey, partKey, this.disclosures);
    this.buffer = text;
    this.box.visible = text.trim() !== "";
    this.markdown.content = text;
    this.markdown.streaming = false;
  }

  remove(): void {
    this.box.parent?.remove(this.box);
    this.box.destroyRecursively();
  }
}

/** Streamed reasoning content that settles to a static Thought block. */
class ReasoningBlock implements ExpandableToolOutput {
  readonly box: BoxRenderable;
  private readonly heading: TextRenderable;
  private readonly markdown: TranscriptMarkdownRenderable;
  private readonly theme: CliTheme;
  private readonly disclosureKey: { key: string };
  private readonly disclosures: Transcript["disclosures"];
  private buffer = "";
  private expanded = false;

  constructor(
    transcript: Transcript,
    parent: Renderable,
    before: Renderable | undefined,
    partKey: string,
    settledText?: string,
  ) {
    this.theme = transcript.theme;
    this.disclosureKey = { key: partKey };
    this.disclosures = transcript.disclosures;
    this.box = section(transcript, "thinking", {}, parent, before);
    this.box.visible = false;
    this.heading = new TranscriptTextRenderable(transcript.renderer, {
      id: transcript.nextId("thinking-heading"),
      content: "",
      visible: false,
      wrapMode: "none",
    });
    this.markdown = new TranscriptMarkdownRenderable(transcript.renderer, {
      renderNode: createMermaidMarkdownRenderer(
        transcript.renderer,
        transcript.theme,
        transcript.disclosures,
        this.disclosureKey,
      ),
      tableOptions: { selectable: true, cellPaddingX: 1 },
      id: transcript.nextId("thinking-md"),
      content: "",
      syntaxStyle: transcript.subtleSyntaxStyle,
      streaming: settledText === undefined,
      internalBlockMode: "top-level",
      fg: transcript.theme.dim,
    });
    repaints.set(this.box, () => {
      this.heading.content = new StyledText([
        fg(this.theme.thinking)(`${GLYPHS.diamond}${ACTIVITY_THOUGHT_LABEL}`),
      ]);
      this.markdown.retheme(transcript.theme, transcript.subtleSyntaxStyle, true);
    });
    this.box.add(this.heading);
    this.box.add(this.markdown);
    const unregister = transcript.toolOutput.register(this);
    this.box.once(RenderableEvents.DESTROYED, unregister);
    if (settledText !== undefined) this.finish(settledText);
  }

  /** The whole thought so far. The preview cut waits for `finish`: a sliding tail would rebuild every block per delta. */
  set(text: string): void {
    if (text === this.buffer) return;
    this.buffer = text;
    this.box.visible = text.trim() !== "";
    if (!hasIncompleteHeadingPrefix(text)) this.markdown.content = text;
  }

  /** A blank thought earns neither a heading nor the row its block would take. */
  finish(text: string, partKey = this.disclosureKey.key): void {
    rekeyDisclosures(this.disclosureKey, partKey, this.disclosures);
    this.buffer = text;
    this.box.visible = text.trim() !== "";
    this.heading.content = new StyledText([
      fg(this.theme.thinking)(`${GLYPHS.diamond}${ACTIVITY_THOUGHT_LABEL}`),
    ]);
    this.heading.visible = this.box.visible;
    this.markdown.content = this.preview();
    this.markdown.streaming = false;
  }

  /** A toggle mid-stream does nothing: `finish` is the only cut point. */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    if (this.markdown.streaming) return;
    this.markdown.content = this.preview();
  }

  remove(): void {
    this.box.parent?.remove(this.box);
    this.box.destroyRecursively();
  }

  private preview(): string {
    return toolOutputPreview(this.buffer, this.expanded, {
      kind: "head-tail",
      head: RESULT_PREVIEW_LINES,
      tail: RESULT_TAIL_LINES,
    });
  }
}

/** `unanswered` holds the row blank: the space a run's status takes, before there is a run. */
type ActivityMode = "unanswered" | "working" | "thinking" | "waiting" | "retrying" | "compacting";

function spins(mode: ActivityMode): boolean {
  return mode !== "waiting" && mode !== "unanswered";
}

/** The turn's single live status row. It never competes with another spinner. */
class ActivityBlock {
  private readonly transcript: Transcript;
  private readonly section: BoxRenderable;
  private readonly line: TextRenderable;
  private readonly spinner: SpinnerRenderable;
  private startedAt = performance.now();
  private readonly durationMs: number;
  private mode: ActivityMode | "settled";
  private workingLabel = ACTIVITY_WORKING_LABEL;

  get anchor(): Renderable {
    return this.section;
  }

  constructor(
    transcript: Transcript,
    parent: TurnSection,
    durationMs: number,
    mode: ActivityMode = "working",
  ) {
    this.transcript = transcript;
    this.durationMs = durationMs;
    this.mode = mode;
    this.section = section(transcript, "activity", {}, parent);
    this.section.flexDirection = "row";
    this.section.height = 1;
    this.spinner = new SpinnerRenderable(transcript.renderer, {
      frames: [...SPINNER_FRAMES],
      interval: SPINNER_INTERVAL_MS,
      autoplay: false,
      color: transcript.theme.running,
    });
    this.spinner.id = transcript.nextId("activity-spinner");
    this.spinner.flexShrink = 0;
    this.section.add(this.spinner);
    this.line = new TranscriptTextRenderable(transcript.renderer, {
      id: transcript.nextId("activity-line"),
      content: "",
      wrapMode: "none",
    });
    this.section.add(this.line);
    repaints.set(this.line, () => this.paint());
    this.paint();
    this.spinner.visible = spins(mode);
    if (spins(mode)) this.spinner.start();
  }

  /** `activity` names the wait behind the running tools; absent, the row says Working. */
  setMode(mode: ActivityMode, activity?: string): void {
    if (this.mode === "settled") return;
    const workingLabel = activity === undefined ? ACTIVITY_WORKING_LABEL : ` ${activity}`;
    if (this.mode === mode && this.workingLabel === workingLabel) return;
    // The wait for a run is not the run's time.
    if (this.mode === "unanswered") this.startedAt = performance.now();
    this.workingLabel = workingLabel;
    this.mode = mode;
    if (!spins(mode)) this.spinner.stop();
    this.spinner.visible = spins(mode);
    this.paint();
    if (spins(mode)) this.spinner.start();
  }

  settle(outcome: TurnOutcome): void {
    if (this.mode === "settled") return;
    const { theme } = this.transcript;
    const elapsed = this.durationMs + performance.now() - this.startedAt;
    this.spinner.stop();
    this.spinner.visible = false;
    this.mode = "settled";
    const paint = (): void => {
      switch (outcome) {
        case "completed": {
          const duration =
            elapsed >= MIN_REPORTED_DURATION_MS ? ` for ${formatDuration(elapsed)}` : "";
          this.line.content = new StyledText([
            fg(theme.dim)(`${ACTIVITY_WORKED_LABEL}${duration}`),
          ]);
          return;
        }
        case "aborted":
          this.line.content = new StyledText([fg(theme.warning)(ACTIVITY_STOPPED_LABEL)]);
          return;
        case "failed":
          this.line.content = new StyledText([
            fg(theme.error)(`${GLYPHS.cross}${ACTIVITY_FAILED_LABEL}`),
          ]);
          return;
        default: {
          const _exhaustive: never = outcome;
          return _exhaustive;
        }
      }
    };
    repaints.set(this.line, paint);
    paint();
  }

  remove(): void {
    this.section.parent?.remove(this.section);
    this.section.destroyRecursively();
  }

  private paint(): void {
    const { theme } = this.transcript;
    switch (this.mode) {
      case "working":
      case "compacting":
        this.spinner.color = theme.running;
        this.line.content = new StyledText([
          fg(theme.dim)(this.mode === "compacting" ? " Compacting context…" : this.workingLabel),
        ]);
        return;
      case "thinking":
        this.spinner.color = theme.thinking;
        this.line.content = new StyledText([fg(theme.thinking)(ACTIVITY_THINKING_LABEL)]);
        return;
      case "waiting":
        this.line.content = new StyledText([
          fg(theme.warning)(`${GLYPHS.bullet}${ACTIVITY_WAITING_LABEL}`),
        ]);
        return;
      case "retrying":
        this.spinner.color = theme.warning;
        this.line.content = new StyledText([fg(theme.warning)(ACTIVITY_RETRY_LABEL)]);
        return;
      case "unanswered":
        this.line.content = "";
        return;
      case "settled":
        return;
      default: {
        const _exhaustive: never = this.mode;
        return _exhaustive;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tool cards
// ---------------------------------------------------------------------------

function taskPreview(part: ToolTurnPart | ShellExecution) {
  if (part.kind === "shell") return undefined;
  if (part.toolName !== "task" || !isJsonObject(part.args)) return undefined;
  const { model, prompt, title } = part.args;
  if (!isJsonString(model) || !isJsonString(prompt)) return undefined;
  return { model, title: isJsonString(title) ? title : "Task", prompt };
}

/**
 * One card per tool call, reused from the call through progress to the
 * settled result. Unified diffs from edit details or shell output render
 * with DiffRenderable; everything else shows a capped preview.
 */
class ToolCard {
  readonly container: BoxRenderable;

  private readonly transcript: Transcript;
  private readonly detail: BoxRenderable;
  private readonly heading: TextRenderable;
  private readonly structuredBodies: Renderable[] = [];
  private current: ToolTurnPart | ShellExecution;
  private live: ToolLive | undefined;
  private expanded = false;
  private destroyed = false;
  private textBody: CodeRenderable | undefined;
  /** The rows of a delegation card, made once and sized for good. */
  private window: TextRenderable | undefined;
  /** A dim remark after the result and clock: what this call is not (`not sent to model`). */
  private note: string | undefined;

  /**
   * A shell call's clock, ticking from the card's first frame until the result
   * lands: how long a command has been running says whether it is stuck. A
   * card built from a settled part never started one.
   *
   * Based on pi's Elapsed/Took row under a bash call:
   * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/renderers/bash.ts
   */
  private timing:
    | {
        readonly kind: "running";
        readonly startedAt: number;
        readonly ticker: ReturnType<typeof setInterval>;
      }
    | { readonly kind: "took"; readonly ms: number }
    | undefined;

  private headingState: [icon: string, color: string, result?: string] = ["", ""];
  private readonly refreshHeading = (): void => {
    if (!this.destroyed) this.heading.content = this.headingContent(...this.headingState);
  };

  constructor(
    transcript: Transcript,
    part: ToolTurnPart | ShellExecution,
    parent: Renderable,
    before: Renderable | undefined,
    live?: ToolLive,
    note?: string,
  ) {
    this.transcript = transcript;
    this.current = part;
    this.live = live;
    this.note = note;
    this.container = section(transcript, "tool", {}, parent, before);
    this.heading = new TranscriptTextRenderable(transcript.renderer, {
      id: transcript.nextId("tool-heading"),
      content: "",
      wrapMode: "none",
      truncate: true,
    });
    this.container.add(this.heading);
    this.detail = new BoxRenderable(transcript.renderer, {
      id: transcript.nextId("tool-detail"),
      visible: false,
      flexDirection: "column",
      backgroundColor: transcript.theme.codeBackground,
      paddingLeft: 2,
      width: "100%",
    });
    this.container.add(this.detail);
    repaints.set(this.container, () => this.retheme());
    const unregister = transcript.toolOutput.register(this);
    if (this.toolName === "bash" && !this.completed) {
      this.timing = {
        kind: "running",
        startedAt: performance.now(),
        ticker: setInterval(this.refreshHeading, 1000),
      };
    }
    this.container.once(RenderableEvents.DESTROYED, () => {
      this.destroyed = true;
      this.stopClock();
      unregister();
    });
    if (!this.expanded) this.render();
  }

  /** The part as last synced: the call, and its result once settled. */
  get part(): ToolTurnPart | undefined {
    return this.current.kind === "tool" ? this.current : undefined;
  }

  private get toolName(): string {
    return this.current.kind === "shell" ? "bash" : this.current.toolName;
  }

  private get result() {
    return this.current.kind === "tool" ? this.current.result : undefined;
  }

  get completed(): boolean {
    return this.current.kind === "shell"
      ? this.current.state !== "running"
      : this.result !== undefined;
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.expanded) return;
    this.expanded = expanded;
    this.render();
  }

  setNote(note: string | undefined): void {
    if (note === this.note) return;
    this.note = note;
    this.refreshHeading();
  }

  /** The settled part, or a fresh progress report while the call runs. */
  sync(part: ToolTurnPart | ShellExecution, live: ToolLive | undefined): void {
    const changed =
      part !== this.current || live?.text !== this.live?.text || live?.title !== this.live?.title;
    this.current = part;
    this.live = live;
    if (this.completed) this.stopClock();
    // A delegation's rows follow the child, which changes without this part.
    if (changed || this.window !== undefined) this.render();
  }

  private stopClock(): void {
    if (this.timing?.kind !== "running") return;
    clearInterval(this.timing.ticker);
    this.timing = { kind: "took", ms: performance.now() - this.timing.startedAt };
  }

  private clock(): string | undefined {
    if (this.current.kind === "shell") {
      const until = this.current.state === "running" ? Date.now() : this.current.finishedAt;
      return formatDuration(Math.max(0, until - this.current.startedAt));
    }
    switch (this.timing?.kind) {
      case "running":
        return formatDuration(performance.now() - this.timing.startedAt);
      case "took":
        return formatDuration(this.timing.ms);
      case undefined:
        return undefined;
      default: {
        const _exhaustive: never = this.timing;
        return _exhaustive;
      }
    }
  }

  private retheme(): void {
    const { theme } = this.transcript;
    if (this.current.kind === "shell") {
      this.detail.backgroundColor = theme.codeBackground;
      this.renderShell(this.current);
      return;
    }
    const delegation = taskPreview(this.current);
    if (delegation !== undefined) {
      this.renderDelegation(delegation);
      return;
    }
    const output = this.live?.text ?? "";
    this.headingState[1] =
      this.result === undefined
        ? output === ""
          ? theme.running
          : theme.user
        : this.result.isError
          ? theme.error
          : theme.ok;
    this.refreshHeading();
    this.detail.backgroundColor = theme.codeBackground;
    const diffs: DiffRenderable[] = [];
    const paint = (node: Renderable): void => {
      if (node instanceof DiffRenderable) {
        node.syntaxStyle = this.transcript.syntaxStyle;
        node.fg = theme.foreground;
        node.addedBg = theme.diffAddedBackground;
        node.removedBg = theme.diffRemovedBackground;
        node.addedLineNumberBg = theme.diffAddedBackground;
        node.removedLineNumberBg = theme.diffRemovedBackground;
        node.addedSignColor = theme.ok;
        node.removedSignColor = theme.error;
        node.lineNumberFg = theme.dim;
        node.selectionBg = theme.selectionBackground;
        node.selectionFg = theme.selectionForeground;
        diffs.push(node);
        return;
      }
      if (node instanceof CodeRenderable) {
        node.syntaxStyle = this.transcript.syntaxStyle;
        node.fg = this.result?.isError === true ? theme.error : theme.dim;
        node.bg = theme.codeBackground;
        node.selectionBg = theme.selectionBackground;
        node.selectionFg = theme.selectionForeground;
      }
      if (node instanceof TextRenderable) node.fg = theme.dim;
      for (const child of node.getChildren()) paint(child);
    };
    paint(this.detail);
    syncDiffGutters(diffs);
  }

  private headingContent(icon: string, color: string, result?: string): StyledText {
    this.headingState = result === undefined ? [icon, color] : [icon, color, result];
    const { theme } = this.transcript;
    const chunks = [fg(color)(icon), ...this.headingTitle()];
    const tail = [result, this.clock(), this.note]
      .filter((value) => value !== undefined)
      .join(" · ");
    if (tail !== "") chunks.push(fg(theme.dim)(`  ${tail}`));
    return new StyledText(chunks);
  }

  /**
   * The tool name and its title. A shell call's title is a command, which
   * reads as code, so it is highlighted as one once the grammar answers.
   */
  private headingTitle(): TextChunk[] {
    const { theme, labelSyntax } = this.transcript;
    const title = this.title();
    const name =
      this.current.kind === "shell" ? (this.note === undefined ? "!" : "!!") : this.toolName;
    const plain = fg(theme.foreground)(` ${toolHeading(name, title)}`);
    const filetype = HEADING_FILETYPES.get(this.toolName);
    if (filetype === undefined || title === undefined) return [plain];
    const highlighted = labelSyntax.chunks(
      title,
      filetype,
      this.transcript.syntaxStyle,
      this.refreshHeading,
    );
    if (highlighted === undefined) return [plain];
    return [fg(theme.foreground)(` ${name} `), ...highlighted];
  }

  private title(): string | undefined {
    if (this.current.kind === "shell") return this.current.command;
    return this.result?.title ?? this.live?.title ?? taskPreview(this.current)?.title;
  }

  private render(): void {
    if (this.current.kind === "shell") {
      this.renderShell(this.current);
      return;
    }
    const { theme } = this.transcript;
    const delegation = taskPreview(this.current);
    if (delegation !== undefined) {
      this.renderDelegation(delegation);
      return;
    }
    const view = projectToolView(this.current, this.live);
    const presentation = presentTool(view);
    switch (presentation.status) {
      case "running": {
        const text = this.live?.text ?? "";
        const inline = inlineToolPreview(text);
        this.heading.content = this.headingContent(
          GLYPHS.bullet,
          text === "" ? theme.running : theme.user,
          inline ?? resultSummary(text),
        );
        if (inline !== undefined || text === "") this.clearBody();
        else this.showPreview(text, theme.dim);
        return;
      }
      case "failed":
        this.renderSettled(presentation, true);
        return;
      case "done":
        this.renderSettled(presentation, false);
        return;
      default: {
        const _exhaustive: never = presentation.status;
        return _exhaustive;
      }
    }
  }

  private renderShell(execution: ShellExecution): void {
    const { theme } = this.transcript;
    const mark = statusMark(
      execution.state === "running"
        ? "running"
        : execution.state === "exited" && execution.exitCode === 0
          ? "done"
          : "failed",
    );
    const outcome =
      execution.state === "exited" && execution.exitCode !== 0
        ? `exit ${String(execution.exitCode)}`
        : execution.state === "cancelled"
          ? "cancelled"
          : execution.state === "signalled"
            ? execution.signal
            : execution.state === "failed"
              ? execution.message
              : undefined;
    this.heading.content = this.headingContent(
      mark.glyph,
      theme[mark.tone],
      [resultSummary(execution.output), outcome].filter((value) => value !== undefined).join(" · "),
    );
    // Process output is display data, not a fabricated conversation tool result.
    this.showPreview(execution.output, outcome === undefined ? theme.dim : theme.error);
  }

  private renderDelegation(delegation: NonNullable<ReturnType<typeof taskPreview>>): void {
    if (this.current.kind !== "tool") return;
    const callId = this.current.callId;
    const { theme } = this.transcript;
    const child = this.transcript.children().find((state) => state.info.parent?.callId === callId);
    const result = this.result;
    const status =
      result !== undefined
        ? result.isError
          ? "failed"
          : "done"
        : child === undefined
          ? "running"
          : runStatus(child.run);
    const mark = statusMark(status);
    const title = this.title();
    const config = [child?.config.model?.id ?? delegation.model, child?.config.thinkingLevel]
      .filter((value) => value !== undefined)
      .join(" · ");
    this.heading.content = new StyledText([
      fg(theme[mark.tone])(`${mark.glyph} `),
      fg(theme.foreground)("task "),
      fg(theme.tool)(title ?? delegation.title),
      ...(config === "" ? [] : [fg(theme.dim)(`  ${config}`)]),
    ]);

    if (this.window === undefined) {
      this.window = new TranscriptTextRenderable(this.transcript.renderer, {
        id: this.transcript.nextId("tool-window"),
        height: DELEGATION_ROWS,
        marginLeft: 2,
        wrapMode: "none",
        truncate: true,
      });
      this.container.add(this.window);
    }
    const steps = [
      { status: "queued" as const, text: delegation.prompt },
      ...(child === undefined ? [] : taskSteps(child)),
    ].slice(-DELEGATION_ROWS);
    const rows: TextChunk[] = [];
    for (let index = 0; index < DELEGATION_ROWS; index += 1) {
      if (index > 0) rows.push(fg(theme.dim)("\n"));
      const step = steps[index];
      if (step === undefined) continue;
      const stepMark = statusMark(step.status);
      rows.push(fg(theme[stepMark.tone])(`${stepMark.glyph} `), fg(theme.dim)(step.text));
    }
    this.window.content = new StyledText(rows);
  }

  private renderSettled(presentation: ToolPresentation, isError: boolean): void {
    const { theme } = this.transcript;
    const output = this.result?.output ?? "";
    if (presentation.body.kind === "diff" && !isError) {
      const { patch, path, added, removed } = presentation.body;
      this.heading.content = this.headingContent(
        GLYPHS.check,
        theme.ok,
        `+${String(added)} -${String(removed)}`,
      );
      const diff = diffFromOutput(patch);
      if (diff === undefined) this.showPreview(patch, theme.dim);
      else
        this.showDiff({
          ...diff,
          files: diff.files.map((file) => ({ ...file, path: path ?? file.path })),
        });
      return;
    }
    const outputDiff = isError ? undefined : diffFromOutput(output);
    if (outputDiff !== undefined) {
      const hunks = outputDiff.files.reduce((count, file) => count + file.sections.length, 0);
      this.heading.content = this.headingContent(
        GLYPHS.check,
        theme.ok,
        `${String(hunks)} ${hunks === 1 ? "hunk" : "hunks"}`,
      );
      this.showDiff(outputDiff);
      return;
    }
    const inline = inlineToolPreview(output);
    const summary = presentation.summary ?? inline ?? resultSummary(output);
    // A collapsed read names the file and its size without repeating its body.
    const collapsedRead =
      this.toolName === "read" && !isError && !this.expanded && inline === undefined;
    const headingResult = collapsedRead
      ? [summary, `${keycap("chat.tools.toggle")} expand`]
          .filter((value) => value !== undefined)
          .join(" · ")
      : summary;
    const mark = statusMark(isError ? "failed" : "done");
    this.heading.content = this.headingContent(mark.glyph, theme[mark.tone], headingResult);
    if (collapsedRead || inline !== undefined) this.clearBody();
    else this.showPreview(output, isError ? theme.error : theme.dim);
  }

  /**
   * Running output is plain text; a settled read is highlighted for its file
   * type. The body and its "more lines" label are made once and updated.
   *
   * Based on opencode v2, which highlights only settled tool bodies:
   * https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/routes/session/index.tsx
   */
  private showPreview(text: string, color: string): void {
    const preview = toolOutputPreview(text, this.expanded, previewCut(this.toolName));
    if (this.structuredBodies.length > 0) this.clearBody();
    if (preview === "") {
      this.clearBody();
      return;
    }
    this.detail.visible = true;
    this.detail.paddingLeft = 2;
    const filetype =
      this.completed && this.toolName === "read" && this.title() !== undefined
        ? pathToFiletype(this.title() ?? "")
        : undefined;
    if (this.textBody === undefined) {
      this.textBody = new TranscriptCodeRenderable(this.transcript.renderer, {
        id: this.transcript.nextId("tool-body"),
        content: preview,
        filetype,
        syntaxStyle: this.transcript.syntaxStyle,
        conceal: false,
        fg: color,
        bg: this.transcript.theme.codeBackground,
        wrapMode: "none",
        truncate: true,
        selectionBg: this.transcript.theme.selectionBackground,
        selectionFg: this.transcript.theme.selectionForeground,
        width: "100%",
      });
      this.detail.add(this.textBody);
    } else {
      if (filetype !== undefined && this.textBody.filetype !== filetype) {
        this.textBody.filetype = filetype;
      }
      this.textBody.content = preview;
      this.textBody.fg = color;
    }
  }

  private showDiff(output: OutputDiff): void {
    this.clearBody();
    this.detail.visible = true;
    this.detail.paddingLeft = 0;
    if (output.before !== undefined) this.addSupplementalPreview(output.before);
    const diffs: DiffRenderable[] = [];
    for (const file of output.files) {
      for (const hunk of file.sections) {
        if (hunk.omittedBefore > 0) {
          const omitted = label(
            this.transcript,
            unchangedLinesLabel(hunk.omittedBefore),
            this.transcript.theme.dim,
          );
          this.detail.add(omitted);
          this.structuredBodies.push(omitted);
        }
        const filetype = file.path === undefined ? undefined : pathToFiletype(file.path);
        const diff = new DiffRenderable(this.transcript.renderer, {
          id: this.transcript.nextId("tool-diff"),
          diff: hunk.patch,
          view: "unified",
          showLineNumbers: true,
          // The highlight callback only runs for a named filetype; "text" has no grammar.
          filetype: filetype ?? (hunk.pair === undefined ? undefined : "text"),
          syntaxStyle: this.transcript.syntaxStyle,
          wrapMode: "none",
          fg: this.transcript.theme.foreground,
          addedBg: this.transcript.theme.diffAddedBackground,
          removedBg: this.transcript.theme.diffRemovedBackground,
          addedLineNumberBg: this.transcript.theme.diffAddedBackground,
          removedLineNumberBg: this.transcript.theme.diffRemovedBackground,
          addedSignColor: this.transcript.theme.ok,
          removedSignColor: this.transcript.theme.error,
          lineNumberFg: this.transcript.theme.dim,
          selectionBg: this.transcript.theme.selectionBackground,
          selectionFg: this.transcript.theme.selectionForeground,
          minHeight: hunk.rows > 0 ? hunk.rows : undefined,
          width: "100%",
        });
        if (hunk.pair !== undefined) markChangedWords(diff, hunk.pair);
        this.detail.add(diff);
        this.structuredBodies.push(diff);
        diffs.push(diff);
      }
    }
    syncDiffGutters(diffs);
    if (output.after !== undefined) this.addSupplementalPreview(output.after);
  }

  private addSupplementalPreview(text: string): void {
    const preview = toolOutputPreview(text, this.expanded, previewCut(this.toolName));
    if (preview === "") return;
    const panel = new BoxRenderable(this.transcript.renderer, {
      id: this.transcript.nextId("tool-output"),
      flexDirection: "column",
      paddingLeft: 2,
      width: "100%",
    });
    panel.add(
      new TranscriptCodeRenderable(this.transcript.renderer, {
        id: this.transcript.nextId("tool-output-body"),
        content: preview,
        syntaxStyle: this.transcript.syntaxStyle,
        conceal: false,
        fg: this.transcript.theme.dim,
        bg: this.transcript.theme.codeBackground,
        wrapMode: "none",
        truncate: true,
        selectionBg: this.transcript.theme.selectionBackground,
        selectionFg: this.transcript.theme.selectionForeground,
        width: "100%",
      }),
    );
    this.detail.add(panel);
    this.structuredBodies.push(panel);
  }

  private clearBody(): void {
    if (this.textBody !== undefined) {
      this.detail.remove(this.textBody);
      this.textBody.destroy();
      this.textBody = undefined;
    }
    for (const body of this.structuredBodies.splice(0)) {
      this.detail.remove(body);
      body.destroyRecursively();
    }
    this.detail.visible = false;
    this.detail.paddingLeft = 2;
  }
}

// ---------------------------------------------------------------------------
// One turn
// ---------------------------------------------------------------------------

/**
 * What the status row shows: the run's phase while it is live, the record's
 * outcome after. A request nothing has answered yet keeps the row blank: the
 * commit lands one event before its run starts, and "Worked" in that gap is a
 * lie the block could never take back, while dropping the row would move the
 * message the run is about to answer.
 */
type TurnStatus =
  | {
      readonly kind: "open";
      readonly phase: RunInfo["phase"];
      readonly live: readonly LivePart[];
      readonly waitingForUser: boolean;
    }
  | { readonly kind: "unanswered" }
  | { readonly kind: "compacting" }
  | { readonly kind: "settled"; readonly outcome: TurnOutcome };

type PartBlock =
  | { readonly kind: "text"; readonly block: AssistantPartBlock; readonly contentIndex: number }
  | { readonly kind: "thinking"; readonly block: ReasoningBlock; readonly contentIndex: number };

/** One visual owner for a user request and every assistant step it drives. */
class TurnBlock {
  private readonly transcript: Transcript;
  readonly root: TurnSection;
  private readonly settled = new Set<string>();
  private readonly tools = new Map<string, ToolCard>();
  /** Streaming parts by `livePartKey`, until their commit lands or the run drops them. */
  private readonly live = new Map<string, PartBlock>();
  private activity: ActivityBlock | undefined;
  private durationMs: number;
  private closed = false;
  private lastTurn: Extract<Turn, { kind: "turn" }> | undefined;

  constructor(transcript: Transcript, id: string, durationMs: number) {
    this.transcript = transcript;
    this.durationMs = durationMs;
    this.root = new TurnSection(transcript, id);
    transcript.container.add(this.root);
  }

  /** True when the turn has drawn no answer yet: nothing but the request and the spinner. */
  get unanswered(): boolean {
    return this.settled.size <= 1 && this.tools.size === 0 && this.live.size === 0;
  }

  sync(turn: Extract<Turn, { kind: "turn" }> | undefined, status: TurnStatus): void {
    const progress = new Map<string, ToolLive>();
    if (status.kind === "open") {
      for (const part of status.live) {
        if (part.kind === "tool") progress.set(part.callId, part.progress);
      }
    }
    if (turn !== undefined && turn !== this.lastTurn) {
      this.durationMs = turn.durationMs;
      for (const part of turn.parts)
        this.syncPart(part, part.kind === "tool" ? progress.get(part.callId) : undefined);
      this.lastTurn = turn;
    }
    for (const [callId, card] of this.tools) {
      const part = card.part;
      if (part !== undefined) card.sync(part, progress.get(callId));
    }
    switch (status.kind) {
      case "open": {
        this.syncLive(status.live);
        this.ensureActivity().setMode(activityMode(status), this.runningActivity());
        return;
      }
      case "unanswered":
        this.syncLive([]);
        this.ensureActivity("unanswered").setMode("unanswered");
        return;
      case "compacting": {
        this.syncLive([]);
        this.ensureActivity().setMode("compacting");
        return;
      }
      case "settled":
        this.syncLive([]);
        this.settle(status.outcome);
        return;
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }

  remove(): void {
    this.closed = true;
    this.root.parent?.remove(this.root);
    this.root.destroyRecursively();
  }

  private syncPart(part: TurnPart, progress: ToolLive | undefined): void {
    const id = turnPartId(part);
    switch (part.kind) {
      case "user":
        if (this.settled.has(id)) return;
        this.settled.add(id);
        appendUser(this.transcript, part.content, this.root, this.contentAnchor());
        return;
      case "assistant": {
        if (this.settled.has(id)) return;
        this.settled.add(id);
        const adopted = this.adoptLive("text", part.contentIndex);
        if (adopted?.kind === "text") {
          adopted.block.finish(part.text, id);
          return;
        }
        void new AssistantPartBlock(
          this.transcript,
          this.root,
          this.contentAnchor(),
          id,
          part.text,
        );
        return;
      }
      case "thinking": {
        if (this.settled.has(id)) return;
        this.settled.add(id);
        const adopted = this.adoptLive("thinking", part.contentIndex);
        if (adopted?.kind === "thinking") {
          adopted.block.finish(part.text, id);
          return;
        }
        void new ReasoningBlock(this.transcript, this.root, this.contentAnchor(), id, part.text);
        return;
      }
      case "tool": {
        const card = this.tools.get(part.callId);
        if (card === undefined) {
          this.tools.set(
            part.callId,
            new ToolCard(this.transcript, part, this.root, this.contentAnchor(), progress),
          );
          return;
        }
        card.sync(part, progress);
        return;
      }
      case "note":
        if (this.settled.has(id)) return;
        this.settled.add(id);
        appendNote(
          this.transcript,
          part.text,
          part.text.startsWith("Error:") ? this.transcript.theme.error : undefined,
          this.root,
          this.contentAnchor(),
        );
        return;
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  }

  /**
   * A settled part at `contentIndex` takes over the live block that streamed
   * it, so the text does not jump from one box to another. The overlay for
   * the run was dropped in the same fold, which is why the block is free.
   */
  private adoptLive(kind: "text" | "thinking", contentIndex: number): PartBlock | undefined {
    for (const [key, entry] of this.live) {
      if (entry.kind !== kind || entry.contentIndex !== contentIndex) continue;
      this.live.delete(key);
      return entry;
    }
    return undefined;
  }

  private syncLive(parts: readonly LivePart[]): void {
    const keep = new Set<string>();
    for (const part of parts) {
      const key = livePartKey(part);
      keep.add(key);
      switch (part.kind) {
        case "text": {
          const existing = this.live.get(key);
          if (existing?.kind === "text") {
            existing.block.set(part.text);
            break;
          }
          const block = new AssistantPartBlock(
            this.transcript,
            this.root,
            this.contentAnchor(),
            key,
          );
          block.set(part.text);
          this.live.set(key, { kind: "text", block, contentIndex: part.index });
          break;
        }
        case "thinking": {
          const existing = this.live.get(key);
          if (existing?.kind === "thinking") {
            existing.block.set(part.text);
            break;
          }
          const block = new ReasoningBlock(this.transcript, this.root, this.contentAnchor(), key);
          block.set(part.text);
          this.live.set(key, { kind: "thinking", block, contentIndex: part.index });
          break;
        }
        case "tool":
          break;
        default: {
          const _exhaustive: never = part;
          return _exhaustive;
        }
      }
    }
    for (const [key, entry] of this.live) {
      if (keep.has(key)) continue;
      this.live.delete(key);
      entry.block.remove();
    }
  }

  private settle(outcome: TurnOutcome): void {
    if (this.closed) return;
    this.closed = true;
    this.ensureActivity().settle(outcome);
  }

  private ensureActivity(initial: ActivityMode = "working"): ActivityBlock {
    this.activity ??= new ActivityBlock(this.transcript, this.root, this.durationMs, initial);
    return this.activity;
  }

  /** Tool calls still without a result, in call order. */
  private runningActivity(): string | undefined {
    const running: string[] = [];
    for (const card of this.tools.values()) {
      const part = card.part;
      if (part !== undefined && part.result === undefined) running.push(part.toolName);
    }
    return runActivityLabel(running);
  }

  /** A turn with a status row keeps it last, so content lands above it. */
  private contentAnchor(): Renderable | undefined {
    return this.closed ? undefined : this.activity?.anchor;
  }
}

function activityMode(status: Extract<TurnStatus, { kind: "open" }>): ActivityMode {
  switch (status.phase.kind) {
    case "waiting":
      return status.waitingForUser ? "waiting" : "working";
    case "retry":
      return "retrying";
    case "respond":
      return status.live.at(-1)?.kind === "thinking" ? "thinking" : "working";
    case "tools":
    case "done":
    case "aborted":
    case "failed":
      return "working";
    default: {
      const _exhaustive: never = status.phase;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// The whole transcript
// ---------------------------------------------------------------------------

function itemKey(item: Turn): string {
  return item.kind === "turn" ? `turn:${item.id}` : `${item.kind}:${item.commit}`;
}

/** A turn that has drawn no answer: only its request, or nothing at all (a completion's turn). */
function isRequestOnly(turn: Extract<Turn, { kind: "turn" }>): boolean {
  return turn.parts.length === 0 || (turn.parts.length === 1 && turn.parts[0]?.kind === "user");
}

/**
 * The status of a turn no run is streaming into: the record's outcome, or the
 * run's when it is the run that answered it. A bare request that no run has
 * answered stays unanswered; a run that ended on it (with nothing to say, or
 * by stopping) settles it.
 */
function settledStatus(
  turn: Extract<Turn, { kind: "turn" }>,
  run: RunInfo | undefined,
): Extract<TurnStatus, { kind: "unanswered" | "settled" }> {
  const answered = run !== undefined && run.startedAt >= turn.startedAt;
  if (!answered) {
    return isRequestOnly(turn) && turn.outcome === "completed"
      ? { kind: "unanswered" }
      : { kind: "settled", outcome: turn.outcome };
  }
  switch (run.phase.kind) {
    case "aborted":
      return { kind: "settled", outcome: "aborted" };
    case "failed":
      return { kind: "settled", outcome: "failed" };
    case "done":
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return { kind: "settled", outcome: turn.outcome };
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}

/** Measured rows are hints, never a limit on how much history can be reached. */
const HEIGHT_CACHE_LIMIT = 1024;

/** One of the user's `!` jobs, shown among the turns where it started. */
interface ShellEntry {
  readonly kind: "shell";
  readonly execution: ShellExecution;
  readonly note: string | undefined;
}

interface TranscriptItem {
  readonly key: string;
  readonly source: Turn | ShellEntry;
  readonly item: Turn | ShellEntry;
  readonly disclosures: TranscriptDisclosures;
  height: number;
}

type MountedItem =
  | { readonly kind: "turn"; readonly root: TurnSection; readonly block: TurnBlock }
  | { readonly kind: "marker"; readonly root: Renderable }
  | { readonly kind: "shell"; readonly root: BoxRenderable; readonly card: ToolCard };

function entryTime(entry: Turn | ShellEntry): number {
  switch (entry.kind) {
    case "turn":
      return entry.startedAt;
    case "shell":
      return entry.execution.startedAt;
    default:
      return entry.at;
  }
}

function layoutY(node: Renderable): number {
  return (
    node.getLayoutNode().getComputedLayout().top +
    node.translateY +
    (node.parent === null ? 0 : layoutY(node.parent))
  );
}

interface ReadingAnchor {
  readonly index: number;
  readonly row: number;
  readonly text?: {
    readonly node: TextBufferRenderable;
    readonly offset: number;
    readonly screenRow: number;
    readonly widthMethod: CliRenderer["widthMethod"];
  };
}

/** The callback leaves chunks untouched, including OpenTUI's link metadata. */
const highlightSources = new WeakMap<
  CodeRenderable,
  {
    callback: NonNullable<CodeRenderable["onChunks"]>;
    source: string;
    text: string;
    highlights: SimpleHighlight[];
  }
>();

type TextChange = Pick<ReturnType<typeof diffChars>[number], "value" | "added" | "removed">;

/** Follow OpenTUI's highlight boundaries, including replacement and concealed spaces. */
function concealChanges(source: string, highlights: SimpleHighlight[]): TextChange[] {
  const boundaries = highlights
    .flatMap(([start, end], index) =>
      start === end
        ? []
        : [
            { offset: start, start: true, index },
            { offset: end, start: false, index },
          ],
    )
    .toSorted(
      (left, right) => left.offset - right.offset || Number(left.start) - Number(right.start),
    );
  const active = new Set<number>();
  const changes: TextChange[] = [];
  let cursor = 0;
  for (const boundary of boundaries) {
    if (cursor < boundary.offset) {
      const conceal = [...active]
        .map((index) => highlights[index])
        .find(
          (highlight) =>
            highlight !== undefined &&
            (highlight[3]?.conceal !== undefined ||
              highlight[2] === "conceal" ||
              highlight[2].startsWith("conceal.")),
        );
      changes.push({
        value: source.slice(cursor, boundary.offset),
        removed: conceal !== undefined,
        added: false,
      });
      if (conceal !== undefined) {
        const replacement =
          conceal[3]?.conceal !== undefined
            ? (conceal[3].conceal ?? "")
            : conceal[2] === "conceal.with.space"
              ? " "
              : "";
        if (replacement !== "") changes.push({ value: replacement, added: true, removed: false });
      }
    }
    if (boundary.start) active.add(boundary.index);
    else active.delete(boundary.index);
    cursor = boundary.offset;
    if (boundary.start) continue;
    const highlight = highlights[boundary.index];
    const meta = highlight?.[3];
    if (
      (meta?.concealLines !== undefined && source[cursor] === "\n") ||
      (source[cursor] === " " &&
        (meta?.conceal === " " ||
          (meta?.conceal === "" && highlight?.[2] === "conceal" && !meta.isInjection)))
    ) {
      changes.push({ value: source[cursor] ?? "", removed: true, added: false });
      cursor += 1;
    }
  }
  if (cursor < source.length)
    changes.push({ value: source.slice(cursor), added: false, removed: false });
  return changes;
}

/** Map the actual native buffer, including conceal replacements, not markdown guesses. */
const textMappings = new WeakMap<
  CodeRenderable,
  {
    source: string;
    text: string;
    changes: TextChange[];
  }
>();

function textOffset(node: TextBufferRenderable, offset: number, toSource: boolean): number {
  if (!(node instanceof CodeRenderable) || node.content === node.plainText) return offset;
  let mapping = textMappings.get(node);
  if (mapping?.source !== node.content || mapping.text !== node.plainText) {
    const highlighted = highlightSources.get(node);
    const changes =
      node.conceal && highlighted?.source === node.content && highlighted.text === node.plainText
        ? concealChanges(highlighted.source, highlighted.highlights)
        : diffChars(node.content, node.plainText);
    mapping = { source: node.content, text: node.plainText, changes };
    textMappings.set(node, mapping);
  }
  let from = 0;
  let to = 0;
  for (const change of mapping.changes) {
    const removed = toSource ? change.added : change.removed;
    const added = toSource ? change.removed : change.added;
    const length = change.value.length;
    if (added) {
      to += length;
      continue;
    }
    if (offset < from + length) return to + (removed ? 0 : offset - from);
    from += length;
    if (!removed) to += length;
  }
  return to;
}

/**
 * Only the viewport, one viewport of overscan on either side, and the tail are
 * mounted. Spacers stand in for the rest. A selection temporarily retains its
 * whole range because OpenTUI copies from mounted text buffers.
 */
export class TranscriptView {
  private readonly transcript: Transcript;
  private readonly mounted = new Map<number, MountedItem>();
  private readonly spacers: BoxRenderable[] = [];
  private readonly heights = new Map<
    string,
    { readonly source: Turn | ShellEntry; readonly height: number }
  >();
  private items: TranscriptItem[] = [];
  /** A local shell card may follow the still-streaming conversation turn. */
  private lastTurnIndex = -1;
  private offsets: number[] = [0];
  private state: SessionState | undefined;
  private geometry = "";
  private queued = false;
  private changingLayout = false;
  private pendingAnchor: ReadingAnchor | "bottom" | undefined;
  private reading: { readonly top: number; readonly anchor: ReadingAnchor | "bottom" } | undefined;
  private followMode: "latest" | "history" = "latest";
  /** The turn selected with Ctrl+Up/Down; it survives physical clamping near the tail. */
  private navigationKey: string | undefined;
  /** Blank rows after the tail so a selected turn can reach the viewport top. */
  private readonly navigationSpacer: BoxRenderable;
  private navigationSlack = 0;
  private selectionRange:
    | { readonly selection: Selection; readonly start: number; readonly end: number }
    | undefined;
  private liveTurn: { readonly key: string; readonly block: TurnBlock } | undefined;
  /** Content after the last turn that is not a turn: the messages still waiting to become one. */
  private readonly tail: Renderable | undefined;
  /** The user's `!` jobs on this head. Jobs, not commits: they join the items by start time. */
  private readonly shellEntries = new Map<string, ShellEntry>();
  private shellChanged = false;
  private readonly shellPositions = new Map<string, number>();

  constructor(transcript: Transcript, options: { readonly tail?: Renderable } = {}) {
    this.transcript = transcript;
    this.tail = options.tail;
    this.navigationSpacer = new BoxRenderable(transcript.renderer, {
      id: transcript.nextId("navigation-slack"),
      width: "100%",
      height: 0,
      flexShrink: 0,
    });
    transcript.renderer.setFrameCallback(this.beforeFrame);
    transcript.renderer.root.on(LayoutEvents.LAYOUT_CHANGED, this.restoreAnchor);
    transcript.renderer.on(CliRenderEvents.FRAME, this.scheduleLayout);
    transcript.renderer.on(CliRenderEvents.SELECTION, this.scheduleLayout);
    transcript.container.once(RenderableEvents.DESTROYED, () => {
      transcript.renderer.removeFrameCallback(this.beforeFrame);
      transcript.renderer.root.off(LayoutEvents.LAYOUT_CHANGED, this.restoreAnchor);
      transcript.renderer.off(CliRenderEvents.FRAME, this.scheduleLayout);
      transcript.renderer.off(CliRenderEvents.SELECTION, this.scheduleLayout);
      this.heights.clear();
      this.clear();
      this.navigationSpacer.destroy();
    });
  }

  /** Diagnostic count; cached widths are bounded independently of durable history. */
  get cachedHeightCount(): number {
    return this.heights.size;
  }

  /** Diagnostic count; the mounted window stays bounded independently of durable history. */
  get mountedItemCount(): number {
    return this.mounted.size;
  }

  /** Temporary space exists only while turn navigation needs to align the tail. */
  get navigationSlackRows(): number {
    return this.navigationSlack;
  }

  get isFollowingLatest(): boolean {
    return this.followMode === "latest";
  }

  get openTurn(): TurnBlock | undefined {
    const last = this.mounted.get(this.lastTurnIndex);
    return last?.kind === "turn" ? last.block : this.liveTurn?.block;
  }

  /** Call after the owning shell updates its theme and syntax styles. */
  retheme(): void {
    this.pendingAnchor ??= this.anchor();
    for (const mounted of this.mounted.values()) repaintTree(mounted.root);
    if (this.liveTurn !== undefined) repaintTree(this.liveTurn.block.root);
    this.transcript.renderer.requestRender();
  }

  /** Progress replaces one card; only a new command changes transcript order. */
  syncShell(execution: ShellExecution, note: string | undefined): void {
    const state = this.state;
    if (state === undefined) return;
    const entry: ShellEntry = { kind: "shell", execution, note };
    this.shellEntries.set(execution.id, entry);
    const index = this.shellPositions.get(execution.id);
    const item = index === undefined ? undefined : this.items[index];
    if (index !== undefined && item !== undefined) {
      this.pendingAnchor ??= this.anchor();
      this.items[index] = { ...item, source: entry, item: entry };
      const mounted = this.mounted.get(index);
      if (mounted !== undefined) this.syncMounted(index, mounted);
      this.scheduleLayout();
      this.transcript.renderer.requestRender();
      return;
    }
    this.shellChanged = true;
    this.sync(state);
  }

  /** The turns and shell jobs in start order; a job goes before the first item that started after it. */
  private entries(source: readonly Turn[]): (Turn | ShellEntry)[] {
    if (this.shellEntries.size === 0) return [...source];
    const jobs = [...this.shellEntries.values()].toSorted(
      (left, right) =>
        left.execution.startedAt - right.execution.startedAt ||
        left.execution.id.localeCompare(right.execution.id),
    );
    const merged: (Turn | ShellEntry)[] = [];
    let next = 0;
    for (const item of source) {
      while (next < jobs.length && entryTime(jobs[next] ?? item) < entryTime(item)) {
        merged.push(jobs[next] ?? item);
        next += 1;
      }
      merged.push(item);
    }
    return [...merged, ...jobs.slice(next)];
  }

  sync(state: SessionState, options: { readonly reset?: boolean } = {}): void {
    const previous = this.state;
    const source = state.transcript.items;
    const changed = previous?.transcript.items !== source || this.shellChanged;
    this.shellChanged = false;
    const reset =
      options.reset === true ||
      previous?.sessionId !== state.sessionId ||
      previous?.head !== state.head ||
      (changed &&
        previous !== undefined &&
        (source.length < previous.transcript.items.length ||
          previous.transcript.items.some(
            (item, index) => itemKey(item) !== itemKey(source[index] ?? item),
          )));
    if (reset) this.clear();
    this.state = state;
    if (changed || reset) {
      this.pendingAnchor ??= this.anchor();
      const old = new Map(this.items.map((item) => [item.key, item]));
      const next: TranscriptItem[] = [];
      for (const item of this.entries(source)) {
        const preceding = next.at(-1);
        // A config run is one display item, not one mounted node per commit.
        const merged =
          item.kind === "config" && preceding?.item.kind === "config"
            ? { ...item, body: { ...preceding.item.body, ...item.body } }
            : item;
        if (merged !== item) next.pop();
        const key = item.kind === "shell" ? `shell:${item.execution.id}` : itemKey(item);
        const existing = old.get(key);
        next.push(
          existing?.source === item
            ? existing
            : {
                key,
                source: item,
                item: merged,
                disclosures: existing?.disclosures ?? new TranscriptDisclosures(),
                height: existing?.height ?? (item.kind === "turn" ? 8 : 3),
              },
        );
      }
      for (const [index, mounted] of this.mounted) {
        const before = this.items[index];
        const after = next[index];
        if (
          before?.key !== after?.key ||
          (mounted.kind === "marker" && before?.source !== after?.source)
        ) {
          mounted.root.parent?.remove(mounted.root);
          mounted.root.destroyRecursively();
          this.mounted.delete(index);
        }
      }
      this.items = next;
      this.shellPositions.clear();
      this.lastTurnIndex = -1;
      for (const [index, item] of next.entries()) {
        if (item.item.kind === "shell") this.shellPositions.set(item.item.execution.id, index);
        else if (item.item.kind === "turn" && item.source === source.at(-1))
          this.lastTurnIndex = index;
      }
      this.reindex();
    }
    this.reconcileWindow();
    if (changed || reset) {
      for (const [index, mounted] of this.mounted) this.syncMounted(index, mounted);
    } else {
      const last = this.mounted.get(this.lastTurnIndex);
      if (last !== undefined) this.syncMounted(this.lastTurnIndex, last);
    }
    const last = source.at(-1);
    if (state.compaction !== undefined && (!this.running() || last?.kind !== "turn")) {
      const key = `compaction:${state.compaction.id}`;
      if (this.liveTurn?.key !== key) {
        this.liveTurn?.block.remove();
        this.liveTurn = { key, block: new TurnBlock(this.transcript, key, 0) };
      }
      this.liveTurn.block.sync(undefined, { kind: "compacting" });
    } else if (this.running() && last?.kind !== "turn" && state.run !== undefined) {
      const key = `live:${state.run.runId}`;
      if (this.liveTurn?.key !== key) {
        this.liveTurn?.block.remove();
        this.liveTurn = { key, block: new TurnBlock(this.transcript, key, 0) };
      }
      this.liveTurn.block.sync(undefined, {
        kind: "open",
        phase: state.run.phase,
        live: state.overlay,
        waitingForUser: waitingCall(state) !== undefined,
      });
    } else if (this.liveTurn !== undefined) {
      this.liveTurn.block.remove();
      this.liveTurn = undefined;
    }
    if (reset) this.pendingAnchor = "bottom";
    this.scheduleLayout();
  }

  /** Logical navigation includes turns that have no renderable yet. */
  jumpTurn(direction: "previous" | "next"): boolean {
    const indices = this.items.flatMap((item, index) => (item.item.kind === "turn" ? [index] : []));
    const selected = indices.findIndex((index) => this.items[index]?.key === this.navigationKey);
    const top = this.transcript.container.scrollTop;
    const index =
      selected >= 0
        ? indices[selected + (direction === "next" ? 1 : -1)]
        : direction === "next"
          ? indices.find((candidate) => this.offset(candidate) + SPACING.block > top)
          : indices.findLast((candidate) => this.offset(candidate) + SPACING.block < top);
    const item = index === undefined ? undefined : this.items[index];
    if (index === undefined || item === undefined) return false;

    this.setFollowMode("history");
    this.navigationKey = item.key;
    this.reading = undefined;
    const target = this.offset(index) + SPACING.block;
    // A tail target clamps until the spacer is laid out; restoreAnchor applies it in-frame.
    this.pendingAnchor = { index, row: SPACING.block };
    this.setNavigationSlack(this.slackForTarget(target));
    this.transcript.container.scrollTo(target);
    this.reconcileWindow(target);
    this.scheduleLayout();
    this.transcript.renderer.requestRender();
    return true;
  }

  /** Page keys take physical ownership and end logical turn navigation. */
  scrollBy(delta: number, unit: ScrollUnit = "absolute"): void {
    this.beginManualScroll();
    this.transcript.container.scrollBy(delta, unit);
  }

  /**
   * Called before OpenTUI moves this viewport for a wheel event. A stale anchor
   * must not scroll back over the user's move, so the new one is captured after.
   */
  beginManualScroll(): void {
    this.endNavigation();
    this.setFollowMode("history");
    this.pendingAnchor = undefined;
    this.reading = undefined;
    queueMicrotask(this.finishManualScroll);
  }

  /** Clear all viewport ownership and follow subsequent output at the tail. */
  returnToLatest(): void {
    this.endNavigation();
    this.pendingAnchor = "bottom";
    this.reading = undefined;
    this.setFollowMode("latest");
    this.transcript.container.scrollTo(Infinity);
    this.reconcileWindow();
    this.scheduleLayout();
    this.transcript.renderer.requestRender();
  }

  clear(): void {
    for (const mounted of this.mounted.values()) {
      mounted.root.parent?.remove(mounted.root);
      mounted.root.destroyRecursively();
    }
    this.mounted.clear();
    for (const spacer of this.spacers.splice(0)) {
      spacer.parent?.remove(spacer);
      spacer.destroy();
    }
    this.endNavigation();
    this.liveTurn?.block.remove();
    this.liveTurn = undefined;
    this.shellEntries.clear();
    this.shellPositions.clear();
    this.items = [];
    this.lastTurnIndex = -1;
    this.offsets = [0];
    this.state = undefined;
    this.geometry = "";
    this.selectionRange = undefined;
    this.reading = undefined;
    this.pendingAnchor = "bottom";
    this.setFollowMode("latest");
  }

  /** OpenTUI's bottom pin is on exactly while output growth owns the viewport. */
  private setFollowMode(mode: "latest" | "history"): void {
    if (this.followMode === mode) return;
    this.followMode = mode;
    this.transcript.container.stickyScroll = mode === "latest";
    this.transcript.onFollowModeChange(mode === "latest");
  }

  /**
   * Content rows without navigation space. scrollHeight comes from the last Yoga
   * pass, so subtract the slack that pass measured (NaN before the first pass)
   * rather than the rows requested since.
   */
  private naturalHeight(): number {
    const measuredSlack = this.navigationSpacer.getLayoutNode().getComputedLayout().height || 0;
    return this.transcript.container.scrollHeight - measuredSlack;
  }

  /** Compares against the requested slack; a wheel step that cancels navigation lands on the natural tail. */
  private atBottom(): boolean {
    const scroll = this.transcript.container;
    const bottom = this.naturalHeight() + this.navigationSlack - scroll.viewport.height;
    return scroll.scrollTop >= Math.max(0, bottom) - 1;
  }

  private viewportRows(): number {
    return Math.max(
      1,
      this.transcript.container.viewport.height || this.transcript.renderer.height,
    );
  }

  /** Runs after OpenTUI moved the viewport, unless another owner took over meanwhile. */
  private readonly finishManualScroll = (): void => {
    if (this.followMode !== "history" || this.navigationKey !== undefined) return;
    if (this.transcript.container.isDestroyed) return;
    if (this.atBottom()) {
      this.returnToLatest();
      return;
    }
    this.pendingAnchor ??= this.captureReadingAnchor();
    this.reconcileWindow();
    this.scheduleLayout();
    this.transcript.renderer.requestRender();
  };

  private slackForTarget(target: number): number {
    return Math.max(0, target + this.viewportRows() - this.naturalHeight());
  }

  private setNavigationSlack(rows: number): void {
    this.navigationSlack = rows;
    this.navigationSpacer.height = rows;
  }

  private endNavigation(): void {
    this.navigationKey = undefined;
    this.setNavigationSlack(0);
  }

  private running(): boolean {
    const run = this.state?.run;
    return run !== undefined && !isTerminalPhase(run.phase);
  }

  private syncMounted(index: number, mounted: MountedItem): void {
    const item = this.items[index]?.item;
    const state = this.state;
    if (mounted.kind === "shell" && item?.kind === "shell") {
      mounted.card.sync(item.execution, undefined);
      mounted.card.setNote(item.note);
      return;
    }
    if (mounted.kind !== "turn" || item?.kind !== "turn" || state === undefined) return;
    const last = index === this.lastTurnIndex;
    mounted.block.sync(
      item,
      last && this.running() && state.run !== undefined
        ? state.compaction !== undefined
          ? { kind: "compacting" }
          : {
              kind: "open",
              phase: state.run.phase,
              live: state.overlay,
              waitingForUser: waitingCall(state) !== undefined,
            }
        : settledStatus(item, last ? state.run : undefined),
    );
  }

  private offset(index: number): number {
    return this.offsets[index] ?? 0;
  }

  private reindex(start = 0): void {
    this.offsets.length = start + 1;
    this.offsets[0] = 0;
    for (let index = start; index < this.items.length; index += 1) {
      this.offsets.push(this.offset(index) + (this.items[index]?.height ?? 1));
    }
  }

  private indexAt(row: number): number {
    let low = 0;
    let high = this.items.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.offset(middle + 1) <= row) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, Math.max(0, this.items.length - 1));
  }

  private anchor(): ReadingAnchor | "bottom" {
    if (this.followMode === "latest") return "bottom";
    const scroll = this.transcript.container;
    if (this.reading?.top === scroll.scrollTop) return this.reading.anchor;
    return this.captureReadingAnchor();
  }

  private captureReadingAnchor(): ReadingAnchor {
    const scroll = this.transcript.container;
    const index = this.indexAt(scroll.scrollTop);
    const row = scroll.scrollTop - this.offset(index);
    const root = this.mounted.get(index)?.root;
    const node = root === undefined ? undefined : this.visibleText(root);
    if (node === undefined) return { index, row };
    const visualRow = Math.max(0, scroll.viewport.y - node.y + node.scrollY);
    // Native line starts are absolute cell offsets, including preceding newlines.
    // CodeRenderable remaps lineSources to markdown source lines, not buffer lines.
    const column = node.lineInfo.lineStartCols[visualRow] ?? 0;
    const text = node.plainText;
    const widthMethod = bufferWidths.get(node) ?? this.transcript.renderer.widthMethod;
    let offset = Math.min(column, text.length);
    if (!/^[\x20-\x7e\n]*$/.test(text)) {
      const buffer = TextBuffer.create(widthMethod);
      try {
        buffer.setText(text);
        offset = buffer.getTextRange(0, column).length;
      } finally {
        buffer.destroy();
      }
    }
    return {
      index,
      row,
      text: {
        node,
        offset: textOffset(node, offset, true),
        widthMethod,
        screenRow: node.y + visualRow - node.scrollY - scroll.viewport.y,
      },
    };
  }

  private visibleText(root: Renderable): TextBufferRenderable | undefined {
    if (!root.visible) return undefined;
    const top = this.transcript.container.viewport.y;
    if (root instanceof TextBufferRenderable && root.y <= top && root.y + root.height > top)
      return root;
    for (const child of root.getChildren()) {
      const node = this.visibleText(child);
      if (node !== undefined) return node;
    }
    return undefined;
  }

  private textTarget(anchor: ReadingAnchor, measured = false): number | undefined {
    const text = anchor.text;
    if (text === undefined || text.node.isDestroyed || !text.node.visible) return undefined;
    const node = text.node;
    const prefix = node.plainText.slice(0, textOffset(node, text.offset, false));
    const column = cellOffset(prefix, prefix.length, text.widthMethod, 4);
    const width = node.getLayoutNode().getComputedLayout().width;
    let info = node.lineInfo;
    // Yoga has measured the new width, but OpenTUI applies text viewports later.
    // Measure only this reading buffer before scroll translation is inherited.
    if (measured && width !== node.width) {
      const buffer = TextBuffer.create(text.widthMethod);
      const view = TextBufferView.create(buffer);
      try {
        buffer.setText(node.plainText);
        view.setWrapMode(node.wrapMode);
        view.setWrapWidth(width);
        info = view.logicalLineInfo;
      } finally {
        view.destroy();
        buffer.destroy();
      }
    }
    const row = info.lineStartCols.findLastIndex((start) => start <= column);
    const scroll = this.transcript.container;
    return (
      scroll.scrollTop +
      (measured ? layoutY(node) - layoutY(scroll.viewport) : node.y - scroll.viewport.y) +
      Math.max(0, row) -
      node.scrollY -
      text.screenRow
    );
  }

  private readonly restoreAnchor = (): void => {
    const anchor = this.pendingAnchor;
    if (anchor === undefined || anchor === "bottom") return;
    const scroll = this.transcript.container;
    const target =
      anchor.text === undefined ? this.indexTarget(anchor) : this.textTarget(anchor, true);
    if (target === undefined) return;
    // Apply the scroll ancestors first. Otherwise viewport resize clamps against
    // the old content height and falsely re-engages the native bottom pin.
    const ancestors: Renderable[] = [];
    for (let node: Renderable | null = scroll.content; node !== null; node = node.parent)
      ancestors.unshift(node);
    for (const node of ancestors) node.updateFromLayout();
    scroll.scrollTo(target);
  };

  /**
   * In-frame, a mounted item's Yoga position beats the prefix offsets: an
   * overscan item mounted above it may have just measured taller than its
   * estimate, which the offsets only learn on the next layout pass.
   */
  private indexTarget(anchor: ReadingAnchor): number {
    const root = this.mounted.get(anchor.index)?.root;
    if (root === undefined || !root.visible) return this.offset(anchor.index) + anchor.row;
    const scroll = this.transcript.container;
    return (
      scroll.scrollTop +
      layoutY(root) -
      layoutY(scroll.viewport) -
      root.getLayoutNode().getComputedMargin(Edge.Top) +
      anchor.row
    );
  }

  private readonly beforeFrame = (): Promise<void> => {
    // Capture against the old geometry before Yoga can clamp a shrinking scroll
    // range or re-engage OpenTUI's bottom pin during reflow.
    if (!this.changingLayout && this.state !== undefined) {
      if (this.followMode === "latest" && !this.atBottom()) this.setFollowMode("history");
      this.pendingAnchor ??= this.anchor();
      this.reconcileWindow();
    }
    return Promise.resolve();
  };

  private readonly scheduleLayout = (): void => {
    if (this.queued || this.transcript.container.isDestroyed) return;
    this.queued = true;
    // FRAME is emitted inside the render pass; mutations there lose render requests.
    queueMicrotask(() => {
      this.queued = false;
      if (!this.transcript.container.isDestroyed && this.state !== undefined) this.layout();
    });
  };

  private layout(): void {
    const scroll = this.transcript.container;
    if (scroll.content.width <= 0 || scroll.viewport.height <= 0) return;
    this.changingLayout = true;
    try {
      const anchor = this.pendingAnchor ?? this.anchor();
      this.pendingAnchor = undefined;
      const geometry = `${String(scroll.content.width)}:${String(this.transcript.userBlockWidth())}:${String(this.transcript.toolOutput.expanded)}`;
      let firstChanged = this.items.length;
      if (geometry !== this.geometry) {
        this.geometry = geometry;
        for (const [index, item] of this.items.entries()) {
          const cached = this.heights.get(
            `${geometry}:${item.key}:${String(item.disclosures.revision)}`,
          );
          // A different width is an estimate until this item is mounted and measured.
          if (cached?.source === item.source && cached.height !== item.height) {
            item.height = cached.height;
            firstChanged = Math.min(firstChanged, index);
          }
        }
      }
      for (const [index, mounted] of this.mounted) {
        const item = this.items[index];
        // A root just mounted outside a frame reads 0 until Yoga measures it;
        // its estimate must stand or every offset below it shifts for one frame.
        if (item === undefined || mounted.root.height === 0) continue;
        const height = mounted.root.height + SPACING.block;
        if (item.height !== height) {
          item.height = height;
          firstChanged = Math.min(firstChanged, index);
        }
        const key = `${geometry}:${item.key}:${String(item.disclosures.revision)}`;
        this.heights.delete(key);
        this.heights.set(key, { source: item.source, height });
      }
      while (this.heights.size > HEIGHT_CACHE_LIMIT) {
        const oldest = this.heights.keys().next();
        if (oldest.done) break;
        this.heights.delete(oldest.value);
      }
      // A growing live tail changes just the final offset, not the history prefix.
      if (firstChanged < this.items.length) this.reindex(firstChanged);
      if (this.navigationKey !== undefined) {
        const navigationIndex = this.items.findIndex(
          (item) => item.key === this.navigationKey && item.item.kind === "turn",
        );
        if (navigationIndex === -1) this.endNavigation();
        else
          this.setNavigationSlack(
            this.slackForTarget(this.offset(navigationIndex) + SPACING.block),
          );
      }
      // Rebase before deciding the window, otherwise newly measured overscan can
      // evict the very turn the reader was looking at.
      const target =
        anchor === "bottom"
          ? undefined
          : (this.textTarget(anchor) ?? this.offset(anchor.index) + anchor.row);
      this.reconcileWindow(
        target ?? Math.max(0, this.offset(this.items.length) - scroll.viewport.height),
      );
      if (anchor === "bottom") scroll.scrollTo(Infinity);
      else if (target !== undefined && target !== scroll.scrollTop) scroll.scrollTo(target);
      // beforeFrame re-reads this anchor, so a clamped target is retried before the next frame.
      this.reading = { top: scroll.scrollTop, anchor };
    } finally {
      this.changingLayout = false;
    }
  }

  private reconcileWindow(top = this.transcript.container.scrollTop): void {
    const scroll = this.transcript.container;
    const viewport = this.viewportRows();
    const atBottom = this.pendingAnchor === "bottom";
    const position = atBottom ? Math.max(0, this.offset(this.items.length) - viewport) : top;
    const start = this.indexAt(Math.max(0, position - viewport));
    const end = this.indexAt(position + viewport * 2);
    const selection = this.transcript.renderer.getSelection();
    if (
      selection !== null &&
      (selection.isDragging || !selection.isStart || selection.behavior !== "cell")
    ) {
      const retained =
        this.selectionRange?.selection === selection ? this.selectionRange : undefined;
      this.selectionRange = {
        selection,
        start: selection.isDragging
          ? Math.min(start, retained?.start ?? start)
          : (retained?.start ?? start),
        end: selection.isDragging ? Math.max(end, retained?.end ?? end) : (retained?.end ?? end),
      };
    } else this.selectionRange = undefined;
    const keep = new Set<number>();
    for (let index = start; index <= end && index < this.items.length; index += 1) keep.add(index);
    if (this.selectionRange !== undefined) {
      for (
        let index = this.selectionRange.start;
        index <= this.selectionRange.end && index < this.items.length;
        index += 1
      )
        keep.add(index);
    }
    if (this.items.length > 0) keep.add(this.items.length - 1);
    if (this.lastTurnIndex >= 0) keep.add(this.lastTurnIndex);
    for (const [index, mounted] of this.mounted) {
      if (keep.has(index) || mounted.root.hasFocusedDescendant) continue;
      mounted.root.parent?.remove(mounted.root);
      mounted.root.destroyRecursively();
      this.mounted.delete(index);
    }
    const owner = this.transcript;
    for (const index of keep) {
      if (this.mounted.has(index)) continue;
      const item = this.items[index];
      if (item === undefined) continue;
      const transcript: Transcript = {
        ...this.transcript,
        disclosures: item.disclosures,
        children: () => owner.children(),
        get syntaxStyle() {
          return owner.syntaxStyle;
        },
        get subtleSyntaxStyle() {
          return owner.subtleSyntaxStyle;
        },
      };
      const mounted: MountedItem =
        item.item.kind === "turn"
          ? (() => {
              const block = new TurnBlock(transcript, item.item.id, item.item.durationMs);
              return { kind: "turn", root: block.root, block };
            })()
          : item.item.kind === "shell"
            ? (() => {
                const root = new BoxRenderable(transcript.renderer, {
                  id: transcript.nextId("shell"),
                  flexDirection: "column",
                  width: "100%",
                  live: false,
                });
                const card = new ToolCard(
                  transcript,
                  item.item.execution,
                  root,
                  undefined,
                  undefined,
                  item.item.note,
                );
                return { kind: "shell", root, card };
              })()
            : { kind: "marker", root: appendMarker(transcript, item.item) };
      this.mounted.set(index, mounted);
      this.syncMounted(index, mounted);
    }
    const children: Renderable[] = [];
    let cursor = 0;
    let gaps = 0;
    for (const [index, mounted] of [...this.mounted].toSorted(
      (left, right) => left[0] - right[0],
    )) {
      if (index > cursor) {
        let spacer = this.spacers[gaps];
        if (spacer === undefined) {
          spacer = new BoxRenderable(this.transcript.renderer, {
            id: this.transcript.nextId("transcript-spacer"),
            width: "100%",
            height: 0,
            flexShrink: 0,
          });
          this.spacers.push(spacer);
        }
        // The getter reads the last layout, so it cannot dedupe a request; the setter does.
        spacer.height = this.offset(index) - this.offset(cursor);
        children.push(spacer);
        gaps += 1;
      }
      children.push(mounted.root);
      cursor = index + 1;
    }
    for (const spacer of this.spacers.splice(gaps)) {
      spacer.parent?.remove(spacer);
      spacer.destroy();
    }
    if (this.liveTurn !== undefined) children.push(this.liveTurn.block.root);
    if (this.tail !== undefined) children.push(this.tail);
    children.push(this.navigationSpacer);
    const current = scroll.getChildren();
    if (
      current.length === children.length &&
      children.every((child, index) => current[index] === child)
    )
      return;
    // add moves existing children, so changed orders must read back each mutation.
    for (const [index, child] of children.entries()) {
      if (scroll.getChildren()[index] !== child) scroll.add(child, index);
    }
  }
}
