/**
 * Every panel, picker and prompt is a value on `local.dialogs` (a stack),
 * reduced by its own pure function and drawn by one host component. A
 * dialog's result is an Intent; a sub-screen is a push; "back" is a pop.
 * There are no promise-wrapped pickers and no raw key listeners: keys reach
 * the top dialog only, as `DialogCommand`s from one keymap layer.
 *
 * Async data (tree, sessions, models, usage, directory listings) arrives as a
 * `loaded` outcome addressed by `DialogId`; a dialog that has closed simply
 * never receives it.
 */
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { Intent } from "../msg.ts";
import { editField } from "./field.ts";
import type { Field, FieldEdit } from "./field.ts";
import { reduceAuth } from "./auth.ts";
import type { AuthDialog, AuthPrompt } from "./auth.ts";
import { reduceList } from "./list.ts";
import type { ListDialog, ListPurpose } from "./list.ts";
import { reduceModel } from "./model-picker.ts";
import type { ModelDialog, ModelList } from "./model-picker.ts";
import { reduceInspector } from "./tasks.ts";
import type { InspectorDialog } from "./tasks.ts";
import { reduceTree } from "./tree.ts";
import type { TreeDialog, TreeLoad } from "./tree.ts";

export type DialogId = string;

export type Dialog =
  | ListDialog
  | ModelDialog
  | TreeDialog
  | InspectorDialog
  | TextDialog
  | AuthDialog;

/** A run of a text panel's line, in a theme colour (foreground when absent). */
export interface TextSpan {
  readonly text: string;
  readonly tone?: "foreground" | "muted" | "dim" | "accent" | "warning" | "error";
  readonly bold?: boolean;
}

/** A text panel's line: plain text, or coloured spans. */
export type TextLine = string | readonly TextSpan[];

/** A read-only scrollable panel: usage, keyboard shortcuts, plugins report. */
export interface TextDialog {
  readonly kind: "text";
  readonly id: DialogId;
  readonly title: string;
  readonly body:
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly lines: readonly TextLine[] }
    | { readonly kind: "failed"; readonly message: string };
  readonly scroll: number;
}

/** What `open` asks for. `reduce` turns it into a Dialog plus the load effect it needs. */
export type DialogRequest =
  | { readonly kind: "list"; readonly purpose: ListPurpose }
  | { readonly kind: "model" }
  | { readonly kind: "tree"; readonly filter: "default" | "users" }
  | { readonly kind: "inspector"; readonly task: string }
  | { readonly kind: "text"; readonly content: "usage" | "shortcuts" | "plugins" }
  | { readonly kind: "auth"; readonly mode: "login" | "logout"; readonly provider: string | null };

export type LoadRequest =
  | { readonly kind: "sessions" }
  | { readonly kind: "tree"; readonly session: SessionId }
  | { readonly kind: "models" }
  | { readonly kind: "usage"; readonly session: SessionId }
  | { readonly kind: "directory"; readonly path: string }
  /** The `/plugins` report: client plugin ids, host plugins with source, path and issues, and plugin commands. */
  | { readonly kind: "plugins" };

export type DialogData =
  | { readonly kind: "list"; readonly choices: ListDialog["choices"] }
  | { readonly kind: "models"; readonly models: ModelList }
  | { readonly kind: "tree"; readonly tree: TreeLoad }
  | { readonly kind: "text"; readonly lines: readonly TextLine[] }
  /** Root sessions for `/resume`; the model filters, sorts and labels them. */
  | { readonly kind: "sessions"; readonly sessions: readonly SessionInfo[] }
  /** The next step of a login the auth dialog drives. */
  | { readonly kind: "auth"; readonly step: AuthPrompt };

/** Keys the dialog layer forwards, named by CHAT_KEYBINDS (picker.*, model.*, tree.*, auth.*), plus the typed field's new text. */
export type DialogCommand =
  | { readonly kind: "key"; readonly name: string }
  | { readonly kind: "query"; readonly text: string }
  /** A click: choose the row, as Enter would. */
  | { readonly kind: "pick"; readonly index: number }
  /** A click that only moves the highlight: a model row, the typed-answer row. */
  | { readonly kind: "highlight"; readonly index: number }
  | { readonly kind: "close" };

/** What reaches the top dialog: a command, an edit of its typed field at the caret, or a terminal paste into it. */
export type DialogInput =
  | DialogCommand
  | { readonly kind: "edit"; readonly edit: FieldEdit }
  | { readonly kind: "paste"; readonly text: string };

/** One dialog's reaction: its next value (null closes it) and the intents it emits. */
export interface DialogStep<D extends Dialog> {
  readonly dialog: D | null;
  readonly intents: readonly Intent[];
  /** Pushed on top, for sub-screens such as a setting's choices or the tree's summary question. */
  readonly push: Dialog | null;
}

const TEXT_PAGE = 10;

