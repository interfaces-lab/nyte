/**
 * The one choice list (was InlineMenu + MenuList): filter by whitespace
 * terms over label, description, status and id; wrap-around movement; an
 * optional typed-answer row after the choices; per-purpose extra actions.
 * The list only moves and filters; accepting a row emits `choose`, and
 * `model/dialogs/accept.ts` decides what that means for each purpose.
 */
import type { CommitId, MessageId, PartId, Revision, SessionId } from "@nyte-ai/sdk";
import type { ChatCommand } from "../../lib/constants.ts";
import type { DialogCommand, DialogId, DialogStep } from "./dialog.ts";

export interface ListDialog {
  readonly kind: "list";
  readonly id: DialogId;
  readonly purpose: ListPurpose;
  readonly title: string;
  readonly choices:
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly items: readonly Choice[] }
    | { readonly kind: "failed"; readonly message: string };
  readonly query: string;
  /** The caret in the typed field (`dialogText`), a UTF-16 offset; absent at the end. */
  readonly caret?: number;
  /** Index into `visibleChoices`; `visibleChoices(…).length` is the typed row. */
  readonly highlighted: number;
  /** The typed answer for purposes that take free text ("" until typed); null for every other purpose. */
  readonly answering: string | null;
  readonly busy: boolean;
}

export interface Choice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly status: {
    readonly text: string;
    readonly tone: "muted" | "ok" | "warning" | "error";
  } | null;
  readonly mark: {
    readonly glyph: string;
    readonly tone: "muted" | "running" | "warning" | "ok" | "error";
  } | null;
}

export type ListPurpose =
  | {
      readonly kind: "question";
      readonly session: SessionId;
      readonly part: PartId;
      readonly typed: true;
    }
  /** `sessions`: the ids the loaded rows name, so a pick switches to a typed id. */
  | { readonly kind: "resume"; readonly sessions: readonly SessionId[] }
  | { readonly kind: "palette" }
  | { readonly kind: "skills" }
  | { readonly kind: "queue"; readonly message: MessageId }
  | { readonly kind: "settings"; readonly highlight: string | null }
  | { readonly kind: "setting"; readonly key: string }
  | {
      readonly kind: "summary";
      readonly target: CommitId;
      readonly revision: Revision | null;
      readonly typed: true;
    }
  | { readonly kind: "tasks"; readonly section: "active" | "finished" }
  | { readonly kind: "provider"; readonly mode: "login" | "logout" };

export interface ListAction {
  readonly command: ChatCommand;
  readonly label: string;
}

const PAGE = 9;

/** The extra per-row keys a purpose offers beside Enter. */
export function listActions(purpose: ListPurpose): readonly ListAction[] {
  if (purpose.kind === "queue")
    return [
      { command: "chat.queue.edit", label: "edit" },
      { command: "chat.queue.delete", label: "delete" },
      { command: "chat.queue.up", label: "earlier" },
      { command: "chat.queue.down", label: "later" },
    ];

  if (purpose.kind === "tasks" && purpose.section === "active")
    return [{ command: "chat.task.stop", label: "cancel" }];

  return [];
}

/** The row label that accepts free text, for purposes that take it. */
export function typedLabel(purpose: ListPurpose): string | null {
  if (purpose.kind === "question") return "Type an answer";

  if (purpose.kind === "summary") return "Summarize with custom prompt";

  return null;
}

export function acceptLabel(purpose: ListPurpose): string {
  switch (purpose.kind) {
    case "queue":
      return "send now";
    case "settings":
      return "open";
    case "tasks":
      return "inspect";
    default:
      return "select";
  }
}

export function cancelLabel(purpose: ListPurpose): string {
  if (purpose.kind === "question") return "later";

  if (purpose.kind === "setting" || purpose.kind === "summary") return "back";

  if (purpose.kind === "tasks" && purpose.section === "finished") return "back";

  return "close";
}

export function emptyLabel(purpose: ListPurpose): string {
  switch (purpose.kind) {
    case "resume":
      return "No saved chats";
    case "skills":
      return "No skills found. Add SKILL.md to .nyte/skills.";
    case "provider":
      return purpose.mode === "login" ? "No providers support login" : "No stored credentials";
    case "queue":
      return "Nothing is queued";
    default:
      return "No choices";
  }
}

