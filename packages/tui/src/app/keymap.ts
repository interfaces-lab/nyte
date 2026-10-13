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
 *   100 selection  Ctrl+C copies, Esc clears, while a selection exists (above dialogs)
 *    20 dialog     every non-composer command → its interaction (enabled iff screen.dialog)
 *     5 completion completion.* (enabled iff screen.completion and no dialog)
 *     1 chat       chat.* (enabled iff no dialog)
 *    -1 textarea   managed textarea editing keys, composer.newline, composer.delete.to.line.start
 *
 * Two intercepts run before the layers: every key dismisses the notice, and
 * printable keys and Backspace become the open dialog's `query` when it takes
 * text. After the layers, a key nobody handled while a dialog or the error
 * screen shows is consumed, so it never edits the composer underneath.
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
import { CHAT_KEYBINDS } from "../lib/constants.ts";
import type { ChatCommand } from "../lib/constants.ts";
import type { Dialog } from "../model/dialogs/dialog.ts";
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
      const open = dialog();
      const text = open === null ? null : dialogText(open);

      if (text === null) return;
      const query = typed(event, text);

      if (query === null) return;
      consume();
      store.dispatch({ kind: "dialog", command: { kind: "query", text: query } });
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

/** The text a dialog's typed field holds, or null when the dialog takes no text now. */
function dialogText(dialog: Dialog): string | null {
  switch (dialog.kind) {
    case "list":
      return dialog.answering ?? dialog.query;
    case "model":
    case "tree":
      return dialog.query;
    case "auth":
      return dialog.step.kind === "secret" ? String.fromCodePoint(...dialog.step.codePoints) : null;
    case "inspector":
    case "text":
      return null;
    default: {
      const _exhaustive: never = dialog;

      return _exhaustive;
    }
  }
}

/** The field's next text for a printable key or Backspace, or null for any other key. */
function typed(event: KeyEvent, text: string): string | null {
  if (event.ctrl || event.meta || event.option || event.super === true) return null;

  if (event.name === "backspace") return Array.from(text).slice(0, -1).join("");
  const first = event.sequence.codePointAt(0);

  if (first === undefined || first < 32 || first === 127) return null;

  return text + event.sequence;
}

function selectedText(renderer: CliRenderer): string {
  const selection = renderer.getSelection();

  if (selection === null || (selection.isStart && selection.behavior === "cell")) return "";

  return selection.getSelectedText();
}
