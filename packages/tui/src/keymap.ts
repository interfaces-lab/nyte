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
import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core";
import type { Command, Keymap, KeymapEvent } from "@opentui/keymap";
import {
  registerCommaBindings,
  registerDefaultKeys,
  registerEnabledFields,
  registerMetadataFields,
} from "@opentui/keymap/addons";
import { registerBaseLayoutFallback } from "@opentui/keymap/addons/opentui";
import { commandBindings } from "@opentui/keymap/extras";
import { createOpenTuiKeymap } from "@opentui/keymap/opentui";
import { CHAT_KEYBINDS, type ChatCommand } from "./constants.ts";

/**
 * A drag selection answers escape and copy itself, so its layer sits above the
 * chat layer. Both keys mean something else the moment the selection is gone,
 * and the layer's `enabled` is what says so.
 */
const SELECTION_KEYBINDS = {
  // Terminals rarely hand cmd+c to the app, so ctrl+c copies too.
  "selection.copy": "ctrl+c,super+c,meta+c",
  "selection.clear": "escape",
} as const satisfies Readonly<Record<string, string>>;

const SELECTION_PRIORITY = 10;

export interface ChatCommandSpec {
  readonly title: string;
  /** Omitted means available whenever the layer is. */
  readonly enabled?: () => boolean;
  /**
   * `false` declines the key: the binding's `preventDefault` never runs, so it
   * still reaches the composer or the scrollback. That is how `up` browses
   * history from the start of the draft and moves the cursor everywhere else.
   */
  readonly run: () => boolean | undefined;
}

export type ChatCommands = { readonly [K in ChatCommand]: ChatCommandSpec };

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
): Command<T, E> {
  const command: Command<T, E> = {
    name,
    category: "Chat",
    title: spec.title,
    run: () => spec.run(),
  };
  return spec.enabled === undefined ? command : { ...command, enabled: spec.enabled };
}

/**
 * `commands` is keyed by the whole `CHAT_KEYBINDS` set, so a bound command with
 * no handler and a handler with no binding are both compile errors.
 */
export function registerChatLayer<T extends object, E extends KeymapEvent>(
  keymap: Keymap<T, E>,
  options: {
    /**
     * False while another surface owns the keyboard: a menu, a drag selection,
     * an open completion. The layer stands down rather than racing them.
     */
    readonly enabled: () => boolean;
    readonly commands: ChatCommands;
    readonly keybinds?: Readonly<Record<ChatCommand, string>>;
  },
): () => void {
  const names = Object.keys(CHAT_KEYBINDS).filter(isChatCommand);
  const commands = names.map((name) => chatCommand<T, E>(name, options.commands[name]));
  return keymap.registerLayer({
    enabled: options.enabled,
    commands,
    bindings: commandBindings<T, E>(options.keybinds ?? CHAT_KEYBINDS),
  });
}

function isChatCommand(name: string): name is ChatCommand {
  return Object.hasOwn(CHAT_KEYBINDS, name);
}

export function registerSelectionLayer(
  keymap: Keymap<Renderable, KeyEvent>,
  renderer: Pick<
    CliRenderer,
    "hasSelection" | "getSelection" | "copyToClipboardOSC52" | "clearSelection"
  >,
): () => void {
  return keymap.registerLayer({
    priority: SELECTION_PRIORITY,
    enabled: () => renderer.hasSelection,
    commands: [
      {
        name: "selection.copy",
        category: "Selection",
        title: "Copy the selected text",
        run: () => {
          const selected = renderer.getSelection()?.getSelectedText();
          if (selected !== undefined && selected !== "") renderer.copyToClipboardOSC52(selected);
          renderer.clearSelection();
        },
      },
      {
        name: "selection.clear",
        category: "Selection",
        title: "Dismiss the selection",
        run: () => {
          renderer.clearSelection();
        },
      },
    ],
    bindings: commandBindings(SELECTION_KEYBINDS),
  });
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

export type EscapeIntent = "abort" | "open_tree" | "ignore";

export interface EscapeState {
  /** Another surface owns the keyboard. */
  readonly selecting: boolean;
  /** The composer is reading a line for a prompt, not chat. */
  readonly prompting: boolean;
  readonly hasDraft: boolean;
  /** A run is live, so there is work to interrupt. */
  readonly busy: boolean;
}

/** Resolve escape before the focused editor sees it. */
export function escapeIntent(state: EscapeState): EscapeIntent {
  if (state.prompting || state.selecting) return "ignore";
  if (state.busy) return "abort";
  return state.hasDraft ? "ignore" : "open_tree";
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
  if (!key.ctrl || key.name !== "c" || state.prompting || state.selecting) return undefined;
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
