import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import type { ComposerImageAttachment, ComposerViewState } from "../../panes/session-view-state.ts";
import { contentDraftText } from "../../references/message-references.ts";
import type { ComposerDocumentState } from "./composer-document.ts";

/** The text and images a refused send gives back. */
export interface Restore {
  readonly text: string;
  readonly attachments: readonly ComposerImageAttachment[];
}

/** The notice above the composer; `restore` is what its Restore Draft button puts back. */
export interface ComposerNotice {
  readonly kind: "status" | "command" | "error";
  readonly message: string;
  readonly restore: Restore | null;
}

/**
 * How a send from the composer ended: `unsent` when the journal still holds it to send later, and
 * `removed` when the person removed its unsent row; only `refused` will never be sent.
 */
export type SendEnd =
  | { readonly kind: "sent"; readonly note: string | undefined }
  | { readonly kind: "unsent" }
  | { readonly kind: "removed" }
  | { readonly kind: "refused"; readonly message: string };

/** A queued message opened in the composer over the person's own text. */
export interface QueuedEdit {
  readonly message: UserMessage;
  readonly view: ComposerViewState;
}

/** A chat's composer as the window keeps it, whether or not a composer shows it. */
export interface SessionDraft {
  readonly composer: ComposerViewState;
  readonly edit: QueuedEdit | null;
  readonly notice: ComposerNotice | null;
}

export function shownDraft(draft: SessionDraft): ComposerViewState {
  return draft.edit?.view ?? draft.composer;
}

/**
 * What the window stores for the chat: an open edit the person changed sits on top of their own
 * text. An unchanged one is still the queued message, so it is left out rather than shown twice.
 */
export function persistedDraft(draft: SessionDraft): ComposerViewState {
  const edit = draft.edit;

  if (
    edit === null ||
    (edit.view.draft === contentDraftText(edit.message.content) &&
      edit.view.attachments.length === 0)
  )
    return draft.composer;

  return draftWith(draft.composer, { text: edit.view.draft, attachments: edit.view.attachments });
}

export function updateShown(
  draft: SessionDraft,
  update: (view: ComposerViewState) => ComposerViewState,
): SessionDraft {
  if (draft.edit === null) return { ...draft, composer: update(draft.composer) };

  return { ...draft, edit: { ...draft.edit, view: update(draft.edit.view) } };
}

/** A keystroke: a change to the text clears any notice that is not an error. */
export function typedDraft(draft: SessionDraft, document: ComposerDocumentState): SessionDraft {
  const typed = updateShown(draft, (view) => ({
    ...view,
    draft: document.text,
    selectionStart: document.selectionStart,
    selectionEnd: document.selectionEnd,
  }));

  if (document.text === shownDraft(draft).draft || draft.notice?.kind === "error") return typed;

  return { ...typed, notice: null };
}

export function openedEdit(draft: SessionDraft, message: UserMessage): SessionDraft {
  const text = contentDraftText(message.content);

  return {
    ...draft,
    edit: {
      message,
      view: {
        draft: text,
        attachments: [],
        selectionStart: text.length,
        selectionEnd: text.length,
      },
    },
    notice: null,
  };
}

/** The edited message left the queue: an unchanged edit goes, a changed one joins the person's text. */
export function lostEdit(draft: SessionDraft): SessionDraft {
  if (draft.edit === null) return draft;

  return { ...draft, composer: persistedDraft(draft), edit: null };
}

/**
 * What closing the composer does to the chat's draft: an open edit the person changed joins their
 * text, and a notice with nothing to restore goes, as both did when the composer held them.
 */
export function foldEdit(draft: SessionDraft): SessionDraft {
  if (draft.edit === null && draft.notice === null) return draft;

  return {
    composer: persistedDraft(draft),
    edit: null,
    notice: draft.notice?.restore === null ? null : draft.notice,
  };
}

/** A send left the composer: its text goes if nothing changed it since, and its images go. */
export function leftDraft(
  draft: SessionDraft,
  sent: ComposerDocumentState,
  attachments: readonly ComposerImageAttachment[],
): SessionDraft {
  const composer = draft.composer;
  const kept = composer.attachments.filter((attachment) => !attachments.includes(attachment));

  return {
    ...draft,
    composer:
      composer.draft === sent.text
        ? { ...composer, draft: "", attachments: kept, selectionStart: 0, selectionEnd: 0 }
        : { ...composer, attachments: kept },
  };
}

/**
 * A send was refused. An empty draft gets the text back at once; a draft with text keeps it and
 * the notice offers Restore Draft. Either way the text goes to the person's own draft, never into
 * a queued edit.
 */
export function refusedDraft(draft: SessionDraft, message: string, sent: Restore): SessionDraft {
  if (draft.composer.draft !== "")
    return { ...draft, notice: { kind: "error", message, restore: sent } };

  return {
    ...draft,
    composer: draftWith(draft.composer, sent),
    notice: { kind: "error", message, restore: null },
  };
}

/**
 * A send ended. Only a refused one gives its text back, as `refusedDraft` does: one the journal
 * still holds shows as an unsent row and goes later, and one the person removed is gone on purpose.
 */
export function endedDraft(draft: SessionDraft, end: SendEnd, sent: Restore): SessionDraft {
  return end.kind === "refused" ? refusedDraft(draft, end.message, sent) : draft;
}

/** Restore Draft: the notice's text goes in front of the person's own draft and the button goes. */
export function restoredDraft(draft: SessionDraft): SessionDraft {
  const notice = draft.notice;

  if (notice === null || notice.restore === null) return draft;

  return {
    ...draft,
    composer: draftWith(draft.composer, notice.restore),
    notice: { ...notice, restore: null },
  };
}

function draftWith(view: ComposerViewState, front: Restore): ComposerViewState {
  const joined = view.draft === "" ? front.text : `${front.text}\n${view.draft}`;

  return {
    ...view,
    draft: joined,
    attachments: [...front.attachments, ...view.attachments],
    selectionStart: joined.length,
    selectionEnd: joined.length,
  };
}
