/**
 * Every app-level shortcut is a named command in one global keymap layer.
 *
 * `@opentui/keymap`'s OpenTUI host prepends its listener to the renderer's key
 * input, so these bindings resolve before any focused renderable sees the key.
 * Stopping a run, opening the palette, or switching panes cannot depend on
 * which pane the cursor happens to be in.
 *
 * The layers are generic over the keymap's host, so the same registration
 * runs under `@opentui/keymap/testing` without a terminal.
 *
 * Based on OpenCode's keymap wiring:
 * https://github.com/anomalyco/opencode/blob/main/packages/tui/src/keymap.tsx
 */
import { MouseButton } from "@opentui/core";
import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core";
import { stringifyKeyStroke } from "@opentui/keymap";
import type { KeyStrokeInput, Command, Keymap, KeymapEvent } from "@opentui/keymap";
import {
  registerCommaBindings,
  registerDefaultKeys,
  registerEnabledFields,
  registerMetadataFields,
} from "@opentui/keymap/addons";
import { registerBaseLayoutFallback } from "@opentui/keymap/addons/opentui";
import { commandBindings } from "@opentui/keymap/extras";
import { createOpenTuiKeymap } from "@opentui/keymap/opentui";
import { CHAT_KEYBINDS, keyStrokes, type ChatCommand } from "./constants.ts";

export interface ChatCommandSpec {
  readonly title: string;
  readonly hint?: string;
  readonly placement?: "secondary" | "help";
  readonly unavailable?: () => string | undefined;
  /** Omitted means available whenever the layer is. */
  readonly enabled?: () => boolean;
  /**
   * `false` declines the key: the binding's `preventDefault` never runs, so it
   * still reaches the composer or the scrollback. That is how `up` browses
   * history from the start of the draft and moves the cursor everywhere else.
   */
  readonly run: () => boolean | undefined;
}

export type ChatCommands = { readonly [K in ChatCommand]?: ChatCommandSpec };

/**
 * The addons every chat keymap needs: the default key parser, `enabled` and
 * `title`/`category` fields, and `a,b` binding strings for the keycaps that
 * queue a message. The same set goes on the renderer's keymap and the test
 * host's, so a binding proven headless is the binding the terminal runs.
 */
export function installChatAddons<T extends object, E extends KeymapEvent>(
  keymap: Keymap<T, E>,
): void {
  registerDefaultKeys(keymap);
  registerEnabledFields(keymap);
  registerMetadataFields(keymap);
  registerCommaBindings(keymap);
}

/** The renderer-bound keymap the chat layer registers into. */
export function createChatKeymap(renderer: CliRenderer): Keymap<Renderable, KeyEvent> {
  const keymap = createOpenTuiKeymap(renderer);
  installChatAddons(keymap);
  // Fall back to the key's base layout code, so Dvorak and AZERTY keep the
  // same physical shortcuts.
  registerBaseLayoutFallback(keymap);
  return keymap;
}

function chatCommand<T extends object, E extends KeymapEvent>(
  name: ChatCommand,
  spec: ChatCommandSpec,
  onRun: (() => void) | undefined,
): Command<T, E> {
  const command: Command<T, E> = {
    name,
    category: "Chat",
    namespace: "chat",
    get title() {
      return spec.title;
    },
    get hint() {
      return spec.hint ?? spec.title;
    },
    get placement() {
      return spec.placement;
    },
    get unavailable() {
      return spec.unavailable?.();
    },
    enabled: () => spec.unavailable?.() === undefined && spec.enabled?.() !== false,
    run: () => {
      onRun?.();
      return spec.run();
    },
  };
  return command;
}

/**
 * Each layer owns its commands; bindings and displayed shortcuts come from
 * `CHAT_KEYBINDS`. The shared QA matrix covers every command in that registry.
 */
export function registerChatLayer<T extends object, E extends KeymapEvent>(
  keymap: Keymap<T, E>,
  options: {
    /**
     * False while another surface owns the keyboard: a menu, a drag selection,
     * an open completion. The layer stands down rather than racing them.
     */
    readonly enabled: () => boolean;
    readonly commands: Partial<ChatCommands>;
    readonly keybinds?: Readonly<Record<ChatCommand, string>>;
    /** Called before any command runs: a run may edit the composer. */
    readonly onRun?: () => void;
  },
): () => void {
  const names = Object.keys(options.commands).filter(isChatCommand);
  const commands = names.flatMap((name) => {
    const spec = options.commands[name];
    return spec === undefined ? [] : [chatCommand<T, E>(name, spec, options.onRun)];
  });
  return keymap.registerLayer({
    enabled: options.enabled,
    commands,
    bindings: commandBindings<T, E>(
      Object.fromEntries(
        names.map((name) => [name, options.keybinds?.[name] ?? CHAT_KEYBINDS[name]]),
      ),
    ),
  });
}

function isChatCommand(name: string): name is ChatCommand {
  return Object.hasOwn(CHAT_KEYBINDS, name);
}

/** Based on https://github.com/anomalyco/opencode/blob/0643a5638e0cd02234e73f176771527d7600faf7/packages/tui/src/util/selection.ts */
function copy(renderer: CliRenderer, write: (text: string) => void): boolean {
  const selection = renderer.getSelection();
  if (selection === null || (selection.isStart && selection.behavior === "cell")) return false;
  const text = selection.getSelectedText();
  if (text === "") return false;
  write(text);
  // Copy never clears selection: clearing also resets multi-click history.
  return true;
}

