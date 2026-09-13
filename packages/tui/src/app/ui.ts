/**
 * The terminal's UI state and the handle every feature module writes through.
 * `App.tsx` paints from `ui`; nothing here patches a renderable's content.
 * Leaf widgets that are pure rendering (transcript view, pickers, gutter)
 * stay imperative renderables and are mounted by the app where the store
 * says they belong.
 */
import type { Selection, SelectionReply } from "@nyte-ai/core";
import type {
  BoxRenderable,
  CliRenderer,
  KeyEvent,
  ScrollBoxRenderable,
  ScrollAcceleration,
  TextareaRenderable,
  TextRenderable,
} from "@opentui/core";
import { createStore, type SetStoreFunction } from "solid-js/store";
import { GLYPHS } from "../constants.ts";
import { fitPowerlineSegments, hintGroups, powerlineSegments } from "../format.ts";
import type { PowerlineSegment, PowerlineState } from "../format.ts";
import type { createChatKeymap } from "../keymap.ts";
import type { PendingGutter } from "../pending-gutter.ts";
import type { PendingTail } from "../pending-tail.ts";
import { InlineMenu, PickerCancelled } from "../picker.ts";
import type { Choice, ChoiceAction, MenuScreen } from "../picker.ts";
import type { ActiveCliTheme, CliTheme } from "../theme.ts";
import type { Transcript, TranscriptView } from "../transcript.ts";
import { displayWidth, truncateDisplay } from "../width.ts";

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

/** Something that can hold the ephemeral slot under the composer. */
export interface EphemeralPanel {
  readonly container: BoxRenderable;
  readonly rows: number;
  readonly hints: string;
  focus(): void;
  blur(): void;
  destroy(): void;
}

export interface Notice {
  readonly lines: readonly string[];
  readonly color: string | undefined;
}

/** What the rows under the composer hold. A notice waits while a panel holds them. */
export type Slot =
  | { readonly kind: "empty" }
  | { readonly kind: "notice"; readonly notice: Notice }
  | { readonly kind: "panel"; readonly container: BoxRenderable; readonly rows: number };

/** Mutable only through `setUi`; Solid tracks the fields readers touch. */
export interface UiState {
  /** The line above the transcript while something loads; hidden when undefined. */
  loading: string | undefined;
  status: Partial<PowerlineState>;
  hints: string;
  slot: Slot;
  /** Said while a panel held the slot, shown when the panel gives it back. */
  queuedNotice: Notice | undefined;
  /** Covers the chat without changing its layout. */
  overlay: BoxRenderable | undefined;
  /** Replaces the chat and composer; only the hint row stays. */
  screen: BoxRenderable | undefined;
  /** The tree picker hides the composer and its rule while it has the slot. */
  composerVisible: boolean;
  /** The label before the composer; a line prompt replaces it while it reads. */
  prompt: string;
  /** The composer is reading one line for a prompt rather than chat. */
  prompting: boolean;
  /** Another surface owns the keyboard. */
  selecting: boolean;
}

export function createUiStore(): [UiState, SetStoreFunction<UiState>] {
  return createStore<UiState>({
    loading: undefined,
    status: {},
    hints: "",
    slot: { kind: "empty" },
    queuedNotice: undefined,
    overlay: undefined,
    screen: undefined,
    composerVisible: true,
    prompt: `${GLYPHS.prompt} `,
    prompting: false,
    selecting: false,
  });
}