function reduceText(dialog: TextDialog, command: DialogCommand): DialogStep<TextDialog> {
  if (command.kind === "close") return { dialog: null, intents: [], push: null };

  if (command.kind !== "key") return { dialog, intents: [], push: null };
  const last = dialog.body.kind === "ready" ? Math.max(0, dialog.body.lines.length - 1) : 0;

  const scrollTo = (scroll: number): DialogStep<TextDialog> => ({
    dialog: { ...dialog, scroll: Math.max(0, Math.min(last, scroll)) },
    intents: [],
    push: null,
  });

  switch (command.name) {
    case "picker.close":
    case "tree.close":
      return { dialog: null, intents: [], push: null };
    case "picker.previous":
      return scrollTo(dialog.scroll - 1);
    case "picker.next":
      return scrollTo(dialog.scroll + 1);
    case "picker.page.up":
      return scrollTo(dialog.scroll - TEXT_PAGE);
    case "picker.page.down":
      return scrollTo(dialog.scroll + TEXT_PAGE);
    case "chat.message.previous":
      return scrollTo(0);
    case "chat.message.next":
      return scrollTo(last);
    default:
      return { dialog, intents: [], push: null };
  }
}

/** The typed field's text and caret, or null when the dialog takes no text now. */
export function dialogField(dialog: Dialog): Field | null {
  const text = dialogText(dialog);

  if (text === null) return null;
  const caret = caretOf(dialog) ?? text.length;

  return { text, caret: Math.max(0, Math.min(caret, text.length)) };
}

function caretOf(dialog: Dialog): number | undefined {
  switch (dialog.kind) {
    case "list":
    case "model":
    case "tree":
      return dialog.caret;
    case "auth":
      return dialog.step.kind === "secret" ? dialog.step.caret : undefined;
    case "inspector":
    case "text":
      return undefined;
    default: {
      const _exhaustive: never = dialog;

      return _exhaustive;
    }
  }
}

function withCaret(dialog: Dialog, caret: number | undefined): Dialog {
  switch (dialog.kind) {
    case "list":
    case "model":
    case "tree":
      return { ...dialog, caret };
    case "auth":
      return dialog.step.kind === "secret"
        ? { ...dialog, step: { ...dialog.step, caret } }
        : dialog;
    case "inspector":
    case "text":
      return dialog;
    default: {
      const _exhaustive: never = dialog;

      return _exhaustive;
    }
  }
}

/**
 * An edit changes the field through the dialog's own `query` handling (so a
 * list still filters and a secret still keeps code points), then places the
 * caret; a bare `query` puts the caret at the end. A paste is an insert, as
 * one line.
 */
export function reduceDialog(dialog: Dialog, input: DialogInput): DialogStep<Dialog> {
  if (input.kind === "paste") {
    const text = input.text
      .replaceAll(/[\r\n]+/gu, " ")
      .replaceAll(/\p{Cc}/gu, "")
      .trim();

    return reduceDialog(dialog, { kind: "edit", edit: { kind: "insert", text } });
  }

  if (input.kind === "edit") {
    const field = dialogField(dialog);

    if (field === null) return { dialog, intents: [], push: null };
    const next = editField(field, input.edit);

    if (next.text === field.text && next.caret === field.caret)
      return { dialog, intents: [], push: null };

    const step =
      next.text === field.text
        ? { dialog, intents: [], push: null }
        : reduceKind(dialog, { kind: "query", text: next.text });

    if (step.dialog === null || dialogText(step.dialog) !== next.text) return step;

    return {
      ...step,
      dialog: withCaret(step.dialog, next.caret === next.text.length ? undefined : next.caret),
    };
  }

  const step = reduceKind(dialog, input);

  return input.kind === "query" && step.dialog !== null
    ? { ...step, dialog: withCaret(step.dialog, undefined) }
    : step;
}

function reduceKind(dialog: Dialog, command: DialogCommand): DialogStep<Dialog> {
  switch (dialog.kind) {
    case "list":
      return reduceList(dialog, command);
    case "model":
      return reduceModel(dialog, command);
    case "tree":
      return reduceTree(dialog, command);
    case "inspector":
      return reduceInspector(dialog, command);
    case "text":
      return reduceText(dialog, command);
    case "auth":
      return reduceAuth(dialog, command);
    default: {
      const _exhaustive: never = dialog;

      return _exhaustive;
    }
  }
}

/** Where the host draws it: the slot under the composer, an overlay over the transcript, or the whole screen. */
export function placement(dialog: Dialog): "slot" | "overlay" | "screen" {
  switch (dialog.kind) {
    case "list":
    case "model":
    case "auth":
      return "slot";
    case "text":
      return "overlay";
    case "tree":
    case "inspector":
      return "screen";
    default: {
      const _exhaustive: never = dialog;

      return _exhaustive;
    }
  }
}

/** The text a dialog's typed field holds, or null when the dialog takes no text now. */
export function dialogText(dialog: Dialog): string | null {
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
