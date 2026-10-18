import type { ModelAccount, SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/sdk";
import type { Task } from "../../lib/tasks.ts";
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

export interface TextSpan {
  readonly text: string;
  readonly tone?: "foreground" | "muted" | "dim" | "accent" | "warning" | "error";
  readonly bold?: boolean;
}

export type TextLine = string | readonly TextSpan[];

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

export type DialogRequest =
  | { readonly kind: "list"; readonly purpose: ListPurpose }
  | { readonly kind: "model" }
  | { readonly kind: "tree"; readonly filter: "default" | "users" }
  | { readonly kind: "inspector"; readonly task: string }
  | {
      readonly kind: "text";
      readonly content: "usage" | "shortcuts" | "plugins" | "pull-request";
    }
  | { readonly kind: "mcp" }
  | { readonly kind: "mcp-details"; readonly workspace: WorkspaceId; readonly server: string }
  | { readonly kind: "auth"; readonly mode: "login" | "logout"; readonly provider: string | null };

export type LoadRequest =
  | { readonly kind: "sessions" }
  | { readonly kind: "accounts"; readonly provider: string | null }
  | { readonly kind: "tree"; readonly session: SessionId }
  | { readonly kind: "models" }
  | { readonly kind: "usage"; readonly session: SessionId }
  | { readonly kind: "directory"; readonly path: string }
  | { readonly kind: "plugins" }
  | { readonly kind: "pull-request"; readonly workspace: WorkspaceId }
  | { readonly kind: "mcp-servers"; readonly workspace: WorkspaceId }
  | { readonly kind: "mcp-server"; readonly workspace: WorkspaceId; readonly server: string }
  | { readonly kind: "mcp-details"; readonly workspace: WorkspaceId; readonly server: string };

export type DialogData =
  | { readonly kind: "list"; readonly choices: ListDialog["choices"] }
  | { readonly kind: "accounts"; readonly accounts: readonly ModelAccount[] }
  | { readonly kind: "models"; readonly models: ModelList }
  | { readonly kind: "tree"; readonly tree: TreeLoad }
  | { readonly kind: "text"; readonly lines: readonly TextLine[] }
  | { readonly kind: "sessions"; readonly sessions: readonly SessionInfo[] }
  | { readonly kind: "auth"; readonly step: AuthPrompt };

export type DialogCommand =
  | { readonly kind: "key"; readonly name: string }
  | { readonly kind: "query"; readonly text: string }
  | { readonly kind: "pick"; readonly index: number }
  | { readonly kind: "highlight"; readonly index: number }
  | { readonly kind: "close" };

export type DialogInput =
  | DialogCommand
  | { readonly kind: "edit"; readonly edit: FieldEdit }
  | { readonly kind: "paste"; readonly text: string };

export interface DialogStep<D extends Dialog> {
  readonly dialog: D | null;
  readonly intents: readonly Intent[];
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

export function dialogField(dialog: Dialog): Field | null {
  const text = dialogText(dialog);

  if (text === null) return null;
  const position = readFieldPosition(dialog);
  const caret = Math.max(0, Math.min(position.caret ?? text.length, text.length));
  const anchor = Math.max(0, Math.min(position.anchor ?? caret, text.length));

  return anchor === caret ? { text, caret } : { text, caret, anchor };
}

function readFieldPosition(dialog: Dialog): Partial<Pick<Field, "caret" | "anchor">> {
  switch (dialog.kind) {
    case "list":
    case "model":
    case "tree":
      return { caret: dialog.caret, anchor: dialog.anchor };
    case "auth":
      return dialog.step.kind === "secret" ? dialog.step : {};
    case "inspector":
    case "text":
      return {};
    default: {
      const _exhaustive: never = dialog;

      return _exhaustive;
    }
  }
}

function withFieldPosition(
  dialog: Dialog,
  position: Partial<Pick<Field, "caret" | "anchor">>,
): Dialog {
  switch (dialog.kind) {
    case "list":
    case "model":
    case "tree":
      return { ...dialog, caret: position.caret, anchor: position.anchor };
    case "auth":
      return dialog.step.kind === "secret"
        ? { ...dialog, step: { ...dialog.step, caret: position.caret, anchor: position.anchor } }
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

export function reduceDialog(dialog: Dialog, input: DialogInput): DialogStep<Dialog> {
  if (input.kind === "paste") {
    const text = input.text
      .replaceAll(/[\r\n]+/gu, " ")
      .replaceAll(/\p{Cc}/gu, "")
      .trim();

    if (text === "") return { dialog, intents: [], push: null };

    return reduceDialog(dialog, { kind: "edit", edit: { kind: "insert", text } });
  }

  if (input.kind === "edit") {
    const field = dialogField(dialog);

    if (field === null) return { dialog, intents: [], push: null };
    const next = editField(field, input.edit);

    if (next.text === field.text && next.caret === field.caret && next.anchor === field.anchor)
      return { dialog, intents: [], push: null };

    const step =
      next.text === field.text
        ? { dialog, intents: [], push: null }
        : reduceKind(dialog, { kind: "query", text: next.text });

    if (step.dialog === null || dialogText(step.dialog) !== next.text) return step;

    return {
      ...step,
      dialog: withFieldPosition(step.dialog, {
        caret: next.caret === next.text.length ? undefined : next.caret,
        anchor: next.anchor,
      }),
    };
  }

  const step = reduceKind(dialog, input);

  return input.kind === "query" && step.dialog !== null
    ? { ...step, dialog: withFieldPosition(step.dialog, {}) }
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

export function placement(dialog: Dialog, task: Task | null): "slot" | "screen" {
  switch (dialog.kind) {
    case "list":
      return dialog.purpose.kind === "trust" && dialog.purpose.gate ? "screen" : "slot";
    case "model":
    case "tree":
    case "auth":
    case "text":
      return "slot";
    case "inspector":
      return task?.kind === "agent" && task.view !== undefined ? "screen" : "slot";
    default: {
      const _exhaustive: never = dialog;

      return _exhaustive;
    }
  }
}

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