export interface Shell {
  readonly renderer: CliRenderer;
  readonly keymap: ReturnType<typeof createChatKeymap>;
  readonly ui: UiState;
  readonly setUi: SetStoreFunction<UiState>;
  readonly root: BoxRenderable;
  /** A store: reads track, and `setTheme` recolors everything that read a role. */
  readonly theme: ActiveCliTheme;
  readonly setTheme: (next: CliTheme) => void;
  readonly transcript: Transcript;
  readonly view: TranscriptView;
  readonly scroll: ScrollBoxRenderable;
  readonly input: TextareaRenderable;
  /** Edit buffers keep the width rules from construction, even after capability replies. */
  readonly inputWidthMethod: CliRenderer["widthMethod"];
  /** Follow-ups queued with ctrl+enter, as compact rows in the live column. */
  readonly pendingGutter: PendingGutter;
  /** Steer messages, as turn-shaped blocks at the transcript's tail. */
  readonly pendingTail: PendingTail;
  /** The task browser draws its background count here and takes its clicks. */
  readonly taskStatus: TextRenderable;
  /** Plugin slots render above the pending gutter. */
  readonly pluginSlot: BoxRenderable;
  /** The attachment preview sits between the composer and the ephemeral rows. */
  readonly previewSlot: BoxRenderable;
  readonly focus: FocusController;
  /** New viewports receive an independent wheel policy with the current setting. */
  readonly newScrollAcceleration: () => ScrollAcceleration;
  /** Applies the persisted wheel policy to this shell and future viewports. */
  readonly setScrollAcceleration: (accelerated: boolean) => void;
  readonly nextId: (prefix?: string) => string;
  /** Set by the shell wiring so a panel can dismiss the completion dropdown. */
  closeCompletion: () => void;
  /** A read-only panel yields when a prompt or another panel needs the slot. */
  dismissInfoPanel: (() => void) | undefined;
}

export function setHints(shell: Shell, text: string): void {
  shell.setUi("hints", text);
}

/** One colored run of a row the screen draws as spans. */
export interface Chunk {
  readonly fg: string;
  readonly text: string;
}

/** Keycaps carry the weight, what they do stays quiet, and the dots between groups recede. */
export function hintChunks(text: string, theme: CliTheme): Chunk[] {
  const chunks: Chunk[] = [{ fg: theme.dim, text: "  " }];
  for (const [index, group] of hintGroups(text).entries()) {
    if (index > 0) chunks.push({ fg: theme.muted, text: " · " });
    chunks.push({ fg: theme.user, text: group.key });
    if (group.label !== "") chunks.push({ fg: theme.dim, text: ` ${group.label}` });
  }
  return chunks;
}

function powerlineColor(theme: CliTheme, segment: PowerlineSegment): string {
  switch (segment.tone) {
    case "workspace":
      return theme.path;
    case "model":
      return theme.accent;
    case "effort":
      return theme.thinking;
    case "queue":
      return theme.warning;
    case "usage":
      switch (segment.level) {
        case "ok":
          return theme.dim;
        case "warning":
          return theme.warning;
        case "error":
          return theme.error;
        default: {
          const _exhaustive: never = segment.level;
          return _exhaustive;
        }
      }
    default: {
      const _exhaustive: never = segment;
      return _exhaustive;
    }
  }
}

/** The lower prompt rule with each status segment colored by its role. */
export function framedPowerline(
  state: Partial<PowerlineState> | undefined,
  width: number,
  theme: CliTheme,
  borderColor: string = theme.promptBorder,
): Chunk[] {
  const frameWidth = Math.max(0, Math.floor(width));
  if (frameWidth === 0) return [];
  if (frameWidth === 1) return [{ fg: borderColor, text: GLYPHS.rule }];
  if (frameWidth < 6) {
    return [
      {
        fg: borderColor,
        text: `${GLYPHS.frameBottomLeft}${GLYPHS.rule.repeat(Math.max(0, frameWidth - 2))}${GLYPHS.frameBottomRight}`,
      },
    ];
  }
  const captionWidth = frameWidth - 5;
  const segments = fitPowerlineSegments(powerlineSegments(state ?? {}), captionWidth);
  const chunks: Chunk[] = [{ fg: borderColor, text: `${GLYPHS.frameBottomLeft}${GLYPHS.rule}` }];
  let captionLength = 0;
  for (const [index, segment] of segments.entries()) {
    const separator = index === 0 ? " " : ` ${GLYPHS.separator} `;
    const separatorRoom = captionWidth - captionLength;
    if (separatorRoom <= 0) break;
    const visibleSeparator = truncateDisplay(separator, separatorRoom);
    chunks.push({ fg: borderColor, text: visibleSeparator });
    captionLength += displayWidth(visibleSeparator);
    const textRoom = captionWidth - captionLength;
    if (textRoom <= 0) break;
    const visibleText = truncateDisplay(segment.text, textRoom);
    chunks.push({ fg: powerlineColor(theme, segment), text: visibleText });
    captionLength += displayWidth(visibleText);
  }
  const trailingRule = GLYPHS.rule.repeat(Math.max(1, frameWidth - captionLength - 4));
  chunks.push({ fg: borderColor, text: ` ${trailingRule}${GLYPHS.frameBottomRight}` });
  return chunks;
}

