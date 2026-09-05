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
  DiffRenderable,
  fg,
  LineNumberRenderable,
  MarkdownRenderable,
  pathToFiletype,
  RenderableEvents,
  StyledText,
  SyntaxStyle,
  TextRenderable,
} from "@opentui/core";
import type {
  BoxOptions,
  CliRenderer,
  LineColorConfig,
  Renderable,
  ScrollBoxRenderable,
  TextChunk,
} from "@opentui/core";
import { presentNote, presentTool, projectToolView, turnPartId } from "@nyte-ai/core";
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
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractFileAttachments,
  extractFileMentions,
  PASTE_COLLAPSE_LINES,
  pasteLineCount,
} from "./composer.ts";
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
  SPACING,
  TOOL_INLINE_PREVIEW_LENGTH,
} from "./constants.ts";
import {
  diffFromOutput,
  diffSections,
  formatDuration,
  omittedLabel,
  previewLines,
  resultSummary,
  spinnerFrame,
  toolHeading,
  unchangedLinesLabel,
  type OutputDiff,
} from "./format.ts";
import { isJsonObject, isJsonString } from "./json.ts";
import type { LabelSyntax } from "./label-syntax.ts";
import { livePartKey, type LivePart, type SessionState } from "./session-state.ts";
import { extractSkillInvocations } from "./slash.ts";
import type { CliTheme } from "./theme.ts";
import { displayWidth } from "./width.ts";

/**
 * OpenTUI's line background fill rejects rows above the screen instead of
 * clipping them. Keep the colors for visible rows while a diff scrolls past
 * the top edge.
 */