/** Every term must appear case-insensitively in `label description status id`. Shared by model and tree search. */
export function matchesTerms(query: string, haystack: string): boolean {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  const text = haystack.toLocaleLowerCase();

  return terms.every((term) => text.includes(term));
}

/** The rows the list shows now: typed purposes never filter, the others by `query`. */
export function visibleChoices(dialog: ListDialog): readonly Choice[] {
  if (dialog.choices.kind !== "ready") return [];

  if (dialog.answering !== null || dialog.query === "") return dialog.choices.items;

  return dialog.choices.items.filter((choice) =>
    matchesTerms(
      dialog.query,
      `${choice.label} ${choice.description} ${choice.status?.text ?? ""} ${choice.id}`,
    ),
  );
}

/** True while the typed-answer row is the highlighted one. */
export function answeringActive(dialog: ListDialog): boolean {
  return dialog.answering !== null && dialog.highlighted >= visibleChoices(dialog).length;
}

function positions(dialog: ListDialog): number {
  return visibleChoices(dialog).length + (dialog.answering === null ? 0 : 1);
}

function moved(dialog: ListDialog, to: number): ListDialog {
  return { ...dialog, highlighted: to };
}

function unchanged(dialog: ListDialog): DialogStep<ListDialog> {
  return { dialog, intents: [], push: null };
}

function accept(dialog: ListDialog, action: ChatCommand | null): DialogStep<ListDialog> {
  if (dialog.choices.kind !== "ready") return unchanged(dialog);

  if (answeringActive(dialog)) {
    const typed = dialog.answering?.trim() ?? "";

    if (typed === "" || action !== null) return unchanged(dialog);

    return {
      dialog,
      intents: [{ kind: "choose", dialog: dialog.id, choice: null, typed, action: null }],
      push: null,
    };
  }

  const choice = visibleChoices(dialog)[dialog.highlighted];

  if (choice === undefined) return unchanged(dialog);

  return {
    dialog,
    intents: [{ kind: "choose", dialog: dialog.id, choice: choice.id, typed: null, action }],
    push: null,
  };
}

/** Moves, filters, types and accepts; the purpose's meaning lives with whoever handles `choose`. */
export function reduceList(dialog: ListDialog, command: DialogCommand): DialogStep<ListDialog> {
  if (command.kind === "close") return { dialog: null, intents: [], push: null };

  if (dialog.busy) return unchanged(dialog);

  if (command.kind === "query") {
    if (dialog.answering !== null)
      return unchanged({
        ...dialog,
        answering: command.text,
        highlighted: visibleChoices(dialog).length,
      });

    return unchanged({ ...dialog, query: command.text, highlighted: 0 });
  }

  if (command.kind === "pick" || command.kind === "highlight") {
    if (command.index < 0 || command.index >= positions(dialog)) return unchanged(dialog);

    return command.kind === "pick"
      ? accept(moved(dialog, command.index), null)
      : unchanged(moved(dialog, command.index));
  }

  const count = positions(dialog);

  switch (command.name) {
    case "picker.close":
      if (dialog.answering === null && dialog.query !== "")
        return unchanged({ ...dialog, query: "", highlighted: 0 });

      if (dialog.answering !== null && dialog.answering !== "")
        return unchanged({ ...dialog, answering: "" });

      if (dialog.purpose.kind === "tasks" && dialog.purpose.section === "finished")
        return {
          dialog,
          intents: [
            {
              kind: "choose",
              dialog: dialog.id,
              choice: "section:active",
              typed: null,
              action: null,
            },
          ],
          push: null,
        };

      return { dialog: null, intents: [], push: null };
    case "picker.accept":
      return accept(dialog, null);
    case "picker.previous":
      return count === 0
        ? unchanged(dialog)
        : unchanged(moved(dialog, (dialog.highlighted - 1 + count) % count));
    case "picker.next":
      return count === 0
        ? unchanged(dialog)
        : unchanged(moved(dialog, (dialog.highlighted + 1) % count));
    case "picker.page.up":
      return unchanged(moved(dialog, Math.max(0, dialog.highlighted - PAGE)));
    case "picker.page.down":
      return unchanged(moved(dialog, Math.max(0, Math.min(count - 1, dialog.highlighted + PAGE))));
    default: {
      const action = listActions(dialog.purpose).find(
        (candidate) => candidate.command === command.name,
      );

      return action === undefined ? unchanged(dialog) : accept(dialog, action.command);
    }
  }
}
