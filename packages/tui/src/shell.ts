/**
 * The screen: transcript above, an opaque live column below with the pending
 * gutter, the composer, its status rule, the ephemeral slot, and the hint row.
 *
 * The ephemeral slot borrows rows from the transcript's tail rather than
 * taking them: a negative bottom margin on the scroll box cancels the slot's
 * height, so the viewport keeps its size, nothing re-anchors, and the
 * composer rides up over the chat as far as the slot is tall. The tail is
 * also where a live answer and its status row are, so the same count goes
 * onto the transcript's bottom padding: a view pinned to the bottom scrolls
 * that far in the same layout pass and keeps its newest rows above the
 * cover, and a view scrolled up moves nothing. Panels declare their row
 * count; nothing measures a laid-out height.
 */
import {
  BoxRenderable,
  CliRenderEvents,
  fg,
  MacOSScrollAccel,
  RenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import {
  COMPOSER_PLACEHOLDER,
  GLYPHS,
  IDLE_HINTS,
  TRANSCRIPT_BOTTOM_PADDING,
} from "./constants.ts";
import { fitPowerlineSegments, hintGroups, powerlineSegments } from "./format.ts";
import type { PowerlineState, PowerlineTone } from "./format.ts";
import { LabelSyntax } from "./label-syntax.ts";
import type { LaneRoles } from "./lanes.ts";
import { PendingGutter } from "./pending-gutter.ts";
import { InlineMenu, PickerCancelled } from "./picker.ts";
import type { Choice, ChoiceAction, MenuScreen } from "./picker.ts";
import { createActiveTheme, updateActiveTheme } from "./theme.ts";
import type { ActiveCliTheme, CliTheme } from "./theme.ts";
import {
  createSubtleSyntaxStyle,
  createSyntaxStyle,
  ToolOutputExpansion,
  TranscriptView,
  type Transcript,
} from "./transcript.ts";
import { displayWidth, truncateDisplay } from "./width.ts";

const MAX_COMPOSER_ROWS = 8;
const COMPOSER_CHROME_ROWS = 4;

function composerRowsForHeight(height: number): number {
  return Math.max(1, Math.min(MAX_COMPOSER_ROWS, height - COMPOSER_CHROME_ROWS));
}

/** Keeps the active editor stable across terminal and pane focus changes. */
export class FocusController {
  private readonly defaultTarget: { focus(): void; blur(): void };
  private target: { focus(): void; blur(): void };
  private terminalFocused = true;

  constructor(defaultTarget: { focus(): void; blur(): void }) {
    this.defaultTarget = defaultTarget;
    this.target = defaultTarget;
  }

  use(target: { focus(): void; blur(): void }): void {
    if (this.target !== target) this.target.blur();
    this.target = target;
    if (this.terminalFocused) target.focus();
    else target.blur();
  }

  reset(): void {
    this.use(this.defaultTarget);
  }

  blur(): void {
    if (!this.terminalFocused) return;
    this.terminalFocused = false;
    this.target.blur();
  }

  restore(): void {
    this.terminalFocused = true;
    this.target.focus();
  }
}

/** Something that can hold the ephemeral slot. */
export interface EphemeralPanel {
  readonly container: BoxRenderable;
  readonly rows: number;
  readonly hints: string;
  focus(): void;
  blur(): void;
  destroy(): void;
}

type Occupant =
  | { readonly kind: "empty" }
  | {
      readonly kind: "notice";
      readonly lines: readonly string[];
      readonly color: string | undefined;
    }
  | { readonly kind: "panel"; readonly container: BoxRenderable };

const MAX_NOTICE_SHARE = 0.4;

/** The rows under the composer that the terminal takes back. */
export class Ephemeral {
  readonly container: BoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly scroll: ScrollBoxRenderable;
  private readonly theme: CliTheme;
  private readonly notice: TextRenderable;
  private occupant: Occupant = { kind: "empty" };
  /** Said while a panel held the slot, shown when the panel gives it back. */
  private queued:
    | { readonly lines: readonly string[]; readonly color: string | undefined }
    | undefined;
  private rows = 0;

  constructor(
    renderer: CliRenderer,
    scroll: ScrollBoxRenderable,
    theme: CliTheme,
    nextId: (prefix?: string) => string,
  ) {
    this.renderer = renderer;
    this.scroll = scroll;
    this.theme = theme;
    this.container = new BoxRenderable(renderer, {
      id: "ephemeral",
      width: "100%",
      flexShrink: 0,
      flexDirection: "column",
      visible: false,
      height: 0,
    });
    this.notice = new TextRenderable(renderer, {
      id: nextId("notice"),
      content: "",
      visible: false,
      wrapMode: "none",
      marginLeft: 3,
      marginRight: 2,
    });
    this.container.add(this.notice);
  }

  /** Client status, in the one place the record cannot keep it. The next keypress clears it. */
  say(text: string | readonly string[], color?: string): void {
    const lines = (Array.isArray(text) ? text : [text]).flatMap((line) => line.split("\n"));
    if (lines.length === 0) {
      this.clear();
      return;
    }
    if (this.occupant.kind === "panel") {
      this.queued = { lines, color };
      return;
    }
    this.occupant = { kind: "notice", lines, color };
    this.paintNotice();
  }

  mount(container: BoxRenderable, rows: number): void {
    if (this.occupant.kind !== "panel" || this.occupant.container !== container) {
      this.detachPanel();
      this.notice.visible = false;
      this.occupant = { kind: "panel", container };
      this.container.add(container);
    }
    this.take(rows);
  }

  setRows(rows: number): void {
    if (this.occupant.kind !== "panel") return;
    this.take(rows);
  }

  /** Give the slot back, but only if `owner` still holds it. */
  release(owner: BoxRenderable | "notice"): void {
    const held =
      owner === "notice"
        ? this.occupant.kind === "notice"
        : this.occupant.kind === "panel" && this.occupant.container === owner;
    if (held) this.clear();
  }

  clear(): void {
    if (this.occupant.kind === "empty" && this.queued === undefined) return;
    this.detachPanel();
    this.notice.visible = false;
    this.occupant = { kind: "empty" };
    this.take(0);
    const waiting = this.queued;
    if (waiting === undefined) return;
    this.queued = undefined;
    this.say(waiting.lines, waiting.color);
  }

  resize(): void {
    if (this.occupant.kind === "notice") this.paintNotice();
  }

  retheme(): void {
    if (this.occupant.kind === "notice" && this.occupant.color === undefined) this.paintNotice();
  }

  private detachPanel(): void {
    if (this.occupant.kind !== "panel") return;
    const { container } = this.occupant;
    if (container.parent === this.container) this.container.remove(container);
  }

  private paintNotice(): void {
    if (this.occupant.kind !== "notice") return;
    const { lines, color } = this.occupant;
    const limit = Math.max(1, Math.floor(this.renderer.height * MAX_NOTICE_SHARE));
    const shown = lines.length <= limit ? lines : lines.slice(0, limit);
    this.notice.content = new StyledText([fg(color ?? this.theme.dim)(shown.join("\n"))]);
    this.notice.height = shown.length;
    this.notice.visible = true;
    this.take(shown.length);
  }

  private take(rows: number): void {
    const next = Math.max(0, Math.floor(rows));
    if (next === this.rows) return;
    this.rows = next;
    this.container.height = next;
    this.container.visible = next > 0;
    this.scroll.marginBottom = -next;
    this.scroll.paddingBottom = TRANSCRIPT_BOTTOM_PADDING + next;
  }
}

export interface Shell {
  readonly renderer: CliRenderer;
  readonly root: BoxRenderable;
  readonly theme: ActiveCliTheme;
  readonly transcript: Transcript;
  readonly view: TranscriptView;
  readonly scroll: ScrollBoxRenderable;
  readonly live: BoxRenderable;
  readonly inputBox: BoxRenderable;
  readonly prompt: TextRenderable;
  readonly input: TextareaRenderable;
  readonly powerline: TextRenderable;
  readonly hints: TextRenderable;
  readonly pendingGutter: PendingGutter;
  readonly taskStatus: TextRenderable;
  readonly ephemeral: Ephemeral;
  readonly focus: FocusController;
  readonly nextId: (prefix?: string) => string;
  hintText: string;
  /** The composer is reading one line for a prompt rather than chat. */
  prompting: boolean;
  /** Another surface owns the keyboard. */
  selecting: boolean;
  /** Set by the shell wiring so a panel can dismiss the completion dropdown. */
  closeCompletion: () => void;
  /** A read-only panel yields when a prompt or another panel needs the slot. */
  dismissInfoPanel: (() => void) | undefined;
}

export function setHints(shell: Shell, text: string): void {
  shell.hintText = text;
  shell.hints.content = hintsText(text, shell.theme);
}

/** Keycaps carry the weight, what they do stays quiet, and the dots between groups recede. */
function hintsText(text: string, theme: CliTheme): StyledText {
  const chunks = [fg(theme.dim)("  ")];
  for (const [index, group] of hintGroups(text).entries()) {
    if (index > 0) chunks.push(fg(theme.muted)(" · "));
    chunks.push(fg(theme.user)(group.key));
    if (group.label !== "") chunks.push(fg(theme.dim)(` ${group.label}`));
  }
  return new StyledText(chunks);
}

function powerlineColor(theme: CliTheme, tone: PowerlineTone): string {
  switch (tone) {
    case "workspace":
      return theme.path;
    case "model":
      return theme.accent;
    case "effort":
      return theme.thinking;
    case "queue":
      return theme.warning;
    case "usage":
      return theme.dim;
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}

/** The lower prompt rule with each status segment colored by its role. */
export function framedPowerline(
  state: PowerlineState | undefined,
  width: number,
  theme: CliTheme,
  borderColor: string = theme.promptBorder,
): StyledText {
  const frameWidth = Math.max(0, Math.floor(width));
  if (frameWidth === 0) return new StyledText([]);
  if (frameWidth === 1) return new StyledText([fg(borderColor)(GLYPHS.rule)]);
  if (state === undefined || frameWidth < 6) {
    return new StyledText([
      fg(borderColor)(
        `${GLYPHS.frameBottomLeft}${GLYPHS.rule.repeat(Math.max(0, frameWidth - 2))}${GLYPHS.frameBottomRight}`,
      ),
    ]);
  }
  const captionWidth = frameWidth - 5;
  const segments = fitPowerlineSegments(powerlineSegments(state), captionWidth);
  const chunks = [fg(borderColor)(`${GLYPHS.frameBottomLeft}${GLYPHS.rule}`)];
  let captionLength = 0;
  for (const [index, segment] of segments.entries()) {
    const separator = index === 0 ? " " : ` ${GLYPHS.separator} `;
    const separatorRoom = captionWidth - captionLength;
    if (separatorRoom <= 0) break;
    const visibleSeparator = truncateDisplay(separator, separatorRoom);
    chunks.push(fg(borderColor)(visibleSeparator));
    captionLength += displayWidth(visibleSeparator);
    const textRoom = captionWidth - captionLength;
    if (textRoom <= 0) break;
    const visibleText = truncateDisplay(segment.text, textRoom);
    chunks.push(fg(powerlineColor(theme, segment.tone))(visibleText));
    captionLength += displayWidth(visibleText);
  }
  const trailingRule = GLYPHS.rule.repeat(Math.max(1, frameWidth - captionLength - 4));
  chunks.push(fg(borderColor)(` ${trailingRule}${GLYPHS.frameBottomRight}`));
  return new StyledText(chunks);
}

export function buildShell(
  renderer: CliRenderer,
  initialTheme: CliTheme,
  roles: LaneRoles,
  openPath: (path: string) => void,
): Shell {
  const theme = createActiveTheme(initialTheme);
  let counter = 0;
  const nextId = (prefix = "n"): string => `${prefix}-${String(counter++)}`;
  const userBlocks = new Set<BoxRenderable>();
  const userBlockWidth = (): number => Math.max(1, renderer.width - 4);

  const root = new BoxRenderable(renderer, {
    id: "app",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.background,
  });
  renderer.setBackgroundColor(theme.terminal);

  const scroll = new ScrollBoxRenderable(renderer, {
    id: "transcript",
    flexGrow: 1,
    minHeight: 0,
    stickyScroll: true,
    stickyStart: "bottom",
    scrollX: false,
    scrollY: true,
    paddingLeft: 1,
    paddingRight: 1,
    paddingBottom: TRANSCRIPT_BOTTOM_PADDING,
    scrollAcceleration: new MacOSScrollAccel(),
    verticalScrollbarOptions: {
      trackOptions: {
        backgroundColor: theme.scrollbarTrack,
        foregroundColor: theme.scrollbarThumb,
      },
    },
  });

  const inputBox = new BoxRenderable(renderer, {
    id: "input-box",
    flexDirection: "row",
    flexShrink: 0,
    border: ["top", "right", "left"],
    borderStyle: "rounded",
    borderColor: theme.promptBorder,
    focusedBorderColor: theme.promptBorderFocused,
    titleColor: theme.dim,
    paddingLeft: 1,
    paddingRight: 1,
    marginLeft: 1,
    marginRight: 1,
  });
  const prompt = new TextRenderable(renderer, {
    id: "input-prompt",
    content: `${GLYPHS.prompt} `,
    fg: theme.user,
  });
  const input = new TextareaRenderable(renderer, {
    id: "input",
    flexGrow: 1,
    maxHeight: composerRowsForHeight(renderer.height),
    wrapMode: "word",
    placeholder: COMPOSER_PLACEHOLDER,
    placeholderColor: theme.dim,
    backgroundColor: theme.transparent,
    focusedBackgroundColor: theme.transparent,
    textColor: theme.foreground,
    focusedTextColor: theme.foreground,
    cursorColor: theme.user,
    selectionBg: theme.selectionBackground,
    selectionFg: theme.selectionForeground,
    keyBindings: [
      { name: "return", action: "submit" },
      { name: "kpenter", action: "submit" },
      { name: "return", shift: true, action: "newline" },
      { name: "kpenter", shift: true, action: "newline" },
      { name: "return", meta: true, action: "newline" },
      { name: "kpenter", meta: true, action: "newline" },
      { name: "j", ctrl: true, action: "newline" },
    ],
  });
  inputBox.onMouseDown = (event) => {
    if (event.button !== 0) return;
    // Mouse auto-focus runs after bubbling and must not focus the border or
    // the disabled composer behind a panel.
    event.preventDefault();
    if (input.focusable) focus.reset();
  };
  inputBox.add(prompt);
  inputBox.add(input);

  const composer = new BoxRenderable(renderer, {
    id: "composer",
    width: "100%",
    flexShrink: 0,
    flexDirection: "column",
  });
  const powerline = new TextRenderable(renderer, {
    id: "powerline",
    content: framedPowerline(undefined, renderer.width - 2, theme),
    height: 1,
    flexShrink: 0,
    wrapMode: "none",
    selectable: false,
    marginLeft: 1,
    marginRight: 1,
  });
  const hints = new TextRenderable(renderer, {
    id: "hints",
    content: hintsText(IDLE_HINTS, theme),
    wrapMode: "none",
    height: 1,
    flexShrink: 0,
    marginLeft: 1,
    marginRight: 1,
  });

  const pendingGutter = new PendingGutter(renderer, theme, roles, nextId);
  const taskStatus = new TextRenderable(renderer, {
    id: "task-status",
    height: 1,
    flexShrink: 0,
    marginLeft: 3,
    marginRight: 2,
    wrapMode: "none",
    truncate: true,
    visible: false,
  });
  const ephemeral = new Ephemeral(renderer, scroll, theme, nextId);
  const live = new BoxRenderable(renderer, {
    id: "live",
    width: "100%",
    flexShrink: 0,
    flexDirection: "column",
    backgroundColor: theme.background,
  });

  root.add(scroll);
  live.add(pendingGutter.container);
  live.add(taskStatus);
  composer.add(inputBox);
  composer.add(powerline);
  live.add(composer);
  live.add(ephemeral.container);
  live.add(hints);
  root.add(live);
  renderer.root.add(root);

  const focus = new FocusController(input);
  const resize = (_width: number, height: number): void => {
    input.maxHeight = composerRowsForHeight(height);
    for (const block of userBlocks) block.width = userBlockWidth();
    pendingGutter.resize();
    ephemeral.resize();
  };
  const blur = (): void => focus.blur();
  const restore = (): void => focus.restore();
  renderer.on(CliRenderEvents.RESIZE, resize);
  renderer.on(CliRenderEvents.BLUR, blur);
  renderer.on(CliRenderEvents.FOCUS, restore);
  root.once(RenderableEvents.DESTROYED, () => {
    renderer.off(CliRenderEvents.RESIZE, resize);
    renderer.off(CliRenderEvents.BLUR, blur);
    renderer.off(CliRenderEvents.FOCUS, restore);
  });
  focus.restore();

  const transcript: Transcript = {
    renderer,
    container: scroll,
    syntaxStyle: createSyntaxStyle(theme),
    subtleSyntaxStyle: createSubtleSyntaxStyle(theme),
    theme,
    labelSyntax: new LabelSyntax(),
    toolOutput: new ToolOutputExpansion(),
    nextId,
    openPath,
    userBlocks,
    userBlockWidth,
  };
  return {
    renderer,
    root,
    theme,
    transcript,
    view: new TranscriptView(transcript),
    scroll,
    live,
    inputBox,
    prompt,
    input,
    powerline,
    hints,
    pendingGutter,
    taskStatus,
    ephemeral,
    focus,
    nextId,
    hintText: IDLE_HINTS,
    prompting: false,
    selecting: false,
    closeCompletion: () => undefined,
    dismissInfoPanel: undefined,
  };
}

/** Repaint the shell around a new palette. The caller redraws the transcript after this returns. */
export function applyShellTheme(shell: Shell, next: CliTheme): void {
  updateActiveTheme(shell.theme, next);
  const { theme } = shell;
  shell.renderer.setBackgroundColor(theme.terminal);
  shell.root.backgroundColor = theme.background;
  shell.live.backgroundColor = theme.background;
  shell.scroll.verticalScrollbarOptions = {
    trackOptions: { backgroundColor: theme.scrollbarTrack, foregroundColor: theme.scrollbarThumb },
  };
  shell.inputBox.borderColor = theme.promptBorder;
  shell.inputBox.focusedBorderColor = theme.promptBorderFocused;
  shell.inputBox.titleColor = theme.dim;
  shell.prompt.fg = theme.user;
  shell.input.placeholderColor = theme.dim;
  shell.input.textColor = theme.foreground;
  shell.input.focusedTextColor = theme.foreground;
  shell.input.cursorColor = theme.user;
  shell.input.selectionBg = theme.selectionBackground;
  shell.input.selectionFg = theme.selectionForeground;
  shell.hints.content = hintsText(shell.hintText, theme);
  shell.pendingGutter.retheme();
  shell.ephemeral.retheme();
  shell.transcript.syntaxStyle = createSyntaxStyle(theme);
  shell.transcript.subtleSyntaxStyle = createSubtleSyntaxStyle(theme);
}

/**
 * The one way to tell the user something that is not part of the
 * conversation. It lands in the ephemeral slot under the composer and the
 * next keypress takes it back.
 */
export function notice(shell: Shell, text: string | readonly string[], color?: string): void {
  shell.ephemeral.say(text, color);
}

export function setInputText(input: TextareaRenderable, text: string): void {
  input.setText(text);
  input.gotoBufferEnd();
}

/** Opens a panel under the composer; every panel opens, holds the keyboard, and closes the same way. */
export function openPanel<P extends EphemeralPanel>(shell: Shell, panel: P): P {
  shell.closeCompletion();
  shell.dismissInfoPanel?.();
  if (shell.selecting) throw new Error("Another panel is already open");
  shell.ephemeral.mount(panel.container, panel.rows);
  setHints(shell, panel.hints);
  shell.selecting = true;
  shell.focus.use(panel);
  shell.input.focusable = false;
  return panel;
}

/** Tears a panel down and hands the composer back its keyboard. Callers own the hint row. */
export function closePanel(shell: Shell, panel: EphemeralPanel): void {
  shell.ephemeral.release(panel.container);
  panel.destroy();
  shell.selecting = false;
  shell.input.focusable = true;
  shell.focus.reset();
}

export function openInlineMenu(
  shell: Shell,
  screen: MenuScreen,
  onError: (cause: unknown) => void,
): InlineMenu {
  return openPanel(
    shell,
    new InlineMenu(
      {
        renderer: shell.renderer,
        theme: shell.theme,
        nextId: shell.nextId,
        onRows: (rows) => shell.ephemeral.setRows(rows),
        onError,
      },
      screen,
    ),
  );
}

/** Swaps the screen an open menu shows and keeps the hint row in step. */
export function showMenuScreen(shell: Shell, menu: InlineMenu, screen: MenuScreen): void {
  if (menu.container.isDestroyed) return;
  menu.show(screen);
  setHints(shell, menu.hints);
}

export interface SelectChoiceOptions {
  readonly selectedId?: string;
  readonly maxVisible?: number;
  readonly signal?: AbortSignal;
  readonly actions?: readonly ChoiceAction[];
  readonly selectLabel?: string;
  readonly cancelLabel?: string;
  readonly load?: () => Promise<readonly Choice[]>;
  /**
   * Lets the menu's text field take an answer of its own instead of a filter.
   * Enter with text resolves with that text rather than a choice id.
   */
  readonly typedPlaceholder?: string;
}

/** One-shot menu: resolves with the chosen id, rejects with `PickerCancelled` when the user backs out. */
export function selectChoice(
  shell: Shell,
  title: string,
  choices: readonly Choice[],
  options: SelectChoiceOptions = {},
): Promise<string> {
  shell.dismissInfoPanel?.();
  if (shell.selecting) return Promise.reject(new Error("Another menu is already open"));
  if (options.signal?.aborted === true) return Promise.reject(new PickerCancelled());
  if (choices.length === 0 && options.load === undefined) {
    return Promise.reject(new Error("A selection menu needs at least 1 choice"));
  }
  const restoredHints = shell.hintText;
  return new Promise<string>((resolve, reject) => {
    let menu: InlineMenu | undefined;
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      if (menu !== undefined) closePanel(shell, menu);
      setHints(shell, restoredHints);
      finish();
    };
    const onAbort = (): void => settle(() => reject(new PickerCancelled()));
    let screen: MenuScreen = {
      title,
      choices,
      onSelect: (id) => settle(() => resolve(id)),
      onCancel: () => settle(() => reject(new PickerCancelled())),
    };
    if (options.selectedId !== undefined) screen = { ...screen, selectedId: options.selectedId };
    if (options.maxVisible !== undefined) screen = { ...screen, maxVisible: options.maxVisible };
    if (options.actions !== undefined) screen = { ...screen, actions: options.actions };
    if (options.selectLabel !== undefined) screen = { ...screen, selectLabel: options.selectLabel };
    if (options.cancelLabel !== undefined) screen = { ...screen, cancelLabel: options.cancelLabel };
    if (options.load !== undefined) screen = { ...screen, load: options.load };
    if (options.typedPlaceholder !== undefined) {
      screen = {
        ...screen,
        typed: {
          placeholder: options.typedPlaceholder,
          onSubmit: (text) => settle(() => resolve(text)),
        },
      };
    }
    menu = openInlineMenu(shell, screen, (cause) => settle(() => reject(cause)));
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Owns the stable metadata in the composer's lower rule. */
export class ComposerStatus {
  private readonly renderer: CliRenderer;
  private readonly line: TextRenderable;
  private readonly theme: CliTheme;
  private readonly isFocused: () => boolean;
  private state: PowerlineState;
  private disposed = false;

  constructor(shell: Shell, isFocused: () => boolean, initial: PowerlineState) {
    this.renderer = shell.renderer;
    this.line = shell.powerline;
    this.theme = shell.theme;
    this.isFocused = isFocused;
    this.state = initial;
    this.line.onSizeChange = this.repaint;
    this.repaint();
  }

  patch(patch: Partial<PowerlineState>): void {
    this.state = { ...this.state, ...patch };
    this.repaint();
  }

  replace(state: PowerlineState): void {
    this.state = state;
    this.repaint();
  }

  readonly repaint = (): void => {
    if (this.disposed || this.line.isDestroyed) return;
    const width = this.line.width > 0 ? this.line.width : Math.max(0, this.renderer.width - 2);
    this.line.content = framedPowerline(
      this.state,
      width,
      this.theme,
      this.isFocused() ? this.theme.promptBorderFocused : this.theme.promptBorder,
    );
  };

  dispose(): void {
    this.disposed = true;
  }
}