/**
 * Ported from OpenCode v2 util/selection.ts and app.tsx at
 * 0643a5638e0cd02234e73f176771527d7600faf7. Selection runs before app bindings.
 */
function handleSelectionKey(
  renderer: CliRenderer,
  write: (text: string) => void,
  event: KeyEvent,
  copyOnSelect: boolean,
): void {
  const selection = renderer.getSelection();
  if (!selection) return;
  const focus = renderer.currentFocusedEditor;
  const editing = focus?.hasSelection() && selection.selectedRenderables.includes(focus);

  // Kitty can report a non-Latin key name with a Latin base-layout C.
  if (event.ctrl && (event.name === "c" || event.baseCode === 99 || event.baseCode === 67)) {
    if ((copyOnSelect && !editing) || !copy(renderer, write)) {
      renderer.clearSelection();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.name === "escape") {
    const text =
      selection.isStart && selection.behavior === "cell" ? "" : selection.getSelectedText();
    renderer.clearSelection();
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (editing) return;
  renderer.clearSelection();
}

export function registerSelectionKeys(
  keymap: Keymap<Renderable, KeyEvent>,
  renderer: CliRenderer,
  options: { readonly copy: (text: string) => void; readonly copyOnSelect: () => boolean },
): () => void {
  const offSelectionKeys = keymap.intercept(
    "key",
    ({ event }) => handleSelectionKey(renderer, options.copy, event, options.copyOnSelect()),
    { priority: 101 },
  );
  renderer.root.onMouseDown = (event) => {
    if (options.copyOnSelect() || event.button !== Number(MouseButton.RIGHT)) return;
    if (!copy(renderer, options.copy)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  renderer.root.onMouseUp = (event) => {
    if (options.copyOnSelect() && event.isDragging) copy(renderer, options.copy);
  };
  return () => {
    offSelectionKeys();
    renderer.root.onMouseDown = undefined;
    renderer.root.onMouseUp = undefined;
  };
}

// ---------------------------------------------------------------------------
// Key decisions that do not need a keymap
// ---------------------------------------------------------------------------

/** How long a second escape still counts as part of the same gesture. */
export const DOUBLE_ESCAPE_MS = 500;

/**
 * Escape twice on an empty composer opens the session tree. The first press
 * only arms the pair, so a lone escape keeps meaning "stop".
 *
 * Based on pi's double-escape timer:
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2866
 */
export class DoubleEscape {
  private armedAt = 0;

  /** True when this press closes the pair; the next press starts a new one. */
  press(now: number = Date.now()): boolean {
    const paired = now - this.armedAt < DOUBLE_ESCAPE_MS;
    this.armedAt = paired ? 0 : now;
    return paired;
  }
}

export type CtrlCAction = "clear_for_quit" | "shutdown";

export interface CtrlCState {
  readonly selecting: boolean;
  readonly prompting: boolean;
  readonly hasDraft: boolean;
}

/**
 * ctrl+c clears a draft first, and quits from an empty composer. While a panel
 * or a prompt owns the keyboard the key is theirs: it closes them, never the app.
 */
export function ctrlCAction(
  key: Pick<KeymapEvent, "name" | "ctrl">,
  state: CtrlCState,
): CtrlCAction | undefined {
  if (!matchesKey("chat.quit", key, "required") || state.prompting || state.selecting)
    return undefined;
  return state.hasDraft ? "clear_for_quit" : "shutdown";
}

/** A printable key that belongs to the composer. */
export function isComposerTextKey(key: KeyEvent): boolean {
  if (key.ctrl || key.meta || key.option || key.super === true) return false;
  const first = key.sequence.charCodeAt(0);
  return key.sequence !== "" && first >= 32 && first !== 127;
}

export function nextThinkingLevel<Level extends string>(
  current: Level,
  supported: readonly Level[],
): Level | undefined {
  if (supported.length < 2) return undefined;
  const index = supported.indexOf(current);
  return supported[(index + 1) % supported.length];
}

const parsedBindings = new Map<string, readonly KeyStrokeInput[]>();

/** Callers project only the modifiers their existing handler owns. */
export function matchesKey(
  command: ChatCommand,
  key: KeyStrokeInput,
  modifiers: "exact" | "required" = "exact",
): boolean {
  const strokes = parsedBindings.get(command) ?? keyStrokes(command);
  parsedBindings.set(command, strokes);
  return strokes.some((stroke) => {
    if (modifiers === "exact") return stringifyKeyStroke(stroke) === stringifyKeyStroke(key);
    return (
      stringifyKeyStroke(stroke) ===
      stringifyKeyStroke({
        name: key.name,
        ctrl: stroke.ctrl && key.ctrl,
        shift: stroke.shift && key.shift,
        meta: stroke.meta && key.meta,
        super: stroke.super && key.super,
        hyper: stroke.hyper && key.hyper,
      })
    );
  });
}

/** Some panels deliberately dispatch by name regardless of modifiers. */
export function matchesKeyName(command: ChatCommand, key: Pick<KeyStrokeInput, "name">): boolean {
  const strokes = parsedBindings.get(command) ?? keyStrokes(command);
  parsedBindings.set(command, strokes);
  return strokes.some(
    (stroke) =>
      stringifyKeyStroke({ name: stroke.name }) === stringifyKeyStroke({ name: key.name }),
  );
}
