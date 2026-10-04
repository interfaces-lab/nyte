/**
 * OpenTUI blocks for transcript entries: one block per turn keyed by the
 * turn's id, one part block per settled part keyed by `turnPartId`, and live
 * blocks for the streaming overlay keyed by `livePartKey`. `Timeline`
 * reconciles restored and live session state into these blocks.
 */
import {
  BoxRenderable,
  CodeRenderable,
  createMarkdownCodeBlockRenderer,
  DiffRenderable,
  fg,
  LineNumberRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  pathToFiletype,
  RenderableEvents,
  StyledText,
  SyntaxStyle,
  TextRenderable,
  TextBufferRenderable,
  TextTableRenderable,
  RGBA,
} from "@opentui/core";
import type {
  CliRenderer,
  MarkdownCodeBlockRenderer,
  MarkdownOptions,
  Renderable,
  SimpleHighlight,
  TextChunk,
  OptimizedBuffer,
} from "@opentui/core";
import { formatToolDuration, parsePatchFacts, toolStatus, turnPartId } from "@nyte-ai/client";
import type { ToolStatus } from "@nyte-ai/client";
import type { Failure, ToolProgress, ToolTurnPart, TurnPart } from "@nyte-ai/protocol";
import type { RunInfo, Turn } from "@nyte-ai/core";
import { diffWordsWithSpace } from "diff";
import { SpinnerRenderable } from "opentui-spinner";
import type { ShellExecution } from "./local-shell.ts";
import {
  ACTIVITY_RETRY_LABEL,
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
  TOOL_INLINE_PREVIEW_LENGTH,
} from "./constants.ts";
import {
  earlierLinesLabel,
  formatDuration,
  omittedLabel,
  type PreviewCut,
  previewLines,
  resultSummary,
  unchangedLinesLabel,
} from "./format.ts";
import {
  diffFromOutput,
  patchSections,
  type ChangedLinePair,
  type OutputDiff,
} from "./output-diff.ts";
import { appendMessage } from "./message.ts";
import { renderMermaidASCII } from "beautiful-mermaid";
import { livePartKey, type LivePart } from "@nyte-ai/client";
import { statusMark, taskActivity, taskLabel, taskStatus, toneStatus } from "./tasks.ts";
import {
  bufferWidths,
  repaints,
  TranscriptCodeRenderable,
  TranscriptTextRenderable,
} from "./surface.ts";
import type { ExpandableToolOutput, Transcript } from "./surface.ts";
import type { CliTheme } from "./theme.ts";
import {
  delegateSubject,
  failureNotice,
  runningActivityLabel,
  toolLabel,
  toolNoun,
  toolSubject,
} from "./tool-copy.ts";
import { displayWidth } from "./width.ts";

/** The callback leaves chunks untouched, including OpenTUI's link metadata. */
export const highlightSources = new WeakMap<
  CodeRenderable,
  {
    callback: NonNullable<CodeRenderable["onChunks"]>;
    source: string;
    text: string;
    highlights: SimpleHighlight[];
  }
>();

/**
 * OpenTUI only seeds inline styled text for streaming markdown. Settled blocks
 * otherwise reserve raw-text geometry but draw nothing until highlighting ends.
 * Draw that pending text too; concealment and asynchronous highlighting stay on.
 */
export class TranscriptMarkdownRenderable extends MarkdownRenderable {
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

export function createMermaidMarkdownRenderer(
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

/** Tint the changed words after the hunk's syntax colours, so the emphasis sits under them. */
function markChangedWords(diff: DiffRenderable, pair: ChangedLinePair): void {
  const code = diff
    .getChildren()
    .filter((child) => child instanceof LineNumberRenderable)
    .flatMap((gutter) => gutter.getChildren())
    .find((child) => child instanceof CodeRenderable);

  if (code === undefined) return;
  code.onHighlight = (highlights, context) => [...highlights, ...wordSpans(context.content, pair)];
}

function previewCut(toolClass: ToolTurnPart["class"] | undefined): PreviewCut {
  return toolClass?.kind === "shell"
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
    "diff.plus": { bg: theme.diffAddedEmphasis },
    "diff.minus": { bg: theme.diffRemovedEmphasis },
  });
}

