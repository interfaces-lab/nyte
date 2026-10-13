/**
 * `@opentui/keymap` is the transport; the interaction table is the decision.
 * Bindings come from CHAT_KEYBINDS (the one list). Each binding's handler
 * refreshes the draft mirror from the textarea, then dispatches the
 * interaction's intent from `screen().interactions`. A command whose
 * interaction has no intent returns false, so the key falls through to the
 * next layer and finally to the textarea.
 *
 * Layers, by priority:
 *   200 error      R resets the root boundary, Q and Ctrl+C quit (enabled iff the error screen shows)
 *   100 selection  Ctrl+C copies, Esc clears, while a selection exists (above dialogs); with
 *                  copy-on-select, Ctrl+C on a transcript selection clears it and falls through
 *    20 dialog     every non-composer command → its interaction (enabled iff screen.dialog)
 *    10 field      FIELD_KEYBINDS → an edit of the dialog's typed field, when it takes text
 *     5 completion completion.* (enabled iff screen.completion and no dialog)
 *     1 chat       chat.* (enabled iff no dialog)
 *    -1 textarea   managed textarea editing keys, composer.newline, composer.delete.to.line.start
 *
 * Two intercepts run before the layers: every key dismisses the notice and
 * any other key clears a transcript selection, and a printable key is
 * inserted at the open dialog's caret when it takes text. After the layers, a
 * key nobody handled while a dialog or the error screen shows is consumed,
 * so it never edits the composer underneath.
 * No component adds a raw `keyInput` listener.
 */
import { InputRenderable, TextareaRenderable } from "@opentui/core";
import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core";
import type { Command } from "@opentui/keymap";
import {
  registerCommaBindings,
  registerDefaultKeys,
  registerEnabledFields,
  registerMetadataFields,
} from "@opentui/keymap/addons";
import {
  registerBaseLayoutFallback,
  registerManagedTextareaLayer,
} from "@opentui/keymap/addons/opentui";
import { commandBindings } from "@opentui/keymap/extras";
import { createOpenTuiKeymap } from "@opentui/keymap/opentui";
import type { Accessor } from "solid-js";
import { CHAT_KEYBINDS, FIELD_KEYBINDS } from "../lib/constants.ts";
import type { ChatCommand, FieldCommand } from "../lib/constants.ts";
import { dialogText } from "../model/dialogs/dialog.ts";
import type { Dialog } from "../model/dialogs/dialog.ts";
import { FIELD_EDITS } from "../model/dialogs/field.ts";
import { chatCommands } from "../model/interactions.ts";
import { readDraft } from "../ui/composer/composer.tsx";
import type { Store } from "./store.ts";

export interface KeymapOptions {
  readonly renderer: CliRenderer;
  readonly store: Store;
  /** The root boundary's reset while the error screen shows. */
  readonly fallen: Accessor<(() => void) | null>;
  /** Leaves the app without the store, which may be what failed. */
  readonly quit: () => void;
}

interface LayerSpec {
  readonly priority: number;
  readonly enabled: () => boolean;
  readonly commands: readonly Command<Renderable, KeyEvent>[];
  readonly keys: Readonly<Record<string, string>>;
}

