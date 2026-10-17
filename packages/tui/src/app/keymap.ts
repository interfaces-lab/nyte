import { InputRenderable, TextareaRenderable } from "@opentui/core";
import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core";
import type { Command } from "@opentui/keymap";
import { registerCommaBindings } from "@opentui/keymap/addons";
import {
  registerBaseLayoutFallback,
  registerManagedTextareaLayer,
} from "@opentui/keymap/addons/opentui";
import { commandBindings } from "@opentui/keymap/extras";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import type { Accessor } from "solid-js";
import { CHAT_KEYBINDS, FIELD_KEYBINDS } from "../lib/constants.ts";
import type { ChatCommand, FieldCommand } from "../lib/constants.ts";
import { dialogText } from "../model/dialogs/dialog.ts";
import type { Dialog } from "../model/dialogs/dialog.ts";
import { FIELD_EDITS } from "../model/dialogs/field.ts";
import { chatCommands } from "../model/interactions.ts";
import { readDraft } from "../ui/composer/composer.tsx";
import type { Store } from "./store.ts";

interface KeymapOptions {
  readonly renderer: CliRenderer;
  readonly store: Store;
  readonly fallen: Accessor<(() => void) | null>;
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
  const keymap = createDefaultOpenTuiKeymap(renderer);
  registerCommaBindings(keymap);
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

  let killed = "";

  const composerCommands: readonly Command<Renderable, KeyEvent>[] = [
    {
      name: "composer.delete.to.line.start",
      run() {
        const editor = composer();

        if (editor === null) return false;
        const before = editor.plainText;
        editor.deleteToLineStart();
        const { text, cursor } = readDraft(editor);
        const removed = before.slice(cursor, cursor + before.length - text.length);

        if (removed !== "") killed = removed;

        return true;
      },
    },
    {
      name: "composer.yank",
      run() {
        const editor = composer();

        if (editor === null || killed === "") return false;
        editor.insertText(killed);

        return true;
      },
    },
  ];

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
      priority: 30,
      enabled: () => live() && typing(),
      commands: [
        {
          name: "field.select.all",
          run() {
            store.dispatch({
              kind: "dialog",
              command: { kind: "edit", edit: { kind: "select-all" } },
            });
          },
        },
        {
          name: "dialog.clipboard.paste",
          run() {
            store.dispatch({ kind: "paste", source: { kind: "clipboard" } });
          },
        },
      ],
      keys: {
        "field.select.all": FIELD_KEYBINDS["field.select.all"],
        "dialog.clipboard.paste": CHAT_KEYBINDS["chat.clipboard.paste"],
      },
    },
    {
      priority: 20,
      enabled: () => live() && dialog() !== null,
      ...table(names.filter((name) => !name.startsWith("completion."))),
    },
    {
      priority: 10,
      enabled: () => live() && typing(),
      commands: fields
        .filter((name) => name !== "field.select.all")
        .map((name) => ({
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
      commands: composerCommands,
      bindings: [
        { key: CHAT_KEYBINDS["chat.submit"], cmd: "input.submit" },
        { key: CHAT_KEYBINDS["composer.newline"], cmd: "input.newline" },
        {
          key: CHAT_KEYBINDS["composer.delete.to.line.start"],
          cmd: "composer.delete.to.line.start",
        },
        { key: CHAT_KEYBINDS["composer.yank"], cmd: "composer.yank" },
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

function composerEditor(renderer: CliRenderer): TextareaRenderable | null {
  const editor = renderer.currentFocusedEditor;

  return editor instanceof TextareaRenderable && !(editor instanceof InputRenderable)
    ? editor
    : null;
}

function printable(event: KeyEvent): boolean {
  if (event.ctrl || event.meta || event.option || event.super === true) return false;
  const first = event.sequence.codePointAt(0);

  return first !== undefined && first >= 32 && first !== 127;
}

/** Whether `event` copies or clears a selection: Ctrl+C (by name or, as kitty reports a non-Latin layout, by its Latin base-layout C) or Escape. */
function selectionKey(event: KeyEvent): boolean {
  const c = event.name === "c" || event.baseCode === 99 || event.baseCode === 67;

  return (event.ctrl && c) || event.name === "escape";
}

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