export function createSyntaxStyle(theme: CliTheme): SyntaxStyle {
  return syntaxStyle(theme, false);
}

/** Keep reasoning markdown structure while lowering every syntax foreground. */
export function createSubtleSyntaxStyle(theme: CliTheme): SyntaxStyle {
  return syntaxStyle(theme, true);
}

export function section(
  transcript: Transcript,
  prefix: string,
  parent: Renderable = transcript.container,
  before?: Renderable,
): BoxRenderable {
  const box = new BoxRenderable(transcript.renderer, {
    id: transcript.nextId(prefix),
    flexDirection: "column",
    backgroundColor: transcript.theme.transparent,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: SPACING.inset,
    paddingRight: SPACING.insetRight,
    marginTop: SPACING.block,
    marginLeft: 0,
    marginRight: 0,
    width: "100%",
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
// Turn blocks
// ---------------------------------------------------------------------------

/** Top-level layout owner for a conversation turn. */
export class TurnSection extends BoxRenderable {
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
    this.box = section(transcript, "assistant", parent, before);
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
    this.box = section(transcript, "thinking", parent, before);
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
    this.section = section(transcript, "activity", parent);
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

  settle(failure: Failure | undefined): void {
    if (this.mode === "settled") return;
    const { theme } = this.transcript;
    const elapsed = this.durationMs + performance.now() - this.startedAt;
    this.spinner.stop();
    this.spinner.visible = false;
    this.mode = "settled";

    const paint = (): void => {
      if (failure === undefined) {
        const duration =
          elapsed >= MIN_REPORTED_DURATION_MS ? ` for ${formatDuration(elapsed)}` : "";

        this.line.content = new StyledText([fg(theme.dim)(`${ACTIVITY_WORKED_LABEL}${duration}`)]);

        return;
      }

      const notice = failureNotice(failure);
      this.line.content = new StyledText([fg(theme[notice.tone])(notice.text)]);
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

/**
 * One card per tool call, reused from the call through progress to the
 * settled result. A settled patch renders with DiffRenderable, as does a
 * unified diff inside shell output; everything else shows a capped preview.
 */
type DelegationClass = Extract<ToolTurnPart["class"], { kind: "delegate" }>;

export class ToolCard {
  readonly container: BoxRenderable;

  private readonly transcript: Transcript;
  private readonly detail: BoxRenderable;
  private readonly heading: TextRenderable;
  private readonly structuredBodies: Renderable[] = [];
  private current: ToolTurnPart | ShellExecution;
  private live: ToolProgress | undefined;
  private expanded = false;
  private destroyed = false;
  private textBody: CodeRenderable | undefined;
  /** A delegation card's step row: one row for good, so nothing below it moves. */
  private window: TextRenderable | undefined;
  /** A dim remark after the result and clock: what this call is not (`not sent to model`). */
  private note: string | undefined;

  private headingState: [icon: string, color: string, result?: string] = ["", ""];
  private readonly refreshHeading = (): void => {
    if (!this.destroyed) this.heading.content = this.headingContent(...this.headingState);
  };

  constructor(
    transcript: Transcript,
    part: ToolTurnPart | ShellExecution,
    parent: Renderable,
    before: Renderable | undefined,
    live: ToolProgress | undefined,
    note?: string,
  ) {
    this.transcript = transcript;
    this.current = part;
    this.live = live;
    this.note = note;
    this.container = section(transcript, "tool", parent, before);
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

    this.container.once(RenderableEvents.DESTROYED, () => {
      this.destroyed = true;
      unregister();
    });

    if (!this.expanded) this.render();
  }

  /** The part as last synced: the call, and its result once settled. */
  get part(): ToolTurnPart | undefined {
    return this.current.kind === "tool" ? this.current : undefined;
  }

  private get toolClass(): ToolTurnPart["class"] | undefined {
    return this.current.kind === "tool" ? this.current.class : undefined;
  }

  /** The settled part's output; a running call's text is its progress. */
  private get output(): string | undefined {
    return this.current.kind === "tool" ? this.current.output : undefined;
  }

  get completed(): boolean {
    return this.current.kind === "shell"
      ? this.current.state !== "running"
      : this.status().tense !== "running";
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
  sync(part: ToolTurnPart | ShellExecution, live: ToolProgress | undefined): void {
    const changed = part !== this.current || live !== this.live;
    this.current = part;
    this.live = live;

    // A delegation follows the child, which changes without this part.
    if (changed || this.toolClass?.kind === "delegate") this.render();
  }

  /** A local command's clock, or how long core measured a settled shell call took. */
  private clock(): string | undefined {
    if (this.current.kind === "shell") {
      const until = this.current.state === "running" ? Date.now() : this.current.finishedAt;

      return formatDuration(Math.max(0, until - this.current.startedAt));
    }

    const facts = this.current.class.kind === "shell" ? this.current.class.facts : undefined;

    return facts === undefined ? undefined : formatToolDuration(facts.durationMs);
  }

  private retheme(): void {
    const { theme } = this.transcript;

    if (this.current.kind === "shell") {
      this.detail.backgroundColor = theme.codeBackground;
      this.renderShell(this.current);

      return;
    }

    if (this.current.class.kind === "delegate") {
      this.renderDelegation(this.current.class);

      return;
    }

    const output = this.live?.text ?? "";
    const { tone } = this.status();
    this.headingState[1] =
      tone === "running" && output !== "" ? theme.user : theme[statusMark(toneStatus(tone)).tone];
    this.refreshHeading();
    this.detail.backgroundColor = theme.codeBackground;
    const diffs: DiffRenderable[] = [];

    const paint = (node: Renderable): void => {
      if (node instanceof DiffRenderable) {
        node.syntaxStyle = this.transcript.syntaxStyle;
        node.fg = theme.foreground;
        node.addedBg = theme.diffAddedBackground;
        node.removedBg = theme.diffRemovedBackground;
        node.addedLineNumberBg = theme.diffAddedGutterBackground;
        node.removedLineNumberBg = theme.diffRemovedGutterBackground;
        node.addedSignColor = theme.diffAdded;
        node.removedSignColor = theme.diffRemoved;
        node.lineNumberFg = theme.dim;
        node.selectionBg = theme.selectionBackground;
        node.selectionFg = theme.selectionForeground;
        diffs.push(node);

        return;
      }

      if (node instanceof CodeRenderable) {
        node.syntaxStyle = this.transcript.syntaxStyle;
        node.fg = this.status().tone === "failure" ? theme.error : theme.dim;
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

    const word = this.current.kind === "tool" ? this.status().word?.toLowerCase() : undefined;

    const tail = [result, word, this.clock(), this.note]
      .filter((value) => value !== undefined)
      .join(" · ");

    if (tail !== "") chunks.push(fg(theme.dim)(`  ${tail}`));

    return new StyledText(chunks);
  }

  /**
   * The call's verb and its subject, or the subject and the tool's noun when
   * no verb is true. A shell call's subject is a command, which reads as code,
   * so it is highlighted as one once the grammar answers.
   */
  private headingTitle(): TextChunk[] {
    const { theme, labelSyntax } = this.transcript;
    const title = this.title();

    const name =
      this.current.kind === "shell"
        ? this.note === undefined
          ? "!"
          : "!!"
        : toolLabel(this.current.class, this.status().tense);

    const noun =
      this.current.kind === "tool" && name === undefined ? toolNoun(this.current.class) : undefined;

    const words = name === undefined ? [title, noun] : [name, title];
    const plain = fg(theme.foreground)(` ${words.filter((word) => word !== undefined).join(" ")}`);
    const command = this.current.kind === "shell" || this.current.class.kind === "shell";

    if (!command || title === undefined) return [plain];

    const highlighted = labelSyntax.chunks(
      title,
      "bash",
      this.transcript.syntaxStyle,
      this.refreshHeading,
    );

    if (highlighted === undefined) return [plain];

    return [fg(theme.foreground)(name === undefined ? " " : ` ${name} `), ...highlighted];
  }

  private status(): ToolStatus {
    return this.current.kind === "tool"
      ? toolStatus(this.current.state)
      : { tense: "running", tone: "running", word: undefined };
  }

  private title(): string | undefined {
    if (this.current.kind === "shell") return this.current.command;

    return toolSubject(this.current.class);
  }

  private render(): void {
    if (this.current.kind === "shell") {
      this.renderShell(this.current);

      return;
    }

    const { theme } = this.transcript;

    if (this.current.class.kind === "delegate") {
      this.renderDelegation(this.current.class);

      return;
    }

    const { tone } = this.status();

    switch (tone) {
      case "running":
      case "attention":
      case "stopped": {
        const text = this.output ?? this.live?.text ?? "";
        const inline = inlineToolPreview(text);
        const mark = statusMark(toneStatus(tone));
        this.heading.content = this.headingContent(
          mark.glyph,
          tone === "running" && text !== "" ? theme.user : theme[mark.tone],
          inline ?? resultSummary(text),
        );

        if (inline !== undefined || text === "") this.clearBody();
        else this.showPreview(text, theme.dim);

        return;
      }

      case "failure":
        this.renderSettled(true);

        return;
      case "success":
        this.renderSettled(false);

        return;
      default: {
        const _exhaustive: never = tone;

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

  /**
   * The call that made the child is its card: its title, then the child's
   * latest step. Every other call on a child is one line naming it.
   */
  private renderDelegation(delegation: DelegationClass): void {
    const { theme } = this.transcript;

    const task = this.transcript
      .tasks()
      .find(
        (candidate) => candidate.kind === "agent" && candidate.id === delegation.target.session,
      );

    const status = this.status();
    const word = status.word?.toLowerCase();

    // A call on a child is its own call: the child's state says nothing about it.
    if (delegation.role !== "create") {
      const own = statusMark(toneStatus(status.tone));
      const name = task === undefined ? delegateSubject(delegation) : taskLabel(task);
      const verb = toolLabel(delegation, status.tense);

      this.heading.content = new StyledText([
        fg(theme[own.tone])(`${own.glyph} `),
        ...(verb === undefined ? [] : [fg(theme.foreground)(`${verb} `)]),
        fg(theme.tool)(name),
        ...(verb === undefined ? [fg(theme.foreground)(` ${toolNoun(delegation) ?? ""}`)] : []),
        ...(word === undefined ? [] : [fg(theme.dim)(`  ${word}`)]),
      ]);
      this.clearBody();

      return;
    }

    // A listed child speaks for itself; until then its create call does.
    const mark = statusMark(task === undefined ? toneStatus(status.tone) : taskStatus(task));

    const config =
      task?.kind === "agent"
        ? [task.state.config.model?.id, task.state.config.thinkingLevel]
            .filter((value) => value !== undefined)
            .join(" · ")
        : "";

    const tail = task === undefined ? word : config === "" ? undefined : config;

    this.heading.content = new StyledText([
      fg(theme[mark.tone])(`${mark.glyph} `),
      fg(theme.foreground)(delegation.title),
      ...(tail === undefined ? [] : [fg(theme.dim)(`  ${tail}`)]),
    ]);

    if (this.window === undefined) {
      this.window = new TranscriptTextRenderable(this.transcript.renderer, {
        id: this.transcript.nextId("tool-window"),
        height: 1,
        marginLeft: 2,
        wrapMode: "none",
        truncate: true,
      });
      this.container.add(this.window);
    }

    this.window.content = new StyledText([
      fg(theme.dim)(task === undefined ? "" : taskActivity(task)),
    ]);
  }

  private renderSettled(isError: boolean): void {
    const { theme } = this.transcript;
    const output = this.output ?? "";
    const toolClass = this.toolClass;

    if (toolClass?.kind === "file_patch" && !isError) {
      const { patch, path, added, removed } = toolClass;
      this.heading.content = this.headingContent(
        GLYPHS.check,
        theme.ok,
        `+${String(added)} -${String(removed)}`,
      );
      const facts = parsePatchFacts(patch);

      if (facts === undefined) this.showPreview(patch, theme.dim);
      else
        this.showDiff({
          files: facts.files.map((file) => ({ path, sections: patchSections(file, patch) })),
          before: undefined,
          after: undefined,
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
    const summary = inline ?? resultSummary(output);

    // A collapsed read names the file and its size without repeating its body.
    const collapsedRead =
      toolClass?.kind === "file_read" && !isError && !this.expanded && inline === undefined;

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
    const preview = toolOutputPreview(text, this.expanded, previewCut(this.toolClass));

    if (this.structuredBodies.length > 0) this.clearBody();

    if (preview === "") {
      this.clearBody();

      return;
    }

    this.detail.visible = true;
    this.detail.paddingLeft = 2;

    const filetype =
      this.completed && this.toolClass?.kind === "file_read"
        ? pathToFiletype(this.toolClass.path)
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
          addedLineNumberBg: this.transcript.theme.diffAddedGutterBackground,
          removedLineNumberBg: this.transcript.theme.diffRemovedGutterBackground,
          addedSignColor: this.transcript.theme.diffAdded,
          removedSignColor: this.transcript.theme.diffRemoved,
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
    const preview = toolOutputPreview(text, this.expanded, previewCut(this.toolClass));

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
export type TurnStatus =
  | {
      readonly kind: "open";
      readonly phase: RunInfo["phase"];
      readonly live: readonly LivePart[];
      readonly waitingForUser: boolean;
    }
  | { readonly kind: "unanswered" }
  | { readonly kind: "compacting" }
  | { readonly kind: "settled"; readonly failure: Failure | undefined };

type PartBlock =
  | { readonly kind: "text"; readonly block: AssistantPartBlock; readonly contentIndex: number }
  | { readonly kind: "thinking"; readonly block: ReasoningBlock; readonly contentIndex: number };

/** One visual owner for a user request and every assistant step it drives. */
export class TurnBlock {
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
    const progress = new Map<string, ToolProgress>();

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
        this.settle(status.failure);

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

  private syncPart(part: TurnPart, progress: ToolProgress | undefined): void {
    const id = turnPartId(part);

    switch (part.kind) {
      case "user":
        if (this.settled.has(id)) return;
        this.settled.add(id);
        appendMessage(
          this.transcript,
          { align: "end", content: part.content },
          this.root,
          this.contentAnchor(),
        );

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

  private settle(failure: Failure | undefined): void {
    if (this.closed) return;
    this.closed = true;
    this.ensureActivity().settle(failure);
  }

  private ensureActivity(initial: ActivityMode = "working"): ActivityBlock {
    this.activity ??= new ActivityBlock(this.transcript, this.root, this.durationMs, initial);

    return this.activity;
  }

  /** Tool calls still going, in call order. */
  private runningActivity(): string | undefined {
    const running: ToolTurnPart["class"][] = [];

    for (const card of this.tools.values()) {
      const part = card.part;

      if (part !== undefined && toolStatus(part.state).tense === "running") {
        running.push(part.class);
      }
    }

    return runningActivityLabel(running);
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