function clipOffscreenDiffLineColors(diff: DiffRenderable): void {
  for (const child of diff.getChildren()) {
    if (!(child instanceof LineNumberRenderable)) continue;
    const colors = child.getLineColors();
    const lines = new Set([...colors.gutter.keys(), ...colors.content.keys()]);
    const lineColors = new Map<number, LineColorConfig>();
    for (const line of lines) {
      lineColors.set(line, { gutter: colors.gutter.get(line), content: colors.content.get(line) });
    }
    let appliedFirstSafeLine: number | undefined;
    const onSizeChange = child.onSizeChange;
    child.onSizeChange = () => {
      appliedFirstSafeLine = undefined;
      onSizeChange?.();
    };
    child.renderBefore = () => {
      const firstSafeLine = Math.max(0, Math.ceil(-child.screenY));
      if (firstSafeLine === appliedFirstSafeLine) return;
      appliedFirstSafeLine = firstSafeLine;
      child.setLineColors(new Map([...lineColors].filter(([line]) => line >= firstSafeLine)));
    };
  }
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

/** Tools whose title is source rather than prose, named by the grammar it speaks. */
const HEADING_FILETYPES = new Map([["bash", "bash"]]);

function inlineToolPreview(text: string): string | undefined {
  const value = text.trim();
  if (value === "" || value.includes("\n") || displayWidth(value) > TOOL_INLINE_PREVIEW_LENGTH) {
    return undefined;
  }
  return value;
}

function toolOutputPreview(text: string, expanded: boolean): ReturnType<typeof previewLines> {
  const trimmed = text.replace(/\n+$/u, "");
  if (expanded || trimmed === "") return { text: trimmed, omitted: 0 };
  const preview = previewLines(text, RESULT_PREVIEW_LINES, RESULT_TAIL_LINES);
  const hidden = Math.max(0, trimmed.split("\n").length - RESULT_PREVIEW_LINES - RESULT_TAIL_LINES);
  if (hidden === 0) return preview;
  const omission = omittedLabel(hidden);
  return {
    ...preview,
    text: preview.text.replace(omission, `${omission} · ${keycap("chat.tools.toggle")} expand`),
  };
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
  /** Width for user cards, which sit inside the scroll padding. */
  readonly userBlocks: Set<BoxRenderable>;
  readonly userBlockWidth: () => number;
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
  return new TextRenderable(transcript.renderer, {
    id: transcript.nextId("label"),
    content: text,
    fg: color,
  });
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
  const tag = new TextRenderable(renderer, {
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
    renderer.clearSelection();
    if (selected !== "") return;
    options.onToggle();
    paint();
  };
  paint();
  parent.add(tag);
  return tag;
}

function addUserText(transcript: Transcript, block: BoxRenderable, text: string): void {
  const lines = text.split("\n");
  const folded = lines.length > PASTE_COLLAPSE_LINES;
  const preview = lines.slice(0, PASTE_PREVIEW_LINES).join("\n");
  const body = new TextRenderable(transcript.renderer, {
    id: transcript.nextId("user-text"),
    content: folded ? preview : text,
    fg: transcript.theme.foreground,
    wrapMode: "word",
    selectionBg: transcript.theme.selectionBackground,
    selectionFg: transcript.theme.selectionForeground,
  });
  block.add(body);
  if (!folded) return;
  const hidden = lines.length - PASTE_PREVIEW_LINES;
  let expanded = false;
  collapsedTag(transcript, block, {
    marginTop: 1,
    label: () => (expanded ? " fewer lines " : ` +${String(hidden)} lines `),
    onToggle: () => {
      expanded = !expanded;
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
  const body = new CodeRenderable(transcript.renderer, {
    id: transcript.nextId("file-body"),
    content: text,
    filetype: pathToFiletype(path) ?? undefined,
    syntaxStyle: transcript.syntaxStyle,
    fg: transcript.theme.foreground,
    visible: false,
    marginTop: 1,
    selectionBg: transcript.theme.selectionBackground,
    selectionFg: transcript.theme.selectionForeground,
  });
  let open = false;
  collapsedTag(transcript, tags, {
    url: pathToFileURL(path).href,
    label: () => ` File ${basename(path)}${open ? "" : ` +${String(pasteLineCount(text))} lines`} `,
    onToggle: () => {
      open = !open;
      body.visible = open;
    },
  });
  block.add(body);
}

function appendUser(
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
  transcript.userBlocks.add(block);
  block.once(RenderableEvents.DESTROYED, () => transcript.userBlocks.delete(block));
  if (presentation.text !== "") addUserText(transcript, block, presentation.text);

  const tags = new BoxRenderable(transcript.renderer, {
    id: transcript.nextId("user-attachments"),
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 1,
    visible:
      presentation.files.length + presentation.skills.length + presentation.images.length > 0,
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
  for (const [index, image] of presentation.images.entries()) {
    collapsedTag(transcript, tags, {
      label: () => ` Image ${String(index + 1)} (${image.mimeType}) `,
      onToggle: () => undefined,
    });
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
    new TextRenderable(transcript.renderer, {
      id: transcript.nextId("note-text"),
      content: text,
      fg: color ?? transcript.theme.dim,
      wrapMode: "word",
    }),
  );
  return box;
}

function appendCard(transcript: Transcript, heading: string, summary: string): BoxRenderable {
  const { theme } = transcript;
  const preview = previewLines(summary, 40);
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
    new TextRenderable(transcript.renderer, {
      id: transcript.nextId("card-heading"),
      content: new StyledText([fg(theme.dim)(heading)]),
      wrapMode: "word",
    }),
  );
  if (visibleSummary !== "") {
    card.add(
      new TextRenderable(transcript.renderer, {
        id: transcript.nextId("card-summary"),
        content: visibleSummary,
        fg: theme.dim,
        wrapMode: "word",
      }),
    );
  }
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

/** Top-level turn owner; animation stays here because nested live boxes break layout. */
class TurnSection extends BoxRenderable {
  private readonly animations = new Map<
    symbol,
    { elapsed: number; line: TextRenderable; draw: (elapsedMs: number) => StyledText }
  >();

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

  protected override onUpdate(deltaTime: number): void {
    for (const animation of this.animations.values()) {
      animation.elapsed += deltaTime;
      animation.line.content = animation.draw(animation.elapsed);
    }
  }

  animate(line: TextRenderable, draw: (elapsedMs: number) => StyledText): symbol {
    const id = Symbol("turn-animation");
    line.content = draw(0);
    this.animations.set(id, { elapsed: 0, line, draw });
    this.live = true;
    return id;
  }

  changeAnimation(id: symbol, draw: (elapsedMs: number) => StyledText): void {
    const animation = this.animations.get(id);
    if (animation === undefined) return;
    animation.draw = draw;
    animation.line.content = draw(animation.elapsed);
  }

  stopAnimation(id: symbol): number {
    const elapsed = this.animations.get(id)?.elapsed ?? 0;
    this.animations.delete(id);
    if (this.animations.size === 0) this.live = false;
    return elapsed;
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
  private readonly markdown: MarkdownRenderable;
  private buffer = "";

  constructor(transcript: Transcript, parent: Renderable, before: Renderable | undefined) {
    this.box = section(transcript, "assistant", {}, parent, before);
    this.markdown = new MarkdownRenderable(transcript.renderer, {
      id: transcript.nextId("assistant-md"),
      content: "",
      syntaxStyle: transcript.syntaxStyle,
      streaming: true,
      internalBlockMode: "top-level",
      // A fenced block whose language has no grammar (`text`, `mermaid`, none)
      // is drawn as plain text in this color. OpenTUI's own default is white,
      // which vanishes on the light theme.
      fg: transcript.theme.foreground,
    });
    this.box.add(this.markdown);
    this.box.visible = false;
  }

  /** The whole text so far; the overlay carries the accumulated stream. */
  set(text: string): void {
    if (text === this.buffer) return;
    this.buffer = text;
    this.box.visible = text.trim() !== "";
    if (!hasIncompleteHeadingPrefix(text)) this.markdown.content = text;
  }

  finish(text: string): void {
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
class ReasoningBlock {
  readonly box: BoxRenderable;
  private readonly heading: TextRenderable;
  private readonly markdown: MarkdownRenderable;
  private readonly theme: CliTheme;
  private buffer = "";

  constructor(transcript: Transcript, parent: Renderable, before: Renderable | undefined) {
    this.theme = transcript.theme;
    this.box = section(transcript, "thinking", {}, parent, before);
    this.box.visible = false;
    this.heading = new TextRenderable(transcript.renderer, {
      id: transcript.nextId("thinking-heading"),
      content: "",
      visible: false,
      wrapMode: "none",
    });
    this.markdown = new MarkdownRenderable(transcript.renderer, {
      id: transcript.nextId("thinking-md"),
      content: "",
      syntaxStyle: transcript.subtleSyntaxStyle,
      streaming: true,
      internalBlockMode: "top-level",
      fg: transcript.theme.dim,
    });
    this.box.add(this.heading);
    this.box.add(this.markdown);
  }

  /** The whole thought so far. The preview cut waits for `finish`: a sliding tail would rebuild every block per delta. */
  set(text: string): void {
    if (text === this.buffer) return;
    this.buffer = text;
    this.box.visible = text.trim() !== "";
    if (!hasIncompleteHeadingPrefix(text)) this.markdown.content = text;
  }

  /** A blank thought earns neither a heading nor the row its block would take. */
  finish(text: string): void {
    this.buffer = text;
    this.box.visible = text.trim() !== "";
    this.heading.content = new StyledText([
      fg(this.theme.thinking)(`${GLYPHS.diamond}${ACTIVITY_THOUGHT_LABEL}`),
    ]);
    this.heading.visible = this.box.visible;
    this.markdown.content = this.preview();
    this.markdown.streaming = false;
  }

  remove(): void {
    this.box.parent?.remove(this.box);
    this.box.destroyRecursively();
  }

  private preview(): string {
    const preview = previewLines(this.buffer, RESULT_PREVIEW_LINES, RESULT_TAIL_LINES);
    return preview.omitted === 0
      ? preview.text
      : `${preview.text}\n${omittedLabel(preview.omitted)}`;
  }
}

type ActivityMode = "working" | "thinking" | "waiting" | "retrying";

/** The turn's single live status row. It never competes with another spinner. */
class ActivityBlock {
  private readonly transcript: Transcript;
  private readonly owner: TurnSection;
  private readonly section: BoxRenderable;
  private readonly line: TextRenderable;
  private readonly animation: symbol;
  private readonly durationMs: number;
  private mode: ActivityMode | "settled" = "working";

  get anchor(): Renderable {
    return this.section;
  }

  constructor(transcript: Transcript, parent: TurnSection, durationMs: number) {
    this.transcript = transcript;
    this.owner = parent;
    this.durationMs = durationMs;
    this.section = section(transcript, "activity", {}, parent);
    this.line = new TextRenderable(transcript.renderer, {
      id: transcript.nextId("activity-line"),
      content: "",
      wrapMode: "none",
    });
    this.section.add(this.line);
    this.animation = parent.animate(this.line, this.frame("working"));
  }

  setMode(mode: ActivityMode): void {
    if (this.mode === "settled" || this.mode === mode) return;
    this.mode = mode;
    this.owner.changeAnimation(this.animation, this.frame(mode));
  }

  settle(outcome: TurnOutcome): void {
    if (this.mode === "settled") return;
    const { theme } = this.transcript;
    const elapsed = this.durationMs + this.owner.stopAnimation(this.animation);
    this.mode = "settled";
    switch (outcome) {
      case "completed": {
        const duration =
          elapsed >= MIN_REPORTED_DURATION_MS ? ` for ${formatDuration(elapsed)}` : "";
        this.line.content = new StyledText([fg(theme.dim)(`${ACTIVITY_WORKED_LABEL}${duration}`)]);
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
  }

  private frame(mode: ActivityMode): (elapsed: number) => StyledText {
    const { theme } = this.transcript;
    switch (mode) {
      case "working":
        return (elapsed) =>
          new StyledText([
            fg(theme.running)(spinnerFrame(elapsed)),
            fg(theme.dim)(ACTIVITY_WORKING_LABEL),
          ]);
      case "thinking":
        return (elapsed) =>
          new StyledText([
            fg(theme.thinking)(spinnerFrame(elapsed)),
            fg(theme.thinking)(ACTIVITY_THINKING_LABEL),
          ]);
      case "waiting":
        return () =>
          new StyledText([
            fg(theme.warning)(GLYPHS.bullet),
            fg(theme.warning)(ACTIVITY_WAITING_LABEL),
          ]);
      case "retrying":
        return (elapsed) =>
          new StyledText([
            fg(theme.warning)(spinnerFrame(elapsed)),
            fg(theme.warning)(ACTIVITY_RETRY_LABEL),
          ]);
      default: {
        const _exhaustive: never = mode;
        return _exhaustive;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tool cards
// ---------------------------------------------------------------------------

function taskPreview(
  part: ToolTurnPart,
): { readonly title: string; readonly prompt: string } | undefined {
  if (part.toolName !== "task" || !isJsonObject(part.args)) return undefined;
  const { agent, prompt } = part.args;
  if (!isJsonString(agent) || !isJsonString(prompt)) return undefined;
  return { title: agent, prompt };
}

/**
 * One card per tool call, reused from the call through progress to the
 * settled result. Unified diffs from edit details or shell output render
 * with DiffRenderable; everything else shows a capped preview.
 */
export class ToolCard {
  readonly container: BoxRenderable;

  private readonly transcript: Transcript;
  private readonly detail: BoxRenderable;
  private readonly heading: TextRenderable;
  private readonly structuredBodies: Renderable[] = [];
  private current: ToolTurnPart;
  private live: ToolLive | undefined;
  private expanded = false;
  private destroyed = false;
  private textBody: CodeRenderable | undefined;
  private omitted: TextRenderable | undefined;

  constructor(
    transcript: Transcript,
    part: ToolTurnPart,
    parent: Renderable,
    before: Renderable | undefined,
  ) {
    this.transcript = transcript;
    this.current = part;
    this.container = section(transcript, "tool", {}, parent, before);
    this.heading = new TextRenderable(transcript.renderer, {
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
    const unregister = transcript.toolOutput.register(this);
    this.container.once(RenderableEvents.DESTROYED, () => {
      this.destroyed = true;
      unregister();
    });
    this.render();
  }

  /** The part as last synced: the call, and its result once settled. */
  get part(): ToolTurnPart {
    return this.current;
  }

  get completed(): boolean {
    return this.current.result !== undefined;
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.expanded) return;
    this.expanded = expanded;
    this.render();
  }

  /** The settled part, or a fresh progress report while the call runs. */
  sync(part: ToolTurnPart, live: ToolLive | undefined): void {
    const changed =
      part !== this.current || live?.text !== this.live?.text || live?.title !== this.live?.title;
    this.current = part;
    this.live = live;
    if (changed) this.render();
  }

  private headingContent(icon: string, color: string, result?: string): StyledText {
    const { theme } = this.transcript;
    const chunks = [fg(color)(icon), ...this.headingTitle()];
    if (result !== undefined) chunks.push(fg(theme.dim)(`  ${result}`));
    return new StyledText(chunks);
  }

  /**
   * The tool name and its title. A shell call's title is a command, which
   * reads as code, so it is highlighted as one once the grammar answers.
   */
  private headingTitle(): TextChunk[] {
    const { theme, labelSyntax } = this.transcript;
    const title = this.title();
    const plain = fg(theme.foreground)(` ${toolHeading(this.current.toolName, title)}`);
    const filetype = HEADING_FILETYPES.get(this.current.toolName);
    if (filetype === undefined || title === undefined) return [plain];
    const highlighted = labelSyntax.chunks(title, filetype, this.transcript.syntaxStyle, () => {
      if (!this.destroyed) this.render();
    });
    if (highlighted === undefined) return [plain];
    return [fg(theme.foreground)(` ${this.current.toolName} `), ...highlighted];
  }

  private title(): string | undefined {
    return this.current.result?.title ?? this.live?.title ?? taskPreview(this.current)?.title;
  }

  private render(): void {
    const { theme } = this.transcript;
    const view = projectToolView(this.current, this.live);
    const presentation = presentTool(view);
    switch (presentation.status) {
      case "running": {
        const preview = taskPreview(this.current);
        const text = this.live?.text ?? preview?.prompt ?? "";
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

  private renderSettled(presentation: ToolPresentation, isError: boolean): void {
    const { theme } = this.transcript;
    const output = this.current.result?.output ?? "";
    if (presentation.body.kind === "diff" && !isError) {
      const { patch, path, added, removed } = presentation.body;
      this.heading.content = this.headingContent(
        GLYPHS.check,
        theme.ok,
        `+${String(added)} -${String(removed)}`,
      );
      this.showDiff({ files: [path === undefined ? { patch } : { patch, path }] });
      return;
    }
    const outputDiff = isError ? undefined : diffFromOutput(output);
    if (outputDiff !== undefined) {
      const stat = diffSections(outputDiff.files.map((file) => file.patch).join("\n"));
      this.heading.content = this.headingContent(
        GLYPHS.check,
        theme.ok,
        `${String(stat.length)} ${stat.length === 1 ? "hunk" : "hunks"}`,
      );
      this.showDiff(outputDiff);
      return;
    }
    const inline = inlineToolPreview(output);
    const summary = presentation.summary ?? inline ?? resultSummary(output);
    // A collapsed read names the file and its size without repeating its body.
    const collapsedRead =
      this.current.toolName === "read" && !isError && !this.expanded && inline === undefined;
    const headingResult = collapsedRead
      ? [summary, `${keycap("chat.tools.toggle")} expand`]
          .filter((value) => value !== undefined)
          .join(" · ")
      : summary;
    this.heading.content = this.headingContent(
      isError ? GLYPHS.cross : GLYPHS.check,
      isError ? theme.error : theme.ok,
      headingResult,
    );
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
    const preview = toolOutputPreview(text, this.expanded);
    if (this.structuredBodies.length > 0) this.clearBody();
    if (preview.text === "") {
      this.clearBody();
      return;
    }
    this.detail.visible = true;
    this.detail.paddingLeft = 2;
    const filetype =
      this.completed && this.current.toolName === "read" && this.title() !== undefined
        ? pathToFiletype(this.title() ?? "")
        : undefined;
    if (this.textBody === undefined) {
      this.textBody = new CodeRenderable(this.transcript.renderer, {
        id: this.transcript.nextId("tool-body"),
        content: preview.text,
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
      this.textBody.content = preview.text;
      this.textBody.fg = color;
    }
    this.omitted ??= label(this.transcript, "", this.transcript.theme.dim);
    if (this.omitted.parent !== this.detail) this.detail.add(this.omitted);
    this.omitted.content = omittedLabel(preview.omitted);
    this.omitted.visible = preview.omitted > 0;
  }

  private showDiff(output: OutputDiff): void {
    this.clearBody();
    this.detail.visible = true;
    this.detail.paddingLeft = 0;
    if (output.before !== undefined) this.addSupplementalPreview(output.before);
    const diffs: DiffRenderable[] = [];
    for (const file of output.files) {
      for (const hunk of diffSections(file.patch)) {
        if (hunk.omittedBefore > 0) {
          const omitted = label(
            this.transcript,
            unchangedLinesLabel(hunk.omittedBefore),
            this.transcript.theme.dim,
          );
          this.detail.add(omitted);
          this.structuredBodies.push(omitted);
        }
        const diff = new DiffRenderable(this.transcript.renderer, {
          id: this.transcript.nextId("tool-diff"),
          diff: hunk.patch,
          view: "unified",
          showLineNumbers: true,
          filetype: file.path === undefined ? undefined : pathToFiletype(file.path),
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
        clipOffscreenDiffLineColors(diff);
        this.detail.add(diff);
        this.structuredBodies.push(diff);
        diffs.push(diff);
      }
    }
    syncDiffGutters(diffs);
    if (output.after !== undefined) this.addSupplementalPreview(output.after);
  }

  private addSupplementalPreview(text: string): void {
    const preview = toolOutputPreview(text, this.expanded);
    if (preview.text === "") return;
    const panel = new BoxRenderable(this.transcript.renderer, {
      id: this.transcript.nextId("tool-output"),
      flexDirection: "column",
      paddingLeft: 2,
      width: "100%",
    });
    panel.add(
      new CodeRenderable(this.transcript.renderer, {
        id: this.transcript.nextId("tool-output-body"),
        content: preview.text,
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
    if (preview.omitted > 0) {
      panel.add(label(this.transcript, omittedLabel(preview.omitted), this.transcript.theme.dim));
    }
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
    if (this.omitted !== undefined) {
      this.detail.remove(this.omitted);
      this.omitted.destroy();
      this.omitted = undefined;
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
 * outcome after. A request nothing has answered yet gets no row: the commit
 * lands one event before its run starts, and "Worked" in that gap is a lie
 * the block could never take back.
 */
export type TurnStatus =
  | {
      readonly kind: "open";
      readonly phase: RunInfo["phase"];
      readonly live: readonly LivePart[];
      readonly waitingForUser: boolean;
    }
  | { readonly kind: "unanswered" }
  | { readonly kind: "settled"; readonly outcome: TurnOutcome };

type PartBlock =
  | { readonly kind: "text"; readonly block: AssistantPartBlock; readonly contentIndex: number }
  | { readonly kind: "thinking"; readonly block: ReasoningBlock; readonly contentIndex: number };

interface ToolLiveView {
  readonly text: string;
  readonly title?: string;
}

/** One visual owner for a user request and every assistant step it drives. */
export class TurnBlock {
  private readonly transcript: Transcript;
  private readonly root: TurnSection;
  private readonly settled = new Set<string>();
  private readonly tools = new Map<string, ToolCard>();
  /** Streaming parts by `livePartKey`, until their commit lands or the run drops them. */
  private readonly live = new Map<string, PartBlock>();
  private activity: ActivityBlock | undefined;
  private durationMs: number;
  private closed = false;

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
    if (turn !== undefined) {
      this.durationMs = turn.durationMs;
      for (const part of turn.parts) this.syncPart(part);
    }
    switch (status.kind) {
      case "open": {
        this.syncLive(status.live);
        const activity = this.ensureActivity();
        activity.setMode(activityMode(status));
        return;
      }
      case "unanswered":
        this.syncLive([]);
        return;
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

  private syncPart(part: TurnPart): void {
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
          adopted.block.finish(part.text);
          return;
        }
        const block = new AssistantPartBlock(this.transcript, this.root, this.contentAnchor());
        block.finish(part.text);
        return;
      }
      case "thinking": {
        if (this.settled.has(id)) return;
        this.settled.add(id);
        const adopted = this.adoptLive("thinking", part.contentIndex);
        if (adopted?.kind === "thinking") {
          adopted.block.finish(part.text);
          return;
        }
        const block = new ReasoningBlock(this.transcript, this.root, this.contentAnchor());
        block.finish(part.text);
        return;
      }
      case "tool": {
        const card = this.tools.get(part.callId);
        if (card === undefined) {
          this.tools.set(
            part.callId,
            new ToolCard(this.transcript, part, this.root, this.contentAnchor()),
          );
          return;
        }
        card.sync(part, undefined);
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
          const block = new AssistantPartBlock(this.transcript, this.root, this.contentAnchor());
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
          const block = new ReasoningBlock(this.transcript, this.root, this.contentAnchor());
          block.set(part.text);
          this.live.set(key, { kind: "thinking", block, contentIndex: part.index });
          break;
        }
        case "tool": {
          const card = this.tools.get(part.callId);
          if (card === undefined) break;
          const view: ToolLiveView = { text: part.progress.text };
          card.sync(
            this.toolPart(part.callId),
            part.progress.title === undefined ? view : { ...view, title: part.progress.title },
          );
          break;
        }
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

  private toolPart(callId: string): ToolTurnPart {
    const card = this.tools.get(callId);
    if (card === undefined) throw new Error(`No tool card for ${callId}`);
    return card.part;
  }

  private settle(outcome: TurnOutcome): void {
    if (this.closed) return;
    this.closed = true;
    this.ensureActivity().settle(outcome);
  }

  private ensureActivity(): ActivityBlock {
    this.activity ??= new ActivityBlock(this.transcript, this.root, this.durationMs);
    return this.activity;
  }

  /** A turn with a status row keeps it last, so content lands above it; the row itself waits for a run. */
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

/** A turn that is nothing but its request. */
function isRequestOnly(turn: Extract<Turn, { kind: "turn" }>): boolean {
  return turn.parts.length === 1 && turn.parts[0]?.kind === "user";
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

type ConfigBody = Extract<Turn, { kind: "config" }>["body"];

/** The merged body of a run of consecutive config commits, and the index it starts at. */
interface ConfigRun {
  readonly body: ConfigBody;
  readonly start: number;
}

/**
 * Consecutive config commits fold into one line: cycling a thinking level
 * lands a commit per step, and the latest value of each field is the only one
 * that still applies. Yields the merged body and where the run of commits begins.
 */
function configRun(items: readonly Turn[], index: number): ConfigRun {
  let start = index;
  while (start > 0 && items[start - 1]?.kind === "config") start -= 1;
  let body: ConfigBody = { kind: "config" };
  for (let cursor = start; cursor <= index; cursor += 1) {
    const item = items[cursor];
    if (item?.kind === "config") body = { ...body, ...item.body };
  }
  return { body, start };
}

/**
 * Reconciles the scroll box with a `SessionState`. Items only ever grow at the
 * tail while the head advances; anything else is a branch change, and the
 * transcript is redrawn from scratch, which is what a go-back looks like.
 */
export class TranscriptView {
  private readonly transcript: Transcript;
  private readonly turns = new Map<string, TurnBlock>();
  private readonly markers = new Map<string, Renderable>();
  private order: string[] = [];
  /** A run streaming with no turn of its own yet (after a checkpoint, before its first commit). */
  private liveTurn: { readonly key: string; readonly block: TurnBlock } | undefined;

  constructor(transcript: Transcript) {
    this.transcript = transcript;
  }

  /** The block for the turn a live run is answering, when one is open. */
  get openTurn(): TurnBlock | undefined {
    const key = this.order.at(-1);
    return key === undefined ? this.liveTurn?.block : (this.turns.get(key) ?? this.liveTurn?.block);
  }

  sync(state: SessionState, options: { readonly reset?: boolean } = {}): void {
    const items = state.transcript.items;
    const keys = items.map(itemKey);
    const extending =
      !options.reset &&
      keys.length >= this.order.length &&
      this.order.every((key, index) => key === keys[index]);
    if (!extending) this.clear();

    const running = isRunningPhase(state.run);
    const lastIndex = items.length - 1;
    // Settled items are immutable records: a delta only touches the open turn,
    // so revisit the last known item (it may settle) and whatever is new.
    const first = extending ? Math.max(0, this.order.length - 1) : 0;
    for (let index = first; index < items.length; index += 1) {
      const item = items[index];
      const key = keys[index];
      if (item === undefined || key === undefined) continue;
      if (item.kind !== "turn") {
        if (!this.markers.has(key)) {
          this.liveTurn?.block.remove();
          this.liveTurn = undefined;
          this.markers.set(key, this.appendMarker(items, index, item));
          this.order.push(key);
        }
        continue;
      }
      let block = this.turns.get(key);
      if (block === undefined) {
        // A run that streamed before its first commit drew into a live turn; the
        // record's turn takes its place.
        this.liveTurn?.block.remove();
        this.liveTurn = undefined;
        block = new TurnBlock(this.transcript, item.id, item.durationMs);
        this.turns.set(key, block);
        this.order.push(key);
      }
      const isLast = index === lastIndex;
      const status: TurnStatus =
        isLast && running && state.run !== undefined
          ? {
              kind: "open",
              phase: state.run.phase,
              live: state.overlay,
              waitingForUser: state.waiting !== undefined,
            }
          : settledStatus(item, isLast ? state.run : undefined);
      block.sync(item, status);
    }

    // Streaming with nothing to attach to: after a checkpoint, or on an empty branch.
    const last = items.at(-1);
    if (running && state.run !== undefined && last?.kind !== "turn") {
      const key = `live:${state.run.runId}`;
      if (this.liveTurn?.key !== key) {
        this.liveTurn?.block.remove();
        this.liveTurn = { key, block: new TurnBlock(this.transcript, key, 0) };
      }
      this.liveTurn.block.sync(undefined, {
        kind: "open",
        phase: state.run.phase,
        live: state.overlay,
        waitingForUser: state.waiting !== undefined,
      });
    } else if (this.liveTurn !== undefined && !running) {
      this.liveTurn.block.remove();
      this.liveTurn = undefined;
    }
    if (!extending) this.scrollToEnd();
  }

  /**
   * Draw one marker. A config commit that follows other config commits takes
   * over their line: the earlier ones come down and their keys point at the
   * merged line, so the order stays aligned with the record.
   */
  private appendMarker(
    items: readonly Turn[],
    index: number,
    item: Exclude<Turn, { kind: "turn" }>,
  ): Renderable {
    if (item.kind !== "config") return appendMarker(this.transcript, item);
    const { body, start } = configRun(items, index);
    const merged = appendMarker(this.transcript, { ...item, body });
    for (let cursor = start; cursor < index; cursor += 1) {
      const previous = items[cursor];
      if (previous === undefined) continue;
      const key = itemKey(previous);
      const line = this.markers.get(key);
      if (line !== undefined && line !== merged) {
        line.parent?.remove(line);
        line.destroyRecursively();
      }
      this.markers.set(key, merged);
    }
    return merged;
  }

  /** Drop every block; the next sync draws the branch again. */
  clear(): void {
    for (const block of this.turns.values()) block.remove();
    this.turns.clear();
    for (const marker of new Set(this.markers.values())) {
      marker.parent?.remove(marker);
      marker.destroyRecursively();
    }
    this.markers.clear();
    this.liveTurn?.block.remove();
    this.liveTurn = undefined;
    this.order = [];
  }

  private scrollToEnd(): void {
    const scroll = this.transcript.container;
    scroll.stickyScroll = true;
    scroll.scrollTo(scroll.scrollHeight);
  }
}

function isRunningPhase(run: RunInfo | undefined): boolean {
  if (run === undefined) return false;
  switch (run.phase.kind) {
    case "done":
    case "aborted":
    case "failed":
      return false;
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return true;
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}