export function installKeymap(options: KeymapOptions): () => void {
  const { renderer, store, fallen } = options;
  const keymap = createOpenTuiKeymap(renderer);
  registerDefaultKeys(keymap);
  registerEnabledFields(keymap);
  registerMetadataFields(keymap);
  registerCommaBindings(keymap);
  // Dvorak and AZERTY keep the same physical shortcuts.
  registerBaseLayoutFallback(keymap);

  const live = (): boolean => fallen() === null;
  const dialog = (): Dialog | null => store.screen().dialog;
  const composer = (): TextareaRenderable | null => composerEditor(renderer);

  const refreshDraft = (): void => {
    const editor = composer();

    if (editor === null || dialog() !== null) return;
    const next = readDraft(editor);
    const { draft } = store.state().local;

    if (next.text === draft.text && next.cursor === draft.cursor && next.row === draft.row) return;
    store.dispatch(next);
  };

  const decide = (name: ChatCommand): Command<Renderable, KeyEvent> => ({
    name,
    run() {
      refreshDraft();
      const { intent } = store.screen().interactions[name];

      if (intent === null) return false;
      store.dispatch(intent);

      return true;
    },
  });

  const table = (names: readonly ChatCommand[]): Pick<LayerSpec, "commands" | "keys"> => ({
    commands: names.map(decide),
    keys: Object.fromEntries(names.map((name) => [name, CHAT_KEYBINDS[name]])),
  });

  const names = chatCommands().filter((name) => !name.startsWith("composer."));

  const typing = (): boolean => {
    const open = dialog();

    return open !== null && dialogText(open) !== null;
  };

  const fields = Object.keys(FIELD_KEYBINDS).filter((name): name is FieldCommand =>
    Object.hasOwn(FIELD_EDITS, name),
  );

  const layers: readonly LayerSpec[] = [
    {
      priority: 200,
      enabled: () => !live(),
      commands: [
        { name: "error.reset", run: () => fallen()?.() },
        { name: "error.quit", run: () => options.quit() },
      ],
      keys: { "error.reset": "r", "error.quit": "q,ctrl+c" },
    },
    {
      priority: 100,
      enabled: () => live() && renderer.hasSelection,
      commands: [
        {
          name: "selection.copy",
          run() {
            const text = selectedText(renderer);

            if (store.state().facts.settings.copyOnSelect && !editingSelection(renderer)) {
              renderer.clearSelection();

              return false;
            }

            if (text === "") return false;
            store.dispatch({ kind: "copy-text", text });

            return true;
          },
        },
        {
          name: "selection.clear",
          run() {
            const text = selectedText(renderer);
            renderer.clearSelection();

            return text !== "";
          },
        },
      ],
      keys: { "selection.copy": CHAT_KEYBINDS["chat.quit"], "selection.clear": "escape" },
    },
    {
      priority: 20,
      enabled: () => live() && dialog() !== null,
      ...table(names.filter((name) => !name.startsWith("completion."))),
    },
    {
      priority: 10,
      enabled: () => live() && typing(),
      commands: fields.map((name) => ({
        name,
        run() {
          store.dispatch({ kind: "dialog", command: { kind: "edit", edit: FIELD_EDITS[name] } });
        },
      })),
      keys: Object.fromEntries(fields.map((name) => [name, FIELD_KEYBINDS[name]])),
    },
    {
      priority: 5,
      enabled: () => live() && dialog() === null && store.screen().completion !== null,
      ...table(names.filter((name) => name.startsWith("completion."))),
    },
    {
      priority: 1,
      enabled: () => live() && dialog() === null,
      ...table(names.filter((name) => name.startsWith("chat."))),
    },
  ];

  const disposers = layers.map((layer) =>
    keymap.registerLayer({
      priority: layer.priority,
      enabled: layer.enabled,
      commands: layer.commands,
      bindings: commandBindings<Renderable, KeyEvent>(layer.keys),
    }),
  );

  disposers.push(
    registerManagedTextareaLayer(keymap, renderer, {
      priority: -1,
      enabled: () => live() && dialog() === null && composer() !== null,
      bindings: [
        { key: CHAT_KEYBINDS["chat.submit"], cmd: "input.submit" },
        { key: CHAT_KEYBINDS["composer.newline"], cmd: "input.newline" },
        {
          key: CHAT_KEYBINDS["composer.delete.to.line.start"],
          cmd: "input.delete.to.line.start",
        },
      ],
    }),
    keymap.intercept("key", ({ event, consume }) => {
      if (!live()) return;
      const { local } = store.state();

      if (local.notice !== null || local.watchedRun !== null)
        store.dispatch({ kind: "dismiss-notice" });

      if (renderer.hasSelection && !selectionKey(event) && !editingSelection(renderer))
        renderer.clearSelection();

      if (!typing() || !printable(event)) return;
      consume();
      store.dispatch({
        kind: "dialog",
        command: { kind: "edit", edit: { kind: "insert", text: event.sequence } },
      });
    }),
    keymap.intercept("key:after", ({ handled, consume }) => {
      if (!handled && (!live() || dialog() !== null)) consume();
    }),
  );

  return () => {
    for (const dispose of disposers.splice(0).toReversed()) dispose();
  };
}

/** The composer: the focused textarea, never a single-line input a dialog may focus. */
function composerEditor(renderer: CliRenderer): TextareaRenderable | null {
  const editor = renderer.currentFocusedEditor;

  return editor instanceof TextareaRenderable && !(editor instanceof InputRenderable)
    ? editor
    : null;
}

/** A key that types its sequence: no modifier but Shift, no control character. */
function printable(event: KeyEvent): boolean {
  if (event.ctrl || event.meta || event.option || event.super === true) return false;
  const first = event.sequence.codePointAt(0);

  return first !== undefined && first >= 32 && first !== 127;
}

/** Ctrl+C and Esc: the keys the selection layer answers, so they keep the selection. */
function selectionKey(event: KeyEvent): boolean {
  // Kitty can report a non-Latin key name with a Latin base-layout C.
  const c = event.name === "c" || event.baseCode === 99 || event.baseCode === 67;

  return (event.ctrl && c) || event.name === "escape";
}

/** The selection is inside the focused editor, which handles its own keys. */
function editingSelection(renderer: CliRenderer): boolean {
  const focus = renderer.currentFocusedEditor;
  const selection = renderer.getSelection();

  return (
    focus !== null &&
    selection !== null &&
    focus.hasSelection() &&
    selection.selectedRenderables.includes(focus)
  );
}

function selectedText(renderer: CliRenderer): string {
  const selection = renderer.getSelection();

  if (selection === null || (selection.isStart && selection.behavior === "cell")) return "";

  return selection.getSelectedText();
}