/** Change what the composer's lower rule says; unchanged fields keep their value. */
export function patchStatus(shell: Shell, patch: Partial<PowerlineState>): void {
  shell.setUi("status", (status) => ({ ...status, ...patch }));
}

/**
 * The one way to tell the user something that is not part of the
 * conversation. It lands in the ephemeral slot under the composer and the
 * next keypress takes it back.
 */
export function notice(shell: Shell, text: string | readonly string[], color?: string): void {
  const lines = (Array.isArray(text) ? text : [text]).flatMap((line) => line.split("\n"));
  if (lines.length === 0) {
    clearNotice(shell);
    return;
  }
  const next: Notice = { lines, color };
  if (shell.ui.slot.kind === "panel") shell.setUi("queuedNotice", next);
  else shell.setUi("slot", { kind: "notice", notice: next });
}

/** A keypress takes the notice back; a panel's rows are its own. */
export function clearNotice(shell: Shell): void {
  if (shell.ui.slot.kind === "notice") shell.setUi("slot", { kind: "empty" });
  shell.setUi("queuedNotice", undefined);
}

export function setInputText(input: TextareaRenderable, text: string): void {
  input.setText(text);
  input.gotoBufferEnd();
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The terminal delivers a decomposed character as its base and then its
 * combining mark. OpenTUI's edit buffer keeps a mark inserted on its own but
 * does not display it, so the base is reinserted together with the mark.
 */
export function mergeCombiningMark(input: TextareaRenderable, key: KeyEvent): void {
  if (key.ctrl || key.meta || key.option || key.super || !/^\p{M}$/u.test(key.sequence)) return;
  if (input.hasSelection()) return;
  const base = [...graphemes.segment(input.editBuffer.getTextRange(0, input.cursorOffset))].at(
    -1,
  )?.segment;
  if (base === undefined || base === "\n") return;
  key.preventDefault();
  input.deleteCharBackward();
  input.insertText(base + key.sequence);
}

/** Opens a panel under the composer; every panel opens, holds the keyboard, and closes the same way. */
export function openPanel<P extends EphemeralPanel>(shell: Shell, panel: P): P {
  shell.closeCompletion();
  shell.dismissInfoPanel?.();
  if (shell.ui.selecting) throw new Error("Another panel is already open");
  shell.setUi({
    slot: { kind: "panel", container: panel.container, rows: panel.rows },
    hints: panel.hints,
    selecting: true,
  });
  shell.focus.use(panel);
  shell.input.focusable = false;
  return panel;
}

/** Puts a container in the slot without taking the keyboard, as the completion dropdown does. */
export function holdSlot(shell: Shell, container: BoxRenderable, rows: number): void {
  const { slot } = shell.ui;
  if (slot.kind === "notice") shell.setUi("queuedNotice", slot.notice);
  shell.setUi("slot", { kind: "panel", container, rows });
}

/** The panel holding the slot grew or shrank. */
export function setSlotRows(shell: Shell, rows: number): void {
  const { slot } = shell.ui;
  if (slot.kind !== "panel") return;
  shell.setUi("slot", { kind: "panel", container: slot.container, rows });
}

/** Gives the slot back, but only if `container` still holds it; a waiting notice then shows. */
export function releaseSlot(shell: Shell, container: BoxRenderable): void {
  const { slot, queuedNotice } = shell.ui;
  if (slot.kind !== "panel" || slot.container !== container) return;
  shell.setUi({
    slot: queuedNotice === undefined ? { kind: "empty" } : { kind: "notice", notice: queuedNotice },
    queuedNotice: undefined,
  });
}

/** Tears a panel down and hands the composer back its keyboard. Callers own the hint row. */
export function closePanel(shell: Shell, panel: EphemeralPanel): void {
  releaseSlot(shell, panel.container);
  panel.destroy();
  shell.setUi("selecting", false);
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
        keymap: shell.keymap,
        theme: shell.theme,
        nextId: shell.nextId,
        onRows: (rows) => setSlotRows(shell, rows),
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
  if (shell.ui.selecting) return Promise.reject(new Error("Another menu is already open"));
  if (options.signal?.aborted === true) return Promise.reject(new PickerCancelled());
  if (choices.length === 0 && options.load === undefined) {
    return Promise.reject(new Error("A selection menu needs at least 1 choice"));
  }
  const restoredHints = shell.ui.hints;
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
    const { typedPlaceholder, signal, ...rest } = options;
    const screen: MenuScreen = {
      ...rest,
      title,
      choices,
      onSelect: (id) => settle(() => resolve(id)),
      onCancel: () => settle(() => reject(new PickerCancelled())),
      typed:
        typedPlaceholder === undefined
          ? undefined
          : { placeholder: typedPlaceholder, onSubmit: (text) => settle(() => resolve(text)) },
    };
    menu = openInlineMenu(shell, screen, (cause) => settle(() => reject(cause)));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface SelectSelectionOptions {
  readonly signal?: AbortSignal;
  readonly cancelLabel?: string;
}

/** A protocol selection rendered as one terminal menu, including multi-pick and own text. */
export function selectSelection(
  shell: Shell,
  selection: Selection,
  options: SelectSelectionOptions = {},
): Promise<SelectionReply> {
  shell.dismissInfoPanel?.();
  if (shell.ui.selecting) return Promise.reject(new Error("Another menu is already open"));
  if (options.signal?.aborted === true) return Promise.reject(new PickerCancelled());
  const restoredHints = shell.ui.hints;
  return new Promise<SelectionReply>((resolve, reject) => {
    const selected = new Set<string>();
    let menu: InlineMenu | undefined;
    let settled = false;
    const selectedIds = (): string[] =>
      selection.choices.filter((choice) => selected.has(choice.id)).map((choice) => choice.id);
    const choices = (): Choice[] =>
      selection.choices.map((choice): Choice => ({
        ...choice,
        ...(selection.multiple === true
          ? {
              mark: selected.has(choice.id)
                ? { text: GLYPHS.check, tone: "ok" }
                : { text: "·", tone: "muted" },
            }
          : {}),
      }));
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      if (menu !== undefined) closePanel(shell, menu);
      setHints(shell, restoredHints);
      finish();
    };
    const submit = (other?: string): void => {
      const picked = selectedIds();
      const text = other?.trim();
      const own = text === "" ? undefined : text;
      if (picked.length === 0 && own === undefined) return;
      settle(() =>
        resolve(own === undefined ? { choices: picked } : { choices: picked, other: own }),
      );
    };
    const onAbort = (): void => settle(() => reject(new PickerCancelled()));
    const screen: MenuScreen = {
      title: selection.title,
      choices: choices(),
      selectLabel: selection.multiple === true ? "toggle" : "answer",
      cancelLabel: options.cancelLabel ?? "later",
      actions:
        selection.multiple === true
          ? [
              {
                command: "chat.queue.submit",
                label: "answer",
                keepOpen: true,
                run: () =>
                  submit(selection.other === undefined ? undefined : menu?.queryInput.value),
              },
            ]
          : undefined,
      onSelect: (id) => {
        if (selection.multiple !== true) {
          settle(() => resolve({ choices: [id] }));
          return;
        }
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        menu?.setChoices(choices(), id);
      },
      onCancel: () => settle(() => reject(new PickerCancelled())),
      typed:
        selection.other === undefined
          ? undefined
          : { placeholder: selection.other, onSubmit: (text) => submit(text) },
    };
    menu = openInlineMenu(shell, screen, (cause) => settle(() => reject(cause)));
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}
